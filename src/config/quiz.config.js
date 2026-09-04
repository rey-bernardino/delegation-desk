// src/config/quiz.config.js

export const QUIZ_CONFIG = {
  // Base duration for block transitions, in ms.
  animationTime: 400,

  // Display value used when revealing a block Webflow ships as display: none.
  // Most blocks use flex formatting.
  blockDisplay: "flex",

  // Blocks whose formatting isn't flex. Keyed by [block] / [form-block] value.
  // A [block-display] attribute in Webflow still wins over this.
  blockDisplays: {
    "quiz-nav": "grid",
  },

  // Inputs the quiz owns.
  fieldSelector: ".d-field",

  // Form blocks whose inputs survive a category switch. [form-block=info] is
  // shown for every category, so its answers are never category-specific.
  preserveFormBlocks: ["info", "optin"],

  validation: {
    // Wrapper that carries the invalid class. Webflow styles the red border
    // and reveals .errorMessage off it.
    fieldWrapper: ".d-field-container",
    invalidClass: "invalid",

    // Blocks whose fields are never required. Empty — the opt-in is required
    // by decision, so nothing is currently exempt. The mechanism stays for
    // when something genuinely optional is added.
    optionalFormBlocks: [],
  },

  payload: {
    // Where a field's human-readable label comes from.
    labelSelector: ".d-field-label",

    // The block whose fields are contact details rather than answers. Sent to
    // both destinations, and never treated as category answers.
    infoFormBlock: "info",

    // Blocks holding contact or consent data rather than category answers.
    // These go to both destinations and never count as answers. optin belongs
    // here, not in the category: it is an email consent, and HubSpot needs it.
    contactFormBlocks: ["info", "optin"],

    // Key the selected category is written to in the quiz payload.
    categoryKey: "category",

    summary: {
      // Bump when the shape changes, so a downstream reader can branch on it
      // instead of guessing. Never reuse a number.
      version: 1,

      // Ship the question text alongside the answers so the consumer can build
      // its headers from any single row rather than hardcoding a schema.
      // Costs ~570 bytes on the largest category. Turn off if size bites.
      includeLabels: true,
    },
  },

  hubspot: {
    submitBaseUrl: "https://api.hsforms.com/submissions/v3/integration/submit",

    // Same shape as athena-form's config.hubspot.
    portalId: "20122740",
    formId: "287352d4-66f8-494a-9e77-3144bf48822a",

    // GDPR / legal consent. Off until the HubSpot form's setting is known: a
    // form with consent options enabled rejects a submission that omits this,
    // and a form without them rejects one that includes it.
    legalConsent: {
      enabled: true,

      // Consent text is read from this field's label so it always matches
      // what the user actually ticked. HubSpot stores it as the record of
      // what was agreed to, so the label copy is a legal artefact, not just
      // UI text.
      optinFieldName: "optin_email",

      // Used only if the label is missing or empty, so the consent record is
      // never blank.
      fallbackText: "I agree to receive email from Athena.",

      // Subscription type ids, e.g.
      // [{ value: true, subscriptionTypeId: 12345, text: "..." }]
      communications: [],
    },
  },

  // What happens after a successful submission. The quiz is a kiosk at an
  // event: it shows the thank-you blocks, counts down, and resets itself for
  // the next person.
  thankyou: {
    enabled: true,

    // Faded in after a submission, in this order.
    blocks: ["thankyou-logo", "thankyou-body", "thankyou-timer"],

    // How long the thank-you stays up before the demo resets itself.
    resetAfterMs: 20000,

    // The bar inside [block=thankyou-timer] that shows the countdown.
    // drain: true empties it 100% -> 0% over resetAfterMs.
    timerBar: ".decor_timer-progress",
    drain: true,

    stagger: 90,
    gap: 60,
  },

  // Superseded by the in-page thank-you above, which is what the kiosk needs —
  // a redirect would leave the event iPad on a page nobody resets. Kept
  // because the machinery is still wired: flip thankyou.enabled off and this
  // on to go back to a thank-you page.
  redirect: {
    enabled: false,

    // Resolved against the current page's parent path, so
    // /events/delegation-desk sends the user to /events/thank-you.
    // Set relativeToParent: false for a top-level /thank-you instead.
    path: "thank-you",
    relativeToParent: true,

    // Carry the current query string (utm_*, etc.) across to the thank-you
    // page. Off, because the hidden fields already captured what matters.
    preserveQuery: false,

    // How long to wait for Webflow to confirm the submission before going
    // anyway. Navigating early would abort the in-flight request.
    waitForWebflowMs: 6000,

    // Whether to redirect when Webflow explicitly reported a failure. Off, so
    // a failed submission doesn't end on a page that thanks the user for it.
    onFailure: false,
  },

  // The hidden Webflow form that records each submission. It is the source
  // the Google Sheets Apps Script reads, via the Webflow Forms API.
  webflowForm: {
    selector: "#wf-form-Delegation-Desk",

    // summary payload key -> Webflow field name. Objects are JSON-stringified.
    fieldMap: {
      v: "v",
      category: "category",
      categoryLabel: "categoryLabel",
      submittedAt: "submittedAt",
      contact: "contact",
      fields: "fields",
      labels: "labels",
    },

    // Webflow's spam trap. Never write to it — a filled honeypot makes Webflow
    // discard the submission without an error.
    honeypotFields: ["cc-num"],
  },

  submitButton: {
    selector: '[cmd="submit"]',

    // Class added while the current category is incomplete. Style
    // [cmd="submit"].disabled in Webflow to override the built-in grey.
    disabledClass: "disabled",

    // true: the greyed button is genuinely inert.
    // false: it stays clickable and a click reveals every outstanding error.
    blockClicks: true,

    // Shown while a submission is in flight. Style
    // [cmd="submit"].loading in Webflow to override the built-in spinner.
    loadingClass: "loading",
    loadingText: "Sending…",

    // false: keep the button's own label and show only the spinner.
    replaceText: true,
  },

  submission: {
    // Master switch. Live: a valid submit posts to every destination below
    // that is explicitly true.
    enabled: true,

    // Which destinations a live submit goes to, once enabled. Both must be
    // explicitly true — anything else is off.
    destinations: {
      // The hidden Webflow form. Named for what it feeds: Apps Script reads
      // those submissions back through the Webflow Forms API and writes them
      // into the spreadsheet. Turning this off stops the Sheets pipeline.
      googleSheets: true,

      // On. Because HubSpot gates everything (see send()), a rejection here
      // stops the Webflow row and the thank-you too.
      hubspot: true,
    },

    // Print both payloads to the console on every submit click.
    logPayloads: true,
  },

  // Every quiz variant. A [select] trigger whose value is not in this list is
  // ignored, so a stray attribute in Webflow can't half-start the quiz.
  variants: ["travel", "gift", "deck", "brief", "offsite"],

  // Human-readable name per variant. This — not the slug — is what gets
  // written into the hidden choice field and reported to HubSpot.
  variantLabels: {
    travel: "Weekend Trip Itinerary",
    gift: "Gift Sourcing Shortlist",
    deck: "Company Deck Template",
    brief: "Brief Me on Someone",
    offsite: "Company Offsite",
  },

  // Hidden inputs the quiz writes into. They live inside [form-block=info] and
  // deliberately carry no .d-field class, so validation ignores them.
  hiddenFields: {
    // Filled with variantLabels[variant] the moment a category is picked.
    choice: "event_allin_delegationdesk_choice",

    // Filled on submit with the summary JSON. Read back out of the Webflow
    // Forms API downstream and exploded into Google Sheets columns.
    summary: "event_allin_delegationdesk_summary",
  },

  // Stamped at submit with the visitor's local date as MM/DD/YYYY. Same field
  // name, format and portal as athena-form's consentDateField, so the HubSpot
  // property already accepts this shape.
  //
  // The input is created inside [form-block=info] if the Webflow markup does
  // not carry it, so this works without waiting for a publish.
  consentDateField: {
    enabled: true,
    name: "optin_email_dateconsented",

    // Only stamp a date when the opt-in is actually ticked. athena-form writes
    // it unconditionally; here a date is a record that consent was given, and
    // recording one for someone who declined would be false. The opt-in is
    // required, so in practice this is always true — the guard is for the day
    // it stops being required. Set false to match athena exactly.
    onlyWhenOptedIn: true,
  },

  intro: {
    // Blocks faded in on page load, in order.
    blocks: ["intro-logo", "select"],

    // Delay between each block in the sequence, in ms.
    stagger: 120,

    // Delay before the first block starts, in ms.
    initialDelay: 80,
  },

  selection: {
    // Faded out when a variant is picked.
    exitBlocks: ["intro-logo", "select"],

    // Faded in afterwards. {variant} is replaced with the chosen variant.
    enterBlocks: ["quiz-nav", "h1-{variant}", "form-blocks"],

    // [form-block] elements faded in with the form, continuing the same
    // stagger sequence as enterBlocks.
    // Order here only decides which blocks appear — enterElementsFor sorts by
    // document position, so optin lands after the category block because that
    // is where it sits in the Webflow markup.
    enterFormBlocks: ["{variant}", "info", "optin", "submit"],

    // Delay between each entering element, in ms.
    stagger: 90,

    // Beat between the exit finishing and the entrance starting, in ms.
    gap: 60,
  },
};
