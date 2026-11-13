import { readFileSync } from 'node:fs';
import { dockerRun } from './docker.mts';

const [task, file, ...extra] = process.argv.slice(2);
if (!task || !file || extra.length) {
  console.error('Usage: node live/grade.mts TASK SUBMISSION.cs');
  process.exit(2);
}

const result = dockerRun(
  'moderato-agent-dx-grader:local',
  'set -eu; cat > /tmp/Submission.cs; exec node run.mts grade "$1" /tmp/Submission.cs',
  readFileSync(file),
  { args: [task], timeout: 180_000 },
);
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 2;
