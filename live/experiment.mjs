import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { graderFiles, revision, taskIds } from '../run.mjs';
import { readFixture, starterFiles } from './fixture-files.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
export const settings = {
  reasoning: 'low', timeoutMs: 120_000, toolLimit: 24, buildLimit: 4,
};
export const prompt = [
  'Read prompt.md and implement the task by replacing Submission.cs. Preserve the public signature and use the provided Moderato.Effects package.',
  'Use the fixture tools to read task files, edit, and build. Read docs/llms.txt if present and use relevant workspace skills.',
  'Compile your final solution using the fixture build tool. Finish with a brief summary.',
].join(' ');

const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const hash = text => createHash('sha256').update(text).digest('hex');
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

export function codexVersion() {
  const codex = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (codex.status !== 0) throw new Error('Could not determine Codex CLI version');
  return codex.stdout.trim();
}

export function initialize(directory, configuration, base, harnessVersion) {
  const { task, model, seed, repeats, conditions } = configuration;
  if (!taskIds.includes(task) || typeof model !== 'string' || !model ||
      typeof seed !== 'string' || !seed || !Number.isSafeInteger(repeats) || repeats < 1 ||
      !conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
    throw new Error('Expected task, model, seed, repeats, and a condition-to-fixture map');
  }
  const names = Object.keys(conditions).sort();
  if (!names.length || names.some(id => !validId.test(id) || typeof conditions[id] !== 'string' || !conditions[id])) {
    throw new Error('Invalid conditions');
  }
  const docs = {};
  const conditionFiles = Object.create(null);
  let fixture;
  for (const id of names) {
    const input = readFixture(resolve(base, conditions[id]));
    const core = Object.fromEntries(starterFiles.filter(name => input.has(name)).map(name => [name, input.get(name)]));
    if (fixture && JSON.stringify(fixture) !== JSON.stringify(core)) throw new Error('Conditions must share the same starter fixture');
    fixture = core;
    conditionFiles[id] = Object.fromEntries([...input].filter(([name]) => !starterFiles.includes(name)).map(([name, content]) => {
      const digest = hash(content);
      docs[digest] = content;
      return [name, digest];
    }));
  }
  const order = [];
  for (let trial = 1; trial <= repeats; trial++) {
    const ids = names.map(condition => ({ id: condition + '-' + trial, condition }));
    ids.sort((left, right) => hash(JSON.stringify([seed, trial, left.condition])).localeCompare(hash(JSON.stringify([seed, trial, right.condition])), 'en'));
    order.push(...ids);
  }
  const experiment = {
    schemaVersion: 1, task, model, harnessVersion, ...settings, seed, repeats, order,
    sdkVersion: JSON.parse(fixture['global.json']).sdk.version,
    packageVersion: JSON.parse(fixture['packages.lock.json']).dependencies['net11.0']['Moderato.Effects'].resolved,
    fixtureRevision: revision(resolve(base, conditions[names[0]]), Object.keys(fixture)),
    graderRevision: revision(join(repository, 'graders'), graderFiles(task)),
    prompt, fixture, conditions: conditionFiles, documents: docs,
  };
  mkdirSync(directory, { recursive: false });
  mkdirSync(join(directory, 'traces'));
  writeJson(join(directory, 'experiment.json'), experiment);
  writeFileSync(join(directory, 'runs.jsonl'), '');
  return experiment;
}

export function loadExperiment(directory) {
  const experiment = JSON.parse(readFileSync(join(directory, 'experiment.json'), 'utf8'));
  if (experiment?.schemaVersion !== 1) throw new Error('Unsupported experiment schema');
  return experiment;
}

export function loadInputs(directory, condition) {
  const experiment = loadExperiment(directory);
  if (!Object.hasOwn(experiment.conditions, condition)) throw new Error('Unknown condition');
  const docs = Object.entries(experiment.conditions[condition]).map(([name, digest]) => {
    const content = experiment.documents[digest];
    if ((name !== '.agents/skills/moderato-effects/SKILL.md' &&
        (!name.startsWith('docs/') || !/\.(md|txt)$/.test(name) ||
          name.split('/').some(part => !part || part === '.' || part === '..') || /[\\:]/.test(name))) ||
        typeof content !== 'string' || hash(content) !== digest) {
      throw new Error('Invalid input snapshot: ' + name);
    }
    return [name, content];
  });
  const core = Object.entries(experiment.fixture);
  if (core.some(([name, text]) => !starterFiles.includes(name) || typeof text !== 'string')) {
    throw new Error('Invalid starter snapshot');
  }
  return new Map(core.concat(docs).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function readRuns(directory) {
  return readFileSync(join(directory, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function recordRun(directory, run) {
  const { order } = loadExperiment(directory);
  if (!order.some(item => item.id === run.id && item.condition === run.condition)) throw new Error('Run is outside the experiment plan');
  if (readRuns(directory).some(item => item.id === run.id)) throw new Error('Run is already recorded');
  appendFileSync(join(directory, 'runs.jsonl'), JSON.stringify(run) + '\n');
  summarize(directory);
}

export function summarize(directory) {
  const experiment = loadExperiment(directory);
  const runs = readRuns(directory);
  const summary = {
    schemaVersion: 1,
    plannedRuns: experiment.order.length,
    recordedRuns: runs.length,
    conditions: Object.fromEntries(Object.keys(experiment.conditions).map(id => {
      const group = runs.filter(run => run.condition === id);
      return [id, {
        runs: group.length,
        firstBuildPassed: group.filter(run => run.firstBuildPassed === true).length,
        firstBuildObserved: group.filter(run => typeof run.firstBuildPassed === 'boolean').length,
        finalBuildPassed: group.filter(run => run.grade?.buildSucceeded === true).length,
        finalBuildObserved: group.filter(run => typeof run.grade?.buildSucceeded === 'boolean').length,
        testsPassed: group.filter(run => run.grade?.success === true).length,
        graded: group.filter(run => run.grade != null).length,
        timeouts: group.filter(run => run.timedOut).length,
        failedBuildAttempts: group.reduce((count, run) => count + run.builds.filter(build => build.exitCode !== 0).length, 0),
        medianDurationMs: median(group.map(run => run.durationMs)),
        medianInputTokens: median(group.map(run => run.usage?.input_tokens)),
        medianOutputTokens: median(group.map(run => run.usage?.output_tokens)),
      }];
    })),
  };
  writeJson(join(directory, 'summary.json'), summary);
  return summary;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, first, second, ...extra] = process.argv.slice(2);
  try {
    if (command === 'init' && first && second && !extra.length) {
      initialize(resolve(second), JSON.parse(readFileSync(first, 'utf8')), dirname(resolve(first)), codexVersion());
    } else if (command === 'summarize' && first && !second) {
      console.log(JSON.stringify(summarize(resolve(first)), null, 2));
    } else {
      throw new Error('Usage: node live/experiment.mjs init CONFIG.json NEW_EXPERIMENT_DIR | summarize EXPERIMENT_DIR');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
