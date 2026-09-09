import { spawnSync } from "node:child_process";

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const project = `ahkmes-operations-e2e-${process.pid}-${Date.now()}`;
const compose = ["compose", "--project-name", project, "--file", "docker-compose.operations-e2e.yml"];
function run(args) { const result = spawnSync(docker, args, { stdio: "inherit" }); if (result.error) throw result.error; return result.status ?? 1; }
try {
  const status = run([...compose, "up", "--build", "--abort-on-container-exit", "--exit-code-from", "operations-e2e"]);
  if (status !== 0) process.exitCode = status;
} finally {
  const cleanup = run([...compose, "down", "--volumes", "--remove-orphans"]);
  if (cleanup !== 0 && process.exitCode === undefined) process.exitCode = cleanup;
}
