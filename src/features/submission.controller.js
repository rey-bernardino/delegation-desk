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
  webflowForm,
  redirect,
  thankyou,
  lenis,
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
      // Validity stops mattering once a submission is under way or done. Both
      // checks have to live here rather than only at the click, because this
      // runs on every keystroke — without them, typing one character during a
      // submission puts the button back to enabled while the request is still
      // in the air.
      if (state.submitting || state.submitted) {
        submitButton?.setEnabled(false);
        return false;
      }

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

    // Sends the user on once everything that had to land has landed.
    redirectAfter(result) {
      if (!redirect?.isEnabled()) {
        return null;
      }

      const url = redirect.resolveUrl();

      // An explicit failure is the one case worth staying put for — thanking
      // someone for a submission that didn't happen is worse than showing
      // them a form that is still on screen. A timeout is not a failure: it
      // usually means slow, not lost.
      const failed = result.webflow && result.webflow.reason === "failed";

      if (failed && config.redirect?.onFailure !== true) {
        console.warn(
          `Delegation Desk: not redirecting to ${url} — Webflow reported a failure`
        );
        return null;
      }

      if (!result.ok && config.redirect?.onFailure !== true) {
        console.warn(
          `Delegation Desk: not redirecting to ${url} — a destination failed`
        );
        return null;
      }

      return redirect.go(url);
    },

    // Fills and submits the hidden Webflow form. Fire-and-forget: Webflow's
    // handler is asynchronous and gives nothing back to await.
    submitToWebflow(payloads) {
      if (!webflowForm?.isPresent()) {
        console.warn("Delegation Desk: hidden Webflow form not on the page");
        return false;
      }

      return webflowForm.fillAndSubmit(payloads.summary);
    },

    // HubSpot is the gate. It goes first, and nothing else happens unless it
    // succeeds — no Webflow row, no redirect. A submission HubSpot rejected
    // isn't a submission, so logging it to the sheet or thanking the user for
    // it would both be lies, and the sheet would disagree with the CRM.
    //
    // With the HubSpot destination off there is nothing to gate on, so the
    // rest proceeds — that is what keeps the switch usable in dev.
    //
    // Each destination must be explicitly true. A missing or misspelled flag
    // means "off", so a typo can't quietly start posting somewhere.
    async send(payloads) {
      const destinations = settings.destinations || {};
      const result = { ok: true, submitted: true, payloads, sent: {} };

      if (destinations.hubspot === true) {
        try {
          result.sent.hubspot = await this.postToHubspot(payloads.hubspotApi);
        } catch (error) {
          result.ok = false;
          result.error = error;

          console.error(
            "Delegation Desk: HubSpot rejected the submission — nothing was " +
              "logged to Webflow, and the user stays on the form.",
            error
          );

          return result;
        }
      } else if (shouldLog()) {
        console.log(
          "Delegation Desk: HubSpot destination is off, so the success gate " +
            "is inactive and the Webflow log runs unconditionally."
        );
      }

      if (destinations.googleSheets === true) {
        result.sent.googleSheets = this.submitToWebflow(payloads);

        // Wait for Webflow to confirm before anything can navigate away —
        // its submission is an in-flight AJAX call that a redirect would kill.
        if (result.sent.googleSheets) {
          result.webflow = await webflowForm.waitForResult(
            config.redirect?.waitForWebflowMs
          );

          if (!result.webflow.ok) {
            console.warn(
              `Delegation Desk: Webflow form did not confirm (${result.webflow.reason})`
            );
          }
        }
      }

      return result;
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

    // Async, because a live submit waits on Webflow and HubSpot. The caller
    // does not need to await it — nothing after the click depends on the
    // result, and the redirect happens from in here.
    async submit() {
      const result = validation.validateAll({ reveal: true });

      if (!result.isValid) {
        if (shouldLog()) {
          logBlocked(result);
        }

        // Owned here rather than in the click handler: what happens on an
        // invalid submit is this controller's decision, and the handler
        // shouldn't need to know that focusing the first bad field is part
        // of it.
        result.firstInvalid?.focus?.();
        lenis?.scrollTo(result.firstInvalid);

        return { ok: false, reason: "invalid", validation: result };
      }

      // One submission at a time. Submitting now waits on HubSpot, which
      // leaves a window where a second click would send everything twice.
      if (state.submitting) {
        console.warn("Delegation Desk: a submission is already in flight");
        return { ok: false, reason: "in-flight" };
      }

      // And one submission per page view. The in-flight guard only covers
      // overlapping sends; this covers a second one after the first landed.
      if (state.submitted) {
        console.warn(
          "Delegation Desk: this page has already submitted successfully"
        );
        return { ok: false, reason: "already-submitted" };
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
        // Say where it would have gone, so the redirect can be checked in dev
        // without anything being sent.
        if (thankyou?.isEnabled()) {
          console.log(
            "Delegation Desk: submission disabled — would show the thank-you " +
              "blocks and reset after " +
              (config.thankyou?.resetAfterMs || 10000) +
              "ms"
          );
        } else if (redirect?.isEnabled()) {
          console.log(
            "Delegation Desk: submission disabled — would redirect to",
            redirect.resolveUrl()
          );
        }

        return { ok: true, submitted: false, payloads };
      }

      state.submitting = true;

      // Greyed while in flight: the button shows something is happening and
      // can't be clicked again. Greyed alone reads the same as "form
      // incomplete", so the spinner is what says "working".
      submitButton?.setEnabled(false);
      submitButton?.setLoading(true);

      let sendResult;

      try {
        sendResult = await this.send(payloads);
      } finally {
        state.submitting = false;

        // Cleared on every path, so no route out of here leaves a spinner
        // running — including the thank-you fade and a failed submit.
        submitButton?.setLoading(false);
      }

      if (sendResult.ok) {
        // Latched before the redirect, and deliberately not unset: the button
        // stays greyed even if the redirect is suppressed, because the
        // destinations already have this submission.
        state.submitted = true;

        // The kiosk stays on the page and shows the thank-you blocks; the
        // redirect is the fallback for a non-kiosk deployment.
        if (thankyou?.isEnabled()) {
          thankyou.show();

          return sendResult;
        }

        const url = this.redirectAfter(sendResult);

        if (!url) {
          console.warn(
            "Delegation Desk: submitted successfully but did not redirect — " +
              "the form stays on screen and the button stays disabled, since " +
              "sending again would duplicate the record."
          );
        }
      } else {
        // Leave a working form behind to retry from.
        this.refreshButton();
      }

      return sendResult;
    },
  };
}
