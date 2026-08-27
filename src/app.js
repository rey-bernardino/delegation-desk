// src/app.js

window.__DELEGATION_DESK__ = true;

import { QUIZ_CONFIG } from "./config/quiz.config.js";
import { createDom } from "./core/dom.js";
import { createAnimations } from "./ui/animations.js";

const dom = createDom();

const animations = createAnimations({
  config: QUIZ_CONFIG,
  dom,
});

// Runs at module evaluation, not on DOMContentLoaded — the intro blocks have to
// be hidden before the browser paints them, or they flash in at full opacity
// and then fade in from nothing.
animations.armBlocks(QUIZ_CONFIG.intro.blocks);

document.addEventListener("DOMContentLoaded", () => {
  function start() {
    try {
      animations.fadeInBlocks(QUIZ_CONFIG.intro.blocks, {
        stagger: QUIZ_CONFIG.intro.stagger,
        initialDelay: QUIZ_CONFIG.intro.initialDelay,
      });

      console.log("Delegation Desk started");
    } catch (error) {
      console.error("Delegation Desk failed to start:", error);
    }
  }

  window.DelegationDesk = {
    config: QUIZ_CONFIG,
    dom,
    animations,
    start,
  };

  start();
});
