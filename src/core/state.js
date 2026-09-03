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

  // Payloads from the last submit attempt, kept for inspection.
  lastPayloads: null,

  // True while a submission is in flight. Submitting now waits on a network
  // call, so without this a second click would send everything twice.
  submitting: false,

  // Latched once a submission has succeeded. Stays true for the rest of the
  // page view: the destinations already have the data, so a second send would
  // duplicate a CRM record and a sheet row.
  submitted: false,
};
