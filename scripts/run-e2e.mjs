import { spawnSync } from "node:child_process";

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const project = `ahkmes-e2e-${process.pid}-${Date.now()}`;
const compose = ["compose", "--project-name", project, "--file", "docker-compose.e2e.yml"];

function run(args) {
  const result = spawnSync(docker, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const exitCode = run([...compose, "up", "--build", "--abort-on-container-exit", "--exit-code-from", "e2e"]);
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  const cleanupCode = run([...compose, "down", "--volumes", "--remove-orphans"]);
  if (cleanupCode !== 0 && process.exitCode === undefined) process.exitCode = cleanupCode;
}
