import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { M80Adapter } from "../adapters/m80.adapter";
import type { MachineEvent } from "../adapters/adapter.interface";
import { startM80SimServer, type M80SimServerHandle } from "../sim-server/m80-sim-server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(__dirname, "index.html"));

/**
 * M80 sim sunucusu + M80Adapter'ı başlatıp canlı durumu bir web sayfasında (SSE ile)
 * gösteren yerel test aracı. Yalnızca geliştirme/test amaçlı — backend'e dokunmaz.
 */
async function main() {
  const uiPort = Number(process.env.TEST_UI_PORT ?? 4000);
  const simPort = Number(process.env.M80_SIM_PORT ?? 6900);
  const cycleTimeMs = Number(process.env.SIMULATOR_CYCLE_MS ?? 4000);
  const alarmProbability = Number(process.env.SIMULATOR_ALARM_PROBABILITY ?? 0.3);

  const sim: M80SimServerHandle = await startM80SimServer({ port: simPort, cycleTimeMs, alarmProbability });
  const adapter = new M80Adapter({ host: "127.0.0.1", port: simPort, pollIntervalMs: 200 });

  const history: MachineEvent[] = [];
  let status: "IDLE" | "RUNNING" | "ALARM" = "IDLE";
  let partCount = 0;
  let lastAlarm = "";
  const sseClients = new Set<http.ServerResponse>();

  function pushToClients(eventName: string, data: unknown) {
    const chunk = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(chunk);
  }

  adapter.onEvent((event) => {
    history.push(event);
    if (history.length > 300) history.shift();
    if (event.type === "CYCLE_START") status = "RUNNING";
    else if (event.type === "ALARM") {
      status = "ALARM";
      lastAlarm = String(event.payload?.message ?? "Alarm");
    } else if (event.type === "CYCLE_END" || event.type === "IDLE") status = "IDLE";
    if (event.type === "PART_COMPLETE") partCount += 1;
    pushToClients("machine-event", event);
  });

  await adapter.connect();

  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(
        `event: snapshot\ndata: ${JSON.stringify({ simPort, status, partCount, lastAlarm, history })}\n\n`,
      );
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(uiPort, () => {
    // eslint-disable-next-line no-console
    console.log(`AHKMES M80 test paneli: http://localhost:${uiPort} (sim TCP port ${simPort})`);
  });

  process.on("SIGINT", async () => {
    server.close();
    await adapter.disconnect().catch(() => undefined);
    await sim.shutdown().catch(() => undefined);
    process.exit(0);
  });
}

void main();
