#!/usr/bin/env node
// Guards against server-only validation dependencies (zod) leaking into the
// client JS bundle — the exact bug this fixes: a Client Component importing
// one runtime constant from a module that also builds Zod schemas at module
// scope pulled zod's entire runtime (~414 KB) into the browser on /app/tasks.
// Checking the compiled output directly (not the import graph) catches the
// real failure mode regardless of which file introduces it next time.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CHUNKS_DIR = join(process.cwd(), ".next", "static", "chunks");

// Symbols that only appear in zod's own compiled source — distinct enough
// that a false positive would require another library to coincidentally
// share zod's internal export names.
const ZOD_MARKERS = ["$ZodAsyncError", "$ZodType", "globalConfig", "$constructor"];

function listJsFiles(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(listJsFiles(full));
    } else if (entry.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

let files;
try {
  files = listJsFiles(CHUNKS_DIR);
} catch {
  console.error(
    `check-client-bundle: ${CHUNKS_DIR} not found — run "next build" first.`,
  );
  process.exit(1);
}

const offenders = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const hits = ZOD_MARKERS.filter((m) => src.includes(m));
  // Require at least 2 markers so an unrelated minified symbol collision on
  // one short name can't fail the build.
  if (hits.length >= 2) offenders.push({ file, hits });
}

if (offenders.length > 0) {
  console.error(
    "\n✗ check-client-bundle: zod appears to have leaked into the client bundle:\n",
  );
  for (const { file, hits } of offenders) {
    console.error(`  ${file.replace(process.cwd() + "/", "")} (matched: ${hits.join(", ")})`);
  }
  console.error(
    "\nzod is a server-only validation dependency (used inside Server Actions).\n" +
      "A Client Component almost certainly imported a runtime value (not a\n" +
      "`type`-only import) from a src/lib/validation/*.ts module that builds\n" +
      "Zod schemas at module scope. Move the shared constant/type into a\n" +
      "zod-free module (see src/lib/validation/task-constants.ts for the\n" +
      "existing pattern) and import from there instead.\n",
  );
  process.exit(1);
}

console.log(`✓ check-client-bundle: no zod runtime found in ${files.length} client chunks.`);
