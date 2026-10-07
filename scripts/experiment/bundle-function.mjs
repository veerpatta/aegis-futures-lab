// Bundle the experimental learner's Neon Function and zip it for deploy.
//
//   node scripts/experiment/bundle-function.mjs
//
// Output: dist/functions/aegisexp/index.mjs and dist/functions/aegisexp.zip
// (the archive the Neon deploy endpoint expects: one entry, index.mjs).
//
// Free-mode guard: the build FAILS if any module that can spend money or
// fetch unlicensed data is pulled in — Databento, Anthropic/Claude, the Yahoo
// fetcher, Telegram notify, or the engine scripts that execute on import.
// esbuild comes with tsx (already a devDependency), so nothing new is installed.

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "dist", "functions", "aegisexp");
mkdirSync(outDir, { recursive: true });

export const FORBIDDEN = [
  /databento/i,
  /anthropic|claude/i,
  /lib[\\/]data[\\/](yahoo|archive|roll-fill|feed-delta)/,
  /scripts[\\/]engine[\\/](notify|run-live|learn|data|model|alerts|paper-broker|paper-release|databento-[a-z-]+)\.ts$/,
  /lib[\\/]paper[\\/](?!policy\.ts)/,
];

const result = await build({
  entryPoints: [join(root, "functions", "aegisexp", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: join(outDir, "index.mjs"),
  banner: {
    js: "import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);",
  },
  external: ["pg-native", "cloudflare:sockets"],
  tsconfig: join(root, "tsconfig.json"),
  metafile: true,
  logLevel: "warning",
  legalComments: "none",
});

const inputs = Object.keys(result.metafile.inputs);
const bad = inputs.filter((p) => FORBIDDEN.some((re) => re.test(p)));
if (bad.length) {
  console.error("Refusing to build: the function bundle would include\n  " + bad.join("\n  "));
  process.exit(1);
}
const text = readFileSync(join(outDir, "index.mjs"), "utf8");
for (const host of ["hist.databento.com", "api.anthropic.com", "query1.finance.yahoo.com", "api.telegram.org"]) {
  if (text.includes(host)) {
    console.error(`Refusing to build: the bundle references ${host}`);
    process.exit(1);
  }
}

// Minimal deflate ZIP writer: one file, index.mjs.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const data = Buffer.from(text, "utf8");
const packed = deflateRawSync(data, { level: 9 });
const name = Buffer.from("index.mjs");
const crc = crc32(data);
const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18);
local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42);
const centralOffset = local.length + name.length + packed.length;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralOffset, 16); end.writeUInt16LE(0, 20);
const zip = Buffer.concat([local, name, packed, central, name, end]);
writeFileSync(join(root, "dist", "functions", "aegisexp.zip"), zip);
writeFileSync(join(outDir, "inputs.json"), JSON.stringify(inputs.map((p) => relative(root, p).replaceAll("\\", "/")).sort(), null, 1));

console.log(`Bundled ${inputs.length} modules → ${(data.length / 1024).toFixed(0)} KB, zip ${(zip.length / 1024).toFixed(0)} KB. Free-mode guard passed.`);
