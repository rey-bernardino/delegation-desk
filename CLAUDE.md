# delegation-desk

Interactive one-page quiz. Vanilla JS, built with Vite, embedded into a Webflow page as a single
`<script type="module">` tag served from jsDelivr. Same publishing model as `athena-form`.

On submit the quiz posts to **two** destinations: a Webflow form and a HubSpot form. Fields are
populated by code, with values read off DOM elements.

## Commands

```bash
npm install
npm run build   # vite build && node scripts/create-webflow-snippet.mjs
```

No tests, no linter, no dev server. Verification is manual, in the browser. `test/local.html` is a
static stand-in for the Webflow page — serve the repo root (`python3 -m http.server 4321`) and open
`/test/local.html`. It loads `src/` directly, so no build is needed to check behaviour.

## Deployment constraints — read before touching build config

1. **`dist/` is committed on purpose.** jsDelivr serves the built bundle straight out of the repo.
   Do NOT add `dist/` to `.gitignore`. Every functional change needs `npm run build` and a commit
   of the rebuilt `dist/`.
2. **The repo must stay public** for `cdn.jsdelivr.net/gh/...` to resolve.
3. `scripts/create-webflow-snippet.mjs` hardcodes the CDN base URL (`rey-bernardino/delegation-desk@main`).
   If the repo is moved, renamed, or the branch changes, update that string AND the `<script>` tag
   in Webflow.
4. The snippet pins `@main`, not a SHA, so pushing to `main` is the deploy. jsDelivr caches; a purge
   may be needed to see a change immediately.
5. `npm run build` changes the bundle hash, which rewrites `dist/webflow-snippet.html`. **The Webflow
   embed must be updated to the new filename on every deploy.**

## Runtime environment

Nothing but `src/` is bundled. jQuery is NOT used — deliberately, so block animation does not depend
on a Webflow global having loaded first. Page globals are never `import`ed; access is always guarded
(`window.X?.method`), because load order is not guaranteed.

Globals the page provides today: **Lenis** (`window.lenis`, plus the page's own
`window.refreshLenis`), loaded from unpkg at 1.0.33.

## Architecture

Entry: `src/app.js`. Every module is a `createX({ deps })` factory. `app.js` instantiates them,
wires dependencies explicitly, then exposes everything on `window.DelegationDesk` for console
debugging.

- `src/config/quiz.config.js` — **all** configuration. Prefer adding config here over hardcoding.
- `src/core/` — `state` (single mutable object), `dom` (selector helpers), `events` (all delegated
  handlers).
- `src/features/` — `selection.controller` (intro ↔ variant transitions), `fields.service`
  (clearing `.d-field` inputs), `validation.service`, `payload.service` (builds what gets sent),
  `submission.controller` (decides what happens on submit).
- `src/integrations/` — `lenis.service` (smooth-scroll refresh), `webflow-form.service` (fills and
  submits the hidden Webflow form).
- `src/ui/` — `animations` (CSS transitions).

`animations` operates on **elements**, never names — resolving a name to an element is `dom`'s job,
because blocks are addressed by more than one attribute (`[block]` and `[form-block]`).

### The DOM is the state machine

Markup lives in Webflow, not this repo. Sections are `[block="name"]` elements.

| Attribute | Meaning |
| --- | --- |
| `[block="name"]` | A section of the page. Referenced by name from config. |
| `[form-block="name"]` | A section *inside* `[block=form-blocks]`. One per variant, plus `info` and `submit`. |
| `[select="travel"]` | Click target that starts the quiz for that variant. Value must be in `config.variants` or the click is ignored with a console warning. |
| `[cmd="back"]` | Returns to the intro blocks. |
| `[block-display="grid"]` | Per-element display override, highest precedence. See **Restoring display** below. |
| `.d-field` (`config.fieldSelector`) | An input the quiz owns. Cleared on a category switch unless its `[form-block]` is in `config.preserveFormBlocks`. |
| `.d-field-container` (`config.validation.fieldWrapper`) | Wrapper that carries the `invalid` class. Webflow styles the red border and reveals `.errorMessage` off it. |
| `[form-block=optin]` | Email consent checkbox. **Required.** Preserved across category switches, sent to HubSpot, never a category answer. |
| `data-dd-touched` | Set once the user has left a field. Untouched fields validate but stay unstyled. |

