// Terminal output helpers. No dependencies, respects NO_COLOR.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap('1'),
  green: wrap('32'),
  red: wrap('31'),
  yellow: wrap('33'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

export const sym = {
  pass: c.green('✔'),
  fail: c.red('✖'),
  warn: c.yellow('▲'),
  dot: c.gray('·'),
  arrow: c.cyan('→'),
  agent: c.magenta('◆'),
  kane: c.cyan('◉'),
};

export function banner(sub = '') {
  const mark = c.bold('handoff');
  console.log(`\n  ${mark} ${c.gray('· design handoff your agent has to prove')}${sub ? '\n  ' + c.gray(sub) : ''}\n`);
}

export function rule(label = '') {
  const width = Math.min(process.stdout.columns || 80, 80) - 4;
  const text = label ? ` ${label} ` : '';
  const line = '─'.repeat(Math.max(0, width - text.length - 2));
  console.log(`  ${c.gray('──')}${c.bold(text)}${c.gray(line)}`);
}

export function statusWord(status) {
  switch (status) {
    case 'passed': return c.green('PASS');
    case 'failed': return c.red('FAIL');
    case 'timeout': return c.yellow('TIME');
    case 'error': return c.yellow('ENV ');
    default: return c.gray(String(status).toUpperCase().slice(0, 4));
  }
}

export function truncate(s, n = 110) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function fmtDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '—';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${Math.round(sec % 60)}s`;
}
