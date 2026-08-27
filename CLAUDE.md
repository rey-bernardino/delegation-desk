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
- `src/core/` — `dom` (selector helpers).
- `src/ui/` — `animations` (CSS transitions).

### The DOM is the state machine

Markup lives in Webflow, not this repo. Sections are `[block="name"]` elements.

| Attribute | Meaning |
| --- | --- |
| `[block="name"]` | A section of the page. Referenced by name from config. |
| `[block-display="grid"]` | Display value to restore when revealing a block Webflow ships as `display: none`. Per-block override; defaults to `config.blockDisplay`, which is `flex` — the blocks use flex formatting. |

Because markup is external, **selectors are the API**. Changing one silently breaks the live page
with no build error. Grep before renaming, and flag any selector change in the summary.

### Load sequence

`animations.armBlocks()` runs at module evaluation, *not* on `DOMContentLoaded` — the intro blocks
must be hidden before first paint or they flash at full opacity and then fade in from nothing. It
hides them with an injected `<style>` rather than inline styles on purpose: if the bundle fails to
load, nothing is hidden and the page degrades to fully visible instead of permanently blank.

`fadeInBlock` then sets inline opacity, which outranks that stylesheet rule without `!important`.
It resets with `transition: none` first, so re-running a fade on an already-visible block does not
dip to 0 and back.

`prefers-reduced-motion: reduce` collapses all durations to 0.

## Milestones

- **1 (done)** — fade in `[block=intro-logo]` and `[block=select]` on page load.
- Later — selection handling, validation (port tactics from `rey-bernardino/athena-form`, branch
  `callflowmerge`), dual Webflow + HubSpot submit.

## Conventions

- 2-space indent, double quotes, semicolons. Named exports only.
- Optional chaining for cross-module and global calls.
- Comment out debug logs rather than deleting them.
