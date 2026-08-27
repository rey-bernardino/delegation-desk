// src/features/selection.controller.js

import { SELECTORS } from "../core/dom.js";

function resolve(name, variant) {
  return name.replace("{variant}", variant);
}

export function createSelectionController({ config, dom, state, animations }) {
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

      if (state.selectedVariant === variant) {
        return false;
      }

      const previous = state.selectedVariant;

      // Switching variants: drop the old one's blocks instantly rather than
      // cross-fading two headings over each other.
      if (previous) {
        animations.hideNow(
          enterElementsFor(previous).filter(
            (element) => !enterElementsFor(variant).includes(element)
          )
        );
      }

      state.selectedVariant = variant;

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
  };
}
