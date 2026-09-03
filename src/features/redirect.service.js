// src/features/redirect.service.js
//
// Where the browser goes once a submission has landed.

export function createRedirectService({ config }) {
  const settings = config.redirect || {};

  return {
    isEnabled() {
      return settings.enabled !== false;
    },

    // "follow the trail of the page": the target is resolved against the
    // current page's parent path, so /events/delegation-desk sends the user to
    // /events/thank-you rather than to a top-level /thank-you that may not
    // exist. A path starting with / (with relativeToParent off) or a full URL
    // is used as-is.
    resolveUrl(from = window.location.pathname) {
      const path = settings.path || "thank-you";

      if (/^https?:\/\//i.test(path)) {
        return path;
      }

      if (settings.relativeToParent === false) {
        return path.startsWith("/") ? path : `/${path}`;
      }

      const leaf = path.replace(/^\/+/, "");

      // Drop the last segment, trailing slash or not:
      //   /events/delegation-desk  -> /events
      //   /events/delegation-desk/ -> /events
      //   /delegation-desk         -> ""
      const parent = String(from).replace(/\/[^/]*\/?$/, "");
      const url = `${parent}/${leaf}`;

      if (settings.preserveQuery && window.location.search) {
        return url + window.location.search;
      }

      return url;
    },

    go(url = this.resolveUrl()) {
      // assign, not replace — the quiz stays in history, so Back returns to it
      // rather than to whatever came before.
      window.location.assign(url);

      return url;
    },
  };
}
