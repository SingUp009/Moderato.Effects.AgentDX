import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { prepare } from '../run.mts';

test('fixture tools allow the selected docs and write only Submission.cs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-dx-fixture-test-'));
  try {
    const fixture = join(directory, 'fixture');
    const usage = join(directory, 'usage.json');
    prepare('resources', fixture);
    mkdirSync(join(fixture, 'docs'));
    const doc = join(fixture, 'docs', 'guide.md');
    writeFileSync(doc, 'read-only guide');
    writeFileSync(join(directory, 'canary.txt'), 'private');
    const requests = [
      ['read_file', { file: 'docs/guide.md' }],
      ['read_file', { file: '../canary.txt' }],
      ['read_file', { file: '../graders/ResourcesTests.cs' }],
      ['write_file', { file: 'docs/guide.md', source: 'overwrite' }],
      ['write_submission', { source: 'new C# source', file: 'docs/guide.md' }],
      ['write_submission', { source: 'new C# source' }],
      ['read_file', { file: 'Submission.cs' }],
    ].map(([name, args], id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }));
    const server = fileURLToPath(new URL('./fixture-mcp.mts', import.meta.url));
    const processResult = spawnSync(process.execPath, [server, fixture, 'resources', usage], {
      input: requests.join('\n') + '\n', encoding: 'utf8',
    });
    assert.equal(processResult.status, 0, processResult.stderr);
    const replies = processResult.stdout.trim().split('\n').map(line => JSON.parse(line).result);
    assert.equal(replies[0].content[0].text, 'read-only guide');
    assert.ok(replies.slice(1, 4).every(reply => reply.isError));
    assert.equal(replies[6].content[0].text, 'new C# source');
    assert.equal(readFileSync(doc, 'utf8'), 'read-only guide');
    assert.equal(readFileSync(join(directory, 'canary.txt'), 'utf8'), 'private');
    assert.deepEqual(JSON.parse(readFileSync(usage, 'utf8')), { calls: 7, builds: [] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
