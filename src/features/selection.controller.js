// src/features/selection.controller.js

import { SELECTORS } from "../core/dom.js";
import { blockNamesFor, formBlockNamesFor } from "../core/variants.js";

export function createSelectionController({
  config,
  dom,
  state,
  animations,
  fields,
  validation,
}) {
  const selection = config.selection || {};
  const variants = config.variants || [];

  // The stagger sequence, sorted top-to-bottom by document position rather
  // than config order. In Webflow [form-block=info] sits above the variant
  // blocks, so fading in config order cascades bottom, top, bottom — which
  // reads as arbitrary even now that it no longer shifts the layout.
  function enterElementsFor(variant) {
    const elements = [
      ...dom.getBlocks(blockNamesFor(config, variant)),
      ...dom.getFormBlocks(formBlockNamesFor(config, variant)),
    ];

    return elements.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
  }

  // Every post-selection target across every variant, as selector strings.
  // Used to hide them before first paint, so all five h1 variants don't stack
  // up on screen while the intro is still fading in.
  function allEnterSelectors() {
    const selectors = new Set();

    variants.forEach((variant) => {
      blockNamesFor(config, variant).forEach((name) =>
        selectors.add(SELECTORS.block(name))
      );

      formBlockNamesFor(config, variant).forEach((name) =>
        selectors.add(SELECTORS.formBlock(name))
      );
    });

    return Array.from(selectors);
  }

  return {
    isVariant(variant) {
      return variants.includes(variant);
    },

    allEnterSelectors,
    enterElementsFor,

    select(variant) {
      if (!this.isVariant(variant)) {
        console.warn(`Delegation Desk: unknown variant "${variant}"`);
        return false;
      }

      // Already on this variant's screen — nothing to transition.
      if (state.showingQuiz && state.selectedVariant === variant) {
        return false;
      }

      const previous = state.selectedVariant;
      const isDifferentCategory = previous !== null && previous !== variant;

      // Answers belong to a category. Coming back to the same one keeps them;
      // switching categories starts clean.
      if (isDifferentCategory) {
        // Reset the validation state of whatever was wiped, or the new
        // category inherits red borders from the old one's answers.
        validation.resetFields(fields.clearAll());
      }

      // Switching variants: drop the old one's blocks instantly rather than
      // cross-fading two headings over each other.
      if (isDifferentCategory) {
        const entering = enterElementsFor(variant);

        animations.hideNow(
          enterElementsFor(previous).filter(
            (element) => !entering.includes(element)
          )
        );
      }

      state.selectedVariant = variant;
      state.showingQuiz = true;

      const exiting = dom
        .getBlocks(selection.exitBlocks)
        .filter((element) => animations.isVisible(element));

      animations.fadeOut(exiting);

      // Only wait for an exit that is actually happening — on a re-selection
      // the intro is already gone and the new blocks should come straight in.
      const initialDelay = exiting.length
        ? animations.duration() + (selection.gap || 0)
        : 0;

      animations.fadeIn(enterElementsFor(variant), {
        initialDelay,
        stagger: selection.stagger,
      });

      return true;
    },

    // [cmd=back] — reverse of select(). selectedVariant is deliberately kept,
    // so picking the same category again retains what was typed.
    back() {
      if (!state.showingQuiz) {
        return false;
      }

      const variant = state.selectedVariant;

      state.showingQuiz = false;

      const exiting = enterElementsFor(variant).filter((element) =>
        animations.isVisible(element)
      );

      animations.fadeOut(exiting);

      const initialDelay = exiting.length
        ? animations.duration() + (selection.gap || 0)
        : 0;

      animations.fadeIn(dom.getBlocks(selection.exitBlocks), {
        initialDelay,
        stagger: config.intro?.stagger,
      });

      return true;
    },
  };
}
