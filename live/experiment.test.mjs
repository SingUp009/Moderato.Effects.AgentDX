import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepare } from '../run.mjs';
import { initialize, loadInputs, recordRun, summarize } from './experiment.mjs';

test('experiment saves the exact inputs and derives its summary from recorded builds', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-dx-records-'));
  try {
    const names = ['control', 'example', 'async'];
    const guides = ['Existing guide', 'Example\n\n' + '~~~csharp\nint value = 1;\n~~~\n', 'Async example'];
    for (const [index, name] of names.entries()) {
      const fixture = join(root, name);
      prepare('resources', fixture);
      mkdirSync(join(fixture, 'docs'));
      writeFileSync(join(fixture, 'docs', 'agents.md'), guides[index]);
      writeFileSync(join(fixture, 'docs', 'llms.txt'), 'Shared index');
    }
    const configuration = {
      task: 'resources', model: 'test-model', seed: 'example-seed', repeats: 3,
      conditions: Object.fromEntries(names.map(name => [name, name])),
    };
    const directory = join(root, 'experiment');
    const experiment = initialize(directory, configuration, root, 'codex-cli test');
    const repeated = initialize(join(root, 'repeated'), configuration, root, 'codex-cli test');
    assert.deepEqual(experiment.order, repeated.order);
    assert.equal(new Set(experiment.order.map(run => run.id)).size, 9);
    for (let offset = 0; offset < 9; offset += 3) {
      assert.deepEqual(experiment.order.slice(offset, offset + 3).map(run => run.condition).sort(), [...names].sort());
    }
    assert.equal(Object.keys(experiment.documents).length, 4);
    assert.ok(experiment.prompt.includes('replacing Submission.cs'));
    writeFileSync(join(root, 'example', 'docs', 'agents.md'), 'Changed after freezing inputs');
    assert.equal(loadInputs(directory, 'example').get('docs/agents.md'), guides[1]);

    const failed = { source: 'Broken source', exitCode: 1, stdout: 'error CS0103', stderr: '', error: null };
    const repaired = { source: 'Correct source', exitCode: 0, stdout: 'Build succeeded', stderr: '', error: null };
    const run = {
      id: 'example-1', condition: 'example', firstBuildPassed: false, builds: [failed, repaired],
      grade: { buildSucceeded: true, success: true, testsPassed: 5, testsTotal: 5 },
      durationMs: 300, usage: { input_tokens: 100, output_tokens: 20 },
    };
    recordRun(directory, run);
    assert.throws(() => recordRun(directory, run), /already recorded/);
    assert.throws(() => recordRun(directory, { ...run, id: 'unknown' }), /outside the experiment/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'runs.jsonl'), 'utf8')), run);
    const summary = summarize(directory);
    assert.equal(summary.recordedRuns, 1);
    assert.equal(summary.conditions.example.firstBuildPassed, 0);
    assert.equal(summary.conditions.example.firstBuildObserved, 1);
    assert.equal(summary.conditions.example.failedBuildAttempts, 1);
    assert.equal(summary.conditions.example.finalBuildPassed, 1);
    assert.equal(summary.conditions.example.testsPassed, 1);
    assert.equal(summary.conditions.example.medianInputTokens, 100);
    assert.equal(summary.conditions.control.medianInputTokens, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
