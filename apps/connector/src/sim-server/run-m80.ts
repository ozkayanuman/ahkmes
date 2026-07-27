import { startM80SimServer } from "./m80-sim-server";

async function main() {
  const port = Number(process.env.M80_SIM_PORT ?? 683);
  const cycleTimeMs = Number(process.env.SIMULATOR_CYCLE_MS ?? 10_000);
  const alarmProbability = Number(process.env.SIMULATOR_ALARM_PROBABILITY ?? 0.1);

  const handle = await startM80SimServer({ port, cycleTimeMs, alarmProbability });
  // eslint-disable-next-line no-console
  console.log(`AHKMES M80 sim sunucusu başladı: tcp://localhost:${handle.port}`);

  process.on("SIGINT", async () => {
    await handle.shutdown();
    process.exit(0);
  });
}

void main();
