import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare, validate } from './report.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const tasks = join(root, 'tasks');
const taskIds = readdirSync(tasks).filter(id => existsSync(join(tasks, id, 'prompt.md'))).sort();
const mutations = JSON.parse(readFileSync(join(root, 'solutions/mutations.json'), 'utf8'));
const sdk = JSON.parse(readFileSync(join(root, 'global.json'), 'utf8')).sdk.version;

function prepare(id, workspace) {
  if (!taskIds.includes(id)) throw new Error('Unknown task: ' + id);
  mkdirSync(workspace);
  try {
    for (const name of ['Submission.csproj', 'packages.lock.json']) {
      cpSync(join(root, 'fixture', name), join(workspace, name));
    }
    for (const name of ['prompt.md', 'Submission.cs', 'Contract.cs']) {
      const source = join(tasks, id, name);
      if (name !== 'Contract.cs' || existsSync(source)) cpSync(source, join(workspace, name));
    }
    cpSync(join(root, 'global.json'), join(workspace, 'global.json'));
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

function readText(path) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function revision(directory) {
  const hash = createHash('sha256');
  for (const name of readdirSync(directory).sort()) {
    hash.update(name + '\0').update(readText(join(directory, name))).update('\0');
  }
  return hash.digest('hex');
}

function dotnet(cwd, args) {
  return spawnSync('dotnet', args, {
    cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en-US' },
  });
}

function build(workspace, project) {
  const sources = (process.env.AGENT_DX_NUGET_SOURCES ?? '').split(delimiter).filter(Boolean);
  const restore = dotnet(workspace, ['restore', project, '--locked-mode', '-p:NuGetAudit=false',
    ...sources.flatMap(source => ['--source', resolve(source)])]);
  if (restore.status !== 0) return { result: restore, stage: 'restore' };
  return { result: dotnet(workspace, ['build', project, '-c', 'Release', '--no-restore', '--disable-build-servers']), stage: 'build' };
}

function grade(id, variant, workspaceRoot = tmpdir()) {
  if (!taskIds.includes(id)) throw new Error('Unknown task: ' + id);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const workspace = mkdtempSync(join(workspaceRoot, 'moderato-agent-dx-'));
  try {
    const submission = join(workspace, 'submission');
    prepare(id, submission);
    const graders = join(workspace, 'graders');
    mkdirSync(graders);
    const testName = id.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('') + 'Tests.cs';
    for (const name of ['Grader.csproj', 'packages.lock.json', testName]) {
      cpSync(join(root, 'graders', name), join(graders, name));
    }
    const fixtureRevision = revision(submission);
    const graderRevision = revision(graders);
    const promptHash = createHash('sha256').update(readText(join(submission, 'prompt.md'))).digest('hex');
    cpSync(join(root, 'global.json'), join(workspace, 'global.json'));
    const sdkResult = dotnet(workspace, ['--version']);
    if (sdkResult.status !== 0 || sdkResult.stdout.trim() !== sdk) {
      throw new Error('Required .NET SDK ' + sdk + '\n' + sdkResult.stderr);
    }

    let solution;
    if (variant === 'reference' || variant === 'mutant') {
      solution = readText(join(root, 'solutions', id + '.cs'));
      if (variant === 'mutant') {
        const [from, to] = mutations[id];
        if (solution.split(from).length !== 2) throw new Error('Mutation must have one match: ' + id);
        solution = solution.replace(from, to);
      }
    } else {
      solution = readText(resolve(variant));
    }
    writeFileSync(join(submission, 'Submission.cs'), solution);
    const packageVersion = readFileSync(join(submission, 'Submission.csproj'), 'utf8')
      .match(/Include="Moderato\.Effects" Version="\[([^\]]+)\]"/)[1];

    const report = {
      schemaVersion: 1, runId: randomUUID(), suite: 'proficiency', taskId: id, taskVersion: 1,
      variant: variant === 'reference' || variant === 'mutant' ? variant : 'local-submission',
      model: null, provider: null, harnessVersion: null, sdkVersion: sdk, packageVersion,
      fixtureRevision, graderRevision, promptHash,
      submissionHash: createHash('sha256').update(solution).digest('hex'), startedAt, durationMs: 0,
      inputTokens: null, outputTokens: null, toolCalls: null, buildSucceeded: false,
      testsPassed: null, testsTotal: null, success: false, failureCategory: null,
    };

    const submitted = build(workspace, 'submission/Submission.csproj');
    if (submitted.result.status !== 0) {
      logFailure(submitted.result);
      report.failureCategory = submitted.result.error?.code === 'ETIMEDOUT' ? 'timeout' :
        submitted.stage === 'restore' ? 'restore' : 'submission-build';
    } else {
      report.buildSucceeded = true;
      const grading = build(workspace, 'graders/Grader.csproj');
      if (grading.result.status !== 0) {
        logFailure(grading.result);
        report.failureCategory = grading.result.error?.code === 'ETIMEDOUT' ? 'timeout' : 'grader-build';
      } else {
        const xml = join(workspace, 'results.xml');
        const result = dotnet(workspace, ['graders/bin/Release/net11.0/Grader.dll', '-noAutoReporters', '-result-xml', xml]);
        if (result.status !== 0 && result.status !== 1) {
          logFailure(result);
          report.failureCategory = result.error?.code === 'ETIMEDOUT' ? 'timeout' : 'grader-run';
        } else {
          const data = existsSync(xml) ? readFileSync(xml, 'utf8') : '';
          const assembly = data.match(/<assembly\s[^>]*>/)?.[0] ?? '';
          const total = Number(assembly.match(/\btotal="(\d+)"/)?.[1]);
          const passed = Number(assembly.match(/\bpassed="(\d+)"/)?.[1]);
          if (total > 0 && Number.isInteger(passed) && (result.status === 0) === (total === passed)) {
            report.testsPassed = passed;
            report.testsTotal = total;
            report.success = total === passed;
            report.failureCategory = report.success ? null : 'behavior';
          } else {
            logFailure(result);
            report.failureCategory = 'grader-run';
          }
        }
      }
    }
    report.durationMs = Math.round(performance.now() - start);
    return validate(report);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function logFailure(result) {
  process.stderr.write([result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n') + '\n');
}

export { grade, prepare, taskIds };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second, ...extra] = process.argv.slice(2);
  try {
    if (command === 'list' && !first) console.log(taskIds.join('\n'));
    else if (command === 'prepare' && first && second && !extra.length) prepare(first, resolve(second));
    else if (command === 'grade' && first && second && !extra.length) {
      const report = grade(first, second);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.success ? 0 : 1;
    } else if (command === 'compare' && first && second && !extra.length) {
      const read = file => JSON.parse(readFileSync(file, 'utf8'));
      console.log(JSON.stringify(compare(read(first), read(second)), null, 2));
    } else {
      throw new Error('Usage: node agent-dx/run.mjs list | prepare TASK NEW_DIR | grade TASK reference|mutant|SOURCE.cs | compare FIRST.json SECOND.json');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
