/**
 * Delegation Desk — Webflow → Sheets ingest
 *
 * Pulls form submissions from the Webflow Forms API and writes them into:
 *   Submissions            one row per submission, every category
 *   <category label>       one row per submission, that category's answers
 *   Logs                   one row per run
 *
 * Category sheets are found by the submission's `categoryLabel`, so the tab
 * names must match config.variantLabels in the quiz:
 *   Weekend Trip Itinerary, Gift Sourcing Shortlist, Company Deck Template,
 *   Brief Me on Someone, Company Offsite
 *
 * SETUP — Project Settings → Script Properties:
 *   WEBFLOW_API_TOKEN   the API token (never commit it, never paste it in chat)
 *   FORM_ID             the Delegation Desk form id
 *
 * Then run ingestWebflowSubmissions() once by hand and read the Logs sheet.
 * setupIngestTrigger() installs the recurring run.
 *
 * Helper names are prefixed wf_ so this can live alongside
 * webflow-forms-debug.gs without colliding — Apps Script shares one global
 * scope across all files in a project.
 */

var WF_API_BASE = "https://api.webflow.com/v2";

var SHEET_SUBMISSIONS = "Submissions";
var SHEET_LOGS = "Logs";

// Fixed columns on a category sheet, before that category's answer columns.
var CATEGORY_FIXED_HEADERS = [
  "Submitted at",
  "Submission ID",
  "First name",
  "Last name",
  "Email",
  "Company",
  "Email opt-in",
];

var SUBMISSIONS_HEADERS = [
  "Submission ID",
  "Submitted at",
  "Received by Webflow",
  "Schema v",
  "Category",
  "Category label",
  "First name",
  "Last name",
  "Email",
  "Company",
  "Email opt-in",
];

/* ---------------------------------------------------------------- config -- */

function wfProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);

  if (!value) {
    throw new Error(
      name +
        " is not set. Project Settings → Script Properties → add " +
        name +
        "."
    );
  }

  return value;
}

/* ------------------------------------------------------------- webflow ---- */

function wfFetch_(path, params) {
  var url = WF_API_BASE + path;

  if (params) {
    var query = Object.keys(params)
      .filter(function (key) {
        return params[key] !== undefined && params[key] !== null;
      })
      .map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
      })
      .join("&");

    if (query) {
      url += "?" + query;
    }
  }

  var response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: "Bearer " + wfProperty_("WEBFLOW_API_TOKEN"),
      accept: "application/json",
    },
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status === 401 || status === 403) {
    throw new Error(
      "Webflow rejected the token (" + status + "). Check scopes. " + body
    );
  }

  if (status === 429) {
    throw new Error("Webflow rate limited (429). The next run will catch up.");
  }

  if (status < 200 || status >= 300) {
    throw new Error("Webflow " + status + " for " + url + " — " + body);
  }

  return JSON.parse(body);
}

/** Every submission for the form, oldest first. */
function wfFetchAllSubmissions_() {
  var formId = wfProperty_("FORM_ID");
  var all = [];
  var offset = 0;
  var limit = 100;

  while (true) {
    var page = wfFetch_("/forms/" + formId + "/submissions", {
      offset: offset,
      limit: limit,
    });

    // The v2 shape is formSubmissions; fall back rather than silently read
    // nothing if that ever changes.
    var batch = page.formSubmissions || page.submissions || [];

    all = all.concat(batch);

    var total = page.pagination && page.pagination.total;

    if (!batch.length || (total !== undefined && all.length >= total)) {
      break;
    }

    offset += limit;

    // Guard against an endless loop if pagination ever misreports.
    if (offset > 10000) {
      break;
    }
  }

  all.sort(function (a, b) {
    return String(a.dateSubmitted || "").localeCompare(
      String(b.dateSubmitted || "")
    );
  });

  return all;
}

/* -------------------------------------------------------------- parsing --- */

function wfSafeJson_(value, fallback, onError) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    // A truncated or malformed blob would otherwise land as empty columns with
    // no explanation, which is the hardest kind of data loss to notice.
    if (onError) {
      onError(error);
    }

    return fallback;
  }
}

/**
 * ISO strings sort and filter as text in Sheets, which is useless for a date
 * column. Hand back a real Date when it parses.
 */
