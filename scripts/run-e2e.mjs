import { spawnSync } from "node:child_process";

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const project = `ahkmes-e2e-${process.pid}-${Date.now()}`;
const compose = ["compose", "--project-name", project, "--file", "docker-compose.e2e.yml"];

function run(args, env = process.env) {
  const result = spawnSync(docker, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const e2eArgs = process.argv.slice(2).join(" ");
  const exitCode = run(
    [...compose, "up", "--build", "--abort-on-container-exit", "--exit-code-from", "e2e"],
    { ...process.env, E2E_TEST_ARGS: e2eArgs },
  );
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  const cleanupCode = run([...compose, "down", "--volumes", "--remove-orphans"]);
  if (cleanupCode !== 0 && process.exitCode === undefined) process.exitCode = cleanupCode;
}
