import { startOpcuaSimServer } from "./opcua-sim-server";

async function main() {
  const port = Number(process.env.OPCUA_SIM_PORT ?? 4840);
  const cycleTimeMs = Number(process.env.SIMULATOR_CYCLE_MS ?? 10_000);
  const alarmProbability = Number(process.env.SIMULATOR_ALARM_PROBABILITY ?? 0.1);

  const handle = await startOpcuaSimServer({ port, cycleTimeMs, alarmProbability });
  // eslint-disable-next-line no-console
  console.log(`AHKMES OPC-UA sim sunucusu başladı: ${handle.endpointUrl}`);

  process.on("SIGINT", async () => {
    await handle.shutdown();
    process.exit(0);
  });
}

void main();