function wfToDate_(value) {
  if (!value) {
    return "";
  }

  var parsed = new Date(value);

  return isNaN(parsed.getTime()) ? value : parsed;
}

function wfParseSubmission_(submission) {
  var response =
    submission.formResponse || submission.data || submission.fields || {};

  var parseErrors = [];

  function note(field) {
    return function (error) {
      parseErrors.push(field + " is not valid JSON (" + error.message + ")");
    };
  }

  return {
    id: submission.id,
    dateSubmitted: wfToDate_(submission.dateSubmitted),
    v: response.v || "",
    category: response.category || "",
    categoryLabel: response.categoryLabel || "",
    submittedAt: wfToDate_(response.submittedAt),
    contact: wfSafeJson_(response.contact, {}, note("contact")),
    fields: wfSafeJson_(response.fields, {}, note("fields")),
    labels: wfSafeJson_(response.labels, {}, note("labels")),
    parseErrors: parseErrors,
    // Kept so a malformed payload can be inspected rather than guessed at.
    raw: response,
  };
}

/* --------------------------------------------------------------- sheets --- */

function wfGetSheet_(name) {
  return SpreadsheetApp.getActive().getSheetByName(name);
}

function wfEnsureHeaders_(sheet, headers) {
  var lastColumn = sheet.getLastColumn();

  var existing =
    sheet.getLastRow() > 0 && lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
      : [];

  var hasHeaders = existing.some(function (cell) {
    return String(cell).trim() !== "";
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    return headers.slice();
  }

  // Append any header this submission needs but the sheet doesn't have yet, so
  // a new question doesn't need a manual column added.
  var merged = existing.slice();

  headers.forEach(function (header) {
    if (merged.indexOf(header) === -1) {
      merged.push(header);
    }
  });

  if (merged.length > existing.length) {
    sheet.getRange(1, 1, 1, merged.length).setValues([merged]);
    sheet.getRange(1, 1, 1, merged.length).setFontWeight("bold");
  }

  return merged;
}

/** Aligns a {header: value} object to the sheet's header order. */
function wfRowFor_(headers, values) {
  return headers.map(function (header) {
    var value = values[header];

    return value === undefined || value === null ? "" : value;
  });
}

function wfExistingIds_(sheet) {
  var seen = {};

  if (sheet.getLastRow() < 2) {
    return seen;
  }

  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  ids.forEach(function (row) {
    var id = String(row[0]).trim();

    if (id) {
      seen[id] = true;
    }
  });

  return seen;
}

/**
 * Rows are queued and written per sheet in one setValues call at the end of a
 * run. appendRow is a round trip each time, which is slow enough to matter
 * when a backlog lands, and queueing also lets every row in a run share one
 * header set instead of re-reading it per submission.
 */
function wfQueueRow_(pending, sheetName, sheet, headers, values) {
  var entry = pending[sheetName];

  if (!entry) {
    entry = pending[sheetName] = { sheet: sheet, headers: [], rows: [] };
  }

  headers.forEach(function (header) {
    if (entry.headers.indexOf(header) === -1) {
      entry.headers.push(header);
    }
  });

  entry.rows.push(values);

  return entry;
}

function wfFlushPending_(pending, stats) {
  Object.keys(pending).forEach(function (sheetName) {
    var entry = pending[sheetName];

    if (!entry.rows.length) {
      return;
    }

    try {
      var headers = wfEnsureHeaders_(entry.sheet, entry.headers);

      var rows = entry.rows.map(function (values) {
        return wfRowFor_(headers, values);
      });

      entry.sheet
        .getRange(entry.sheet.getLastRow() + 1, 1, rows.length, headers.length)
        .setValues(rows);
    } catch (error) {
      stats.errors.push("write to '" + sheetName + "': " + error.message);
    }
  });
}

function wfSubmissionsRow_(parsed) {
  return {
    headers: SUBMISSIONS_HEADERS,
    values: {
      "Submission ID": parsed.id,
      "Submitted at": parsed.submittedAt,
      "Received by Webflow": parsed.dateSubmitted,
      "Schema v": parsed.v,
      Category: parsed.category,
      "Category label": parsed.categoryLabel,
      "First name": parsed.contact.firstname || "",
      "Last name": parsed.contact.lastname || "",
      Email: parsed.contact.email || "",
      Company: parsed.contact.company || "",
      "Email opt-in": parsed.contact.optin_email || "",
    },
  };
}

function wfCategoryRow_(parsed) {
  // Column order follows the order of keys in `fields`, which follows the
  // Webflow markup order. Headers are the question text from `labels`, so a
  // sheet is readable without knowing the field names.
  var keys = Object.keys(parsed.fields);

  var answerHeaders = keys.map(function (key) {
    return parsed.labels[key] || key;
  });

  var values = {
    "Submitted at": parsed.submittedAt,
    "Submission ID": parsed.id,
    "First name": parsed.contact.firstname || "",
    "Last name": parsed.contact.lastname || "",
    Email: parsed.contact.email || "",
    Company: parsed.contact.company || "",
    "Email opt-in": parsed.contact.optin_email || "",
  };

  keys.forEach(function (key, index) {
    values[answerHeaders[index]] = parsed.fields[key];
  });

  return {
    headers: CATEGORY_FIXED_HEADERS.concat(answerHeaders),
    values: values,
  };
}

function wfWriteLog_(stats) {
  var sheet = wfGetSheet_(SHEET_LOGS);

  if (!sheet) {
    Logger.log("No '%s' sheet — skipping the run log.", SHEET_LOGS);
    return;
  }

  var headers = wfEnsureHeaders_(sheet, [
    "Run at",
    "Fetched",
    "Added",
    "Duplicates",
    "No category sheet",
    "Errors",
    "Duration (ms)",
    "Added IDs",
  ]);

  sheet.appendRow(
    wfRowFor_(headers, {
      "Run at": new Date(),
      Fetched: stats.fetched,
      Added: stats.added,
      Duplicates: stats.duplicates,
      "No category sheet": stats.missingSheet,
      Errors: stats.errors.length ? stats.errors.join(" | ") : "",
      "Duration (ms)": stats.durationMs,
      "Added IDs": stats.addedIds.join(", ").slice(0, 5000),
    })
  );
}

/* ---------------------------------------------------------------- ingest -- */

function ingestWebflowSubmissions() {
  var started = new Date();

  var stats = {
    fetched: 0,
    added: 0,
    duplicates: 0,
    missingSheet: 0,
    errors: [],
    addedIds: [],
    durationMs: 0,
  };

  // One run at a time — a slow run overlapping the next would double-write.
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    Logger.log("Another ingest run holds the lock — skipping this one.");
    return;
  }

  try {
    var submissionsSheet = wfGetSheet_(SHEET_SUBMISSIONS);

    if (!submissionsSheet) {
      throw new Error("No '" + SHEET_SUBMISSIONS + "' sheet in this workbook.");
    }

    var submissions = wfFetchAllSubmissions_();

    stats.fetched = submissions.length;

    // The Submissions sheet is the record of what has been ingested, so there
    // is no separate cursor to drift out of sync.
    var seen = wfExistingIds_(submissionsSheet);
    var pending = {};

    submissions.forEach(function (submission) {
      var parsed;

      try {
        parsed = wfParseSubmission_(submission);
      } catch (error) {
        stats.errors.push("parse " + submission.id + ": " + error.message);
        return;
      }

      if (!parsed.id) {
        stats.errors.push("submission with no id, skipped");
        return;
      }

      if (seen[parsed.id]) {
        stats.duplicates++;
        return;
      }

      // Malformed JSON still gets ingested — a row with the contact and
      // category is more useful than a silently dropped submission — but the
      // run is flagged so it can be looked at.
      parsed.parseErrors.forEach(function (message) {
        stats.errors.push(parsed.id + ": " + message);
      });

      var submissionsRow = wfSubmissionsRow_(parsed);

      wfQueueRow_(
        pending,
        SHEET_SUBMISSIONS,
        submissionsSheet,
        submissionsRow.headers,
        submissionsRow.values
      );

      seen[parsed.id] = true;

      var categorySheet = parsed.categoryLabel
        ? wfGetSheet_(parsed.categoryLabel)
        : null;

      if (categorySheet) {
        var categoryRow = wfCategoryRow_(parsed);

        wfQueueRow_(
          pending,
          parsed.categoryLabel,
          categorySheet,
          categoryRow.headers,
          categoryRow.values
        );
      } else {
        stats.missingSheet++;
        stats.errors.push(
          "no sheet named '" + parsed.categoryLabel + "' for " + parsed.id
        );
      }

      stats.added++;
      stats.addedIds.push(parsed.id);
    });

    wfFlushPending_(pending, stats);
  } catch (error) {
    stats.errors.push(error.message);
    Logger.log("Ingest failed: %s", error.message);
  } finally {
    lock.releaseLock();
  }

  stats.durationMs = new Date().getTime() - started.getTime();

  wfWriteLog_(stats);

  Logger.log(
    "Ingest done — fetched %s, added %s, duplicates %s, errors %s (%sms)",
    stats.fetched,
    stats.added,
    stats.duplicates,
    stats.errors.length,
    stats.durationMs
  );

  return stats;
}

