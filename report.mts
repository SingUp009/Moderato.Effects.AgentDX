const identity = [
  'suite', 'taskId', 'taskVersion', 'model', 'provider', 'harnessVersion',
  'sdkVersion', 'packageVersion', 'fixtureRevision', 'graderRevision', 'promptHash',
] as const;
const optionalCounts = ['inputTokens', 'outputTokens', 'toolCalls', 'testsPassed', 'testsTotal'] as const;
const categories = ['timeout', 'restore', 'submission-build', 'grader-build', 'grader-run', 'behavior'] as const;

export interface GradeReport {
  schemaVersion: 1;
  runId: string;
  suite: string;
  taskId: string;
  taskVersion: number;
  variant: string;
  model: string | null;
  provider: string | null;
  harnessVersion: string | null;
  sdkVersion: string;
  packageVersion: string;
  fixtureRevision: string;
  graderRevision: string;
  promptHash: string;
  submissionHash: string;
  startedAt: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCalls: number | null;
  buildSucceeded: boolean;
  testsPassed: number | null;
  testsTotal: number | null;
  success: boolean;
  failureCategory: typeof categories[number] | null;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function validate(input: unknown): GradeReport {
  if (!input || typeof input !== 'object') throw new Error('Unsupported report schema');
  const report = input as Partial<Record<keyof GradeReport, unknown>>;
  if (report.schemaVersion !== 1) throw new Error('Unsupported report schema');
  const strings = ['runId', 'suite', 'taskId', 'variant', 'sdkVersion', 'packageVersion', 'startedAt'] as const;
  if (strings.some(key => typeof report[key] !== 'string' || !report[key]) ||
    typeof report.startedAt !== 'string' || !Number.isFinite(Date.parse(report.startedAt)) ||
    !count(report.taskVersion) || report.taskVersion < 1 ||
    (['fixtureRevision', 'graderRevision', 'promptHash', 'submissionHash'] as const).some(key =>
      typeof report[key] !== 'string' || !/^[a-f0-9]{64}$/.test(report[key])) ||
    (['model', 'provider', 'harnessVersion'] as const).some(key => report[key] !== null && typeof report[key] !== 'string') ||
    !count(report.durationMs) || optionalCounts.some(key => report[key] !== null && !count(report[key])) ||
    typeof report.success !== 'boolean' || typeof report.buildSucceeded !== 'boolean') {
    throw new Error('Invalid run metadata');
  }
  const graded = report.testsTotal !== null;
  if (graded !== (report.testsPassed !== null) ||
    (graded && (!report.buildSucceeded || !count(report.testsTotal) || !count(report.testsPassed) ||
      report.testsTotal === 0 || report.testsPassed > report.testsTotal)) ||
    report.success !== (graded && report.testsPassed === report.testsTotal) ||
    (report.success ? report.failureCategory !== null : !categories.some(category => category === report.failureCategory)) ||
    (graded && !report.success && report.failureCategory !== 'behavior') ||
    (!graded && report.failureCategory === 'behavior')) {
    throw new Error('Inconsistent grading result');
  }
  return report as GradeReport;
}

export function compare(first: unknown, second: unknown) {
  const baseline = validate(first);
  const candidate = validate(second);
  for (const key of identity) {
    if (baseline[key] !== candidate[key]) throw new Error('Incompatible reports: ' + key);
  }

  const rate = (report: GradeReport) => report.testsTotal === null || report.testsPassed === null
    ? null : report.testsPassed / report.testsTotal;
  const change = (first: number | null, second: number | null) => first === null || second === null ? null : second - first;
  const testPassChange = change(rate(baseline), rate(candidate));
  return {
    taskId: baseline.taskId,
    baseline: { variant: baseline.variant, runs: 1, successes: Number(baseline.success) },
    candidate: { variant: candidate.variant, runs: 1, successes: Number(candidate.success) },
    successPercentagePoints: 100 * (Number(candidate.success) - Number(baseline.success)),
    buildPercentagePoints: 100 * (Number(candidate.buildSucceeded) - Number(baseline.buildSucceeded)),
    testPassPercentagePoints: testPassChange === null ? null : 100 * testPassChange,
    durationMsDifference: change(baseline.durationMs, candidate.durationMs),
    inputTokensDifference: change(baseline.inputTokens, candidate.inputTokens),
    outputTokensDifference: change(baseline.outputTokens, candidate.outputTokens),
    toolCallsDifference: change(baseline.toolCalls, candidate.toolCalls),
  };
}
