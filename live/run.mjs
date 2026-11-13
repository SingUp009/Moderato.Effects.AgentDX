import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../report.mjs';
import { graderFiles, revision, taskIds } from '../run.mjs';
import { codexVersion, loadExperiment, loadInputs, prompt as defaultPrompt, readRuns, recordRun, settings } from './experiment.mjs';

const argv = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));

async function execute({ task, workspace, directory, model, prompt, experimentDirectory, condition }) {
  const usageFile = join(directory, 'tool-usage.json');
  const config = {
    web_search: 'disabled', 'agents.enabled': false, model_reasoning_effort: settings.reasoning, approval_policy: 'never',
    'mcp_servers.fixture.command': process.execPath,
    'mcp_servers.fixture.args': [join(here, 'fixture-mcp.mjs'), workspace, task, usageFile,
      ...(experimentDirectory ? [experimentDirectory, condition] : [])],
    'mcp_servers.fixture.required': true,
  };
  for (const tool of ['list_files', 'read_file', 'write_submission', 'build_submission']) {
    config['mcp_servers.fixture.tools.' + tool + '.approval_mode'] = 'approve';
  }
  const args = [
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json', '--color', 'never',
    '--model', model, '--sandbox', 'read-only', '--cd', workspace, '--skip-git-repo-check',
    ...['shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'multi_agent'].flatMap(flag => ['--disable', flag]),
    ...Object.entries(config).flatMap(([key, value]) => ['-c', key + '=' + JSON.stringify(value)]), '-',
  ];
  const events = createWriteStream(join(directory, 'events.jsonl'), { flags: 'wx' });
  const stderr = createWriteStream(join(directory, 'stderr.log'), { flags: 'wx' });
  const saved = Promise.all([finished(events), finished(stderr)]);
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
  }, settings.timeoutMs);
  child.on('error', error => { spawnError = error.message; });
  const [exitCode, signal] = await new Promise(done => child.on('close', (...result) => done(result)));
  clearTimeout(timer);
  await saved;
  const result = {
    task, model, reasoning: settings.reasoning, startedAt, durationMs: Math.round(performance.now() - start),
    exitCode, signal, timedOut, spawnError,
  };
  writeFileSync(join(directory, 'run.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

function telemetry(directory) {
  let usage = null;
  let toolCalls = 0;
  for (const line of readFileSync(join(directory, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.completed') usage = event.usage ?? null;
      if (event.type === 'item.completed' && event.item?.type === 'mcp_tool_call') toolCalls++;
    } catch {
      continue;
    }
  }
  return { usage, toolCalls };
}

async function runExperiment(directory) {
  const experiment = loadExperiment(directory);
  if (codexVersion() !== experiment.harnessVersion) throw new Error('Codex CLI version differs from experiment');
  if (!taskIds.includes(experiment.task) ||
      revision(join(here, '..', 'graders'), graderFiles(experiment.task)) !== experiment.graderRevision ||
      Object.entries(settings).some(([key, value]) => experiment[key] !== value)) {
    throw new Error('Grader files or run limits differ from the experiment');
  }
  const completed = new Set(readRuns(directory).map(run => run.id));
  const next = experiment.order.find(run => !completed.has(run.id));
  if (!next) throw new Error('Experiment has no pending runs');
  const { id, condition } = next;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Invalid run ID');
  const trace = join(directory, 'traces', id);
  const workspace = join(trace, 'fixture');
  const inputs = loadInputs(directory, condition);
  mkdirSync(trace);
  mkdirSync(workspace);
  for (const [name, content] of inputs) {
    const path = join(workspace, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { flag: 'wx' });
  }
  if (revision(workspace, Object.keys(experiment.fixture)) !== experiment.fixtureRevision) {
    throw new Error('Starter files differ from the experiment');
  }
  const { task, model, prompt } = experiment;
  const result = await execute({ task, model, prompt, workspace, directory: trace, experimentDirectory: directory, condition });
  let builds = [];
  try {
    builds = JSON.parse(readFileSync(join(trace, 'tool-usage.json'), 'utf8')).builds;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const submissionPath = join(workspace, 'Submission.cs');
  const submission = readFileSync(submissionPath, 'utf8');
  let grade = null;
  let gradingError = null;
  if (submission !== inputs.get('Submission.cs')) {
    const scored = spawnSync(process.execPath, [join(here, 'grade.mjs'), task, submissionPath], {
      encoding: 'utf8', timeout: 190_000, windowsHide: true,
    });
    writeFileSync(join(trace, 'grade.stderr.log'), scored.stderr ?? '');
    try {
      if (scored.status !== 0 && scored.status !== 1) throw new Error(scored.error?.message ?? 'Grader command failed');
      grade = validate(JSON.parse(scored.stdout));
      if (grade.fixtureRevision !== experiment.fixtureRevision || grade.graderRevision !== experiment.graderRevision) {
        throw new Error('Grader image differs from the experiment');
      }
    } catch (error) {
      grade = null;
      gradingError = error.message;
      console.error(gradingError);
    }
  }
  recordRun(directory, {
    id, condition, ...result, ...telemetry(trace), builds, submission,
    firstBuildPassed: builds.length ? builds[0].exitCode === 0 : null, grade, gradingError,
  });
  console.log(id, grade ? grade.success ? 'passed' : grade.failureCategory : 'ungraded');
  return gradingError ? 2 : result.timedOut ? 124 : (result.exitCode ?? 2);
}

try {
  if (argv.length === 3 && argv[0] === 'experiment' && argv[2] === '--live') {
    process.exitCode = await runExperiment(resolve(argv[1]));
  } else {
    const [task, fixture, output, model, optIn, ...extra] = argv;
    if (!taskIds.includes(task) || !fixture || !output || !model || optIn !== '--live' || extra.length) {
      throw new Error('Usage: node live/run.mjs experiment EXPERIMENT_DIR --live | TASK FIXTURE NEW_OUTPUT_DIR MODEL --live');
    }
    const workspace = resolve(fixture);
    const directory = resolve(output);
    const taskPrompt = readFileSync(join(workspace, 'prompt.md'), 'utf8');
    mkdirSync(directory);
    writeFileSync(join(directory, 'inputs.json'), JSON.stringify({ task, model, prompt: defaultPrompt, taskPrompt }, null, 2) + '\n');
    const result = await execute({ task, model, workspace, directory, prompt: defaultPrompt });
    if (result.spawnError) console.error(result.spawnError);
    process.exitCode = result.timedOut ? 124 : (result.exitCode ?? 2);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
