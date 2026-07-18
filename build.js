/* Vercel build step: stage the static app files into public/ (the project's
   configured output directory). The api/ folder is picked up separately as
   serverless functions. */
const fs = require("fs");
const path = require("path");
const FILES = [
  "index.html",
  "styles.css",
  "agent.css",
  "outcomes.css",
  "strategy.js",
  "app.js",
  "agent.js",
  "outcomes.js",
];
fs.mkdirSync("public", { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(f, path.join("public", f));
  console.log("staged", f);
}
