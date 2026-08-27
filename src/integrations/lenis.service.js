// src/integrations/lenis.service.js
//
// Lenis is loaded by the Webflow page, not bundled here — never import it, and
// always guard, because load order isn't guaranteed.
//
// Lenis caches the scroll limit and only recomputes it on resize. This quiz
// changes the page height dramatically (intro ~139px of scroll, a filled
// category ~1508px), so without a refresh the limit is stale: after entering a
// category the user can only scroll the intro's height and the rest of the form
// is unreachable; after going back they can scroll into empty space.

export function createLenisService() {
  let scheduled = false;

  return {
    getInstance() {
      return window.lenis || null;
    },

    isPresent() {
      return (
        typeof window.refreshLenis === "function" ||
        typeof window.lenis?.resize === "function"
      );
    },

    refresh() {
      // The page defines refreshLenis itself — prefer it, so whatever the page
      // wants to do on a resize stays in one place.
      if (typeof window.refreshLenis === "function") {
        window.refreshLenis();
        return true;
      }

      if (typeof window.lenis?.resize === "function") {
        window.lenis.resize();
        return true;
      }

      return false;
    },

    // A staggered cascade changes layout once but fires through several timers,
    // and each error message toggling adds another. Coalesce to one resize per
    // frame rather than one per element.
    scheduleRefresh() {
      if (scheduled) {
        return;
      }

      scheduled = true;

      window.requestAnimationFrame(() => {
        scheduled = false;
        this.refresh();
      });
    },

    // Native scrollIntoView fights Lenis's hijacked scrolling, so hand it to
    // Lenis when it's there.
    scrollTo(target, options = {}) {
      if (!target) {
        return false;
      }

      const instance = this.getInstance();

      if (typeof instance?.scrollTo === "function") {
        instance.scrollTo(target, { offset: options.offset ?? -120 });
        return true;
      }

      target.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return false;
    },
  };
}
