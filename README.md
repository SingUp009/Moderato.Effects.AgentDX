# Moderato.Effects Agent DX

This is the offline Proficiency suite. The grader verifies public behavior against a published Moderato.Effects package. It exercises five tasks and ships one reference implementation and one deliberately incorrect, compiling implementation per task.

## Run locally

Use Node.js 22 or later and .NET SDK 11.0.100. NuGet restores the locked packages on first use. Set `AGENT_DX_NUGET_SOURCES` to local feed directories separated by the platform's path delimiter if packages are available offline. The suite verifies NuGet content hashes in locked mode.

```sh
node run.mjs list
node run.mjs prepare resources ./resources-task
node run.mjs grade resources reference > reference.json
node run.mjs grade resources mutant > mutant.json
node run.mjs compare mutant.json reference.json
node --test offline.test.mjs
```

Read `prompt.md` in a prepared project and edit its `Submission.cs`. Run `dotnet build` in that project. Back at the repository root, pass the edited file to `grade` in place of `reference` or `mutant`. The command stages that one C# source file in a fresh fixture, builds it, and runs the grader in a separate process. The expected grading exit codes are 0 for pass, 1 for a reported failure, and 2 for a command or setup error.

The tasks cover expected error unions, cleanup and release exit cases, cancellation propagation, the difference between one deadline and a deadline per retry, and typed environments. Tests control cancellation and cleanup through explicit signals and control deadlines through a fake clock. Real time limits are watchdogs for stalled submissions.

## Isolation

`prepare` copies only the task prompt, starter source, public contract when needed, project, lockfile and pinned SDK configuration. Place the prepared workspace outside the repository when sharing it with an evaluated agent. The grader and reference implementations stay in the evaluator checkout. The temporary grading directory is removed when grading finishes.

The local grading command executes submitted C# with the caller's OS permissions. Use it for trusted offline submissions. Before running an agent, use an isolated execution environment that cannot read the evaluator checkout, credentials, or unrelated files. Grade the result in a separate restricted environment with only the dependencies and inputs it needs. The offline suite has no live agent adapter and uses no model credentials or paid model APIs.

## JSON report schema v1

[offline-example.json](reports/offline-example.json) is the output of a local reference run. It represents a grader self-check.

| Fields | Meaning |
| --- | --- |
| `schemaVersion`, `runId` | Schema revision and unique run identifier |
| `suite`, `taskId`, `taskVersion`, `variant` | Measurement, task revision, and condition or offline submission type |
| `sdkVersion`, `packageVersion` | Exact .NET SDK and published Moderato.Effects package |
| `fixtureRevision`, `graderRevision`, `promptHash`, `submissionHash` | SHA-256 hashes of staged fixture inputs, grader inputs, prompt, and submitted C# respectively. Text uses LF for hashing. |
| `model`, `provider`, `harnessVersion`, `inputTokens`, `outputTokens`, `toolCalls` | Agent metadata and usage, `null` in an offline run |
| `startedAt`, `durationMs` | UTC start time and elapsed time including preparation, restore, build, and tests |
| `buildSucceeded`, `testsPassed`, `testsTotal`, `success` | Submission build status, test counts, and final verdict. Counts are `null` if no valid test report was produced. |
| `failureCategory` | `null` on success. Otherwise `timeout`, `restore`, `submission-build`, `grader-build`, `grader-run`, or `behavior`. |

`compare` accepts two reports with the same task, prompt, fixture, grader, SDK, package, and agent configuration. It reports differences in verdict and test rates in percentage points and differences in available duration and usage. Each input represents one run. The comparison does not estimate an improvement from a sample of one.

## Run in Docker

Build two local images using Linux containers. Image preparation downloads the locked packages. Build and grading containers run without networking or host mounts.

```sh
docker build -f live/Dockerfile --target fixture -t moderato-agent-dx-fixture:local .
docker build -f live/Dockerfile --target grader -t moderato-agent-dx-grader:local .
node live/grade.mjs resources solutions/resources.cs
```

The grading command passes only the submitted C# source to a fresh grader container. For Docker Desktop installations outside PATH, set `AGENT_DX_DOCKER` to the executable path and select the Linux context before running the scripts.

### Run an agent

Use a signed-in Codex CLI and prepare a fresh fixture outside this repository. Add the intended documentation snapshot under `docs/` and optionally an application Skill under `.agents/skills/`. Use a fresh output directory outside the fixture. Review the inputs before starting a live run.

```sh
node run.mjs prepare resources ../resources-task
git -C ../resources-task init -q
node live/run.mjs resources ../resources-task ../resources-run gpt-6-luna --live
node live/grade.mjs resources ../resources-task/Submission.cs
```

The live runner uses the restricted fixture tools to read task materials and update only `Submission.cs`. Its Docker build tool accepts the source and fixed project files. The model turn has a two-minute limit, at most 24 fixture tool calls, and at most four build attempts. `inputs.json` contains the user prompt and task prompt. The output directory also contains CLI events, build exit codes and run metadata.

## Live experiment design

Compare standard documentation, the added guide, and the guide with Skill using the same task revisions, dependencies, model, harness and execution budget. Give every run a fresh environment. Serve the same documentation snapshot to each condition and expose only the intended guide and Skill for that condition. Record sample sizes, success rates, and uncertainty before interpreting differences. Adoption should record framework choice on neutral prompts. Value should use the same behavior specification across implementations and disclose any mandated library choice.

Future work includes randomized repeated runs, wider task coverage, and recording the exact guide and example texts in experiment reports.
