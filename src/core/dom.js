// src/core/dom.js
//
// Markup lives in Webflow, not this repo — these selectors are the API.
// Renaming one silently breaks the live page with no build error.

export function createDom() {
  return {
    getBlock(name) {
      return document.querySelector(`[block="${name}"]`);
    },

    getBlocks(names) {
      return names.map((name) => this.getBlock(name)).filter(Boolean);
    },

    getAllBlocks() {
      return Array.from(document.querySelectorAll("[block]"));
    },

    getBlockName(element) {
      return element?.getAttribute("block") || null;
    },
  };
}
