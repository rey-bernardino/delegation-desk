// src/ui/animations.js
//
// CSS-transition based. No jQuery — nothing here depends on a Webflow global
// being loaded first.
//
// Everything below operates on elements, not names. Resolving a name to an
// element is dom's job, because blocks are addressed by more than one
// attribute ([block] and [form-block]).

const ARM_FADE_STYLE_ID = "dd-arm-fade";
const ARM_HIDDEN_STYLE_ID = "dd-arm-hidden";

// Where an element's real display value is stashed before it is hidden, so it
// comes back as what Webflow styled it as rather than a guess.
const DISPLAY_ATTR = "data-dd-display";

function blockNameOf(element) {
  return (
    element.getAttribute("block") || element.getAttribute("form-block") || null
  );
}

function toArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function injectStyle(id, css) {
  if (document.getElementById(id)) {
    return false;
  }

  const style = document.createElement("style");

  style.id = id;
  style.textContent = css;

  (document.head || document.documentElement).appendChild(style);

  return true;
}

export function createAnimations({ config }) {
  const animationTime = config.animationTime || 600;

  function prefersReducedMotion() {
    return (
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    );
  }

  function duration() {
    return prefersReducedMotion() ? 0 : animationTime;
  }

  // Precedence: an explicit [block-display] in Webflow, then whatever the
  // element actually was before we hid it, then a config override by name,
  // then the flex default.
  function displayFor(element) {
    const name = blockNameOf(element);

    return (
      element.getAttribute("block-display") ||
      element.getAttribute(DISPLAY_ATTR) ||
      (name && config.blockDisplays?.[name]) ||
      config.blockDisplay ||
      "flex"
    );
  }

  // Only meaningful while the element is still visible.
  function rememberDisplay(element) {
    if (element.getAttribute(DISPLAY_ATTR)) {
      return;
    }

    const display = window.getComputedStyle(element).display;

    if (display && display !== "none") {
      element.setAttribute(DISPLAY_ATTR, display);
    }
  }

  return {
    animationTime,
    duration,
    displayFor,

    // Both arm* methods hide via an injected stylesheet, before first paint if
    // the bundle is in the page head. Deliberately CSS and not inline style:
    // if this bundle never loads, nothing is hidden and the page degrades to
    // fully visible rather than permanently blank.

    // Present but transparent — the block still occupies layout.
    armFade(selectors) {
      const list = toArray(selectors);

      if (!list.length) {
        return;
      }

      injectStyle(
        ARM_FADE_STYLE_ID,
        `${list.join(",\n")} {\n  opacity: 0;\n}\n`
      );
    },

    // Out of the flow entirely — for blocks that must not take up space or
    // catch clicks until the quiz reveals them.
    armHidden(selectors) {
      const list = toArray(selectors);

      if (!list.length) {
        return;
      }

      injectStyle(
        ARM_HIDDEN_STYLE_ID,
        `${list.join(",\n")} {\n  display: none;\n}\n`
      );
    },

    isVisible(element) {
      if (!element) {
        return false;
      }

      return window.getComputedStyle(element).display !== "none";
    },

    // Reveals a display:none element without animating it. Used when swapping
    // variants, where the outgoing one should just be gone.
    hideNow(elements) {
      toArray(elements).forEach((element) => {
        rememberDisplay(element);

        element.style.transition = "";
        element.style.opacity = "0";
        element.style.display = "none";
      });
    },

    // Takes the element's layout space at opacity 0, ready to be raised.
    // Inline opacity outranks the armFade rule, so no !important juggling.
    prepareElement(element) {
      if (!element) {
        return null;
      }

      // A block Webflow ships as display:none can't fade — reveal it first.
      if (!this.isVisible(element)) {
        element.style.display = displayFor(element);
      }

      // Reset with transitions off, or a block that is already visible fades
      // out to 0 before fading back in.
      element.style.transition = "none";
      element.style.opacity = "0";
      element.style.willChange = "opacity";

      return element;
    },

    raiseElement(element, time) {
      if (!element) {
        return null;
      }

      // Force a reflow so the transition runs from the prepared 0 instead of
      // snapping straight to 1.
      void element.offsetHeight;

      element.style.transition = `opacity ${time ?? duration()}ms ease`;
      element.style.opacity = "1";

      return element;
    },

    fadeInElement(element, options = {}) {
      if (!element) {
        return null;
      }

      const delay = options.delay || 0;
      const time = duration();

      const reveal = () => {
        this.prepareElement(element);
        this.raiseElement(element, time);
      };

      if (delay > 0) {
        window.setTimeout(reveal, delay);
      } else {
        reveal();
      }

      window.setTimeout(() => {
        element.style.willChange = "";
        element.style.transition = "";
      }, delay + time + 50);

      return element;
    },

    fadeOutElement(element, options = {}) {
      if (!element) {
        return null;
      }

      const delay = options.delay || 0;
      const time = duration();

      // Already gone — don't re-run and don't leave a stray display value.
      if (!this.isVisible(element)) {
        return element;
      }

      // Capture what it is now, while it is still visible, so [cmd=back] can
      // bring it back as a grid or a block rather than the flex default.
      rememberDisplay(element);

      element.style.willChange = "opacity";
      element.style.transition = `opacity ${time}ms ease`;

      window.setTimeout(() => {
        element.style.opacity = "0";
      }, delay);

      window.setTimeout(() => {
        // Pull it out of the flow, or it keeps its space and stays clickable
        // while invisible.
        element.style.display = "none";
        element.style.willChange = "";
        element.style.transition = "";
      }, delay + time + 50);

      return element;
    },

    // Reserve first, then stagger opacity only.
    //
    // Revealing each element at its own turn shoves the ones already on screen
    // around: a block that appears above a visible one pushes it down mid-fade.
    // Taking the whole set's layout space in a single step at the start of the
    // entrance means nothing moves once the cascade is running.
    //
    // The reserve is deferred to initialDelay rather than done up front, so the
    // incoming blocks don't claim space while the outgoing ones are still
    // fading out.
    fadeIn(elements, options = {}) {
      const stagger = options.stagger || 0;
      const initialDelay = options.initialDelay || 0;
      const list = toArray(elements);
      const time = duration();

      if (!list.length) {
        return list;
      }

      const run = () => {
        list.forEach((element) => this.prepareElement(element));

        // Commit the whole reveal before any transition starts.
        void document.body.offsetHeight;

        list.forEach((element, index) => {
          const offset = index * stagger;

          if (offset > 0) {
            window.setTimeout(() => this.raiseElement(element, time), offset);
          } else {
            this.raiseElement(element, time);
          }

          window.setTimeout(() => {
            element.style.willChange = "";
            element.style.transition = "";
          }, offset + time + 50);
        });
      };

      if (initialDelay > 0) {
        window.setTimeout(run, initialDelay);
      } else {
        run();
      }

      return list;
    },

    fadeOut(elements, options = {}) {
      const stagger = options.stagger || 0;
      const initialDelay = options.initialDelay || 0;

      return toArray(elements).map((element, index) =>
        this.fadeOutElement(element, { delay: initialDelay + index * stagger })
      );
    },
  };
}
