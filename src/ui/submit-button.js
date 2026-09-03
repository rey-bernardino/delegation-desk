// src/ui/submit-button.js
//
// The submit button mirrors the validity of the current category: greyed out
// until every field passes, live as the user types.

const FALLBACK_STYLE_ID = "dd-submit-disabled";

export function createSubmitButton({ config }) {
  const settings = config.submitButton || {};
  const selector = settings.selector || '[cmd="submit"]';
  const disabledClass = settings.disabledClass || "disabled";

  // Webflow has no rule for this button's disabled state, so ship a fallback
  // in the palette the rest of the site already uses for disabled controls.
  // Authoring `[cmd="submit"].disabled` in Webflow overrides it — same
  // specificity, and the page stylesheet loads first.
  function injectFallbackStyle() {
    if (document.getElementById(FALLBACK_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");

    style.id = FALLBACK_STYLE_ID;
    style.textContent = `${selector}.${disabledClass} {
  background-color: #d9d9d9;
  color: #b3b3b3;
  cursor: not-allowed;
}
`;

    (document.head || document.documentElement).appendChild(style);
  }

  return {
    getButton() {
      return document.querySelector(selector);
    },

    setEnabled(isEnabled) {
      const button = this.getButton();

      if (!button) {
        return null;
      }

      injectFallbackStyle();

      button.classList.toggle(disabledClass, !isEnabled);
      button.setAttribute("aria-disabled", String(!isEnabled));

      // disabled alone isn't enough if the control is ever authored as a div
      // rather than a button, so kill pointer events too.
      if (settings.blockClicks !== false) {
        button.style.pointerEvents = isEnabled ? "" : "none";

        if ("disabled" in button) {
          button.disabled = !isEnabled;
        }
      }

      return button;
    },
  };
}