### Hidden fields

`[form-block=info]` also holds hidden inputs Webflow ships pre-filled (`utm_*`, `hdyhau_primary`,
`hdyhau_secondary`, `phone`) plus two the quiz owns. **They deliberately carry no `.d-field` class**,
so validation ignores them and `clearAll` never touches them — do not add that class to a hidden
input or it becomes a required field that can never be filled.

`config.hiddenFields.choice` (`event_allin_delegationdesk_choice`) is written the moment a category
is picked, with the **display label** from `config.variantLabels`, not the slug:

| variant | label |
| --- | --- |
| `travel` | Weekend Trip Itinerary |
| `gift` | Gift Sourcing Shortlist |
| `deck` | Company Deck Template |
| `brief` | Brief Me on Someone |
| `offsite` | Company Offsite |

`config.hiddenFields.summary` (`event_allin_delegationdesk_summary`) is written on submit with the
summary JSON — see **The summary payload** below. It is filled *before* the HubSpot payload is
built, so that payload carries the value rather than an empty string.

Variants are `travel`, `gift`, `deck`, `brief`, `offsite`. Per-variant block names are templated in
config with `{variant}` — `h1-{variant}` resolves to `[block="h1-travel"]`, and `enterFormBlocks`
`{variant}` resolves to `[form-block="travel"]`.

Because markup is external, **selectors are the API**. Changing one silently breaks the live page
with no build error. Grep before renaming, and flag any selector change in the summary.

### Load sequence

Both `arm*` methods run at module evaluation, *not* on `DOMContentLoaded` — blocks must be hidden
before first paint, or the intro flashes at full opacity and all five variant headings show at once
before the quiz starts. `armFade` sets `opacity: 0` (block keeps its layout space); `armHidden` sets
`display: none` (block is out of the flow entirely, used for every post-selection target).

Both hide with an injected `<style>` rather than inline styles on purpose: if the bundle fails to
load, nothing is hidden and the page degrades to fully visible instead of permanently blank. The
fade then sets inline opacity/display, which outranks those stylesheet rules without `!important`.

`prefers-reduced-motion: reduce` collapses all durations to 0.

### Restoring display

Fading a block out sets `display: none`, so fading it back in has to pick a display value. Guessing
`flex` for everything is wrong — `quiz-nav` is a grid and `intro-logo` is a plain block. Resolution
order in `animations.displayFor`:

1. `[block-display]` on the element — an explicit override authored in Webflow.
2. `data-dd-display` — what the element actually computed to before we hid it. Written by
   `fadeOutElement`/`hideNow` while the element is still visible, so anything the quiz has hidden
   comes back exactly as Webflow styled it.
3. `config.blockDisplays[name]` — for a block that has never been visible, so nothing was recorded.
   This is why `quiz-nav: "grid"` lives in config: it is revealed for the first time, not restored.
4. `config.blockDisplay` — the `flex` default.

### Selection transition

A click on `[select]` is handled by a delegated listener in `core/events.js` and runs
`selection.select(variant)`:

1. Intro blocks (`selection.exitBlocks`) fade out and are pulled from the flow.
2. After `animationTime + selection.gap`, the entering elements fade in on a `selection.stagger`
   sequence: `enterBlocks` first, then `enterFormBlocks`.

Three details that are easy to break:

- **`fadeIn` reserves layout for the whole set in one step, then staggers opacity only.** Revealing
  each element at its own turn shoves the ones already on screen around — in Webflow
  `[form-block=info]` sits *above* the variant blocks, so revealing it third pushed the visible
  variant block down 408px mid-fade. Never move the `prepareElement` calls into the per-element
  timers.
- The reserve is deferred to `initialDelay` rather than done up front, so incoming blocks don't
  claim space while the outgoing ones are still fading out. Both halves matter: reserve too early
  and the page grows during the exit; reserve too late (per element) and the cascade shifts.
- The exit delay is only applied when something is actually visible to exit, so re-selecting a
  variant brings the new blocks straight in instead of pausing on a blank screen.

