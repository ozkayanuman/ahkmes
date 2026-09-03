import path from "node:path";

export interface ConnectorEnv {
  adapter: "simulator" | "opcua" | "m80" | "fanuc";
  backendUrl: string;
  machineId: string;
  machineKey: string;
  simulatorCycleTimeMs: number;
  simulatorAlarmProbability: number;
  opcuaEndpointUrl: string;
  opcuaCycleStatusNodeId?: string;
  opcuaPartCountNodeId?: string;
  opcuaAlarmMessageNodeId?: string;
  m80Host: string;
  m80Port: number;
  m80PollIntervalMs: number;
  m80ProgramIdentityAddress?: string;
  m80Tags: { name: string; address: string }[];
  tagPollIntervalMs: number;
  fanucHost: string;
  fanucPort: number;
  durableQueuePath?: string;
  /** Yalnızca edge hostunun loopback arayüzünde açılan sağlık/metric portu. 0 kapalıdır. */
  healthPort: number;
}

function parseM80Tags(raw: string | undefined): { name: string; address: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorEnv {
  const adapter =
    env.ADAPTER === "opcua"
      ? "opcua"
      : env.ADAPTER === "m80"
        ? "m80"
        : env.ADAPTER === "fanuc"
          ? "fanuc"
          : "simulator";
  const backendUrl = env.BACKEND_URL ?? "http://localhost:3000";
  let parsedBackendUrl: URL;
  try {
    parsedBackendUrl = new URL(backendUrl);
  } catch {
    throw new Error("BACKEND_URL geçerli bir HTTP(S) URL olmalı");
  }
  if (!/^https?:$/.test(parsedBackendUrl.protocol) || parsedBackendUrl.username || parsedBackendUrl.password) {
    throw new Error("BACKEND_URL yalnızca kimlik bilgisi içermeyen HTTP(S) URL olabilir");
  }
  const machineId = env.MACHINE_ID;
  const machineKey = env.MACHINE_KEY;
  if (!machineId) throw new Error("MACHINE_ID env değişkeni tanımlı olmalı");
  if (!machineKey) throw new Error("MACHINE_KEY env değişkeni tanımlı olmalı");
  if (adapter === "opcua" && !env.OPCUA_ENDPOINT_URL) {
    throw new Error("ADAPTER=opcua için OPCUA_ENDPOINT_URL env değişkeni tanımlı olmalı");
  }
  if (adapter === "m80" && !env.M80_HOST) {
    throw new Error("ADAPTER=m80 için M80_HOST env değişkeni tanımlı olmalı");
  }
  const healthPort = Number(env.HEALTH_PORT ?? 0);
  if (!Number.isInteger(healthPort) || healthPort < 0 || healthPort > 65535) {
    throw new Error("HEALTH_PORT 0 ile 65535 arasında tam sayı olmalı");
  }

  return {
    adapter,
    backendUrl,
    machineId,
    machineKey,
    simulatorCycleTimeMs: Number(env.SIMULATOR_CYCLE_MS ?? 10_000),
    simulatorAlarmProbability: Number(env.SIMULATOR_ALARM_PROBABILITY ?? 0.1),
    opcuaEndpointUrl: env.OPCUA_ENDPOINT_URL ?? "",
    opcuaCycleStatusNodeId: env.OPCUA_CYCLE_STATUS_NODE_ID,
    opcuaPartCountNodeId: env.OPCUA_PART_COUNT_NODE_ID,
    opcuaAlarmMessageNodeId: env.OPCUA_ALARM_MESSAGE_NODE_ID,
    m80Host: env.M80_HOST ?? "",
    m80Port: Number(env.M80_PORT ?? 683),
    m80PollIntervalMs: Number(env.M80_POLL_INTERVAL_MS ?? 500),
    m80ProgramIdentityAddress: env.M80_PROGRAM_IDENTITY_ADDRESS,
    m80Tags: parseM80Tags(env.M80_TAGS),
    tagPollIntervalMs: Number(env.TAG_POLL_INTERVAL_MS ?? 0),
    fanucHost: env.FANUC_HOST ?? "",
    fanucPort: Number(env.FANUC_PORT ?? 8193),
    durableQueuePath: env.DURABLE_QUEUE_PATH ?? path.resolve(`data/edge-${machineId}.queue.json`),
    healthPort,
  };
}
