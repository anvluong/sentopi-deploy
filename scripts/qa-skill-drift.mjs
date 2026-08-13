#!/usr/bin/env node
/*
 * Holds the sentopi-qa skill's check table equal to what qa-check.mjs
 * actually enforces. Run: node scripts/qa-skill-drift.mjs
 *
 * Why this exists. The Sentopi gate was once described in three places at
 * once: the tracked skills/sentopi-qa/SKILL.md, the gitignored copy under
 * .claude/, and Phase 4 of the sentopi-growth-loop skill. Two of the three
 * had drifted, and the fixes recorded as "Fixed 2026-08-09" had landed on
 * only one of them. GoutSafe hit the same class of bug and solved it with
 * qa:skill-drift on 2026-08-12. This is that guard, adapted: sentopi-deploy
 * has no package.json, so qa-check.mjs's own source is the code side.
 *
 * Three assertions, and the third is the one a set comparison misses:
 *   1. The skill file and its markers exist. Missing means FAIL, never skip.
 *      A gate that quietly passes when its subject is absent is not a gate.
 *   2. Set equality in BOTH directions. GoutSafe shipped a version that
 *      caught only additions and said so on 2026-08-13.
 *   3. Remedy strings match verbatim. qa-check.mjs used to fail an em-dash
 *      and tell the fixer to use "a colon, semicolon, or period", which is
 *      the exact construction Voice/rules.md:29 names as the failure mode.
 *      Set equality passes that happily, because the id was never wrong.
 *
 * Dependency-free on purpose (node builtins only, paths resolved from
 * import.meta.url rather than cwd), so CI can run it with no install step.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK_FILE = join(ROOT, 'scripts/qa-check.mjs');
const SKILL_FILE = join(ROOT, '.claude/skills/sentopi-qa/SKILL.md');

const START = '<!-- gate:static-start -->';
const END = '<!-- gate:static-end -->';

export function checkSkillDrift() {
  const out = [];

  if (!existsSync(SKILL_FILE)) {
    out.push('skill-drift: .claude/skills/sentopi-qa/SKILL.md is missing. The gate has no canonical definition, so this check cannot pass.');
    return out;
  }
  if (!existsSync(CHECK_FILE)) {
    out.push('skill-drift: scripts/qa-check.mjs is missing.');
    return out;
  }

  const code = readFileSync(CHECK_FILE, 'utf8');
  const skill = readFileSync(SKILL_FILE, 'utf8');

  const from = skill.indexOf(START);
  const to = skill.indexOf(END);
  if (from === -1 || to === -1 || to < from) {
    out.push(`skill-drift: the ${START} / ${END} markers are missing or out of order in SKILL.md. Without them there is no canonical list and this check is vacuous.`);
    return out;
  }
  const table = skill.slice(from + START.length, to);

  // Code side: every block that can fail carries [gate:<id>]. Skip this file's
  // own prose so the examples above do not register as real checks.
  const codeIds = new Set(
    [...code.matchAll(/\[gate:([a-z0-9-]+)\]/g)].map((m) => m[1])
  );
  codeIds.add('skill-drift'); // registered here, not in qa-check.mjs

  // Doc side: first backticked cell of each table row.
  const docIds = new Set();
  const remedies = new Map();
  for (const line of table.split('\n')) {
    const row = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|(.*)\|\s*$/);
    if (!row) continue;
    docIds.add(row[1]);
    const remedy = row[2].match(/Remedy:\s*`([^`]+)`/);
    if (remedy) remedies.set(row[1], remedy[1]);
  }

  if (!docIds.size) {
    out.push('skill-drift: the fenced table in SKILL.md has no rows. Expected one `id` per check.');
    return out;
  }

  for (const id of codeIds) {
    if (!docIds.has(id))
      out.push(`skill-drift: qa-check.mjs enforces [gate:${id}] but SKILL.md has no row for it. Add the row.`);
  }
  for (const id of docIds) {
    if (!codeIds.has(id))
      out.push(`skill-drift: SKILL.md claims a "${id}" check that qa-check.mjs does not enforce. Remove the row or add the check.`);
  }

  // Assertion 3. A row may pin the exact remediation wording the gate prints
  // to a human. Wording that contradicts Voice/rules.md is the live defect
  // this catches, and an id-only comparison cannot see it.
  for (const [id, phrase] of remedies) {
    if (!code.includes(phrase))
      out.push(`skill-drift: SKILL.md pins the ${id} remedy to "${phrase}" but qa-check.mjs does not print that string. The gate's own advice has drifted from the rule it enforces.`);
  }

  return out;
}

// Standalone: node scripts/qa-skill-drift.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkSkillDrift();
  if (problems.length) {
    for (const p of problems) console.log(`FAIL  ${p}`);
    console.log(`\n${problems.length} drift problem(s).`);
    process.exit(1);
  }
  console.log('skill-drift: SKILL.md and qa-check.mjs agree.');
  process.exit(0);
}