`enterElementsFor` sorts by document position, not config order, so the cascade reads top-to-bottom.
Config order still decides *which* blocks appear.

`[cmd=back]` runs `selection.back()`, the mirror image: the variant's blocks fade out, the intro
fades back in.

### Retaining vs clearing answers

`state.selectedVariant` is deliberately **not** cleared by `back()` — it records the last category
picked, while `state.showingQuiz` records which screen is up. That split is what makes the rule
work:

- Back, then the **same** category → answers are retained.
- Back, then a **different** category → `fields.clearAll()` wipes every `.d-field`.

`clearAll` dispatches `input` and `change` on each field. A silent value wipe would leave stale
"filled" styling and, later, stale validation state behind. It returns the fields it cleared, and
the selection controller feeds those to `validation.resetFields` so red borders and touched flags
don't carry into the new category.

`config.preserveFormBlocks` (`["info", "optin"]`) is exempt from all of that: `[form-block=info]` — name,
email, company — is shown for every category, so its answers are never category-specific and must
survive a switch.

### Lenis must be refreshed on every height change

Lenis caches the scroll limit and only recomputes it on resize, and this quiz changes the page height
drastically. Measured on the live page: the intro allows ~139px of scroll, a filled category ~1508px.
Without a refresh the limit is stale in both directions — after entering a category the user can
scroll only 139px and **most of the form is unreachable**; after `[cmd=back]` they can scroll 1508px
into empty space.

`lenis.service.js` wraps it. `scheduleRefresh()` coalesces to one resize per frame, because a
staggered cascade changes layout once but fires through several timers. Refresh points:

- `fadeIn` — right after the batched reserve, where layout becomes final for the entering set.
- `fadeOutElement` / `hideNow` — when a block leaves the flow and the page shrinks.
- `validation.showFieldState` — `.errorMessage` flips between `display: none` and `block`, so every
  field state change moves the page height.

Anything added later that shows, hides, or resizes a block must call `lenis?.scheduleRefresh()`.

`lenis.scrollTo()` is used instead of `scrollIntoView` when focusing the first invalid field —
native smooth scrolling fights Lenis's hijacked scroll.

### Contact vs category blocks

`config.payload.contactFormBlocks` (`["info", "optin"]`) marks the blocks holding contact and
consent data. Their fields go to **both** destinations and are **never** counted as category
answers, so `answers` / `summary.fields` stay purely the category's own questions while
`optin_email` lands in `summary.contact` and the HubSpot payload.

## Validation

Every field in the **current** category is required. Tactics follow athena-form's
`validation.service.js`, including its email regex and the consecutive/leading/trailing dot checks.

**Scope is the point.** `getScopedFields()` resolves `config.selection.enterFormBlocks` for
`state.selectedVariant` and collects `.d-field` inside those blocks only. The other four categories
sit in the DOM with empty inputs and must never count against the user — never validate by querying
`.d-field` globally.

`config.validation.optionalFormBlocks` exempts a block from being required. It is currently empty:
the opt-in is required by decision, so the submit button stays grey until the box is ticked.

Checkboxes and radios validate on `.checked`, never `.value` — a checkbox always carries a `value`
attribute, so reading `.value` would make an unticked box look filled in.

Styling only appears once a field carries `data-dd-touched`, set on `focusout`. This is athena-form's
`solo=""` convention inverted: there, untouched fields carry the attribute; here, touched ones do.
The effect is the same — a form that has not been filled in yet is never shown as a wall of red.

Triggers, all delegated in `core/events.js`:

- `focusout` on a `.d-field` → mark touched, validate that field.
- `input` / `change` → re-validate, but only if already touched, so an error clears the moment it is
  fixed without shouting at a field being typed into for the first time.
- `[cmd=submit]` → the button is **greyed and inert** until the current category is complete, so a
  click can only happen on a valid form. See **The submit button** below.

### The submit button

`submission.refreshButton()` drives it off `validation.checkAll()` — a read-only pass that applies
no styling and sets no touched flags, because the button has to reflect validity long before the
user has visited every field. Refreshed on every `input`, `change` and `focusout`, and after
`[select]` and `[cmd=back]`.

