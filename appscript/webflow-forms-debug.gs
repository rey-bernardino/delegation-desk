/**
 * Delegation Desk — Webflow forms discovery
 *
 * Debug step before wiring the sheet: lists every site the token can see and
 * every form on each, so the right form can be identified by id rather than
 * guessed by name.
 *
 * SETUP — do this once, and do it yourself; the token is a credential and
 * should never be pasted into a chat, a commit, or this file:
 *
 *   1. Webflow → Site settings → Apps & integrations → API access →
 *      generate a token with at least `forms:read` and `sites:read`.
 *   2. In Apps Script: Project Settings (gear) → Script Properties →
 *      Add script property
 *        name:  WEBFLOW_API_TOKEN
 *        value: <paste the token there>
 *   3. Run listWebflowForms() and read the output in the Execution log.
 *
 * Webflow Data API v2. Endpoints used:
 *   GET /v2/sites
 *   GET /v2/sites/{site_id}/forms
 */

var WEBFLOW_API_BASE = "https://api.webflow.com/v2";

// From the live page's <html data-wf-site>. Leave blank to list every site the
// token can reach.
var WEBFLOW_SITE_ID = "6513fda5217cc80d379e2473";

function getWebflowToken_() {
  var token = PropertiesService.getScriptProperties().getProperty(
    "WEBFLOW_API_TOKEN"
  );

  if (!token) {
    throw new Error(
      "WEBFLOW_API_TOKEN is not set. Project Settings → Script Properties → " +
        "add WEBFLOW_API_TOKEN with your Webflow API token."
    );
  }

  return token;
}

/**
 * Single place where every Webflow call goes out, so auth, error handling and
 * logging stay consistent.
 */
function webflowGet_(path, params) {
  var url = WEBFLOW_API_BASE + path;

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
      Authorization: "Bearer " + getWebflowToken_(),
      accept: "application/json",
    },
    // Read the body on failure instead of throwing an opaque exception.
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status === 401 || status === 403) {
    throw new Error(
      "Webflow rejected the token (" +
        status +
        "). Check it hasn't expired and has forms:read and sites:read. " +
        body
    );
  }

  if (status === 429) {
    throw new Error("Webflow rate limited this call (429). Wait and retry.");
  }

  if (status < 200 || status >= 300) {
    throw new Error("Webflow " + status + " for " + url + " — " + body);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Webflow returned non-JSON for " + url + " — " + body);
  }
}

/** Every site the token can see. */
function listWebflowSites() {
  var data = webflowGet_("/sites");
  var sites = data.sites || [];

  Logger.log("Sites the token can see: %s", sites.length);

  sites.forEach(function (site) {
    Logger.log(
      "  %s\n     id:        %s\n     shortName: %s",
      site.displayName || "(no display name)",
      site.id,
      site.shortName || ""
    );
  });

  // Shape is logged once so a change in the API is obvious rather than silent.
  if (sites.length) {
    Logger.log("First site, raw keys: %s", Object.keys(sites[0]).join(", "));
  }

  return sites;
}

/**
 * Every form on a site, with the id to wire into the ingest script.
 * Pass a site id, or leave it out to use WEBFLOW_SITE_ID.
 */
function listWebflowForms(siteId) {
  var site = siteId || WEBFLOW_SITE_ID;

  if (!site) {
    Logger.log("No site id set — listing sites instead.");
    return listWebflowSites();
  }

  var forms = [];
  var offset = 0;
  var limit = 100;

  // Paginate: a site with many forms returns them in pages.
  while (true) {
    var page = webflowGet_("/sites/" + site + "/forms", {
      offset: offset,
      limit: limit,
    });

    var batch = page.forms || [];

    forms = forms.concat(batch);

    var total = page.pagination && page.pagination.total;

    if (!batch.length || forms.length >= (total || forms.length)) {
      break;
    }

    offset += limit;
  }

  Logger.log("Forms on site %s: %s", site, forms.length);
  Logger.log("");

  forms.forEach(function (form) {
    Logger.log("  %s", form.displayName || "(no display name)");
    Logger.log("     id:       %s", form.id);
    Logger.log("     pageName: %s", form.pageName || "");
    Logger.log("     pageId:   %s", form.pageId || "");
    Logger.log("     created:  %s", form.createdOn || "");

    // Field names are what the ingest script reads, so surface them now —
    // this is where a rename in the Designer will show up.
    var fields = form.fields || form.formFields;

    if (fields) {
      Logger.log(
        "     fields:   %s",
        (Array.isArray(fields)
          ? fields.map(function (f) {
              return f.displayName || f.name || f.slug;
            })
          : Object.keys(fields).map(function (key) {
              return (fields[key] && fields[key].displayName) || key;
            })
        ).join(", ")
      );
    }

    Logger.log("");
  });

  if (forms.length) {
    Logger.log("First form, raw keys: %s", Object.keys(forms[0]).join(", "));
    Logger.log("First form, raw JSON:\n%s", JSON.stringify(forms[0], null, 2));
  } else {
    Logger.log(
      "No forms returned. A form only appears here once it has been published " +
        "and, in some cases, received at least one submission."
    );
  }

  return forms;
}

/**
 * Convenience: find the Delegation Desk form without reading the whole list.
 * Matches on display name, case-insensitively.
 */
function findDelegationDeskForm() {
  var forms = listWebflowForms();

  var match = forms.filter(function (form) {
    return String(form.displayName || "")
      .toLowerCase()
      .indexOf("delegation") !== -1;
  });

  if (!match.length) {
    Logger.log("No form whose name contains 'delegation'.");
    return null;
  }

  match.forEach(function (form) {
    Logger.log("MATCH: %s → id %s", form.displayName, form.id);
  });

  return match[0];
}
