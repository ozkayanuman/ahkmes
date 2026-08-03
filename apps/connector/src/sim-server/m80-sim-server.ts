import net from "node:net";
import {
  DataType,
  decodeGetDataRequest,
  DEFAULT_ITEM_ADDRESSES,
  encodeCharValue,
  encodeGetDataReply,
  encodeLongValue,
  totalFrameSize,
  type GetDataRequest,
} from "../adapters/m80-protocol";

export interface M80SimServerConfig {
  port: number;
  cycleTimeMs: number;
  alarmProbability?: number;
}

export interface M80SimServerHandle {
  port: number;
  /** Açık istemci soketlerini kapatarak saha ağ kesintisini taklit eder. */
  disconnectClients(): void;
  shutdown(): Promise<void>;
}

function matchesItem(req: GetDataRequest, item: { section: number; subSection: number }): boolean {
  return req.section === item.section && req.subSection === item.subSection;
}

/**
 * Gerçek bir M80 olmadan `M80Adapter`'ı test etmek için sahte bir TCP sunucu.
 * `m80-protocol.ts`'teki (bizim basitleştirdiğimiz) GIOP/EZSocket çerçevesini konuşur;
 * `opcua-sim-server.ts` ile birebir aynı çevrim mantığını (CYCLE_START → ALARM (opsiyonel)
 * → PART_COMPLETE → CYCLE_END) section/subSection adresli "mochaGetData" sorgularına
 * yanıt vererek üretir.
 */
export function startM80SimServer(config: M80SimServerConfig): Promise<M80SimServerHandle> {
  let cycleStatus = 0;
  let partCount = 0;
  let alarmMessage = "";
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clients = new Set<net.Socket>();

  const alarmProbability = config.alarmProbability ?? 0;

  function scheduleCycle() {
    if (stopped) return;
    cycleStatus = 1; // RUNNING
    timer = setTimeout(() => {
      if (stopped) return;
      partCount += 1;
      if (Math.random() < alarmProbability) {
        cycleStatus = 2; // ALARM
        alarmMessage = "Simülasyon (M80): eksen aşırı yük";
        timer = setTimeout(() => {
          if (stopped) return;
          cycleStatus = 0;
          alarmMessage = "";
          timer = setTimeout(() => scheduleCycle(), config.cycleTimeMs / 4);
        }, config.cycleTimeMs / 4);
      } else {
        cycleStatus = 0; // IDLE — CYCLE_END
        timer = setTimeout(() => scheduleCycle(), config.cycleTimeMs / 4);
      }
    }, config.cycleTimeMs);
  }

  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
    let recvBuffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      recvBuffer = Buffer.concat([recvBuffer, chunk]);
      for (;;) {
        const size = totalFrameSize(recvBuffer);
        if (size === null) return;
        const frame = recvBuffer.subarray(0, size);
        recvBuffer = recvBuffer.subarray(size);

        const req = decodeGetDataRequest(frame);
        let data: Buffer;
        if (matchesItem(req, DEFAULT_ITEM_ADDRESSES.cycleStatus)) {
          data = encodeLongValue(cycleStatus);
        } else if (matchesItem(req, DEFAULT_ITEM_ADDRESSES.partCount)) {
          data = encodeLongValue(partCount);
        } else if (matchesItem(req, DEFAULT_ITEM_ADDRESSES.alarmMessage)) {
          data = encodeCharValue(alarmMessage);
        } else {
          socket.write(
            encodeGetDataReply({ requestId: req.requestId, isError: true, dataType: DataType.LONG, data: Buffer.alloc(0) }),
          );
          continue;
        }
        socket.write(encodeGetDataReply({ requestId: req.requestId, isError: false, dataType: req.dataType, data }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      scheduleCycle();
      resolve({
        port: config.port,
        disconnectClients() {
          for (const client of clients) client.destroy();
        },
        async shutdown() {
          stopped = true;
          if (timer) clearTimeout(timer);
          for (const client of clients) client.destroy();
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