Greyed state is `config.submitButton.disabledClass` (`disabled`), plus `disabled`,
`aria-disabled`, and `pointer-events: none` — athena-form's belt-and-braces, since the control may
be authored as a div where the property is inert. `ui/submit-button.js` injects a fallback rule in
the same palette the rest of the site uses for disabled controls (`#d9d9d9` on `#b3b3b3`); authoring
`[cmd="submit"].disabled` in Webflow overrides it.

`config.submitButton.blockClicks: false` leaves the greyed button clickable, in which case the click
runs `validateAll({ reveal: true })` and surfaces every outstanding error at once. The tradeoff:
inert is cleaner, but a user who never focuses a field sees a grey button with no explanation of
which field is missing.

## Submission

`config.submission.enabled` is the master switch and is **on**. Under it,
`config.submission.destinations` gates each destination and **each must be explicitly `true`** — a
missing or misspelled flag means off, so a typo can't quietly start posting somewhere:

| flag | what it does | now |
| --- | --- | --- |
| `hubspot` | POSTs the Forms v3 body. **Runs first and gates everything else.** | `false` by decision |
| `googleSheets` | submits the hidden Webflow form, which Apps Script reads back into the sheet | `true` |

**HubSpot is the gate.** It goes first, and nothing else happens unless it succeeds — no Webflow
row, no redirect. A submission HubSpot rejected is not a submission, so logging it to the sheet or
thanking the user for it would both be lies, and the sheet would end up disagreeing with the CRM.
A failure leaves the user on a working form to retry from.

With the HubSpot destination **off** there is nothing to gate on, so the rest proceeds — that is
what keeps the switch usable in dev, and the console says the gate is inactive.

Two flags stop a submission happening twice, and `refreshButton()` honours **both** — it runs on
every keystroke, so checking only at the click would let typing a single character re-enable the
button while the request was still in the air:

- `state.submitting` — true while a send is in flight. Blocks an overlapping submit.
- `state.submitted` — latched once a send has succeeded, and never unset. Blocks a *later* submit,
  which the in-flight flag doesn't cover.

The latch is set before the redirect and deliberately survives a suppressed one: if the submission
succeeded but the redirect was blocked (Webflow reported a failure, or `redirect.enabled` is off),
the button stays greyed, because the destinations already have the data and sending again would
duplicate a CRM record and a sheet row. That case logs a warning explaining why the form is still
on screen.

A submit click validates, builds every payload, stores them on `state.lastPayloads`, logs them, and
sends to each enabled destination.

Both payloads are printed to the console on every submit click, grouped under
`Delegation Desk — submit payloads (<category>, not sent)`: the quiz payload, its `answers` as a
`console.table`, the HubSpot payload, and the serialised `quizJson`. A blocked submit logs a warning
naming the invalid fields instead. `config.submission.logPayloads: false` silences it.

`payload.service.js` builds and never sends. Two shapes, because the destinations want different
things — both read values off the DOM at build time:

**quiz** — destined for a single field, so `buildAll()` also returns `quizJson` (the serialised
form). Category, the info fields as separate top-level keys, then the category's own answers with
their labels:

```json
{
  "category": "travel",
  "firstname": "Rey", "lastname": "Bernardino",
  "email": "rey@athena.com", "company": "Athena",
  "answers": [
    { "name": "trip-destination", "label": "Preferred destination, or \"surprise me\"", "value": "Tokyo" }
  ]
}
```

**hubspot** — flat `name` → `value` of **every** named input in the info block, hidden ones
included, so `utm_*`, `hdyhau_*` and `phone` ride along. The chosen category travels as
`event_allin_delegationdesk_choice`, not as a synthetic `category` key: HubSpot rejects properties
it doesn't know, and that hidden input is the property the portal actually has.

**hubspotApi** — the Forms v3 submission body, same shape as athena-form's
`hubspot.service.js buildSubmissionPayload()`:

```json
{
  "submittedAt": 1757000000000,
  "fields": [{ "name": "email", "value": "rey@athena.com" }],
  "context": { "pageUri": "...", "pageName": "...", "hutk": "<hubspotutk cookie>" }
}
```

