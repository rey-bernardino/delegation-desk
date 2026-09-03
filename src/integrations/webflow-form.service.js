// src/integrations/webflow-form.service.js
//
// Fills and submits the hidden Webflow form that is the source of record for
// the Google Sheets pipeline. Webflow only stores submissions that go through
// its own handler, so the form is submitted by clicking its submit control
// rather than calling form.submit() — the same approach as athena-form's
// error-logger.service.js.
//
// jQuery and Webflow are page globals here, never imported, and never assumed
// to be loaded.

export function createWebflowFormService({ config }) {
  const settings = config.webflowForm || {};
  const formSelector = settings.selector || "#wf-form-Delegation-Desk";
  const fieldMap = settings.fieldMap || {};
  const honeypotFields = settings.honeypotFields || [];

  function getForm() {
    return document.querySelector(formSelector);
  }

  function serialise(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  return {
    getForm,

    isPresent() {
      return Boolean(getForm());
    },

    // Returns what it wrote, so a caller can log or check it.
    fill(summary) {
      const form = getForm();

      if (!form || !summary) {
        return null;
      }

      const written = {};

      Object.entries(fieldMap).forEach(([summaryKey, fieldName]) => {
        // Never write to the honeypot — Webflow uses it to discard bots, so a
        // filled one would silently bin the submission.
        if (honeypotFields.includes(fieldName)) {
          return;
        }

        const field = form.querySelector(`[name="${fieldName}"]`);

        if (!field) {
          console.warn(
            `Delegation Desk: Webflow form has no field named "${fieldName}"`
          );
          return;
        }

        const value = serialise(summary[summaryKey]);

        // maxlength does not truncate a value set from script, but Webflow may
        // still cut it server-side. Say so rather than losing data silently.
        if (field.maxLength > 0 && value.length > field.maxLength) {
          console.warn(
            `Delegation Desk: "${fieldName}" is ${value.length} chars but its maxlength is ${field.maxLength} — Webflow may truncate it.`
          );
        }

        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));

        written[fieldName] = value;
      });

      return written;
    },

    // Webflow binds its handler to the submit control, so clicking it is what
    // records a submission. form.submit() bypasses that entirely and stores
    // nothing.
    submit() {
      const form = getForm();

      if (!form) {
        console.warn(`Delegation Desk: Webflow form ${formSelector} not found`);
        return false;
      }

      const control = form.querySelector(
        '[type="submit"], button[type="submit"], .w-button'
      );

      if (!control) {
        console.warn("Delegation Desk: Webflow form has no submit control");
        return false;
      }

      control.click();

      return true;
    },

    fillAndSubmit(summary) {
      const written = this.fill(summary);

      if (!written) {
        return false;
      }

      return this.submit();
    },
  };
}
