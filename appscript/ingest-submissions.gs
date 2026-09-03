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
 *   RESET_PASSWORD      gates "Reset — clear everything"
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

// Columns the ingest must never write to. They are filled in by hand after a
// submission lands, so an ingest that rewrote them — even with a blank — would
// destroy work. "Output" is column A on every category sheet.
var RESERVED_HEADERS = ["Output"];

// Reserved columns a fresh category sheet is created with, in this order and
// ahead of the ingest's own columns. Only used when a sheet has no headers at
// all, so a reset rebuilds the layout that was there before.
var CATEGORY_LEADING_HEADERS = ["Output"];

// Fixed columns on a category sheet, after the reserved ones and before that
// category's answer columns.
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

function wfIsCategorySheet_(name) {
  return name !== SHEET_SUBMISSIONS && name !== SHEET_LOGS;
}

function wfIsReserved_(header) {
  return RESERVED_HEADERS.indexOf(String(header).trim()) !== -1;
}

function wfEnsureHeaders_(sheet, headers, leadingHeaders) {
  var lastColumn = sheet.getLastColumn();

  var existing =
    sheet.getLastRow() > 0 && lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
      : [];

  // getLastColumn() reports the used range, which can run past the last real
  // header when a column has been formatted or touched. Trailing blanks would
  // push appended headers off into empty space.
  while (existing.length && String(existing[existing.length - 1]).trim() === "") {
    existing.pop();
  }

  var hasHeaders = existing.some(function (cell) {
    return String(cell).trim() !== "";
  });

  if (!hasHeaders) {
    // Fresh or just-reset sheet: lay out the reserved columns first, so
    // "Output" comes back as column A rather than being lost.
    var initial = (leadingHeaders || []).concat(headers);

    sheet.getRange(1, 1, 1, initial.length).setValues([initial]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, initial.length).setFontWeight("bold");

    return initial;
  }

  // Append any header this submission needs but the sheet doesn't have yet, so
  // a new question doesn't need a manual column added.
  var added = headers.filter(function (header) {
    return existing.indexOf(header) === -1;
  });

  if (!added.length) {
    return existing.slice();
  }

  // Write only the new cells. Rewriting the whole row would touch the
  // reserved columns — same value, but it would also restyle them, and there
  // is no reason to write a cell someone else owns.
  sheet
    .getRange(1, existing.length + 1, 1, added.length)
    .setValues([added])
    .setFontWeight("bold");

  return existing.concat(added);
}

/** Aligns a {header: value} object to the sheet's header order. */
function wfRowFor_(headers, values) {
  return headers.map(function (header) {
    var value = values[header];

    return value === undefined || value === null ? "" : value;
  });
}