**The `hutk` guard — do not "simplify" it.** `context.hutk` is added only when the `hubspotutk`
cookie exists and is non-blank; otherwise **the key is absent entirely**. Sending `hutk: null` or
`hutk: ""` makes HubSpot reject the whole submission, and the cookie legitimately does not exist for
anyone whose browser blocked it — Brave, Safari ITP, any cookie blocker, or a first visit before
HubSpot's script ran. Collapsing this to `context.hutk = getCookie("hubspotutk")` fails exactly the
users who are hardest to reproduce. Carried over from athena-form's `buildContext()`.

Field values are likewise always strings — `valueOf()` guarantees it, and the mapping coerces
`?? ""` — because a null value is rejected the same way a null hutk is.

`legalConsentOptions` is **on** (`config.hubspot.legalConsent.enabled`). A HubSpot form with GDPR
consent options enabled rejects a submission that omits it — and a form without them rejects one
that includes it, so if submissions start failing with a consent-related error, this flag is the
first thing to check.

```json
{ "consent": { "consentToProcess": true, "text": "I agree to receive emails from Athena.", "communications": [] } }
```

The `text` is read from the opt-in checkbox's label at build time rather than hardcoded, so it
always matches what the user actually ticked. **HubSpot stores it as the record of what was agreed
to, so that label's copy is a legal artefact, not just UI text** — changing it changes the consent
record for every submission after the change. `fallbackText` covers a missing or blank label so the
record is never empty; the label is trimmed before falling back, or whitespace-only copy would slip
through as empty consent text.

If the form uses subscription types rather than a plain process consent, `communications` takes
`[{ value: true, subscriptionTypeId: …, text: … }]`. `submission.controller.js` has `postToHubspot()` ready, mirroring athena's
`submitForm()` error typing, but nothing calls it while submission is disabled.

### The summary payload

Written into the hidden summary field on submit, read back downstream out of the Webflow Forms API,
and exploded into Google Sheets columns. Shaped for that consumer, which is why it differs from the
quiz payload — `fields` and `labels` are **flat maps keyed by field name**, so the reader takes
`Object.keys(fields)` for column order and `labels[key]` for the header. JSON preserves key order,
so column order stays stable as long as the Webflow markup order does.

```json
{
  "v": 1,
  "category": "travel",
  "categoryLabel": "Weekend Trip Itinerary",
  "submittedAt": "2026-09-03T02:41:51.884Z",
  "contact": { "firstname": "Rey", "lastname": "Bernardino", "email": "…", "company": "Athena" },
  "fields": { "trip-destination": "Tokyo", "trip-budget": "5000" },
  "labels": { "trip-destination": "Preferred destination, or \"surprise me\"", "trip-budget": "Total trip budget" }
}
```

- `v` (`config.payload.summary.version`) — bump when the shape changes so a downstream reader can
  branch on it rather than guess. Never reuse a number.
- `labels` makes each row self-describing: the consumer builds headers from any single row instead
  of hardcoding a schema, so a reworded question updates the header on its own. Costs 570 bytes on
  the largest category; `config.payload.summary.includeLabels: false` drops it.
- `contact` is kept out of `fields` so a per-category sheet can lay out contact columns first and
  answer columns after, and an all-submissions sheet can ignore `fields` entirely.

Measured sizes for travel (11 fields, the largest category): ~1.3KB with typical answers, ~3.1KB
with long ones, ~9KB with pathologically verbose ones. The field has no `maxlength`.

### Console helper

```js
buildSubmissionPayload()          // uses the selected category
buildSubmissionPayload("gift")    // build for another category
```

Global, defined in `app.js`. Builds and logs every payload from whatever is currently on screen —
no validation, no submission, no DOM mutation.

`[form-block=info]` is contact detail, not an answer — it goes to both destinations and is never
included in `answers`. Labels come from `.d-field-label` inside the field's wrapper.

## Webflow-side CSS

`webflow/optin-checkbox.css` styles the opt-in checkbox and is **not bundled** — it is pasted into
the Webflow page. Two things it has to undo: `.d-field { width: 100% }`, which stretches the native
box across the row, and the generic `.d-field-container.invalid input` rule, which adds an error
icon and 35px of right padding that wreck a 22px box.

