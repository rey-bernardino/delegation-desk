// src/config/quiz.config.js

export const QUIZ_CONFIG = {
  // Base duration for block transitions, in ms.
  animationTime: 600,

  intro: {
    // Blocks faded in on page load, in order.
    blocks: ["intro-logo", "select"],

    // Delay between each block in the sequence, in ms.
    stagger: 200,

    // Delay before the first block starts, in ms.
    initialDelay: 100,
  },
};
