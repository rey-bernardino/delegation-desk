// src/config/quiz.config.js

export const QUIZ_CONFIG = {
  // Base duration for block transitions, in ms.
  animationTime: 600,

  // Display value used when revealing a block Webflow ships as display: none.
  // Blocks use flex formatting; override per block with [block-display].
  blockDisplay: "flex",

  // Every quiz variant. A [select] trigger whose value is not in this list is
  // ignored, so a stray attribute in Webflow can't half-start the quiz.
  variants: ["travel", "gift", "deck", "brief", "offsite"],

  intro: {
    // Blocks faded in on page load, in order.
    blocks: ["intro-logo", "select"],

    // Delay between each block in the sequence, in ms.
    stagger: 200,

    // Delay before the first block starts, in ms.
    initialDelay: 100,
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
    stagger: 150,

    // Beat between the exit finishing and the entrance starting, in ms.
    gap: 100,
  },
};
