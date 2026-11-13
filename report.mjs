const identity = [
  'suite', 'taskId', 'taskVersion', 'model', 'provider', 'harnessVersion',
  'sdkVersion', 'packageVersion', 'fixtureRevision', 'graderRevision', 'promptHash',
];
const optionalCounts = ['inputTokens', 'outputTokens', 'toolCalls', 'testsPassed', 'testsTotal'];
const categories = ['timeout', 'restore', 'submission-build', 'grader-build', 'grader-run', 'behavior'];

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validate(report) {
  if (!report || report.schemaVersion !== 1) throw new Error('Unsupported report schema');
  const strings = ['runId', 'suite', 'taskId', 'variant', 'sdkVersion', 'packageVersion', 'startedAt'];
  if (strings.some(key => typeof report[key] !== 'string' || !report[key]) ||
    !Number.isFinite(Date.parse(report.startedAt)) || !count(report.taskVersion) || report.taskVersion < 1 ||
    ['fixtureRevision', 'graderRevision', 'promptHash', 'submissionHash'].some(key =>
      typeof report[key] !== 'string' || !/^[a-f0-9]{64}$/.test(report[key])) ||
    ['model', 'provider', 'harnessVersion'].some(key => report[key] !== null && typeof report[key] !== 'string') ||
    !count(report.durationMs) || optionalCounts.some(key => report[key] !== null && !count(report[key])) ||
    typeof report.success !== 'boolean' || typeof report.buildSucceeded !== 'boolean') {
    throw new Error('Invalid run metadata');
  }
  const graded = report.testsTotal !== null;
  if (graded !== (report.testsPassed !== null) ||
    (graded && (!report.buildSucceeded || report.testsTotal === 0 || report.testsPassed > report.testsTotal)) ||
    report.success !== (graded && report.testsPassed === report.testsTotal) ||
    (report.success ? report.failureCategory !== null : !categories.includes(report.failureCategory)) ||
    (graded && !report.success && report.failureCategory !== 'behavior') ||
    (!graded && report.failureCategory === 'behavior')) {
    throw new Error('Inconsistent grading result');
  }
  return report;
}

export function compare(baseline, candidate) {
  validate(baseline);
  validate(candidate);
  for (const key of identity) {
    if (baseline[key] !== candidate[key]) throw new Error('Incompatible reports: ' + key);
  }

  const rate = report => report.testsTotal === null ? null : report.testsPassed / report.testsTotal;
  const change = (first, second) => first === null || second === null ? null : second - first;
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