## The hidden Webflow form

`#wf-form-Delegation-Desk` is a hidden Webflow form, the source of record for the Google Sheets
pipeline: Apps Script reads it back through the Webflow Forms API. Its fields mirror the summary
payload — `category`, `categoryLabel`, `submittedAt`, `contact`, `fields`, `labels` — with the
object-valued ones JSON-stringified. `config.webflowForm.fieldMap` is the mapping.

**Submit by clicking the form's own submit control**, never `form.submit()`. Webflow binds its
handler to the control, and only a submission that goes through that handler is stored — calling
`form.submit()` records nothing. Carried over from athena-form's `error-logger.service.js`.

**`cc-num` is Webflow's honeypot.** Never write to it: a filled honeypot makes Webflow discard the
submission silently, with no error anywhere.

`contact`, `fields` and `labels` are textareas capped at 5000 characters; `v`, `category`,
`categoryLabel` and `submittedAt` are text inputs at 256. That covers a travel submission with long
answers (~3KB) but not a pathological one (~9KB) — the service warns whenever a value exceeds its
field's `maxlength`, so truncation shows up in the console rather than silently downstream.

### After submission — the kiosk loop

This runs on an iPad at an event, so a successful submission does **not** navigate. It swaps the
quiz for `thankyou-logo` / `thankyou-body` / `thankyou-timer`, drains the countdown bar, and resets
itself for the next person. `[cmd=reset]`, inside the timer block, does the same immediately.

`config.thankyou.resetAfterMs` is the countdown (10s). The bar (`.decor_timer-progress`) is driven
by a single `width` transition from 100% to 0% rather than a per-frame tick — the browser
interpolates it and there is nothing to keep in sync. The countdown starts *after* the thank-you has
faded in, or the bar would already be part-drained before anyone could see it.

**Reset means "next attendee", which is stricter than a category switch:**

- `fields.clearAll({ includePreserved: true })` — clears the contact fields and the opt-in too.
  `config.preserveFormBlocks` is for switching category, not for handing the iPad to a stranger:
  leaving one person's name and email on screen would be a privacy problem.
- The hidden fields are cleared explicitly, since they carry no `.d-field` class and `clearAll`
  never sees them. Left alone, the next submission would ship the previous category label and
  summary JSON.
- `webflowForm.restore()` puts the hidden form back. **Webflow hides the form and reveals
  `.w-form-done` after a submission and never undoes it**, so without this the kiosk would record
  the first person and then silently stop.
- `state.submitted` / `submitting` / `selectedVariant` / `showingQuiz` are cleared, and the submit
  button is greyed, since the form is empty again.

A manual reset cancels the pending timer, so it can't fire later and wipe the next person's
half-filled form.

### Redirect (superseded)

`config.redirect` is **off** — the in-page thank-you above replaced it, because a redirect would
leave the event iPad on a page nobody resets. The machinery is kept wired: flip `thankyou.enabled`
off and `redirect.enabled` on for a non-kiosk deployment.

The target **follows the trail of the current page**: `redirect.path` is resolved against the
current page's parent, so `/events/delegation-desk` → `/events/thank-you`, and the same quiz
published at `/delegation-desk` → `/thank-you`. `relativeToParent: false` forces a top-level path;
a full `https://…` URL is used verbatim.

**The redirect waits for Webflow.** Its submission is an in-flight AJAX call, and navigating away
would abort it — the row would simply never appear. `webflowForm.waitForResult()` watches the
wrapper for `.w-form-done` / `.w-form-fail` (Webflow toggles them with inline styles, which is the
only readable signal, since the form sits inside a hidden container so computed display is `none`
either way) and resolves on whichever lands first, or on `waitForWebflowMs`.

A **timeout is not a failure** — it usually means slow, not lost — so it still redirects. An
explicit `.w-form-fail` does not, because thanking someone for a submission that didn't happen is
worse than leaving the form on screen. `redirect.onFailure: true` overrides that.

