import { spawn } from 'node:child_process';

/**
 * `npm run dev` - the API and the client together, one command, as the README promises.
 *
 * A script rather than `concurrently` or `npm-run-all`: running two long-lived processes
 * is about thirty lines of `child_process`, and a reviewer cloning this repo should not
 * install a dependency to read one log. Same reasoning as `migrate.ts` over the TypeORM
 * CLI - a tool earns its place by doing something awkward, not something short.
 */

// npm is a .cmd on Windows, and Node 20+ refuses to spawn one without a shell (the
// CVE-2024-27980 fix). The command therefore goes through a shell as a single string
// rather than as command + args, which is also what avoids DEP0190 - passing an args
// array with shell: true is deprecated precisely because the arguments are not escaped.
// Everything interpolated below is a hard-coded constant in this file.

const TARGETS = [
  { name: 'api', workspace: '@task-platform/api', colour: '[36m' },
  { name: 'web', workspace: '@task-platform/web', colour: '[35m' },
];

const RESET = '[0m';

const children = [];
let shuttingDown = false;

function prefix(name, colour, chunk) {
  const text = chunk.toString().replace(/\n$/, '');

  if (text.length === 0) {
    return;
  }

  for (const line of text.split('\n')) {
    process.stdout.write(`${colour}[${name}]${RESET} ${line}\n`);
  }
}

function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    child.kill();
  }

  process.exit(code);
}

for (const { name, workspace, colour } of TARGETS) {
  const child = spawn(`npm run dev --workspace ${workspace}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  child.stdout.on('data', (chunk) => prefix(name, colour, chunk));
  child.stderr.on('data', (chunk) => prefix(name, colour, chunk));

  // If either half dies the other is useless, so take both down rather than leaving a
  // half-running stack that looks fine until the first request.
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.stdout.write(`${colour}[${name}]${RESET} exited (${code ?? 'signal'})\n`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
