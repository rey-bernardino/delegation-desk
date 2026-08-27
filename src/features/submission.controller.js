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

  return {
    isEnabled() {
      return settings.enabled === true;
    },

    submit() {
      const result = validation.validateAll({ reveal: true });

      if (!result.isValid) {
        return { ok: false, reason: "invalid", validation: result };
      }

      const payloads = payload.buildAll();

      // Kept so the payloads can be inspected from the console while the
      // destination is still being decided.
      state.lastPayloads = payloads;

      if (!this.isEnabled()) {
        console.log("Delegation Desk payloads (not submitted):", payloads);

        return { ok: true, submitted: false, payloads };
      }

      // Posting to Webflow + HubSpot goes here.
      return { ok: true, submitted: false, payloads };
    },
  };
}
