// src/core/events.js
//
// All handlers are delegated off document, so they survive Webflow re-rendering
// or cloning any part of the markup.

import { SELECTORS } from "./dom.js";

export function bindEvents({ selection }) {
  document.addEventListener("click", (event) => {
    const trigger = event.target?.closest?.(SELECTORS.select);

    if (!trigger) {
      return;
    }

    const variant = trigger.getAttribute("select");

    if (!variant) {
      return;
    }

    // The trigger is often an <a> in Webflow — don't let it navigate.
    event.preventDefault();

    selection.select(variant);
  });
}
