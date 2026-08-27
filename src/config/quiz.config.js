// src/config/quiz.config.js

export const QUIZ_CONFIG = {
  // Base duration for block transitions, in ms.
  animationTime: 400,

  // Display value used when revealing a block Webflow ships as display: none.
  // Most blocks use flex formatting.
  blockDisplay: "flex",

  // Blocks whose formatting isn't flex. Keyed by [block] / [form-block] value.
  // A [block-display] attribute in Webflow still wins over this.
  blockDisplays: {
    "quiz-nav": "grid",
  },

  // Inputs the quiz owns.
  fieldSelector: ".d-field",

  // Form blocks whose inputs survive a category switch. [form-block=info] is
  // shown for every category, so its answers are never category-specific.
  preserveFormBlocks: ["info"],

  validation: {
    // Wrapper that carries the invalid class. Webflow styles the red border
    // and reveals .errorMessage off it.
    fieldWrapper: ".d-field-container",
    invalidClass: "invalid",
  },

  payload: {
    // Where a field's human-readable label comes from.
    labelSelector: ".d-field-label",

    // The block whose fields are contact details rather than answers. Sent to
    // both destinations, and never treated as category answers.
    infoFormBlock: "info",

    // Key the selected category is written to in both payloads.
    categoryKey: "category",
  },

  submission: {
    // Nothing is posted while this is false — the submit click only builds and
    // stores the payloads. Flip it when the destination is decided.
    enabled: false,

    // Print both payloads to the console on every submit click.
    logPayloads: true,
  },

  // Every quiz variant. A [select] trigger whose value is not in this list is
  // ignored, so a stray attribute in Webflow can't half-start the quiz.
  variants: ["travel", "gift", "deck", "brief", "offsite"],

  intro: {
    // Blocks faded in on page load, in order.
    blocks: ["intro-logo", "select"],

    // Delay between each block in the sequence, in ms.
    stagger: 120,

    // Delay before the first block starts, in ms.
    initialDelay: 80,
  },

  selection: {
    // Faded out when a variant is picked.
    exitBlocks: ["intro-logo", "select"],

    // Faded in afterwards. {variant} is replaced with the chosen variant.
    enterBlocks: ["quiz-nav", "h1-{variant}", "form-blocks"],

    // [form-block] elements faded in with the form, continuing the same
    // stagger sequence as enterBlocks.
    enterFormBlocks: ["{variant}", "info", "submit"],

    // Delay between each entering element, in ms.
    stagger: 90,

    // Beat between the exit finishing and the entrance starting, in ms.
    gap: 60,
  },
};
