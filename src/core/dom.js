// src/core/dom.js
//
// Markup lives in Webflow, not this repo — these selectors are the API.
// Renaming one silently breaks the live page with no build error.

export const SELECTORS = {
  block: (name) => `[block="${name}"]`,
  formBlock: (name) => `[form-block="${name}"]`,
  select: "[select]",
};

export function createDom() {
  return {
    selectors: SELECTORS,

    getBlock(name) {
      return document.querySelector(SELECTORS.block(name));
    },

    getFormBlock(name) {
      return document.querySelector(SELECTORS.formBlock(name));
    },

    getBlocks(names) {
      return (names || []).map((name) => this.getBlock(name)).filter(Boolean);
    },

    getFormBlocks(names) {
      return (names || [])
        .map((name) => this.getFormBlock(name))
        .filter(Boolean);
    },

    getAllBlocks() {
      return Array.from(document.querySelectorAll("[block]"));
    },

    getSelectTriggers() {
      return Array.from(document.querySelectorAll(SELECTORS.select));
    },

    getBlockName(element) {
      return element?.getAttribute("block") || null;
    },
  };
}
