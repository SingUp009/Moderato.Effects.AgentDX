import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compare, validate } from './report.mjs';
import { grade, prepare, taskIds } from './run.mjs';

test('discovers tasks and prepares a clean agent-visible project', () => {
  const root = mkdtempSync(join(tmpdir(), 'moderato-fixture-test-'));
  try {
    assert.deepEqual(taskIds, ['cancellation', 'composition', 'dependencies', 'resources', 'typed-errors']);
    for (const id of taskIds) {
      const target = join(root, id);
      prepare(id, target);
      const common = ['Submission.cs', 'Submission.csproj', 'global.json', 'packages.lock.json', 'prompt.md'];
      if (id !== 'cancellation') common.push('Contract.cs');
      assert.deepEqual(readdirSync(target).sort(), common.sort());
      assert.throws(() => prepare(id, target), { code: 'EEXIST' });
      assert.match(readFileSync(join(target, 'Submission.cs'), 'utf8'), /NotImplementedException/);
    }
    assert.throws(() => prepare('../graders', join(root, 'unexpected')), /Unknown task/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reference submissions pass and compiling mistakes fail the graders', () => {
  const root = mkdtempSync(join(tmpdir(), 'moderato-grade-test-'));
  try {
    for (const id of taskIds) {
      const good = grade(id, 'reference', root);
      assert.equal(good.success, true, JSON.stringify(good));
      assert.equal(good.testsPassed, good.testsTotal);
      assert.ok(good.testsTotal >= 3);
      assert.deepEqual(readdirSync(root), []);

      const bad = grade(id, 'mutant', root);
      assert.equal(bad.buildSucceeded, true, JSON.stringify(bad));
      assert.equal(bad.success, false);
      assert.equal(bad.failureCategory, 'behavior');
      assert.ok(bad.testsPassed > 0 && bad.testsPassed < bad.testsTotal);
      assert.notEqual(bad.submissionHash, good.submissionHash);
      assert.equal(compare(bad, good).successPercentagePoints, 100);
      assert.deepEqual(readdirSync(root), []);
    }

    const invalid = join(root, 'bad.cs');
    writeFileSync(invalid, 'this is not valid C#');
    const broken = grade('typed-errors', invalid, root);
    assert.equal(broken.buildSucceeded, false);
    assert.equal(broken.testsTotal, null);
    assert.equal(broken.failureCategory, 'submission-build');
    assert.deepEqual(readdirSync(root), ['bad.cs']);

    assert.throws(() => grade('typed-errors', join(root, 'missing.cs'), root), { code: 'ENOENT' });
    assert.deepEqual(readdirSync(root), ['bad.cs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed results and comparisons across revisions', () => {
  const report = JSON.parse(readFileSync(new URL('./reports/offline-example.json', import.meta.url), 'utf8'));
  assert.equal(validate(report), report);
  assert.throws(() => validate({ ...report, schemaVersion: 2 }), /schema/);
  assert.throws(() => validate({ ...report, toolCalls: undefined }), /metadata/);
  assert.throws(() => validate({ ...report, testsPassed: report.testsTotal + 1 }), /grading/);
  assert.throws(() => validate({ ...report, success: false }), /grading/);
  assert.throws(() => compare(report, { ...report, taskVersion: 2 }), /taskVersion/);
  assert.throws(() => compare(report, { ...report, graderRevision: '0'.repeat(64) }), /graderRevision/);
  const comparison = compare(report, { ...report, variant: 'repeat', durationMs: report.durationMs + 25 });
  assert.equal(comparison.baseline.runs, 1);
  assert.equal(comparison.successPercentagePoints, 0);
  assert.equal(comparison.durationMsDifference, 25);
  assert.equal(comparison.inputTokensDifference, null);
});
