#!/usr/bin/env node
/**
 * Regenerate manifest.json from the contents of free/.
 *
 * The supervisor reads manifest.json to know which skills to fetch. If
 * a new skill folder (e.g. free/private_llm/) is on disk but not in
 * manifest.json, the supervisor never sees it. Same for stale checksums
 * — the supervisor short-circuits re-fetches when its cached checksum
 * matches, so an edited skill.json that hasn't bumped its checksum in
 * manifest.json won't propagate.
 *
 * This script walks free/, computes sha256 for every skill file, and
 * writes a fresh manifest.json. Run it any time a skill is added or
 * edited; commit the result.
 *
 *   node scripts/regen-manifest.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FREE_DIR = join(REPO_ROOT, 'free');
const MANIFEST_PATH = join(REPO_ROOT, 'manifest.json');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const entries = readdirSync(FREE_DIR).sort();
const skills = [];

for (const entry of entries) {
  const full = join(FREE_DIR, entry);
  const st = statSync(full);

  if (st.isFile() && entry.endsWith('.json')) {
    // Single-file skill (e.g. free/csv_parse.json)
    skills.push({
      path: `free/${entry}`,
      type: 'file',
      checksum: sha256(full),
    });
    continue;
  }

  if (st.isDirectory()) {
    // Directory-shaped skill (e.g. free/cat-selfie-maker/)
    const skillJsonPath = join(full, 'skill.json');
    try {
      statSync(skillJsonPath);
    } catch {
      console.warn(`skip: ${entry}/ has no skill.json`);
      continue;
    }

    const manifest = JSON.parse(readFileSync(skillJsonPath, 'utf8'));
    const files = [];
    // The skill.json's `files` field lists auxiliary files (handler.js,
    // architecture.md, etc.) that ship alongside. Include only files
    // that actually exist on disk + are referenced in the manifest's
    // files[] (so README.md or .DS_Store don't leak in).
    const declared = Array.isArray(manifest.files) ? manifest.files : [];
    for (const fname of declared) {
      const fpath = join(full, fname);
      try {
        statSync(fpath);
        files.push({
          name: fname,
          checksum: sha256(fpath),
        });
      } catch {
        console.warn(`skip aux: ${entry}/${fname} declared but missing`);
      }
    }

    skills.push({
      path: `free/${entry}`,
      type: 'directory',
      manifest_file: 'skill.json',
      checksum: sha256(skillJsonPath),
      files,
    });
  }
}

const existing = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const next = {
  version: bumpPatch(existing.version ?? '0.0.0'),
  format: existing.format ?? 'hearth.skill/1',
  updated_at: new Date().toISOString(),
  skills,
};

writeFileSync(MANIFEST_PATH, JSON.stringify(next, null, 2) + '\n');
console.log(
  `wrote ${MANIFEST_PATH}: ${skills.length} skills, version ${existing.version ?? '0.0.0'} → ${next.version}`,
);

function bumpPatch(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) return '0.0.1';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4]}`;
}
