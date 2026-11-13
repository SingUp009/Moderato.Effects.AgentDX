import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskIds } from '../run.mjs';

const [task, fixture, output, model, optIn, ...extra] = process.argv.slice(2);
if (!taskIds.includes(task) || !fixture || !output || !model || optIn !== '--live' || extra.length) {
  console.error('Usage: node live/run.mjs TASK FIXTURE NEW_OUTPUT_DIR MODEL --live');
  process.exit(2);
}

const workspace = resolve(fixture);
const directory = resolve(output);
const server = fileURLToPath(new URL('./fixture-mcp.mjs', import.meta.url));
const usage = join(directory, 'tool-usage.json');
const prompt = [
  'Read prompt.md and implement the task by replacing Submission.cs. Preserve the public signature and use the provided Moderato.Effects package.',
  'Use the fixture tools to read task files, edit, and build. Read docs/llms.txt if present and use relevant workspace skills.',
  'Compile your final solution using the fixture build tool. Finish with a brief summary.',
].join(' ');
const taskPrompt = readFileSync(join(workspace, 'prompt.md'), 'utf8');

mkdirSync(directory, { recursive: false });
writeFileSync(join(directory, 'inputs.json'), JSON.stringify({ task, model, prompt, taskPrompt }, null, 2) + '\n');
const settings = {
  web_search: 'disabled', 'agents.enabled': false, model_reasoning_effort: 'low', approval_policy: 'never',
  'mcp_servers.fixture.command': process.execPath,
  'mcp_servers.fixture.args': [server, workspace, task, usage],
  'mcp_servers.fixture.required': true,
};
for (const tool of ['list_files', 'read_file', 'write_submission', 'build_submission']) {
  settings['mcp_servers.fixture.tools.' + tool + '.approval_mode'] = 'approve';
}
const args = [
  'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json', '--color', 'never',
  '--model', model, '--sandbox', 'read-only', '--cd', workspace, '--skip-git-repo-check',
  ...['shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'multi_agent'].flatMap(flag => ['--disable', flag]),
  ...Object.entries(settings).flatMap(([key, value]) => ['-c', key + '=' + JSON.stringify(value)]), '-',
];
const events = createWriteStream(join(directory, 'events.jsonl'), { flags: 'wx' });
const stderr = createWriteStream(join(directory, 'stderr.log'), { flags: 'wx' });
const start = performance.now();
const startedAt = new Date().toISOString();
const child = spawn('codex', args, { cwd: workspace, windowsHide: true });
child.stdout.pipe(events);
child.stderr.pipe(stderr);
child.stdin.on('error', error => { if (error.code !== 'EPIPE') console.error(error.message); });
child.stdin.end(prompt);
let timedOut = false;
let spawnError = null;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 120_000);
child.on('error', error => {
  spawnError = error.message;
  console.error(error.message);
});
child.on('close', (exitCode, signal) => {
  clearTimeout(timer);
  const result = {
    task, model, reasoning: 'low', startedAt, durationMs: Math.round(performance.now() - start),
    exitCode, signal, timedOut, spawnError,
  };
  writeFileSync(join(directory, 'run.json'), JSON.stringify(result, null, 2) + '\n');
  process.exitCode = timedOut ? 124 : (exitCode ?? 2);
});
