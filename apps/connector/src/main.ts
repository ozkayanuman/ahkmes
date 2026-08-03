import type { MachineAdapter } from "./adapters/adapter.interface";
import { FanucAdapter } from "./adapters/fanuc.adapter";
import { M80Adapter } from "./adapters/m80.adapter";
import { OpcuaAdapter } from "./adapters/opcua.adapter";
import { SimulatorAdapter } from "./adapters/simulator.adapter";
import { Connector } from "./core/connector";
import { loadConfig } from "./config";
import { fetchBackendConnectorConfig } from "./backend-config";

async function main() {
  const config = loadConfig();

  let adapterType = config.adapter;
  let opcuaEndpointUrl = config.opcuaEndpointUrl;
  let m80Host = config.m80Host;
  let m80Port = config.m80Port;

  // ADAPTER env değişkeni açıkça verilmediyse, web'de configure edilen bağlantı
  // ayarlarını (Machine.connectorType/connectorConfig) backend'den çek.
  if (!process.env.ADAPTER) {
    const backendConfig = await fetchBackendConnectorConfig(
      config.backendUrl,
      config.machineId,
      config.machineKey,
    );
    if (backendConfig) {
      const cfg = (backendConfig.connectorConfig ?? {}) as Record<string, string>;
      if (backendConfig.connectorType === "OPC_UA") {
        adapterType = "opcua";
        if (!process.env.OPCUA_ENDPOINT_URL && cfg.endpointUrl) opcuaEndpointUrl = cfg.endpointUrl;
      } else if (backendConfig.connectorType === "M80") {
        adapterType = "m80";
        if (!process.env.M80_HOST && cfg.host) m80Host = cfg.host;
        if (!process.env.M80_PORT && cfg.port) m80Port = Number(cfg.port);
      }
      // eslint-disable-next-line no-console
      console.log(`Backend'den bağlantı ayarları alındı: connectorType=${backendConfig.connectorType}`);
    }
  }

  const adapter: MachineAdapter =
    adapterType === "opcua"
      ? new OpcuaAdapter({
          endpointUrl: opcuaEndpointUrl,
          cycleStatusNodeId: config.opcuaCycleStatusNodeId,
          partCountNodeId: config.opcuaPartCountNodeId,
          alarmMessageNodeId: config.opcuaAlarmMessageNodeId,
        })
      : adapterType === "m80"
        ? new M80Adapter({
            host: m80Host,
            port: m80Port,
            pollIntervalMs: config.m80PollIntervalMs,
            tags: config.m80Tags,
          })
        : adapterType === "fanuc"
          ? new FanucAdapter({ host: config.fanucHost, port: config.fanucPort })
          : new SimulatorAdapter({
              cycleTimeMs: config.simulatorCycleTimeMs,
              alarmProbability: config.simulatorAlarmProbability,
            });

  const connector = new Connector(adapter, {
    backendUrl: config.backendUrl,
    machineId: config.machineId,
    machineKey: config.machineKey,
    tagPollIntervalMs: config.tagPollIntervalMs,
    durableQueuePath: config.durableQueuePath,
    healthPort: config.healthPort,
  });

  await connector.start();
  // eslint-disable-next-line no-console
  console.log(
    `AHKMES connector başladı — adapter=${adapterType}, machineId=${config.machineId}, backend=${config.backendUrl}`,
  );

  process.on("SIGINT", async () => {
    await connector.stop();
    process.exit(0);
  });
}

void main();
