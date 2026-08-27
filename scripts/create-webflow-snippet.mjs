import fs from "fs";

const manifest = JSON.parse(
  fs.readFileSync("dist/.vite/manifest.json", "utf8")
);

const entry = manifest["src/app.js"];

if (!entry) {
  throw new Error("Could not find src/app.js in Vite manifest.");
}

const baseUrl =
  "https://cdn.jsdelivr.net/gh/rey-bernardino/delegation-desk@main/dist";

const snippet = `<script type="module" src="${baseUrl}/${entry.file}"></script>\n`;

fs.writeFileSync("dist/webflow-snippet.html", snippet);

console.log(snippet);
