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
}) {
  const settings = config.submission || {};
  const categoryKey = config.payload?.categoryKey || "category";

  function shouldLog() {
    return settings.logPayloads !== false;
  }

  function logPayloads(payloads) {
    const { quiz, hubspot, quizJson } = payloads;
    const canGroup = typeof console.group === "function";

    if (canGroup) {
      console.group(
        `Delegation Desk — submit payloads (${quiz?.[categoryKey]}, not sent)`
      );
    }

    console.log("quiz payload:", quiz);

    // The answers read far better as a table than as a nested array.
    if (typeof console.table === "function" && quiz?.answers?.length) {
      console.table(quiz.answers);
    }

    console.log("hubspot payload:", hubspot);
    console.log("quiz payload as JSON (for the single field):", quizJson);

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

  return {
    isEnabled() {
      return settings.enabled === true;
    },

    logPayloads,

    submit() {
      const result = validation.validateAll({ reveal: true });

      if (!result.isValid) {
        if (shouldLog()) {
          logBlocked(result);
        }

        return { ok: false, reason: "invalid", validation: result };
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
