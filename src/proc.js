// Cross-platform process helpers. Windows needs care: npm installs CLIs as
// .cmd shims, and Node refuses to spawn .cmd files without a shell. Where we
// can, we resolve the shim to its real JS entry and run it with node directly,
// so arguments (plain-English objectives full of quotes) survive intact.
import { spawn, execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';

function which(cmd) {
  try {
    const out = isWin
      ? execSync(`where ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      : execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

let npmRootCache;
function npmRoot() {
  if (npmRootCache !== undefined) return npmRootCache;
  try {
    npmRootCache = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    npmRootCache = null;
  }
  return npmRootCache;
}

function binFromPackage(pkgName, binName) {
  const root = npmRoot();
  if (!root) return null;
  const pkgDir = path.join(root, ...pkgName.split('/'));
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName] || Object.values(pkg.bin || {})[0];
    if (!rel) return null;
    const p = path.join(pkgDir, rel);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Resolve how to launch a CLI.
 * Returns { cmd, prefix: [], shell: bool, display } or null.
 */
export function resolveCli({ envVar, binName, pkgName }) {
  const override = envVar && process.env[envVar];
  if (override) {
    if (/\.(c?m?js)$/i.test(override)) return { cmd: process.execPath, prefix: [override], shell: false, display: override };
    return { cmd: override, prefix: [], shell: isWin && /\.(cmd|bat)$/i.test(override), display: override };
  }
  if (pkgName) {
    const entry = binFromPackage(pkgName, binName);
    if (entry) {
      const isJs = /\.(c?m?js)$/i.test(entry) || firstLineIsNodeShebang(entry);
      if (isJs) return { cmd: process.execPath, prefix: [entry], shell: false, display: `${binName} (${entry})` };
      return { cmd: entry, prefix: [], shell: false, display: entry };
    }
  }
  const found = which(binName);
  if (!found.length) return null;
  if (isWin) {
    const exe = found.find((f) => /\.exe$/i.test(f));
    if (exe) return { cmd: exe, prefix: [], shell: false, display: exe };
    const cmdShim = found.find((f) => /\.(cmd|bat)$/i.test(f)) || found[0];
    return { cmd: cmdShim, prefix: [], shell: true, display: cmdShim };
  }
  return { cmd: found[0], prefix: [], shell: false, display: found[0] };
}

function firstLineIsNodeShebang(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64);
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    return /^#!.*node/.test(buf.toString());
  } catch {
    return false;
  }
}

// Quote one argument for cmd.exe when we have no choice but to use a shell.
function cmdQuote(arg) {
  if (/^[\w./:@=-]+$/.test(arg)) return arg;
  return '"' + String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1').replace(/[%^&|<>!]/g, '^$&') + '"';
}

// Call fn for every complete line on a stream (NDJSON from Kane CLI and Claude Code).
export function eachLine(stream, fn) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { fn(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  return () => { if (buf.trim()) fn(buf); buf = ''; };
}

export function launch(resolved, args, opts = {}) {
  const fullArgs = [...resolved.prefix, ...args];
  if (resolved.shell) {
    const line = [cmdQuote(resolved.cmd), ...fullArgs.map(cmdQuote)].join(' ');
    return spawn(line, { ...opts, shell: true, windowsHide: true });
  }
  return spawn(resolved.cmd, fullArgs, { ...opts, windowsHide: true });
}

export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (isWin) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

export function startServer(command, cwd) {
  const child = spawn(command, { cwd, shell: true, detached: !isWin, stdio: 'ignore', windowsHide: true });
  child.unref?.();
  return child;
}

export async function urlIsUp(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function waitForUrl(url, totalMs = 30000) {
  const end = Date.now() + totalMs;
  while (Date.now() < end) {
    if (await urlIsUp(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function openFile(file) {
  try {
    if (isWin) spawn('cmd', ['/c', 'start', '""', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [file], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}
