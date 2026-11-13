import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { dockerRun } from './docker.mjs';

const [root, task, usageFile] = process.argv.slice(2);
const files = new Map();
const starterFiles = ['prompt.md', 'Submission.cs', 'Contract.cs', 'Submission.csproj', 'global.json', 'packages.lock.json'];
const docRoot = join(root, 'docs');

for (const name of [...starterFiles, '.agents/skills/moderato-effects/SKILL.md']) {
  const path = join(root, name);
  if (existsSync(path) && lstatSync(path).isFile()) files.set(name, readFileSync(path, 'utf8'));
}
if (existsSync(docRoot) && lstatSync(docRoot).isDirectory()) {
  for (const entry of readdirSync(docRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(md|txt)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8'));
  }
}
if (!starterFiles.filter(name => name !== 'Contract.cs').every(name => files.has(name))) {
  throw new Error('Expected a prepared fixture');
}
if (!/^[a-z]+(?:-[a-z]+)*$/.test(task)) throw new Error('Invalid task ID');

const usage = { calls: 0, builds: [] };
const tools = {
  list_files: ['List task files and documentation.', {}],
  read_file: ['Read one relative task file.', { file: { type: 'string' } }],
  write_submission: ['Replace Submission.cs with the complete C# source.', { source: { type: 'string' } }],
  build_submission: ['Build Submission.cs with the pinned SDK in offline Docker.', {}],
};

function call(name, args) {
  if (++usage.calls > 24) throw new Error('Tool budget exhausted');
  if (!Object.hasOwn(tools, name) || Object.keys(args).some(key => !Object.hasOwn(tools[name][1], key))) {
    throw new Error('Unsupported tool or argument');
  }
  switch (name) {
    case 'list_files':
      return [...files.keys()].join('\n');
    case 'read_file':
      if (!files.has(args.file)) throw new Error('File unavailable');
      return files.get(args.file);
    case 'write_submission':
      if (typeof args.source !== 'string' || args.source.length > 32_768) throw new Error('Invalid source');
      writeFileSync(join(root, 'Submission.cs'), args.source);
      files.set('Submission.cs', args.source);
      return 'Saved';
    case 'build_submission': {
      if (usage.builds.length >= 4) throw new Error('Build budget exhausted');
      const script = [
        'set -eu',
        'mkdir /tmp/work',
        'cd /tmp/work',
        'tar -xf -',
        'dotnet restore --locked-mode --source /feed -p:NuGetAudit=false',
        'dotnet build -c Release --no-restore --disable-build-servers',
      ].join('; ');
      const result = dockerRun('moderato-agent-dx-fixture:local', script, archive());
      usage.builds.push(result.status);
      return [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 12_000);
    }
    default:
      throw new Error('Tool unavailable');
  }
}

function archive() {
  const folder = mkdtempSync(join(tmpdir(), 'agent-dx-build-'));
  try {
    const names = starterFiles.filter(name => files.has(name));
    for (const name of names) writeFileSync(join(folder, name), files.get(name));
    const tar = spawnSync('tar', ['-cf', '-', ...names], { cwd: folder, windowsHide: true });
    if (tar.status !== 0) throw new Error(tar.error?.message ?? tar.stderr.toString());
    return tar.stdout;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result = {};
  if (request.method === 'initialize') {
    result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } };
  } else if (request.method === 'tools/list') {
    result = { tools: Object.entries(tools).map(([name, [description, properties]]) => ({
      name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    })) };
  } else if (request.method === 'tools/call') {
    let text;
    let isError = false;
    try {
      text = call(request.params.name, request.params.arguments ?? {});
    } catch (error) {
      text = error.message;
      isError = true;
    }
    writeFileSync(usageFile, JSON.stringify(usage));
    result = { content: [{ type: 'text', text }], isError };
  }
  console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}
