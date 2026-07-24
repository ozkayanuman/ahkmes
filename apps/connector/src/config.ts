export interface ConnectorEnv {
  adapter: "simulator" | "opcua";
  backendUrl: string;
  machineId: string;
  machineKey: string;
  simulatorCycleTimeMs: number;
  simulatorAlarmProbability: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorEnv {
  const adapter = env.ADAPTER === "opcua" ? "opcua" : "simulator";
  const backendUrl = env.BACKEND_URL ?? "http://localhost:3000";
  const machineId = env.MACHINE_ID;
  const machineKey = env.MACHINE_KEY;
  if (!machineId) throw new Error("MACHINE_ID env değişkeni tanımlı olmalı");
  if (!machineKey) throw new Error("MACHINE_KEY env değişkeni tanımlı olmalı");

  return {
    adapter,
    backendUrl,
    machineId,
    machineKey,
    simulatorCycleTimeMs: Number(env.SIMULATOR_CYCLE_MS ?? 10_000),
    simulatorAlarmProbability: Number(env.SIMULATOR_ALARM_PROBABILITY ?? 0.1),
  };
}
