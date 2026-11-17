// `npm run cf:build` — the OpenNext Cloudflare build, minus the local env files.
//
// WHY THIS EXISTS. `opennextjs-cloudflare build` copies the values of .env,
// .env.local, .env.production and .env.production.local into the Worker bundle
// (.open-next/cloudflare/next-env.mjs) and loads them into process.env at
// runtime. On this machine .env.local is a `vercel env pull`, so a plain build
// ships the database URLs and the blob token inside the Worker's code. The
// Worker must get its configuration from `wrangler secret put` instead, never
// from a file on whoever's laptop ran the build.
//
// So the env files are renamed in place (to `<name>.cf-hidden`, still covered
// by the `.env*` line in .gitignore) for the length of the build and put back
// afterwards, and the build FAILS if anything was embedded regardless.
import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"];
const hidden = (name) => `${name}.cf-hidden`;

// A previous run that was killed mid-build left a file hidden: put it back first.
for (const name of ENV_FILES) {
  if (!existsSync(name) && existsSync(hidden(name))) renameSync(hidden(name), name);
}

const moved = [];
let status = 1;
try {
  for (const name of ENV_FILES) {
    if (existsSync(name)) {
      renameSync(name, hidden(name));
      moved.push(name);
    }
  }
  const result = spawnSync("npx", ["opennextjs-cloudflare", "build", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: true,
  });
  status = result.status ?? 1;
} finally {
  for (const name of moved) renameSync(hidden(name), name);
}

if (status === 0) {
  const envModule = path.join(root, ".open-next", "cloudflare", "next-env.mjs");
  if (existsSync(envModule)) {
    const env = await import(pathToFileURL(envModule).href);
    const baked = [...new Set([env.production, env.development, env.test].flatMap((m) => Object.keys(m ?? {})))];
    if (baked.length > 0) {
      console.error(`\ncf-build: refusing — env values were embedded in the Worker bundle: ${baked.join(", ")}`);
      process.exit(1);
    }
  }
}
process.exit(status);
