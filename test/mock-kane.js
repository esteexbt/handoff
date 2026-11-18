#!/usr/bin/env node
// Test double for kane-cli (used only by test/run-tests.js — never by real runs).
// Mimics agent-mode NDJSON + exit codes. Fails checks when the demo's known bugs are present.
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('kane-cli 0.0.0-mock'); process.exit(0); }
const objective = args.filter((a) => !a.startsWith('--') && a !== 'run')[0] || '';
const url = args[args.indexOf('--url') + 1];
const app = fs.readFileSync(process.env.MOCK_APP_JS, 'utf8');
const emit = (o) => console.log(JSON.stringify(o));
emit({ type: 'run_start', objective, url });
emit({ type: 'step', step: `Open ${url}` });
emit({ type: 'step', step: 'Locate the elements named in the objective' });
let pass = true, summary = 'All assertions held.', state = { url };
if (/ada@example"/.test(objective) && app.includes("value.includes('@')")) {
  pass = false;
  summary = 'Submitted "ada@example": the page showed "You\'re on the list" and no error. An invalid address was accepted.';
  state.checked_message = "You're on the list. We'll write when Sprout is ready.";
}
if (/Yearly/.test(objective) && app.includes('MONTHLY * 12}')) {
  pass = false;
  summary = 'After selecting Yearly, the Grow plan shows "$60 per year", not "$48".';
  state.checked_message = '$60 per year';
}
emit({ type: 'step', step: pass ? 'Assertion passed' : 'Assertion failed' });
emit({ type: 'run_end', status: pass ? 'passed' : 'failed', summary, final_state: state, reason: pass ? 'Objective completed' : 'Assertion failed', duration: 12.3, bifurcated: false, total_runs: 1 });
process.exit(pass ? 0 : 1);