While `submission.enabled` is false, nothing sends and nothing navigates, but the console logs where
it *would* have gone, so the path can be checked in dev.

## Google Sheets pipeline

`appscript/` holds the Apps Script, which is **not** bundled or deployed by this repo — it is pasted
into a script bound to the spreadsheet.

`webflow-forms-debug.gs` lists the sites and forms the API token can see, so the form is wired by
id rather than by a name that can be edited in the Designer.

`ingest-submissions.gs` does the actual work. Entry points:

| function | what it does |
| --- | --- |
| `ingestWebflowSubmissions()` | the run itself — what the trigger calls |
| `syncNow()` | manual run, identical path so it can't behave differently from the trigger |
| `debugFetchSubmissions()` | fetches without writing; dumps the raw shape and checks tab names |
| `resetAllSheets()` | **dry run** — reports what a reset would delete |
| `resetAllSheetsConfirmed()` | destructive — clears every managed sheet, headers included; asks for `RESET_PASSWORD` first |
| `setupIngestTrigger()` / `deleteIngestTriggers()` | start / stop the 5-minute schedule |
| `ingestStatus()` | whether the schedule is on, and when it last ran |

`onOpen()` puts the whole set in the spreadsheet's own menu bar — sync, start/stop the schedule,
status, connection check, and both resets. It is a simple trigger, so it needs no deployment; the
menu appears on reload. Menu actions report through `wfToast_`, because `Logger.log` is invisible to
someone working in the sheet.

Script Properties the ingest needs: `WEBFLOW_API_TOKEN`, `FORM_ID`, and `RESET_PASSWORD`. None of
them are in this repo — it is public, so jsDelivr can serve the bundle.

The reset is split in two on purpose: the easy-to-run name is the one that does nothing. The
destructive half also asks for `RESET_PASSWORD`, which guards a mis-click in a dropdown rather than
providing security — anyone who can open the script can read the property. Both live
only in dev — clearing headers as well as rows matters while the question set is still changing,
since a stale column would otherwise linger after a field is renamed.

Rows are queued and written per sheet in one `setValues` call per run, not `appendRow` per
submission — `appendRow` is a round trip each time, which is slow when a backlog lands, and
queueing lets every row in a run share one header set.

Dedupe reads the submission ids already in `Submissions` rather than keeping a cursor, so there is
no stored position to drift, and deleting a row re-ingests it. A timestamp cursor would skip two
submissions landing in the same second.

The token lives in Script Properties as `WEBFLOW_API_TOKEN` — never in the repo, and never in a
message. The site id is `6513fda5217cc80d379e2473`, readable from the live page's
`<html data-wf-site>`.

## Milestones

- **1 (done)** — fade in `[block=intro-logo]` and `[block=select]` on page load.
- **2 (done)** — `[select=variant]` click fades the intro out and the variant's blocks in.
- **3 (done)** — `[cmd=back]` returns to the intro; switching category clears `.d-field` inputs,
  re-picking the same one retains them; `quiz-nav` restores as a grid.
- **4 (done)** — killed the layout jump when entering a category.
- **5 (done)** — required-field validation scoped to the current category; `[form-block=info]`
  inputs are never cleared.
- **6 (done)** — submit builds both payloads without sending anything.
- **7 (done)** — Lenis scroll limit refreshed on every height change.
- **8 (done)** — hidden choice field, HubSpot Forms v3 payload shape, `buildSubmissionPayload()`.
- **9 (done)** — summary JSON into `event_allin_delegationdesk_summary`, shaped for Sheets.
- **10 (done)** — submit button greys out until the category is complete.
- **11 (done)** — `[form-block=optin]` in the flow, required, routed to HubSpot.
- **12 (done)** — HubSpot success gates the Webflow log; submit button locks out duplicates.
- **13 (done)** — in-page thank-you, 10s countdown, and a full kiosk reset on `[cmd=reset]`.
- **7 (done)** — Lenis scroll limit refreshed on every height change.
- Next — decide the destination, then post to Webflow + HubSpot.

## Conventions

- 2-space indent, double quotes, semicolons. Named exports only.
- Optional chaining for cross-module and global calls.
- Comment out debug logs rather than deleting them.
