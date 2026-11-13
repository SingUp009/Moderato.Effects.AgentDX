import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { graderFiles, revision, taskIds } from '../run.mts';
import { readFixture, starterFiles } from './fixture-files.mts';
import type { GradeReport } from '../report.mts';

type Configuration = {
  task: string;
  model: string;
  seed: string;
  repeats: number;
  conditions: Record<string, string>;
  prompt?: string;
};
type Trial = { id: string; condition: string };
type Experiment = Omit<Configuration, 'conditions'> & typeof settings & {
  schemaVersion: 1;
  harnessVersion: string;
  order: Trial[];
  sdkVersion: string;
  packageVersion: string;
  fixtureRevision: string;
  graderRevision: string;
  prompt: string;
  fixture: Record<string, string>;
  conditions: Record<string, Record<string, string>>;
  documents: Record<string, string>;
};
export type BuildRecord = {
  source: string;
  exitCode: number | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
};
export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
};
type RecordedRun = Trial & {
  firstBuildPassed: boolean | null;
  builds: BuildRecord[];
  grade: GradeReport | null;
  durationMs: number;
  usage: TokenUsage | null;
  timedOut?: boolean;
};

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
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const writeJson = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

export function codexVersion() {
  const codex = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (codex.status !== 0) throw new Error('Could not determine Codex CLI version');
  return codex.stdout.trim();
}

export function initialize(directory: string, configuration: Configuration, base: string, harnessVersion: string) {
  const { task, model, seed, repeats, conditions } = configuration;
  if (!taskIds.includes(task) || typeof model !== 'string' || !model ||
      typeof seed !== 'string' || !seed || !Number.isSafeInteger(repeats) || repeats < 1 ||
      (configuration.prompt !== undefined && (typeof configuration.prompt !== 'string' || !configuration.prompt.trim())) ||
      !conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
    throw new Error('Expected task, model, seed, repeats, and a condition-to-fixture map');
  }
  const names = Object.keys(conditions).sort();
  if (!names.length || names.some(id => !validId.test(id) || typeof conditions[id] !== 'string' || !conditions[id])) {
    throw new Error('Invalid conditions');
  }
  const docs: Record<string, string> = {};
  const conditionFiles: Experiment['conditions'] = Object.create(null);
  let fixture: Experiment['fixture'] | undefined;
  for (const id of names) {
    const input = readFixture(resolve(base, conditions[id]));
    const core = Object.fromEntries([...input].filter(([name]) => starterFiles.includes(name)));
    if (fixture && JSON.stringify(fixture) !== JSON.stringify(core)) throw new Error('Conditions must share the same starter fixture');
    fixture = core;
    conditionFiles[id] = Object.fromEntries([...input].filter(([name]) => !starterFiles.includes(name)).map(([name, content]) => {
      const digest = hash(content);
      docs[digest] = content;
      return [name, digest];
    }));
  }
  if (!fixture) throw new Error('Expected a starter fixture');
  const order: Trial[] = [];
  for (let trial = 1; trial <= repeats; trial++) {
    const ids = names.map(condition => ({ id: condition + '-' + trial, condition }));
    ids.sort((left, right) => hash(JSON.stringify([seed, trial, left.condition])).localeCompare(hash(JSON.stringify([seed, trial, right.condition])), 'en'));
    order.push(...ids);
  }
  const experiment: Experiment = {
    schemaVersion: 1, task, model, harnessVersion, ...settings, seed, repeats, order,
    sdkVersion: JSON.parse(fixture['global.json']).sdk.version,
    packageVersion: JSON.parse(fixture['packages.lock.json']).dependencies['net11.0']['Moderato.Effects'].resolved,
    fixtureRevision: revision(resolve(base, conditions[names[0]]), Object.keys(fixture)),
    graderRevision: revision(join(repository, 'graders'), graderFiles(task)),
    prompt: configuration.prompt ?? prompt, fixture, conditions: conditionFiles, documents: docs,
  };
  mkdirSync(directory, { recursive: false });
  mkdirSync(join(directory, 'traces'));
  writeJson(join(directory, 'experiment.json'), experiment);
  writeFileSync(join(directory, 'runs.jsonl'), '');
  return experiment;
}

export function loadExperiment(directory: string): Experiment {
  const experiment: Partial<Experiment> | null = JSON.parse(readFileSync(join(directory, 'experiment.json'), 'utf8'));
  if (experiment?.schemaVersion !== 1) throw new Error('Unsupported experiment schema');
  return experiment as Experiment;
}

export function loadInputs(directory: string, condition: string) {
  const experiment = loadExperiment(directory);
  if (!Object.hasOwn(experiment.conditions, condition)) throw new Error('Unknown condition');
  const docs = Object.entries(experiment.conditions[condition]).map(([name, digest]): [string, string] => {
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

function median(values: (number | undefined)[]) {
  const sorted = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function readRuns(directory: string): RecordedRun[] {
  return readFileSync(join(directory, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function recordRun<Run extends RecordedRun>(directory: string, run: Run) {
  const { order } = loadExperiment(directory);
  if (!order.some(item => item.id === run.id && item.condition === run.condition)) throw new Error('Run is outside the experiment plan');
  const lock = join(directory, '.recording-lock');
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const deadline = performance.now() + 5_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || performance.now() >= deadline) throw error;
      Atomics.wait(wait, 0, 0, 25);
    }
  }
  try {
    if (readRuns(directory).some(item => item.id === run.id)) throw new Error('Run is already recorded');
    appendFileSync(join(directory, 'runs.jsonl'), JSON.stringify(run) + '\n');
    summarize(directory);
  } finally {
    rmdirSync(lock);
  }
}

export function summarize(directory: string) {
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
      throw new Error('Usage: node live/experiment.mts init CONFIG.json NEW_EXPERIMENT_DIR | summarize EXPERIMENT_DIR');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