/* ----------------------------------------------------------------- debug -- */

/**
 * Run this before the first real ingest. Fetches without writing anything and
 * logs the raw shape, so a mismatch between what Webflow returns and what this
 * script expects is obvious rather than showing up as empty columns.
 */
function debugFetchSubmissions() {
  var submissions = wfFetchAllSubmissions_();

  Logger.log("Submissions returned: %s", submissions.length);

  if (!submissions.length) {
    Logger.log(
      "None yet. A form has to be published and submitted at least once " +
        "before the API returns anything."
    );
    return [];
  }

  var first = submissions[0];

  Logger.log("First submission, top-level keys: %s", Object.keys(first).join(", "));
  Logger.log("First submission, raw JSON:\n%s", JSON.stringify(first, null, 2));

  var parsed = wfParseSubmission_(first);

  Logger.log("Parsed:");
  Logger.log("  id:            %s", parsed.id);
  Logger.log("  v:             %s", parsed.v);
  Logger.log("  category:      %s", parsed.category);
  Logger.log("  categoryLabel: %s  ← must match a sheet tab name", parsed.categoryLabel);
  Logger.log("  submittedAt:   %s", parsed.submittedAt);
  Logger.log("  contact keys:  %s", Object.keys(parsed.contact).join(", "));
  Logger.log("  field keys:    %s", Object.keys(parsed.fields).join(", "));
  Logger.log("  labels:        %s", JSON.stringify(parsed.labels));

  var tabs = SpreadsheetApp.getActive()
    .getSheets()
    .map(function (sheet) {
      return sheet.getName();
    });

  Logger.log("Sheet tabs: %s", tabs.join(" | "));
  Logger.log(
    "Category sheet for this submission: %s",
    tabs.indexOf(parsed.categoryLabel) === -1
      ? "MISSING — nothing will be written to a category sheet"
      : "found"
  );

  return submissions;
}

