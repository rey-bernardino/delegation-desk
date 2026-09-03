// src/features/submission.controller.js
//
// Owns what happens on submit. Right now that is: validate, build both
// payloads, keep them. Nothing is posted — config.submission.enabled is false
// pending an internal decision on where this goes.
//
// When that decision lands, this is the only file that needs to change.

export function createSubmissionController({
  config,
  state,
  validation,
  payload,
  fields,
  submitButton,
}) {
  const settings = config.submission || {};
  const categoryKey = config.payload?.categoryKey || "category";

  function shouldLog() {
    return settings.logPayloads !== false;
  }

  function logPayloads(payloads) {
    const { summary, summaryJson, quiz, hubspot, hubspotApi, categoryLabel } =
      payloads;
    const canGroup = typeof console.group === "function";

    if (canGroup) {
      console.group(
        `Delegation Desk — submit payloads (${categoryLabel}, not sent)`
      );
    }

    // What actually goes into the hidden field and travels downstream.
    console.log("summary JSON (hidden field → Sheets):", summaryJson);
    console.log(`  ${summaryJson?.length ?? 0} chars`);
    console.log("summary payload:", summary);

    // The answers read far better as a table than as a nested array.
    if (typeof console.table === "function" && quiz?.answers?.length) {
      console.table(quiz.answers);
    }

    console.log("quiz payload:", quiz);
    console.log("hubspot payload (flat):", hubspot);
    console.log("hubspot API body (Forms v3):", hubspotApi);

    if (canGroup) {
      console.groupEnd();
    }
  }

  function logBlocked(result) {
    console.warn(
      `Delegation Desk — submit blocked, ${result.invalid.length} of ${result.total} field(s) invalid:`,
      result.invalid.map((field) => field.name)
    );
  }

  function getSubmitUrl() {
    const { submitBaseUrl, portalId, formId } = config.hubspot || {};

    if (!submitBaseUrl || !portalId || !formId) {
      return null;
    }

    return `${submitBaseUrl}/${portalId}/${formId}`;
  }

  return {
    isEnabled() {
      return settings.enabled === true;
    },

    getSubmitUrl,
    logPayloads,

    // Keeps the button in step with the current category's validity. Cheap
    // enough to call on every keystroke — it only reads input values.
    refreshButton() {
      const { isValid } = validation.checkAll();

      submitButton?.setEnabled(isValid);

      return isValid;
    },

    // Callable from the console: window.buildSubmissionPayload()
    //
    // Builds every payload from whatever is currently on screen without
    // validating, submitting, or touching anything. Pass a variant to build
    // for a category other than the selected one.
    buildSubmissionPayload(variant) {
      const payloads = payload.buildAll(variant);

      if (!payloads.quiz) {
        console.warn(
          "Delegation Desk: no category selected — pass one, e.g. buildSubmissionPayload(\"travel\")"
        );

        return payloads;
      }

      logPayloads(payloads);

      return payloads;
    },

    // Mirrors athena-form's hubspot.service.js submitForm(). Not called while
    // submission.enabled is false, and inert until portalId/formId are set.
    async postToHubspot(apiPayload) {
      const url = getSubmitUrl();

      if (!url) {
        throw new Error(
          "Delegation Desk: config.hubspot.portalId / formId are not set"
        );
      }

      let response;

      try {
        response = await fetch(url, {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(apiPayload),
        });
      } catch (networkError) {
        const error = new Error("Network error while submitting to HubSpot");
        error.type = "hubspot_network_error";
        error.originalError = networkError;
        throw error;
      }

      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const error = new Error("HubSpot API rejected the submission");

        error.type =
          response.status === 429
            ? "hubspot_rate_limited"
            : response.status >= 500
              ? "hubspot_server_error"
              : "hubspot_api_error";

        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    },

    submit() {
      const result = validation.validateAll({ reveal: true });

      if (!result.isValid) {
        if (shouldLog()) {
          logBlocked(result);
        }

        return { ok: false, reason: "invalid", validation: result };
      }

      // Write the summary JSON into its hidden field before anything is
      // built, so the HubSpot payload picks the filled value up rather than
      // an empty string.
      const summaryField = config.hiddenFields?.summary;

      if (summaryField) {
        fields.setValue(summaryField, payload.buildSummaryJson());
      }

      const payloads = payload.buildAll();

      // Kept so the payloads can be inspected from the console while the
      // destination is still being decided.
      state.lastPayloads = payloads;

      if (shouldLog()) {
        logPayloads(payloads);
      }

      if (!this.isEnabled()) {
        return { ok: true, submitted: false, payloads };
      }

      // Posting to Webflow + HubSpot goes here.
      return { ok: true, submitted: false, payloads };
    },
  };
}