function wfExistingIds_(sheet, headerName) {
  var seen = {};

  if (!sheet || sheet.getLastRow() < 2) {
    return seen;
  }

  var wanted = headerName || "Submission ID";
  var lastColumn = sheet.getLastColumn();

  if (!lastColumn) {
    return seen;
  }

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var column = headers.indexOf(wanted) + 1;

  // The id column is column A on Submissions but sits after Output and
  // Submitted at on a category sheet, so it has to be found by header rather
  // than assumed.
  if (!column) {
    return seen;
  }

  var ids = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getValues();

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
      var leading = wfIsCategorySheet_(sheetName)
        ? CATEGORY_LEADING_HEADERS
        : [];

      var headers = wfEnsureHeaders_(entry.sheet, entry.headers, leading);

      // The block of columns the ingest owns, so reserved columns are left
      // exactly as they are — no blank written over a hand-filled cell, and
      // no formula in that column overwritten.
      var ownedIndexes = [];

      headers.forEach(function (header, index) {
        if (!wfIsReserved_(header)) {
          ownedIndexes.push(index);
        }
      });

      if (!ownedIndexes.length) {
        stats.errors.push("'" + sheetName + "': no writable columns");
        return;
      }

      var firstOwned = Math.min.apply(null, ownedIndexes);
      var lastOwned = Math.max.apply(null, ownedIndexes);

      // A reserved column between the first and last owned one cannot be
      // skipped by a single setValues, so say so rather than quietly
      // clobbering it. Keeping reserved columns at the edges avoids this.
      for (var i = firstOwned; i <= lastOwned; i++) {
        if (wfIsReserved_(headers[i])) {
          stats.errors.push(
            "'" +
              sheetName +
              "': reserved column '" +
              headers[i] +
              "' sits inside the ingest's columns and would be overwritten — " +
              "move it to column A. Nothing was written."
          );
          return;
        }
      }

      var rows = entry.rows.map(function (values) {
        return wfRowFor_(headers, values).slice(firstOwned, lastOwned + 1);
      });

      // A sheet trimmed to fewer columns than the payload needs would throw
      // "those columns are out of bounds" and lose the whole batch.
      var neededColumns = lastOwned + 1;

      if (entry.sheet.getMaxColumns() < neededColumns) {
        entry.sheet.insertColumnsAfter(
          entry.sheet.getMaxColumns(),
          neededColumns - entry.sheet.getMaxColumns()
        );
      }

      var neededRows = entry.sheet.getLastRow() + rows.length;

      if (entry.sheet.getMaxRows() < neededRows) {
        entry.sheet.insertRowsAfter(
          entry.sheet.getMaxRows(),
          neededRows - entry.sheet.getMaxRows()
        );
      }

      entry.sheet
        .getRange(
          entry.sheet.getLastRow() + 1,
          firstOwned + 1,
          rows.length,
          lastOwned - firstOwned + 1
        )
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
    "Backfilled",
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
      Backfilled: stats.backfilled,
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
    backfilled: 0,
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
    // Dedupe is per destination sheet, not global. A submission already in
    // Submissions can still be missing from its category sheet — because that
    // sheet was cleared, recreated, or added later — and skipping it outright
    // would leave the category sheets permanently unable to catch up.
    var seenBySheet = {};

    seenBySheet[SHEET_SUBMISSIONS] = wfExistingIds_(submissionsSheet);

    function alreadyIn(sheetName, sheet, id) {
      if (!seenBySheet[sheetName]) {
        seenBySheet[sheetName] = wfExistingIds_(sheet);
      }

      return seenBySheet[sheetName][id] === true;
    }

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

      var categorySheet = parsed.categoryLabel
        ? wfGetSheet_(parsed.categoryLabel)
        : null;

      var needsSubmissions = !alreadyIn(
        SHEET_SUBMISSIONS,
        submissionsSheet,
        parsed.id
      );

      var needsCategory =
        Boolean(categorySheet) &&
        !alreadyIn(parsed.categoryLabel, categorySheet, parsed.id);

      if (!needsSubmissions && !needsCategory) {
        stats.duplicates++;
        return;
      }

      // Malformed JSON still gets ingested — a row with the contact and
      // category is more useful than a silently dropped submission — but the
      // run is flagged so it can be looked at.
      parsed.parseErrors.forEach(function (message) {
        stats.errors.push(parsed.id + ": " + message);
      });

      if (needsSubmissions) {
        var submissionsRow = wfSubmissionsRow_(parsed);

        wfQueueRow_(
          pending,
          SHEET_SUBMISSIONS,
          submissionsSheet,
          submissionsRow.headers,
          submissionsRow.values
        );

        seenBySheet[SHEET_SUBMISSIONS][parsed.id] = true;
        stats.added++;
        stats.addedIds.push(parsed.id);
      }

      if (needsCategory) {
        var categoryRow = wfCategoryRow_(parsed);

        wfQueueRow_(
          pending,
          parsed.categoryLabel,
          categorySheet,
          categoryRow.headers,
          categoryRow.values
        );

        seenBySheet[parsed.categoryLabel][parsed.id] = true;

        // Counted separately: a row that goes only to a category sheet is a
        // backfill, not a new submission, and conflating them would make the
        // Logs sheet lie about how many people came through.
        if (!needsSubmissions) {
          stats.backfilled++;
        }
      }

      if (!categorySheet) {
        stats.missingSheet++;
        stats.errors.push(
          "no sheet named '" + parsed.categoryLabel + "' for " + parsed.id
        );
      }
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
    "Ingest done — fetched %s, added %s, backfilled %s, duplicates %s, errors %s (%sms)",
    stats.fetched,
    stats.added,
    stats.backfilled,
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
 * The password gate on the destructive reset.
 *
 * This is a guard against a mis-click in a dropdown, not security: anyone who
 * can open the script can read the property. It exists so that "Reset — clear
 * everything" cannot be the thing that happens when someone means to click
 * "Reset — preview".
 *
 * The password lives in Script Properties as RESET_PASSWORD rather than in
 * this file, because this repo is public.
 */
function wfCheckResetPassword_() {
  var expected = PropertiesService.getScriptProperties().getProperty(
    "RESET_PASSWORD"
  );

  if (!expected) {
    wfToast_(
      "RESET_PASSWORD is not set. Project Settings → Script Properties → " +
        "add RESET_PASSWORD before a reset can run."
    );
    return false;
  }

  var ui;

  try {
    ui = SpreadsheetApp.getUi();
  } catch (error) {
    // No UI means no way to ask, so refuse. Failing closed matters more here
    // than anywhere else in this file.
    Logger.log(
      "Reset needs the spreadsheet UI — run it from the Delegation Desk menu."
    );
    return false;
  }

  var response = ui.prompt(
    "Reset — clear everything",
    "This clears every Delegation Desk sheet, headers included.\n" +
      "It cannot be undone from here.\n\n" +
      "Enter the reset password:",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    wfToast_("Reset cancelled — nothing was cleared.");
    return false;
  }

  if (String(response.getResponseText()).trim() !== String(expected).trim()) {
    wfToast_("Wrong password — nothing was cleared.");
    return false;
  }

  return true;
}

/**
 * Destructive. Clears every managed sheet completely — headers included, so
 * the next ingest rebuilds them from whatever the payload looks like then.
 * Category sheets get their reserved "Output" column back as column A, but
 * anything that was typed into it is gone.
 * That matters in dev, where the question set is still changing and stale
 * columns would otherwise linger.
 *
 * Asks for the reset password first. Does not touch triggers;
 * deleteIngestTriggers() does that.
 */
function resetAllSheetsConfirmed() {
  if (!wfCheckResetPassword_()) {
    return null;
  }

  var spreadsheet = SpreadsheetApp.getActive();
  var cleared = [];
  var rowsCleared = 0;

  wfManagedSheetNames_().forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      Logger.log("Skipped '%s' — no such sheet.", name);
      return;
    }

    var dataRows = Math.max(0, sheet.getLastRow() - 1);

    rowsCleared += dataRows;

    sheet.clear();
    sheet.setFrozenRows(0);

    cleared.push(name + " (" + dataRows + " row(s))");
  });

  Logger.log("Cleared: %s", cleared.join(", ") || "nothing");

  wfToast_(
    "Reset done — cleared " +
      rowsCleared +
      " row(s) across " +
      cleared.length +
      " sheet(s). Headers are gone too; the next sync rebuilds them."
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
