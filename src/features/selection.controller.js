// src/features/selection.controller.js

import { SELECTORS } from "../core/dom.js";

function resolve(name, variant) {
  return name.replace("{variant}", variant);
}

export function createSelectionController({
  config,
  dom,
  state,
  animations,
  fields,
}) {
  const selection = config.selection || {};
  const variants = config.variants || [];

  function blockNamesFor(variant) {
    return (selection.enterBlocks || []).map((name) => resolve(name, variant));
  }

  function formBlockNamesFor(variant) {
    return (selection.enterFormBlocks || []).map((name) =>
      resolve(name, variant)
    );
  }

  // Order matters — this is the stagger sequence.
  function enterElementsFor(variant) {
    return [
      ...dom.getBlocks(blockNamesFor(variant)),
      ...dom.getFormBlocks(formBlockNamesFor(variant)),
    ];
  }

  // Every post-selection target across every variant, as selector strings.
  // Used to hide them before first paint, so all five h1 variants don't stack
  // up on screen while the intro is still fading in.
  function allEnterSelectors() {
    const selectors = new Set();

    variants.forEach((variant) => {
      blockNamesFor(variant).forEach((name) =>
        selectors.add(SELECTORS.block(name))
      );

      formBlockNamesFor(variant).forEach((name) =>
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
        fields.clearAll();
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
