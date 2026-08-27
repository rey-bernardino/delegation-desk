// src/core/events.js
//
// All handlers are delegated off document, so they survive Webflow re-rendering
// or cloning any part of the markup.

import { SELECTORS } from "./dom.js";

export function bindEvents({ selection }) {
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
    }
  });
}
