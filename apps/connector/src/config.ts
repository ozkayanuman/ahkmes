export interface ConnectorEnv {
  adapter: "simulator" | "opcua";
  backendUrl: string;
  machineId: string;
  machineKey: string;
  simulatorCycleTimeMs: number;
  simulatorAlarmProbability: number;
  opcuaEndpointUrl: string;
  opcuaCycleStatusNodeId?: string;
  opcuaPartCountNodeId?: string;
  opcuaAlarmMessageNodeId?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorEnv {
  const adapter = env.ADAPTER === "opcua" ? "opcua" : "simulator";
  const backendUrl = env.BACKEND_URL ?? "http://localhost:3000";
  const machineId = env.MACHINE_ID;
  const machineKey = env.MACHINE_KEY;
  if (!machineId) throw new Error("MACHINE_ID env değişkeni tanımlı olmalı");
  if (!machineKey) throw new Error("MACHINE_KEY env değişkeni tanımlı olmalı");
  if (adapter === "opcua" && !env.OPCUA_ENDPOINT_URL) {
    throw new Error("ADAPTER=opcua için OPCUA_ENDPOINT_URL env değişkeni tanımlı olmalı");
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
  };
}
