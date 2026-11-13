import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const starterFiles = ['prompt.md', 'Submission.cs', 'Contract.cs', 'Submission.csproj', 'global.json', 'packages.lock.json'];

export function readFixture(root: string) {
  const files = new Map<string, string>();
  for (const name of [...starterFiles, '.agents/skills/moderato-effects/SKILL.md']) {
    const path = join(root, name);
    if (existsSync(path) && lstatSync(path).isFile()) files.set(name, readFileSync(path, 'utf8'));
  }
  const docs = join(root, 'docs');
  if (existsSync(docs) && lstatSync(docs).isDirectory()) {
    for (const entry of readdirSync(docs, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(md|txt)$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      files.set(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  }
  if (starterFiles.some(name => name !== 'Contract.cs' && !files.has(name))) {
    throw new Error('Expected a prepared fixture');
  }
  return new Map([...files].sort(([left], [right]) => left.localeCompare(right, 'en')));
}
