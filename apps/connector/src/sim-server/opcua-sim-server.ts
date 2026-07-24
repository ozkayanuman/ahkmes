import { DataType, OPCUAServer, Variant } from "node-opcua";

export interface SimServerConfig {
  port: number;
  cycleTimeMs: number;
  alarmProbability?: number;
}

export interface SimServerHandle {
  endpointUrl: string;
  shutdown(): Promise<void>;
}

/**
 * Gerçek bir makine/kontrolcü olmadan OPC-UA adapter'ını test etmek için kendi
 * açık kaynak (node-opcua) OPC-UA sunucumuz. Üç değişken yayınlar:
 *   ns=1;s=CycleStatus   (Int32: 0=IDLE, 1=RUNNING, 2=ALARM)
 *   ns=1;s=PartCount     (Int32, her tamamlanan parçada artar)
 *   ns=1;s=AlarmMessage  (String)
 * Gerçek bir makineye bağlanmadan simulator.adapter.ts ile aynı çevrim mantığını
 * OPC-UA protokolü üzerinden üretir.
 */
export async function startOpcuaSimServer(config: SimServerConfig): Promise<SimServerHandle> {
  const server = new OPCUAServer({
    port: config.port,
    resourcePath: "/UA/AHKMESSim",
    buildInfo: {
      productName: "AHKMES-Sim",
      buildNumber: "1",
      buildDate: new Date(),
    },
  });

  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  if (!addressSpace) throw new Error("OPC-UA address space oluşturulamadı");
  const namespace = addressSpace.getOwnNamespace();

  const device = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "Machine",
  });

  let cycleStatus = 0;
  let partCount = 0;
  let alarmMessage = "";

  // minimumSamplingInterval belirtilmezse node-opcua varsayılan olarak 1000ms'e
  // yükseltiyor — kısa ömürlü ALARM durumu gibi geçişleri kaçırmamak için düşürüldü.
  namespace.addVariable({
    componentOf: device,
    browseName: "CycleStatus",
    nodeId: "s=CycleStatus",
    dataType: "Int32",
    minimumSamplingInterval: 50,
    value: { get: () => new Variant({ dataType: DataType.Int32, value: cycleStatus }) },
  });
  namespace.addVariable({
    componentOf: device,
    browseName: "PartCount",
    nodeId: "s=PartCount",
    dataType: "Int32",
    minimumSamplingInterval: 50,
    value: { get: () => new Variant({ dataType: DataType.Int32, value: partCount }) },
  });
  namespace.addVariable({
    componentOf: device,
    browseName: "AlarmMessage",
    nodeId: "s=AlarmMessage",
    dataType: "String",
    minimumSamplingInterval: 50,
    value: { get: () => new Variant({ dataType: DataType.String, value: alarmMessage }) },
  });

  await server.start();

  const alarmProbability = config.alarmProbability ?? 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function scheduleCycle() {
    if (stopped) return;
    cycleStatus = 1; // RUNNING
    timer = setTimeout(() => {
      if (stopped) return;
      partCount += 1;
      if (Math.random() < alarmProbability) {
        cycleStatus = 2; // ALARM
        alarmMessage = "Simülasyon (OPC-UA): eksen aşırı yük";
        // ALARM ayrı bir tick'te temizlenir — aksi halde 0 (IDLE) değeri hiç
        // örneklenmeden RUNNING'e dönülür ve CYCLE_END olayı kaçırılır.
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
  scheduleCycle();

  const endpointUrl = server.getEndpointUrl();
  return {
    endpointUrl,
    async shutdown() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await server.shutdown();
    },
  };
}
