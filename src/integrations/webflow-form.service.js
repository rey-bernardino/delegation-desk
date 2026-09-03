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

    // Webflow submits over AJAX and reports by revealing .w-form-done or
    // .w-form-fail. Navigating away before that lands would abort the request,
    // so the redirect has to wait for one of them.
    //
    // Resolves rather than rejects on timeout: a submission that took too long
    // to confirm has usually still gone through, and hanging the user on a
    // finished form is worse than redirecting a moment early.
    waitForResult(timeoutMs = 6000) {
      return new Promise((resolve) => {
        const form = getForm();

        if (!form) {
          resolve({ ok: false, reason: "no-form" });
          return;
        }

        const wrapper = form.closest(".w-form") || form.parentElement;

        if (!wrapper) {
          resolve({ ok: false, reason: "no-wrapper" });
          return;
        }

        const done = wrapper.querySelector(".w-form-done");
        const fail = wrapper.querySelector(".w-form-fail");

        // Webflow toggles these with inline styles. The form itself is inside a
        // hidden container, so computed display is "none" either way — the
        // inline value is the only readable signal.
        const isShown = (element) =>
          Boolean(element) &&
          element.style.display !== "" &&
          element.style.display !== "none";

        if (isShown(done)) {
          resolve({ ok: true, reason: "already-done" });
          return;
        }

        let settled = false;

        const finish = (result) => {
          if (settled) {
            return;
          }

          settled = true;
          observer.disconnect();
          window.clearTimeout(timer);
          resolve(result);
        };

        const observer = new MutationObserver(() => {
          if (isShown(done)) {
            finish({ ok: true, reason: "done" });
          } else if (isShown(fail)) {
            finish({ ok: false, reason: "failed" });
          }
        });

        observer.observe(wrapper, {
          attributes: true,
          subtree: true,
          attributeFilter: ["style", "class"],
        });

        const timer = window.setTimeout(
          () => finish({ ok: false, reason: "timeout" }),
          timeoutMs
        );
      });
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