/* --------------------------------------------------------------- trigger -- */

/**
 * Feedback for menu actions. Logger.log is invisible to someone working in the
 * spreadsheet, so say it where they are looking. Wrapped because toast is not
 * available in every context this file runs in — a scheduled run has no UI.
 */
function wfToast_(message, title) {
  Logger.log(message);

  try {
    SpreadsheetApp.getActive().toast(message, title || "Delegation Desk", 8);
  } catch (error) {
    // No UI available (scheduled run) — the log line above is enough.
  }
}

function wfIngestTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === "ingestWebflowSubmissions";
  });
}

function wfDeleteTriggers_() {
  var triggers = wfIngestTriggers_();

  triggers.forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  return triggers.length;
}

/**
 * Starts the recurring sync. Clears any existing one first, so running this
 * twice leaves one trigger rather than two racing runs.
 */
function setupIngestTrigger() {
  var replaced = wfDeleteTriggers_();

  ScriptApp.newTrigger("ingestWebflowSubmissions")
    .timeBased()
    .everyMinutes(5)
    .create();

  wfToast_(
    replaced
      ? "Scheduled sync restarted — every 5 minutes."
      : "Scheduled sync started — every 5 minutes."
  );

  return true;
}

function deleteIngestTriggers() {
  var removed = wfDeleteTriggers_();

  wfToast_(
    removed
      ? "Scheduled sync stopped."
      : "Nothing to stop — no scheduled sync was running."
  );

  return removed;
}

/** Reports whether the sync is scheduled, and when it last ran. */
function ingestStatus() {
  var triggers = wfIngestTriggers_();
  var sheet = wfGetSheet_(SHEET_LOGS);
  var lastRun = "never";

  if (sheet && sheet.getLastRow() > 1) {
    var value = sheet.getRange(sheet.getLastRow(), 1).getValue();

    lastRun = value instanceof Date ? value.toLocaleString() : String(value);
  }

  wfToast_(
    (triggers.length
      ? "Scheduled sync is ON (every 5 minutes)."
      : "Scheduled sync is OFF.") + " Last run: " + lastRun
  );

  return { scheduled: triggers.length > 0, lastRun: lastRun };
}

