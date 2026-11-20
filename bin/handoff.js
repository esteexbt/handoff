#!/usr/bin/env node
import * as cmd from '../src/commands.js';
import { c } from '../src/ui.js';
import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('../package.json');

const argv = process.argv.slice(2);
const VERSION_FLAGS = ['--version', '-v', 'version'];
const command = VERSION_FLAGS.includes(argv[0]) ? argv.shift() : argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'help';

function parseFlags(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (k.startsWith('no-')) { opts[k.slice(3)] = false; continue; }
    if (v !== undefined) opts[k] = v;
    else if (args[i + 1] && !args[i + 1].startsWith('--')) opts[k] = args[++i];
    else opts[k] = true;
  }
  return opts;
}

const HELP = `
  ${c.bold('handoff')} ${c.gray('· design handoff your coding agent has to prove')}

  ${c.bold('Usage')}
    handoff init   [--url http://localhost:3000] [--no-hook]   create handoff.md + install the Claude Code Stop hook
    handoff verify [--only id,id] [--headed] [--open]          run every check in a real browser with Kane CLI
    handoff loop   [--max 3] [--headed] [--open] [--no-sweep]  verify → brief Claude Code → fix → re-verify, until green
                   [--only id,id] [--model name]
    handoff proof  [--no-open]                                 rebuild and open .handoff/proof.html
    handoff brief                                              print the fix brief the agent receives
    handoff doctor                                             check kane-cli, Claude Code, spec and app
    handoff hook                                               (used by Claude Code's Stop hook)

  ${c.bold('Spec')}  handoff.md — front matter (url, start), ## Brand, ## Checks in plain English.
`;

const table = {
  init: cmd.init,
  verify: cmd.verify,
  loop: cmd.loop,
  proof: cmd.proof,
  brief: cmd.brief,
  doctor: cmd.doctor,
  hook: cmd.hook,
};

async function main() {
  if (command === 'help') { console.log(HELP); return 0; }
  if (VERSION_FLAGS.includes(command)) { console.log(`handoff ${version}`); return 0; }
  const fn = table[command];
  if (!fn) { console.log(HELP); return 1; }
  return fn(parseFlags(argv));
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    if (command === 'hook') {
      // Never wedge Claude Code because of our own bug.
      process.stdout.write(JSON.stringify({ systemMessage: `Handoff hook error: ${err.message}` }) + '\n');
      process.exit(0);
    }
    console.error(`\n  ${c.red('✖')} ${err.message}\n`);
    process.exit(1);
  },
);
