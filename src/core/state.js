// src/core/state.js
//
// Single mutable object. The DOM is the real state machine; this only holds
// what can't be read back off an attribute.

export const state = {
  // Which quiz variant the user picked: travel | gift | deck | brief | offsite
  // Kept after [cmd=back] so re-picking the same category can retain inputs.
  selectedVariant: null,

  // Whether the quiz blocks are on screen, as opposed to the intro.
  showingQuiz: false,
};