/* ------------------------------------------------------------ manual run -- */

/**
 * Manual sync. Identical to the scheduled run — same dedupe, same lock, same
 * Logs row — so triggering it by hand can't produce a different result from
 * the trigger. Safe to run at any time; already-ingested submissions are
 * skipped.
 */
function syncNow() {
  Logger.log("Manual sync starting…");

  var stats = ingestWebflowSubmissions();

  if (!stats) {
    Logger.log("Sync skipped — another run held the lock.");
    return null;
  }

  Logger.log(
    "Manual sync finished — %s new row(s) from %s submission(s), %s already ingested.",
    stats.added,
    stats.fetched,
    stats.duplicates
  );

  if (stats.errors.length) {
    Logger.log("Errors this run:");
    stats.errors.forEach(function (message) {
      Logger.log("  %s", message);
    });
  }

  return stats;
}

/* ----------------------------------------------------------------- reset -- */

/** Every sheet this system writes to. */
function wfManagedSheetNames_() {
  return [
    SHEET_SUBMISSIONS,
    SHEET_LOGS,
    "Weekend Trip Itinerary",
    "Gift Sourcing Shortlist",
    "Company Deck Template",
    "Brief Me on Someone",
    "Company Offsite",
  ];
}

/**
 * Dry run. Reports exactly what a reset would delete and changes nothing.
 *
 * Deliberately split from the destructive half: this is the function whose
 * name is easy to run by accident, so it is the one that does nothing.
 */
function resetAllSheets() {
  var spreadsheet = SpreadsheetApp.getActive();
  var total = 0;

  Logger.log("DRY RUN — nothing has been deleted.");
  Logger.log("A reset would clear:");

  wfManagedSheetNames_().forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      Logger.log("  %-24s (no such sheet)", name);
      return;
    }

    // Row 1 is headers, so data rows are everything below it.
    var dataRows = Math.max(0, sheet.getLastRow() - 1);

    total += dataRows;

    Logger.log("  %-24s %s data row(s)", name, dataRows);
  });

  Logger.log("");
  Logger.log("Total: %s data row(s) across %s sheet(s).", total, wfManagedSheetNames_().length);
  Logger.log("");
  Logger.log("To actually clear them, run resetAllSheetsConfirmed().");

  return total;
}

/**
 * Destructive. Clears every managed sheet completely — headers included, so
 * the next ingest rebuilds them from whatever the payload looks like then.
 * That matters in dev, where the question set is still changing and stale
 * columns would otherwise linger.
 *
 * Does not touch triggers; deleteIngestTriggers() does that.
 */
function resetAllSheetsConfirmed() {
  var spreadsheet = SpreadsheetApp.getActive();
  var cleared = [];

  wfManagedSheetNames_().forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      Logger.log("Skipped '%s' — no such sheet.", name);
      return;
    }

    var dataRows = Math.max(0, sheet.getLastRow() - 1);

    sheet.clear();
    sheet.setFrozenRows(0);

    cleared.push(name + " (" + dataRows + " row(s))");
  });

  Logger.log("Cleared: %s", cleared.join(", ") || "nothing");
  Logger.log(
    "Headers are gone too — the next ingest rebuilds them from the payload."
  );

  return cleared;
}

/* ------------------------------------------------------------------ menu -- */

/**
 * Puts the manual actions in the spreadsheet's own menu bar, so a sync doesn't
 * mean opening the script editor. Runs automatically when the sheet is opened.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Delegation Desk")
    .addItem("Sync now", "syncNow")
    .addSeparator()
    .addItem("Start scheduled sync (every 5 min)", "setupIngestTrigger")
    .addItem("Stop scheduled sync", "deleteIngestTriggers")
    .addItem("Sync status", "ingestStatus")
    .addSeparator()
    .addItem("Check connection", "debugFetchSubmissions")
    .addSeparator()
    .addItem("Reset — preview", "resetAllSheets")
    .addItem("Reset — clear everything", "resetAllSheetsConfirmed")
    .addToUi();
}
