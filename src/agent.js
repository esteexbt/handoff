// Talks to the coding agent. Two directions:
//  1. feedback(): turns Kane's verdicts into a precise fix brief (used by the
//     Stop hook and by `handoff loop`).
//  2. runClaude(): runs Claude Code headless with that brief and streams what
//     it does, so the loop can close without a human.
import { resolveCli, launch } from './proc.js';
import { c, sym, truncate } from './ui.js';

export function feedback(spec, failing, { round = 1, maxRounds = 3 } = {}) {
  const lines = [];
  lines.push(`HANDOFF: Kane CLI just tested this app in a real Chrome browser against the designer's spec (${spec.file.split(/[\\/]/).pop()}), and ${failing.length} check${failing.length > 1 ? 's' : ''} did not pass. Attempt ${round} of ${maxRounds}.`);
  lines.push('');
  for (const r of failing) {
    lines.push(`## ${r.id} — ${r.status.toUpperCase()}`);
    lines.push(`Spec: ${r.objective}`);
    lines.push(`Tested at: ${r.url}`);
    if (r.summary) lines.push(`What Kane saw: ${r.summary}`);
    if (r.reason && r.reason !== r.summary) lines.push(`Kane's reason: ${r.reason}`);
    if (r.finalState) {
      const fs = r.finalState;
      const bits = [];
      if (fs.url) bits.push(`ended on ${fs.url}`);
      for (const [k, v] of Object.entries(fs)) {
        if (k !== 'url' && v != null && typeof v !== 'object') bits.push(`${k}: ${truncate(v, 160)}`);
      }
      if (bits.length) lines.push(`Final page state: ${bits.join('; ')}`);
    }
    const tail = (r.steps || []).slice(-6).map((s) => truncate(s.text, 140));
    if (tail.length) lines.push(`Last steps Kane took:\n${tail.map((t) => `  - ${t}`).join('\n')}`);
    lines.push('');
  }
  if (spec.brand.length) {
    lines.push('Brand rules from the spec (keep any change consistent with these):');
    for (const b of spec.brand) lines.push(`  - ${b}`);
    lines.push('');
  }
  lines.push('How to respond:');
  lines.push('- Fix the APPLICATION so the behaviour matches the spec. Never edit handoff.md or weaken a check.');
  lines.push('- Make the smallest change that satisfies the spec; do not break the checks that already pass.');
  lines.push('- Do not start dev servers or long-running processes; Handoff re-runs Kane after you finish.');
  lines.push('- Finish with one sentence describing what you changed.');
  return lines.join('\n');
}

export function resolveClaude() {
  return resolveCli({ envVar: 'HANDOFF_AGENT_BIN', binName: 'claude', pkgName: '@anthropic-ai/claude-code' });
}

function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  const short = file ? String(file).split(/[\\/]/).slice(-2).join('/') : '';
  switch (name) {
    case 'Edit': case 'MultiEdit': return `edit ${short}`;
    case 'Write': return `write ${short}`;
    case 'Read': return `read ${short}`;
    case 'Bash': return `run ${truncate(input.command, 70)}`;
    case 'Grep': return `search "${truncate(input.pattern, 40)}"`;
    case 'Glob': return `find ${truncate(input.pattern, 40)}`;
    default: return `${name}${short ? ' ' + short : ''}`;
  }
}

/**
 * Run Claude Code headless with the brief on stdin (no shell-quoting issues on
 * Windows). Streams tool use live. Resolves { ok, text, edits, cost }.
 */
export function runClaude(brief, { cwd, model } = {}) {
  const claude = resolveClaude();
  if (!claude) {
    return Promise.resolve({ ok: false, text: 'Claude Code (`claude`) not found on PATH.', edits: [] });
  }
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];
  if (model) args.push('--model', model);
  const env = { ...process.env, HANDOFF_INSIDE_LOOP: '1' };

  return new Promise((resolve) => {
    let child;
    try {
      child = launch(claude, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
    } catch (e) {
      return resolve({ ok: false, text: e.message, edits: [] });
    }
    let buf = '';
    let finalText = '';
    let cost = null;
    const edits = new Set();
    let stderr = '';

    const onLine = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'assistant' && ev.message?.content) {
        for (const part of ev.message.content) {
          if (part.type === 'tool_use') {
            const d = describeTool(part.name, part.input);
            if (/^(edit|write)/.test(d)) edits.add(d.replace(/^(edit|write) /, ''));
            console.log(`      ${sym.agent} ${c.magenta(d)}`);
          } else if (part.type === 'text' && part.text.trim()) {
            console.log(`      ${sym.agent} ${c.gray(truncate(part.text, 100))}`);
          }
        }
      } else if (ev.type === 'result') {
        finalText = ev.result || finalText;
        cost = ev.total_cost_usd ?? ev.cost_usd ?? null;
      }
    };

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, text: e.message, edits: [] }));
    child.on('close', (code) => {
      if (buf.trim()) onLine(buf);
      resolve({ ok: code === 0, text: finalText || truncate(stderr, 300), edits: [...edits], cost });
    });
    child.stdin.write(brief);
    child.stdin.end();
  });
}
