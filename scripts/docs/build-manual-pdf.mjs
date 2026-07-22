/* Regenerate docs/user-manual.pdf from docs/USER-MANUAL.md.
 *
 *   node scripts/docs/build-manual-pdf.mjs
 *
 * The original PDF was produced by printing the manual from headless Chrome;
 * this script does the same thing reproducibly. It renders the markdown to a
 * plain A4 print stylesheet (no app chrome, no dark background — this is the
 * version a trader prints) and drives Chrome's --print-to-pdf.
 *
 * Only the markdown subset the manual actually uses is supported: headings,
 * paragraphs, ordered/unordered lists with hanging indents, tables,
 * blockquotes, horizontal rules, and inline bold/italic/code/bare links.
 * Keep it that way — see the manual-sync rule in CLAUDE.md.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const mdPath = join(repoRoot, "docs/USER-MANUAL.md");
const pdfPath = join(repoRoot, "docs/user-manual.pdf");

/* ── Markdown → HTML ─────────────────────────────────────────────────── */

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>');
}

const ORDERED = /^\d+\.\s+/;
const BULLET = /^[-*]\s+/;
const HEADING = /^#{1,6}\s/;
const RULE = /^---+$/;

function isBlockStart(line) {
  return (
    line.startsWith("|") ||
    line.startsWith(">") ||
    HEADING.test(line) ||
    RULE.test(line.trim()) ||
    ORDERED.test(line) ||
    BULLET.test(line)
  );
}

function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (RULE.test(line.trim())) {
      out.push("<hr />");
      i++;
      continue;
    }

    if (HEADING.test(line)) {
      const [, hashes, text] = line.match(/^(#+)\s+(.*)$/);
      out.push(`<h${hashes.length}>${inline(text)}</h${hashes.length}>`);
      i++;
      continue;
    }

    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (row) =>
        row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(rows[0]).map((h) => `<th>${inline(h)}</th>`).join("");
      const body = rows
        .slice(2)
        .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    if (ORDERED.test(line) || BULLET.test(line)) {
      const ordered = ORDERED.test(line);
      const marker = ordered ? ORDERED : BULLET;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          const next = lines[i + 1] ?? "";
          if (marker.test(next) || /^\s+\S/.test(next)) {
            i++;
            continue;
          }
          break;
        }
        if (marker.test(l)) {
          items.push(l.replace(marker, ""));
          i++;
        } else if (/^\s+\S/.test(l) && items.length) {
          items[items.length - 1] += ` ${l.trim()}`;
          i++;
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return out.join("\n");
}

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Segoe UI", -apple-system, Roboto, Helvetica, Arial, sans-serif;
         font-size: 10.5pt; line-height: 1.5; color: #14181f; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h2 { font-size: 13pt; margin: 16pt 0 5pt; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p { margin: 0 0 7pt; }
  ol, ul { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin-bottom: 4pt; }
  hr { border: none; border-top: 1px solid #d3d9e2; margin: 12pt 0; }
  blockquote { margin: 8pt 0; padding: 7pt 10pt; background: #fdf6e7;
               border-left: 3px solid #c88a1a; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt;
          page-break-inside: avoid; }
  th, td { border: 1px solid #d3d9e2; padding: 5pt 7pt; text-align: left;
           vertical-align: top; }
  th { background: #f1f4f8; font-weight: 600; }
  code { font-family: Consolas, "SFMono-Regular", monospace; font-size: 9.5pt; }
  a { color: #14181f; }
`;

/* ── Print via headless Chrome ───────────────────────────────────────── */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error(
    "No Chrome/Edge binary found. Set CHROME_PATH to one and re-run:\n  " +
      CHROME_CANDIDATES.join("\n  ")
  );
  process.exit(1);
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Aegis Futures Lab — User Manual</title>
<style>${PRINT_CSS}</style>
</head><body>
${markdownToHtml(readFileSync(mdPath, "utf8"))}
</body></html>`;

const work = mkdtempSync(join(tmpdir(), "aegis-manual-"));
const htmlPath = join(work, "manual.html");
writeFileSync(htmlPath, html, "utf8");

try {
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ],
    { stdio: "inherit" }
  );
  console.log(`Wrote ${pdfPath}`);
} finally {
  /* KEEP_HTML=1 leaves the intermediate render behind — handy when the
     markdown grows a construct the small converter above doesn't handle. */
  if (process.env.KEEP_HTML) console.log(`Kept ${htmlPath}`);
  else rmSync(work, { recursive: true, force: true });
}
