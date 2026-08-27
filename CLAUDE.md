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
on a Webflow global having loaded first. If a later milestone needs a page global (`hbspt`,
`Webflow`, `jQuery`), never `import` it; guard access (`window.X?.method`), because load order is
not guaranteed.

## Architecture

Entry: `src/app.js`. Every module is a `createX({ deps })` factory. `app.js` instantiates them,
wires dependencies explicitly, then exposes everything on `window.DelegationDesk` for console
debugging.

- `src/config/quiz.config.js` — **all** configuration. Prefer adding config here over hardcoding.
- `src/core/` — `state` (single mutable object), `dom` (selector helpers), `events` (all delegated
  handlers).
- `src/features/` — `selection.controller` (intro ↔ variant transitions), `fields.service`
  (clearing `.d-field` inputs).
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
| `.d-field` (`config.fieldSelector`) | An input the quiz owns. Cleared when the user switches to a different category. |

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

Two details that are easy to break:

- `fadeInElement` does the `display` reveal **inside** the delayed callback, not up front. Revealing
  a staggered block early makes it claim layout space at opacity 0 while the intro is still fading,
  which jumps the page.
- The exit delay is only applied when something is actually visible to exit, so re-selecting a
  variant brings the new blocks straight in instead of pausing on a blank screen.

`[cmd=back]` runs `selection.back()`, the mirror image: the variant's blocks fade out, the intro
fades back in.

### Retaining vs clearing answers

`state.selectedVariant` is deliberately **not** cleared by `back()` — it records the last category
picked, while `state.showingQuiz` records which screen is up. That split is what makes the rule
work:

- Back, then the **same** category → answers are retained.
- Back, then a **different** category → `fields.clearAll()` wipes every `.d-field`.

`clearAll` dispatches `input` and `change` on each field. A silent value wipe would leave stale
"filled" styling and, later, stale validation state behind.

## Milestones

- **1 (done)** — fade in `[block=intro-logo]` and `[block=select]` on page load.
- **2 (done)** — `[select=variant]` click fades the intro out and the variant's blocks in.
- **3 (done)** — `[cmd=back]` returns to the intro; switching category clears `.d-field` inputs,
  re-picking the same one retains them; `quiz-nav` restores as a grid.
- Later — validation (port tactics from `rey-bernardino/athena-form`, branch `callflowmerge`),
  dual Webflow + HubSpot submit.

## Conventions

- 2-space indent, double quotes, semicolons. Named exports only.
- Optional chaining for cross-module and global calls.
- Comment out debug logs rather than deleting them.
