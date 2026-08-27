# delegation-desk

Interactive one-page quiz for the Delegation Desk Webflow page. Built with Vite, shipped to Webflow
as a single `<script type="module">` tag served from jsDelivr.

```bash
npm install
npm run build
```

The build writes `dist/webflow-snippet.html` — paste its contents into the Webflow page's custom
code. The filename is content-hashed, so **the embed must be updated on every deploy**.

`dist/` is committed on purpose: jsDelivr serves the bundle directly out of this repo, and the
snippet pins `@main`, so pushing to `main` is the deploy.

To check behaviour locally without publishing:

```bash
python3 -m http.server 4321
```

then open <http://localhost:4321/test/local.html>.

See [CLAUDE.md](CLAUDE.md) for the block attribute contract and deployment constraints.
