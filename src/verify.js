// Runs the spec's checks through Kane CLI and records a round.
import { checkUrl } from './spec.js';
import { resolveKane, runCheck, makeLivePrinter, isAutomationSlip, isInfraFailure, meaningfulEvidence } from './kane.js';
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
export async function runRound(spec, checks, { kane, headed = false, live = true, quiet = false, label = '', retries = Number(process.env.HANDOFF_SLIP_RETRIES ?? 1) } = {}) {
  const startedAt = new Date().toISOString();
  const results = [];
  const total = checks.length;
  for (let i = 0; i < total; i++) {
    const check = checks[i];
    const url = checkUrl(spec, check);
    if (!quiet) {
      console.log(`  ${c.gray(`[${i + 1}/${total}]`)} ${c.bold(check.id)} ${c.gray(truncate(check.objective, 80))}`);
    }
    const go = () => runCheck(kane, {
      objective: check.objective,
      url,
      headed,
      timeoutSec: Number(process.env.HANDOFF_TIMEOUT || 300),
      onEvent: live && !quiet ? makeLivePrinter() : undefined,
    });
    let r = await go();
    // Triage: when Kane says the failure was its own automation slipping (not the
    // app), re-run once before anyone touches the code.
    const notTheApp = (x) => (x.status === 'failed' || x.status === 'timeout') && (isAutomationSlip(x) || isInfraFailure(x));
    if (notTheApp(r) && retries > 0) {
      const why = isInfraFailure(r) ? 'Kane reports a platform problem, not an app bug' : 'Kane flagged its own automation';
      if (!quiet) console.log(`      ${sym.warn} ${c.yellow(why)} ${c.gray(truncate(r.oneLiner || r.verdict?.rootCause, 80))}\n      ${sym.arrow} ${c.gray('re-running before blaming the code')}`);
      const first = { status: r.status, oneLiner: r.oneLiner, summary: r.summary, verdict: r.verdict, evidence: r.evidence, reportUrl: r.reportUrl, credits: r.credits };
      r = await go();
      r.retriedAfterSlip = first;
      r.credits = (r.credits || 0) + (first.credits || 0);
    }
    if (r.status === 'failed') r.slip = isAutomationSlip(r);
    // Still a platform failure after the retry: report it as environment, never as an app bug.
    if ((r.status === 'failed' || r.status === 'timeout') && isInfraFailure(r)) r.status = 'error';
    const entry = { id: check.id, route: check.route || '', ...r };
    results.push(entry);
    if (!quiet) {
      const icon = r.status === 'passed' ? sym.pass : r.status === 'failed' ? sym.fail : sym.warn;
      const line = r.oneLiner || r.summary || r.reason;
      console.log(`      ${icon} ${statusWord(r.status)} ${c.gray(fmtDuration(r.duration))}${line ? '  ' + (r.status === 'error' ? c.gray(truncate(line, 90)) : truncate(line, 90)) : ''}`);
      for (const e of (r.status === 'failed' ? meaningfulEvidence(r.evidence) : [])) {
        console.log(`        ${c.gray('Kane read')} ${c.red(JSON.stringify(e.read))} ${c.gray('· expected')} ${c.green(JSON.stringify(e.expected))}`);
      }
      if (r.reportUrl && r.status !== 'passed') console.log(`        ${c.gray('report')} ${c.cyan(truncate(r.reportUrl, 70))}`);
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
