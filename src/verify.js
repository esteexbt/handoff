// Runs the spec's checks through Kane CLI and records a round.
import { checkUrl } from './spec.js';
import { resolveKane, runCheck, makeLivePrinter } from './kane.js';
import { startServer, waitForUrl, urlIsUp, killTree } from './proc.js';
import { c, sym, statusWord, truncate, fmtDuration } from './ui.js';

export class HandoffError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Make sure the app is reachable; start it from `start:` if needed.
export async function ensureApp(spec, { quiet = false } = {}) {
  if (await urlIsUp(spec.url)) return { started: null };
  if (!spec.start) {
    throw new HandoffError(`${spec.url} is not responding. Start your app, or add \`start: <command>\` to handoff.md.`, 'APP_DOWN');
  }
  if (!quiet) console.log(`  ${sym.dot} ${c.gray(`starting app: ${spec.start}`)}`);
  const child = startServer(spec.start, spec.root);
  const ok = await waitForUrl(spec.url, 45000);
  if (!ok) {
    killTree(child);
    throw new HandoffError(`Started \`${spec.start}\` but ${spec.url} never came up.`, 'APP_DOWN');
  }
  return { started: child };
}

export function requireKane() {
  const kane = resolveKane();
  if (!kane) {
    throw new HandoffError('kane-cli not found. Install it: npm install -g @testmuai/kane-cli  then  kane-cli login', 'NO_KANE');
  }
  return kane;
}

/**
 * Run a set of checks sequentially. Returns a round object.
 */
export async function runRound(spec, checks, { kane, headed = false, live = true, quiet = false, label = '' } = {}) {
  const startedAt = new Date().toISOString();
  const results = [];
  const total = checks.length;
  for (let i = 0; i < total; i++) {
    const check = checks[i];
    const url = checkUrl(spec, check);
    if (!quiet) {
      console.log(`  ${c.gray(`[${i + 1}/${total}]`)} ${c.bold(check.id)} ${c.gray(truncate(check.objective, 80))}`);
    }
    const r = await runCheck(kane, {
      objective: check.objective,
      url,
      headed,
      timeoutSec: Number(process.env.HANDOFF_TIMEOUT || 300),
      onEvent: live && !quiet ? makeLivePrinter() : undefined,
    });
    const entry = { id: check.id, route: check.route || '', ...r };
    results.push(entry);
    if (!quiet) {
      const icon = r.status === 'passed' ? sym.pass : r.status === 'failed' ? sym.fail : sym.warn;
      console.log(`      ${icon} ${statusWord(r.status)} ${c.gray(fmtDuration(r.duration))}${r.summary ? '  ' + truncate(r.summary, 90) : r.reason ? '  ' + c.gray(truncate(r.reason, 90)) : ''}`);
    }
  }
  return { label, startedAt, finishedAt: new Date().toISOString(), results };
}

export function tally(results) {
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'timeout').length;
  const errors = results.filter((r) => r.status === 'error').length;
  return { passed, failed, errors, total: results.length };
}

export function printTally(results) {
  const t = tally(results);
  const parts = [`${c.green(t.passed + ' passed')}`];
  if (t.failed) parts.push(c.red(`${t.failed} failed`));
  if (t.errors) parts.push(c.yellow(`${t.errors} env error${t.errors > 1 ? 's' : ''}`));
  console.log(`\n  ${parts.join(c.gray(' · '))} ${c.gray(`of ${t.total}`)}`);
  return t;
}
