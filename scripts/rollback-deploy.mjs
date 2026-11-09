#!/usr/bin/env node
/**
 * Point production back at the previous deployment.
 *
 * Called by `.github/workflows/verify-deploy.yml` after the live probes fail.
 * It answers one question from Vercel's API — which earlier READY production
 * deployment can we return to? — and refuses to act when the answer is unclear:
 *
 *   - production no longer serves EXPECTED_SHA: another deploy is already live,
 *     so this run has nothing to roll back (exit 0, not an error);
 *   - no earlier deployment with a different commit exists: fail loudly, because
 *     a human has to decide what to do;
 *   - the rollback API fails or production still serves EXPECTED_SHA afterwards:
 *     fail, so the red workflow is not mistaken for a repaired deployment.
 *
 * Rollback reverts code, not schema, which is why `check:migrations` forbids
 * destructive DDL. It also does not touch the `dev` environment.
 *
 * Environment:
 *   VERCEL_TOKEN       required; a Vercel account token that can roll back
 *   VERCEL_PROJECT_ID  required unless VERCEL_PROJECT names the project
 *   VERCEL_PROJECT     project name, resolved through the API when no id is given
 *                      (default friendloop)
 *   VERCEL_TEAM_ID     optional; needed when the project belongs to a team
 *   EXPECTED_SHA       required; the commit the probes tested
 *   APP_URL            default https://friendloop.dev
 *   DRY_RUN            "1" lists the target without calling rollback
 */

import { appendFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.vercel.com";
const APP_URL = (process.env.APP_URL ?? "https://friendloop.dev").replace(/\/+$/, "");
const VERSION_URL = `${APP_URL}/api/version`;

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const projectName = process.env.VERCEL_PROJECT || "friendloop";
const teamId = process.env.VERCEL_TEAM_ID;
const expectedSha = process.env.EXPECTED_SHA;
const dryRun = process.env.DRY_RUN === "1";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 120_000;

function fail(message) {
  // `::error::` renders the message on the failing workflow step, where whoever
  // gets the email will look first.
  console.error(`::error::${message}`);
  process.exit(1);
}

function requireEnv() {
  if (!token) fail("VERCEL_TOKEN is not set. Add a Vercel account token as a repository secret.");
  if (!projectId && !projectName) {
    fail("Set VERCEL_PROJECT_ID (or VERCEL_PROJECT) so the rollback knows which project to act on.");
  }
  if (!expectedSha) fail("EXPECTED_SHA is not set. It should be the commit the failed deploy was built from.");
}

function apiUrl(path) {
  const url = new URL(path, API);
  if (teamId) url.searchParams.set("teamId", teamId);
  return url;
}

/** One Vercel API call; a non-2xx response includes the body, which says why. */
async function api(path, init = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    fail(`Could not reach the Vercel API (${path}): ${error.message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    fail(`${init.method ?? "GET"} ${path} returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return body ? JSON.parse(body) : {};
}

/** The commit production says it is running, or null when it cannot be read. */
async function liveCommit() {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const { commit } = await response.json();
    return commit ?? null;
  } catch {
    return null;
  }
}

async function resolveProjectId() {
  if (projectId) return projectId;
  const project = await api(`/v9/projects/${encodeURIComponent(projectName)}`);
  if (!project.id) fail(`Vercel returned no project id for "${projectName}".`);
  return project.id;
}

/**
 * The newest earlier production deployment with a different commit. Vercel's
 * `isRollbackCandidate` is the preferred signal; the fallback keeps this working
 * if the field is ever missing from a response.
 */
function pickTarget(deployments, failedSha = expectedSha) {
  const candidates = deployments
    .filter((deployment) => deployment?.target === "production")
    .filter((deployment) => (deployment.state ?? deployment.readyState) === "READY")
    .map((deployment) => ({
      id: deployment.uid ?? deployment.id,
      commit: deployment.meta?.githubCommitSha ?? null,
      url: deployment.url,
      createdAt: deployment.createdAt ?? 0,
      candidate: deployment.isRollbackCandidate === true,
    }))
    .filter((deployment) => deployment.id && deployment.commit && deployment.commit !== failedSha)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (candidates.length === 0) return null;
  return candidates.find((deployment) => deployment.candidate) ?? candidates[0];
}

function summary(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

async function main() {
  requireEnv();
  const project = await resolveProjectId();

  const live = await liveCommit();
  if (live !== null && live !== expectedSha) {
    summary([
      "## Rollback skipped",
      "",
      `Production reports \`${live}\`, not the failed \`${expectedSha}\`: a different deployment is already live, so this run has nothing to undo.`,
    ]);
    return;
  }
  if (live === null) {
    // `/api/version` being unreadable is itself a failure of the deployment under
    // test, so carry on rather than leave a broken release in place.
    console.warn(`Could not read ${VERSION_URL}; rolling back without confirming the live commit.`);
  }

  const params = new URLSearchParams({
    projectId: project,
    target: "production",
    state: "READY",
    limit: "20",
  });
  const { deployments = [] } = await api(`/v7/deployments?${params}`);
  const target = pickTarget(deployments);
  if (!target) {
    fail(
      `No earlier READY production deployment with a different commit exists, so ${expectedSha} cannot be rolled back automatically. Check the Vercel dashboard.`,
    );
  }

  const from = live ?? expectedSha;
  if (dryRun) {
    summary([
      "## Rollback (dry run)",
      "",
      `Would point production from \`${from}\` to \`${target.commit}\` (${target.url}).`,
    ]);
    return;
  }

  console.log(`Rolling back from ${from} to ${target.commit} (${target.url})`);
  await api(`/v1/projects/${encodeURIComponent(project)}/rollback/${encodeURIComponent(target.id)}`, {
    method: "POST",
  });

  // Vercel moves the production alias, which is not always instant. Wait for the
  // deployment to stop reporting the failed commit rather than trust the API's
  // 200 alone. A third commit landing mid-rollback also counts as success: the
  // release under test is no longer live, and its own run will judge it.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = await liveCommit();
  while (current === null || current === expectedSha) {
    if (Date.now() >= deadline) {
      fail(
        `Rollback was accepted but ${VERSION_URL} still reports ${current ?? "nothing"} instead of ${target.commit}. Check the Vercel dashboard.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await liveCommit();
  }

  const note = current && target.commit && current !== target.commit
    ? ` Production now reports \`${current}\` instead of \`${target.commit}\` — another deploy landed while the rollback ran.`
    : "";
  summary([
    "## Rolled back production",
    "",
    `\`${from}\` failed its live probes. Production now serves \`${current ?? "unknown"}\` (${target.url}).${note}`,
    "",
    "The merge is still on `main`; redeploy it once the cause is fixed.",
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();

export { pickTarget };
