// End-to-end test of the loop with test doubles for kane-cli and claude.
// node test/run-tests.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/spec.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'handoff.js');

// 1. spec parsing
const spec = parseSpec(fs.readFileSync(path.join(root, 'examples/sprout/handoff.md'), 'utf8'));
assert.equal(spec.name, 'Sprout');
assert.equal(spec.url, 'http://localhost:4173');
assert.equal(spec.checks.length, 5);
assert.equal(spec.checks[1].id, 'reject-bad-email');
assert.equal(spec.swatches.length, 3);
const s2 = parseSpec('---\nurl: http://x\n---\n## Checks\n- **pricing** [/pricing] — Click Yearly\n- Just a sentence with no id\n');
assert.equal(s2.checks[0].id, 'pricing');
assert.equal(s2.checks[0].route, '/pricing');
assert.equal(s2.checks[1].id, 'just-a-sentence-with');
console.log('✔ spec parsing');

// 2. full loop in a temp copy of the demo
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
fs.cpSync(path.join(root, 'examples/sprout'), tmp, { recursive: true });
const env = {
  ...process.env,
  NO_COLOR: '1',
  HANDOFF_KANE_BIN: path.join(root, 'test/mock-kane.js'),
  HANDOFF_AGENT_BIN: path.join(root, 'test/mock-claude.js'),
  MOCK_APP_JS: path.join(tmp, 'public/app.js'),
};
const verify = spawnSync(process.execPath, [bin, 'verify'], { cwd: tmp, env, encoding: 'utf8' });
process.stdout.write(verify.stdout);
assert.equal(verify.status, 1, 'verify should fail on the seeded bugs');
assert.match(verify.stdout, /3 passed · 2 failed/);
console.log('✔ verify catches 2 bugs');

const loop = spawnSync(process.execPath, [bin, 'loop'], { cwd: tmp, env, encoding: 'utf8' });
process.stdout.write(loop.stdout + loop.stderr);
assert.equal(loop.status, 0, 'loop should end green');
assert.match(loop.stdout, /Verified\./);
assert.match(fs.readFileSync(path.join(tmp, 'public/app.js'), 'utf8'), /0\.8/);
console.log('✔ loop: agent fixed, Kane re-verified');

// 3. hook: green build → exit 0 with a systemMessage; nothing changed → silent skip
const hookRun = spawnSync(process.execPath, [bin, 'hook'], { cwd: tmp, env, input: JSON.stringify({ session_id: 's1', cwd: tmp }), encoding: 'utf8' });
assert.equal(hookRun.status, 0);
assert.match(hookRun.stdout, /systemMessage/);
const hookSkip = spawnSync(process.execPath, [bin, 'hook'], { cwd: tmp, env, input: JSON.stringify({ session_id: 's1', cwd: tmp }), encoding: 'utf8' });
assert.equal(hookSkip.status, 0);
assert.equal(hookSkip.stdout.trim(), '');
console.log('✔ hook passes and skips unchanged builds');

// 4. hook blocks with a brief when a bug is reintroduced
const appJs = path.join(tmp, 'public/app.js');
fs.writeFileSync(appJs, fs.readFileSync(appJs, 'utf8').replace(' * 0.8', ''));
const hookFail = spawnSync(process.execPath, [bin, 'hook'], { cwd: tmp, env, input: JSON.stringify({ session_id: 's2', cwd: tmp }), encoding: 'utf8' });
assert.equal(hookFail.status, 2);
assert.match(hookFail.stderr, /yearly-pricing/);
assert.match(hookFail.stderr, /\$60 per year/);
console.log('✔ hook blocks Claude with Kane\'s findings (exit 2)');

assert.ok(fs.existsSync(path.join(tmp, '.handoff/proof.html')));
assert.ok(fs.existsSync(path.join(tmp, '.handoff/badge.svg')));
console.log('✔ proof page + badge written');
console.log(`\nAll good. Proof: ${path.join(tmp, '.handoff/proof.html')}`);
