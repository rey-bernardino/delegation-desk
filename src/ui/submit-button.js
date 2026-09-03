// src/ui/submit-button.js
//
// The submit button mirrors the validity of the current category: greyed out
// until every field passes, live as the user types.

const FALLBACK_STYLE_ID = "dd-submit-disabled";
const LOADING_STYLE_ID = "dd-submit-loading";

// Where the button's own label is stashed while it says "Sending…", so it can
// be put back without the original copy being hardcoded here.
const LABEL_ATTR = "data-dd-label";

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

  const loadingClass = settings.loadingClass || "loading";
  const loadingText = settings.loadingText || "Sending…";

  // Webflow authors the label as a div inside the button, so the text lives one
  // level down. Fall back to the button itself if that ever changes.
  function labelElement(button) {
    const child = Array.from(button.children).find(
      (element) => element.textContent.trim() !== ""
    );

    return child || button;
  }

  // A spinner, in case Webflow has no styling for the loading state. Uses
  // currentColor so it follows whatever the button's text colour is.
  function injectLoadingStyle() {
    if (document.getElementById(LOADING_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");

    style.id = LOADING_STYLE_ID;
    style.textContent = `${selector}.${loadingClass} {
  position: relative;
  padding-right: 56px;
  color: #062812;
}

${selector}.${loadingClass}::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 26px;
  width: 14px;
  height: 14px;
  margin-top: -8px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: dd-submit-spin 0.7s linear infinite;
}

@keyframes dd-submit-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  ${selector}.${loadingClass}::after {
    animation: none;
  }
}
`;

    (document.head || document.documentElement).appendChild(style);
  }

  return {
    getButton() {
      return document.querySelector(selector);
    },

    // Feedback for the wait. Submitting posts to HubSpot and waits on Webflow,
    // so without this the only signal is the button going grey — which looks
    // the same as the button being disabled for an incomplete form.
    setLoading(isLoading) {
      const button = this.getButton();

      if (!button) {
        return null;
      }

      injectLoadingStyle();

      const label = labelElement(button);

      if (isLoading) {
        // Remember the real label once, so a double call can't stash
        // "Sending…" as the thing to restore.
        if (!button.hasAttribute(LABEL_ATTR)) {
          button.setAttribute(LABEL_ATTR, label.textContent);
        }

        if (settings.replaceText !== false) {
          label.textContent = loadingText;
        }

        button.classList.add(loadingClass);
        button.setAttribute("aria-busy", "true");
      } else {
        const original = button.getAttribute(LABEL_ATTR);

        if (original !== null) {
          label.textContent = original;
          button.removeAttribute(LABEL_ATTR);
        }

        button.classList.remove(loadingClass);
        button.removeAttribute("aria-busy");
      }

      return button;
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
