// src/core/events.js
//
// All handlers are delegated off document, so they survive Webflow re-rendering
// or cloning any part of the markup.

import { SELECTORS } from "./dom.js";

export function bindEvents({
  config,
  selection,
  validation,
  submission,
  thankyou,
  lenis,
}) {
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

        // A fresh category starts incomplete; a retained one may already pass.
        submission.refreshButton();
      }

      return;
    }

    const cmdTrigger = target?.closest?.(SELECTORS.cmd);

    if (!cmdTrigger) {
      return;
    }

    const cmd = cmdTrigger.getAttribute("cmd");

    if (cmd === "reset") {
      event.preventDefault();
      thankyou?.reset();
      return;
    }

    if (cmd === "back") {
      event.preventDefault();
      selection.back();
      submission.refreshButton();
      return;
    }

    if (cmd === "submit") {
      // The quiz owns submission entirely — Webflow, HubSpot and the redirect
      // are all handled in the controller — so the control's own action is
      // always stopped.
      event.preventDefault();

      // Deliberately not awaited: the click handler has nothing left to do,
      // and the controller handles both the failure messaging and the
      // redirect.
      submission.submit();
    }
  });

  // Re-validate as the user types, but only for fields already touched — this
  // clears an error the moment it is fixed without shouting at a field being
  // filled in for the first time.
  document.addEventListener("input", (event) => {
    const field = event.target?.closest?.(fieldSelector);

    if (!field) {
      return;
    }

    if (validation.isTouched(field)) {
      validation.validateField(field);
    }

    // The button tracks validity even for fields the user hasn't left yet.
    submission.refreshButton();
  });

  document.addEventListener("change", (event) => {
    const field = event.target?.closest?.(fieldSelector);

    if (!field) {
      return;
    }

    if (validation.isTouched(field)) {
      validation.validateField(field);
    }

    submission.refreshButton();
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
    submission.refreshButton();
  });
}
