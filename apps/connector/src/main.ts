import { SimulatorAdapter } from "./adapters/simulator.adapter";
import { Connector } from "./core/connector";
import { loadConfig } from "./config";

async function main() {
  const config = loadConfig();

  if (config.adapter === "opcua") {
    throw new Error(
      "OPC-UA adapter henüz uygulanmadı (Faz H, stretch — bkz. docs/superpowers/specs/2026-07-24-machine-connector-design.md). Şimdilik ADAPTER=simulator kullanın.",
    );
  }

  const adapter = new SimulatorAdapter({
    cycleTimeMs: config.simulatorCycleTimeMs,
    alarmProbability: config.simulatorAlarmProbability,
  });

  const connector = new Connector(adapter, {
    backendUrl: config.backendUrl,
    machineId: config.machineId,
    machineKey: config.machineKey,
  });

  await connector.start();
  // eslint-disable-next-line no-console
  console.log(
    `AHKMES connector başladı — adapter=${config.adapter}, machineId=${config.machineId}, backend=${config.backendUrl}`,
  );

  process.on("SIGINT", async () => {
    await connector.stop();
    process.exit(0);
  });
}

void main();
