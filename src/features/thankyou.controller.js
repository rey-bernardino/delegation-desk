// src/features/thankyou.controller.js
//
// The kiosk loop. A successful submission swaps the quiz for the thank-you
// blocks, a countdown bar drains, and then the whole demo resets itself for the
// next person. [cmd=reset] does the same thing immediately.
//
// Reset here means "next attendee", which is stricter than a category switch:
// the contact fields and the opt-in are cleared too, because leaving one
// person's name and email on screen for the next one would be a privacy
// problem, not just an untidy form.

export function createThankyouController({
  config,
  dom,
  state,
  animations,
  fields,
  validation,
  selection,
  submitButton,
  webflowForm,
  lenis,
}) {
  const settings = config.thankyou || {};
  const variants = config.variants || [];

  let timerId = null;

  function blocks() {
    return dom.getBlocks(settings.blocks || []);
  }

  function timerBar() {
    return settings.timerBar
      ? document.querySelector(settings.timerBar)
      : null;
  }

  // Every element any variant could have revealed, so a reset can't leave a
  // stray block behind whatever route got here.
  function allQuizElements() {
    return variants.flatMap((variant) => selection.enterElementsFor(variant));
  }

  return {
    isEnabled() {
      return settings.enabled !== false;
    },

    // Drains the bar over the countdown, matching the reset it is counting
    // down to. Driven off one width transition rather than a per-frame tick:
    // the browser interpolates it, and there is nothing to keep in sync.
    startTimer(onExpire) {
      this.stopTimer();

      const duration = settings.resetAfterMs || 10000;
      const bar = timerBar();

      if (bar) {
        const from = settings.drain === false ? "0%" : "100%";
        const to = settings.drain === false ? "100%" : "0%";

        bar.style.transition = "none";
        bar.style.width = from;

        // Commit the starting width before transitioning off it, or the bar
        // jumps straight to the end.
        void bar.offsetWidth;

        bar.style.transition = `width ${duration}ms linear`;
        bar.style.width = to;
      }

      timerId = window.setTimeout(() => {
        timerId = null;
        onExpire?.();
      }, duration);

      return duration;
    },

    stopTimer() {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      const bar = timerBar();

      if (bar) {
        bar.style.transition = "none";
        bar.style.width = settings.drain === false ? "0%" : "100%";
      }
    },

    // Called on a successful submission: the quiz goes, the thank-you arrives,
    // the countdown starts.
    show(onExpire) {
      const exiting = allQuizElements().filter((element) =>
        animations.isVisible(element)
      );

      animations.fadeOut(exiting);

      const initialDelay = exiting.length
        ? animations.duration() + (settings.gap || 0)
        : 0;

      animations.fadeIn(blocks(), {
        initialDelay,
        stagger: settings.stagger,
      });

      state.showingThankyou = true;

      // Start the countdown when the thank-you is actually on screen, not
      // while it is still fading in — otherwise the bar is already part-drained
      // by the time anyone can see it.
      window.setTimeout(
        () => this.startTimer(onExpire || (() => this.reset())),
        initialDelay
      );

      return true;
    },

    // Back to a clean demo for the next person.
    reset() {
      this.stopTimer();

      // Values first, so nothing of the previous attendee survives.
      const cleared = fields.clearAll({ includePreserved: true });

      validation.resetFields(cleared);

      // The hidden fields are not .d-field, so clearAll never touches them.
      // Left alone, the next submission would carry this one's category label
      // and summary JSON.
      Object.values(config.hiddenFields || {}).forEach((name) => {
        fields.setValue(name, "");
      });

      // Webflow hides the form and shows its success message after a
      // submission. Without putting that back, the next submit has nothing to
      // submit — the kiosk would silently stop recording after the first
      // person.
      webflowForm?.restore();

      state.selectedVariant = null;
      state.showingQuiz = false;
      state.showingThankyou = false;
      state.submitting = false;
      state.submitted = false;
      state.lastPayloads = null;

      const exiting = [...blocks(), ...allQuizElements()].filter((element) =>
        animations.isVisible(element)
      );

      animations.fadeOut(exiting);

      const initialDelay = exiting.length
        ? animations.duration() + (settings.gap || 0)
        : 0;

      animations.fadeIn(dom.getBlocks(config.intro?.blocks || []), {
        initialDelay,
        stagger: config.intro?.stagger,
      });

      // The form is empty again, so the button belongs greyed.
      submitButton?.setEnabled(false);

      lenis?.scheduleRefresh();

      console.log("Delegation Desk reset — ready for the next person");

      return true;
    },
  };
}
