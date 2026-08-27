// src/core/events.js
//
// All handlers are delegated off document, so they survive Webflow re-rendering
// or cloning any part of the markup.

import { SELECTORS } from "./dom.js";

export function bindEvents({ config, selection, validation }) {
  const fieldSelector = config.fieldSelector || ".d-field";

  document.addEventListener("click", (event) => {
    const target = event.target;

    const selectTrigger = target?.closest?.(SELECTORS.select);

    if (selectTrigger) {
      const variant = selectTrigger.getAttribute("select");

      if (variant) {
        // The trigger is often an <a> in Webflow — don't let it navigate.
        event.preventDefault();
        selection.select(variant);
      }

      return;
    }

    const cmdTrigger = target?.closest?.(SELECTORS.cmd);

    if (!cmdTrigger) {
      return;
    }

    const cmd = cmdTrigger.getAttribute("cmd");

    if (cmd === "back") {
      event.preventDefault();
      selection.back();
      return;
    }

    if (cmd === "submit") {
      // Reveal every outstanding error at once, and stop the submit only when
      // something is actually wrong. Submission itself is a later milestone —
      // a valid form is left to whatever Webflow does today.
      const result = validation.validateAll({ reveal: true });

      if (!result.isValid) {
        event.preventDefault();
        result.firstInvalid?.focus?.();
        result.firstInvalid?.scrollIntoView?.({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  });

  // Re-validate as the user types, but only for fields already touched — this
  // clears an error the moment it is fixed without shouting at a field being
  // filled in for the first time.
  document.addEventListener("input", (event) => {
    const field = event.target?.closest?.(fieldSelector);

    if (field && validation.isTouched(field)) {
      validation.validateField(field);
    }
  });

  document.addEventListener("change", (event) => {
    const field = event.target?.closest?.(fieldSelector);

    if (field && validation.isTouched(field)) {
      validation.validateField(field);
    }
  });

  // focusout, not blur — blur doesn't bubble, so it can't be delegated.
  // Leaving a field is what marks it touched.
  document.addEventListener("focusout", (event) => {
    const field = event.target?.closest?.(fieldSelector);

    if (!field) {
      return;
    }

    validation.markTouched(field);
    validation.validateField(field);
  });
}
