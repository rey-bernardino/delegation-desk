// src/app.js

window.__DELEGATION_DESK__ = true;

import { QUIZ_CONFIG } from "./config/quiz.config.js";
import { state } from "./core/state.js";
import { createDom, SELECTORS } from "./core/dom.js";
import { createLenisService } from "./integrations/lenis.service.js";
import { createWebflowFormService } from "./integrations/webflow-form.service.js";
import { createAnimations } from "./ui/animations.js";
import { createSubmitButton } from "./ui/submit-button.js";
import { createFieldsService } from "./features/fields.service.js";
import { createValidationService } from "./features/validation.service.js";
import { createPayloadService } from "./features/payload.service.js";
import { createSubmissionController } from "./features/submission.controller.js";
import { createRedirectService } from "./features/redirect.service.js";
import { createSelectionController } from "./features/selection.controller.js";
import { createThankyouController } from "./features/thankyou.controller.js";
import { bindEvents } from "./core/events.js";

const dom = createDom();

const lenis = createLenisService();

const webflowForm = createWebflowFormService({
  config: QUIZ_CONFIG,
});

const animations = createAnimations({
  config: QUIZ_CONFIG,
  lenis,
});

const fields = createFieldsService({
  config: QUIZ_CONFIG,
});

const submitButton = createSubmitButton({
  config: QUIZ_CONFIG,
});

const validation = createValidationService({
  config: QUIZ_CONFIG,
  dom,
  state,
  lenis,
});

const payload = createPayloadService({
  config: QUIZ_CONFIG,
  dom,
  state,
});

const redirect = createRedirectService({
  config: QUIZ_CONFIG,
});

// Order matters below: selection has no submission or thank-you dependency,
// so it is built first, then the thank-you controller that drives the kiosk
// loop off it, then submission, which hands over to thank-you on success.
const selection = createSelectionController({
  config: QUIZ_CONFIG,
  dom,
  state,
  animations,
  fields,
  validation,
});

const thankyou = createThankyouController({
  config: QUIZ_CONFIG,
  dom,
  state,
  animations,
  fields,
  validation,
  selection,
  submitButton,
  webflowForm,
  lenis,
});

const submission = createSubmissionController({
  config: QUIZ_CONFIG,
  state,
  validation,
  payload,
  fields,
  submitButton,
  webflowForm,
  redirect,
  thankyou,
  lenis,
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
      bindEvents({
        config: QUIZ_CONFIG,
        selection,
        validation,
        submission,
        thankyou,
        lenis,
      });

      // Nothing is filled in yet, so the button starts greyed.
      submission.refreshButton();

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
    lenis,
    webflowForm,
    animations,
    submitButton,
    fields,
    validation,
    payload,
    redirect,
    submission,
    selection,
    thankyou,
    start,

    buildSubmissionPayload: (variant) =>
      submission.buildSubmissionPayload(variant),
  };

  // Console helper, deliberately global so it can be called straight from
  // Chrome devtools without going through window.DelegationDesk.
  window.buildSubmissionPayload = (variant) =>
    submission.buildSubmissionPayload(variant);

  start();
});
