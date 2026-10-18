import { execFileSync } from "node:child_process";

// Resolve once while compiling, never from the running deployment's environment.
// Explicit build inputs support build contexts that do not include .git.
export function buildIdentity(cwd, env = process.env, git = (args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
) {
  if (Boolean(env.BUILD_COMMIT_SHA) !== Boolean(env.BUILD_BRANCH)) {
    throw new Error("Supply BUILD_COMMIT_SHA and BUILD_BRANCH together, or use Git metadata.");
  }
  const commitSha = env.BUILD_COMMIT_SHA || git(["rev-parse", "HEAD"]);
  const branch = env.BUILD_BRANCH || git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commitSha) || !branch || /[\r\n]/.test(branch)) {
    throw new Error("Build identity requires a full commit SHA and branch.");
  }
  return { commitSha, branch, builtAt: new Date().toISOString() };
}
