import type { MachineAdapter } from "./adapters/adapter.interface";
import { OpcuaAdapter } from "./adapters/opcua.adapter";
import { SimulatorAdapter } from "./adapters/simulator.adapter";
import { Connector } from "./core/connector";
import { loadConfig } from "./config";

async function main() {
  const config = loadConfig();

  const adapter: MachineAdapter =
    config.adapter === "opcua"
      ? new OpcuaAdapter({
          endpointUrl: config.opcuaEndpointUrl,
          cycleStatusNodeId: config.opcuaCycleStatusNodeId,
          partCountNodeId: config.opcuaPartCountNodeId,
          alarmMessageNodeId: config.opcuaAlarmMessageNodeId,
        })
      : new SimulatorAdapter({
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
