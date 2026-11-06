// Bundle the engine clock's Neon Function and zip it for deploy.
//
//   node scripts/clock/bundle.mjs
//
// Output: dist/functions/aegisclock/index.mjs, dist/functions/aegisclock.zip
// and dist/functions/aegisclock.zip.b64 (the base64 body the Neon deploy API
// and the Neon MCP `deploy_function` tool accept).
//
// Guard: the clock must stay tiny and dependency-free — only lib/clock, its
// entry file and Neon's trigger parser may be bundled. It never imports the
// learner, the strategies, a Postgres driver, Yahoo, Telegram or any paid API,
// and the build fails if the bundle grows past MAX_BYTES (a bigger clock would
// mean something unintended was pulled in).

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "dist", "functions", "aegisclock");
mkdirSync(outDir, { recursive: true });

export const MAX_BYTES = 16 * 1024;
export const ALLOWED = [
  /^functions\/aegisclock\/index\.ts$/,
  /^lib\/clock\/[a-z-]+\.ts$/,
  /^node_modules\/@neon\/functions\/dist\/(triggers|lib\/parse-trigger-invocation)\.js$/,
];

const result = await build({
  entryPoints: [join(root, "functions", "aegisclock", "index.ts")],
  bundle: true,
  minify: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: join(outDir, "index.mjs"),
  tsconfig: join(root, "tsconfig.json"),
  metafile: true,
  logLevel: "warning",
  legalComments: "none",
});

const inputs = Object.keys(result.metafile.inputs).map((p) => relative(root, join(root, p)).replaceAll("\\", "/"));
const bad = inputs.filter((p) => !ALLOWED.some((re) => re.test(p)));
if (bad.length) {
  console.error("Refusing to build: the clock bundle would include\n  " + bad.join("\n  "));
  process.exit(1);
}

const output = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]];
if (output.bytes > MAX_BYTES) {
  console.error(`Refusing to build: the clock bundle is ${output.bytes} bytes (limit ${MAX_BYTES}).`);
  process.exit(1);
}

// Minimal deflate ZIP writer: one file, index.mjs (same layout as the learner's bundle).
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const { readFileSync } = await import("node:fs");
const data = readFileSync(join(outDir, "index.mjs"));
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
writeFileSync(join(root, "dist", "functions", "aegisclock.zip"), zip);
writeFileSync(join(root, "dist", "functions", "aegisclock.zip.b64"), zip.toString("base64"));

console.log(`Clock bundle: ${inputs.length} modules → ${data.length} bytes, zip ${zip.length} bytes, base64 ${zip.toString("base64").length} chars.`);
