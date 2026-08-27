// src/ui/animations.js
//
// CSS-transition based. No jQuery — nothing here depends on a Webflow global
// being loaded first.

const ARM_STYLE_ID = "dd-arm-blocks";

export function createAnimations({ config, dom }) {
  const animationTime = config.animationTime || 600;

  function prefersReducedMotion() {
    return (
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    );
  }

  function duration() {
    return prefersReducedMotion() ? 0 : animationTime;
  }

  return {
    // Hides the named blocks via an injected stylesheet, before first paint if
    // the bundle is in the page head. Deliberately CSS and not inline style:
    // if this bundle never loads, nothing is hidden and the page degrades to
    // fully visible rather than permanently blank.
    armBlocks(names) {
      if (document.getElementById(ARM_STYLE_ID)) {
        return;
      }

      const selector = names
        .map((name) => `[block="${name}"]`)
        .join(",\n");

      const style = document.createElement("style");

      style.id = ARM_STYLE_ID;
      style.textContent = `${selector} {\n  opacity: 0;\n}\n`;

      (document.head || document.documentElement).appendChild(style);
    },

    // Inline opacity outranks the armBlocks rule, so no !important juggling.
    fadeInBlock(name, options = {}) {
      const element = dom.getBlock(name);

      if (!element) {
        // console.warn(`[block="${name}"] not found`);
        return null;
      }

      const delay = options.delay || 0;
      const time = duration();

      // A block Webflow ships as display:none can't fade — reveal it first.
      // Per-block [block-display] wins, then config.blockDisplay (flex).
      if (window.getComputedStyle(element).display === "none") {
        element.style.display =
          element.getAttribute("block-display") ||
          config.blockDisplay ||
          "flex";
      }

      // Reset with transitions off, or a block that is already visible fades
      // out to 0 before fading back in.
      element.style.transition = "none";
      element.style.opacity = "0";
      element.style.willChange = "opacity";

      // Commit the reset before anything can transition off it.
      void element.offsetHeight;

      window.setTimeout(() => {
        element.style.transition = `opacity ${time}ms ease`;
        element.style.opacity = "1";
      }, delay);

      window.setTimeout(() => {
        element.style.willChange = "";
        element.style.transition = "";
      }, delay + time + 50);

      return element;
    },

    fadeInBlocks(names, options = {}) {
      const stagger = options.stagger || 0;
      const initialDelay = options.initialDelay || 0;

      return names.map((name, index) =>
        this.fadeInBlock(name, { delay: initialDelay + index * stagger })
      );
    },
  };
}
