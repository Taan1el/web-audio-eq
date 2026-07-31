#!/usr/bin/env node
// Repository checks that don't need a browser.
//
//   node tools/check.mjs
//
// Nothing here can hear audio, so these guard the invariants that break
// silently instead: the band list drifting apart across the three worlds, a
// manifest pointing at a file that isn't there, and the version in the
// changelog disagreeing with the manifest.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const failures = [];
const fail = (msg) => failures.push(msg);

// ---- The band list is copied into three files that can't import each other ----
// content.js (isolated world), inject.js (main world) and popup.js (extension
// page) each declare it. If they drift, the popup draws one curve and the audio
// plays another — with no error anywhere.
const SHARED = ["content.js", "inject.js", "popup.js"];

function extract(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  return m ? m[1].replace(/\s+/g, "") : null;
}

const bands = SHARED.map((f) => [f, extract(read(f), "BANDS")]);
const missingBands = bands.filter(([, v]) => v === null).map(([f]) => f);
if (missingBands.length) fail(`BANDS not found in: ${missingBands.join(", ")}`);
else if (new Set(bands.map(([, v]) => v)).size !== 1) {
  fail("BANDS differ between files:\n" + bands.map(([f, v]) => `    ${f}: ${v}`).join("\n"));
}

// Q lives only in the two audio files; the popup doesn't filter anything.
const qs = ["content.js", "inject.js"].map((f) => [f, extract(read(f), "Q")]);
if (new Set(qs.map(([, v]) => v)).size !== 1) {
  fail("Q differs between files:\n" + qs.map(([f, v]) => `    ${f}: ${v}`).join("\n"));
}

// The popup's tick labels must line up one-for-one with the bands.
const labels = extract(read("popup.js"), "LABELS");
const bandCount = (bands[0][1] || "").split(",").length;
const labelCount = (labels || "").split(",").length;
if (labels && bandCount !== labelCount) {
  fail(`popup.js LABELS has ${labelCount} entries but BANDS has ${bandCount}`);
}

// ---- Manifest ----
let manifest;
try {
  manifest = JSON.parse(read("manifest.json"));
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");

  // Chrome accepts 1-4 dot-separated integers, each 0-65535.
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || "")) {
    fail(`version "${manifest.version}" is not a valid extension version`);
  }

  // Every path the manifest names has to exist, or the extension fails to load
  // with an error that names the manifest rather than the missing file.
  const referenced = [
    manifest.action?.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
  ].filter(Boolean);

  for (const p of new Set(referenced)) {
    if (!existsSync(join(ROOT, p))) fail(`manifest references a missing file: ${p}`);
  }

  // world:"MAIN" content scripts landed in Chrome 111. Without the floor,
  // older Chrome installs the extension and then silently does nothing.
  const usesMainWorld = (manifest.content_scripts || []).some((cs) => cs.world === "MAIN");
  if (usesMainWorld && !manifest.minimum_chrome_version) {
    fail('a content script uses world:"MAIN", so minimum_chrome_version must be set (111+)');
  }

  // ---- Changelog agrees with the manifest ----
  if (existsSync(join(ROOT, "CHANGELOG.md"))) {
    const changelog = read("CHANGELOG.md");
    if (!new RegExp(`^##\\s*\\[?${manifest.version.replace(/\./g, "\\.")}\\]?`, "m").test(changelog)) {
      fail(`CHANGELOG.md has no section for version ${manifest.version}`);
    }
  }
}

// ---- The popup must not reach the network ----
// The privacy policy promises zero requests, so a stray CDN link would make the
// project's own documentation false.
const popup = read("popup.html");
const remote = popup.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi);
if (remote) fail(`popup.html loads remote resources:\n    ${remote.join("\n    ")}`);

if (failures.length) {
  console.error("FAIL\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("OK — bands in sync, manifest consistent, popup self-contained");
