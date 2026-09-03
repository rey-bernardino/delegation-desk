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

function wfSafeJson_(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function wfParseSubmission_(submission) {
  var response =
    submission.formResponse || submission.data || submission.fields || {};

  var contact = wfSafeJson_(response.contact, {});

  return {
    id: submission.id,
    dateSubmitted: submission.dateSubmitted || "",
    v: response.v || "",
    category: response.category || "",
    categoryLabel: response.categoryLabel || "",
    submittedAt: response.submittedAt || "",
    contact: contact,
    fields: wfSafeJson_(response.fields, {}),
    labels: wfSafeJson_(response.labels, {}),
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

function wfAppendToSubmissions_(sheet, parsed) {
  var headers = wfEnsureHeaders_(sheet, SUBMISSIONS_HEADERS);

  var values = {
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
  };

  sheet.appendRow(wfRowFor_(headers, values));
}

function wfAppendToCategory_(sheet, parsed) {
  // Column order follows the order of keys in `fields`, which follows the
  // Webflow markup order. Headers are the question text from `labels`, so a
  // sheet is readable without knowing the field names.
  var keys = Object.keys(parsed.fields);

  var answerHeaders = keys.map(function (key) {
    return parsed.labels[key] || key;
  });

  var headers = wfEnsureHeaders_(
    sheet,
    CATEGORY_FIXED_HEADERS.concat(answerHeaders)
  );

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

  sheet.appendRow(wfRowFor_(headers, values));
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

      try {
        wfAppendToSubmissions_(submissionsSheet, parsed);

        // Written first, so a failure on the category sheet can't cause the
        // same submission to be ingested twice on the next run.
        seen[parsed.id] = true;

        var categorySheet = parsed.categoryLabel
          ? wfGetSheet_(parsed.categoryLabel)
          : null;

        if (categorySheet) {
          wfAppendToCategory_(categorySheet, parsed);
        } else {
          stats.missingSheet++;
          stats.errors.push(
            "no sheet named '" + parsed.categoryLabel + "' for " + parsed.id
          );
        }

        stats.added++;
        stats.addedIds.push(parsed.id);
      } catch (error) {
        stats.errors.push("write " + parsed.id + ": " + error.message);
      }
    });
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

function setupIngestTrigger() {
  deleteIngestTriggers();

  ScriptApp.newTrigger("ingestWebflowSubmissions")
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log("Trigger installed: ingestWebflowSubmissions every 5 minutes.");
}

function deleteIngestTriggers() {
  var removed = 0;

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "ingestWebflowSubmissions") {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  Logger.log("Removed %s existing trigger(s).", removed);
}
