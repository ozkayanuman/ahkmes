import type { MachineAdapter, MachineEvent, TagReading } from "./adapter.interface";

export interface FanucAdapterConfig {
  host: string;
  port?: number;
}

/**
 * Fanuc FOCAS2 adaptör İSKELETİ — Çoklu marka mimarisinin genişletilebilir
 * olduğunu göstermek için eklendi (bkz. `M80Adapter` ile aynı `MachineAdapter`
 * arayüzü). FOCAS2, Fanuc'un resmi, lisanslı, native (DLL/shared library)
 * kütüphanesidir — M80'in aksine açık kaynak bir reverse-engineering muadili
 * yaygın olarak bulunmuyor. Bu yüzden burada GERÇEK bir protokol implementasyonu
 * YOK; yalnızca `MachineAdapter` sözleşmesine uyan, net şekilde işaretlenmiş bir
 * placeholder var.
 *
 * Gerçek entegrasyon için gerekenler:
 *   1. Fanuc'tan (veya makine üreticisinden) FOCAS2 lisansı + `Fwlib32.dll`/
 *      `fwlib32-linux` native kütüphanesi.
 *   2. Node'dan bu native kütüphaneyi çağırmak için bir FFI katmanı (ör.
 *      `node-ffi-napi` veya küçük bir C++ addon).
 *   3. `connect()`/`readTags()` içindeki TODO'ların gerçek FOCAS2 çağrılarıyla
 *      (`cnc_allclibhndl3`, `cnc_statinfo`, `cnc_rdprgnum` vb.) doldurulması.
 */
export class FanucAdapter implements MachineAdapter {
  private listeners: ((event: MachineEvent) => void)[] = [];
  private connected = false;

  constructor(private readonly config: FanucAdapterConfig) {}

  async connect(): Promise<void> {
    // TODO: gerçek FOCAS2 entegrasyonu — cnc_allclibhndl3(host, port, timeout, &handle)
    throw new Error(
      "FanucAdapter henüz bir iskelet: gerçek FOCAS2 native kütüphanesi entegre edilmedi. " +
        "Bkz. apps/connector/src/adapters/fanuc.adapter.ts başlık yorumu.",
    );
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  onEvent(cb: (event: MachineEvent) => void): void {
    this.listeners.push(cb);
  }

  async readTags(): Promise<TagReading[]> {
    // TODO: cnc_rdprgnum / cnc_statinfo / cnc_rdspeed gibi FOCAS2 çağrılarıyla doldurulacak.
    return [];
  }

  private emit(type: MachineEvent["type"], payload?: Record<string, unknown>) {
    if (!this.connected) return;
    const event: MachineEvent = { type, timestamp: new Date().toISOString(), payload };
    for (const cb of this.listeners) cb(event);
  }
}
