// src/app.js

window.__DELEGATION_DESK__ = true;

import { QUIZ_CONFIG } from "./config/quiz.config.js";
import { state } from "./core/state.js";
import { createDom, SELECTORS } from "./core/dom.js";
import { createAnimations } from "./ui/animations.js";
import { createFieldsService } from "./features/fields.service.js";
import { createSelectionController } from "./features/selection.controller.js";
import { bindEvents } from "./core/events.js";

const dom = createDom();

const animations = createAnimations({
  config: QUIZ_CONFIG,
});

const fields = createFieldsService({
  config: QUIZ_CONFIG,
});

const selection = createSelectionController({
  config: QUIZ_CONFIG,
  dom,
  state,
  animations,
  fields,
});

// Runs at module evaluation, not on DOMContentLoaded — blocks have to be hidden
// before the browser paints them, or the intro flashes in at full opacity and
// every variant's heading shows at once before the quiz starts.
animations.armFade(
  QUIZ_CONFIG.intro.blocks.map((name) => SELECTORS.block(name))
);

animations.armHidden(selection.allEnterSelectors());

document.addEventListener("DOMContentLoaded", () => {
  function start() {
    try {
      bindEvents({ selection });

      animations.fadeIn(dom.getBlocks(QUIZ_CONFIG.intro.blocks), {
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
    state,
    dom,
    animations,
    fields,
    selection,
    start,
  };

  start();
});
