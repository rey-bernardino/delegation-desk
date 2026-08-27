// src/core/state.js
//
// Single mutable object. The DOM is the real state machine; this only holds
// what can't be read back off an attribute.

export const state = {
  // Which quiz variant the user picked: travel | gift | deck | brief | offsite
  selectedVariant: null,
};
