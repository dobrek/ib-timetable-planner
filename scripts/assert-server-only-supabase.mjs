#!/usr/bin/env node
// Fails the build when the browser bundle (`dist/client/`) carries a Supabase key or host.
//
// Why (S-402, research § 4): the browser never talks to Supabase — every Auth and data call runs in
// the Worker, with the publishable key as an `astro:env` server secret. That is what makes the
// Turnstile check in front of `POST /api/auth/forgot` a real gate: if the key ever shipped to the
// browser, anyone could call GoTrue's `/recover` directly and flood reset links past the check.
// It was true by accident (no island ever needed a client); this script and CLAUDE.md make it a
// rule. Runs as `postbuild`, so every `pnpm build` — CI's verify and e2e, the Playwright
// webServer, the solver scripts — checks the bundle it just produced.
//
// Prints each offending file and pattern, never the matched value. Host tooling, not Worker code.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const clientDir = join(root, "dist/client");

// Prefixes and hosts only: what a leaked key or URL would contain, never a value itself.
const PATTERNS = ["sb_publishable_", "sb_secret_", ".supabase.co", "127.0.0.1:54321"];

// Everything else is scanned as text, so a new text asset type is covered without a list change.
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".zip",
  ".gz",
  ".br",
  ".wasm",
]);

let files;
try {
  files = listFiles(clientDir);
} catch (error) {
  fail(`could not read ${relative(root, clientDir)}: ${error instanceof Error ? error.message : String(error)}`);
}

const findings = files
  .filter((file) => !BINARY_EXTENSIONS.has(extname(file).toLowerCase()))
  .flatMap((file) => {
    const content = readFileSync(file, "utf-8");
    return PATTERNS.filter((pattern) => content.includes(pattern)).map((pattern) => ({ file, pattern }));
  });

if (findings.length > 0) {
  for (const { file, pattern } of findings) {
    process.stderr.write(`[assert-server-only-supabase] ${relative(root, file)} contains "${pattern}"\n`);
  }
  fail(
    "the browser bundle must hold no Supabase key or host. Supabase is server-only: read it through " +
      "`astro:env/server` in server code, never `astro:env/client`, `PUBLIC_*` or `createBrowserClient`",
  );
}
process.stdout.write(
  `[assert-server-only-supabase] ${files.length} files in ${relative(root, clientDir)}: no Supabase key or host\n`,
);

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function fail(reason) {
  process.stderr.write(`[assert-server-only-supabase] ${reason}\n`);
  process.exit(1);
}
