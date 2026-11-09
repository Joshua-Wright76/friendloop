import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

type TestTiming = {
  id: string;
  title: string;
  file: string;
  line: number;
  project: string;
  status: TestResult["status"];
  outcome: ReturnType<TestCase["outcome"]>;
  expectedStatus: TestCase["expectedStatus"];
  startTime: string;
  durationMs: number;
  retry: number;
  workerIndex: number;
  parallelIndex: number;
};

/**
 * One small JSON document per Playwright process. Unlike the HTML report this
 * contains timings only: no screenshots, videos, traces, stdout, or test steps.
 * CI uploads it after both passing and failing shards for future balancing.
 */
class DurationReporter implements Reporter {
  private config: FullConfig | undefined;
  private planned = 0;
  private tests: TestTiming[] = [];

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.planned = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({
      id: test.id,
      title: test.title,
      file: relative(process.cwd(), test.location.file),
      line: test.location.line,
      project: test.parent.project()?.name ?? "unknown",
      status: result.status,
      outcome: test.outcome(),
      expectedStatus: test.expectedStatus,
      startTime: result.startTime.toISOString(),
      durationMs: result.duration,
      retry: result.retry,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
    });
  }

  onEnd(result: FullResult) {
    const outputFile = process.env.E2E_RESULTS_FILE ?? "test-results/e2e-results.json";
    const shard = this.config?.shard;
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, `${JSON.stringify({
      version: 1,
      status: result.status,
      group: process.env.GROUP ?? null,
      shard: shard ? { current: shard.current, total: shard.total } : null,
      gitSha: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      startTime: result.startTime.toISOString(),
      durationMs: result.duration,
      planned: this.planned,
      tests: this.tests,
    })}\n`);
  }

  printsToStdio() {
    return false;
  }
}

export default DurationReporter;
