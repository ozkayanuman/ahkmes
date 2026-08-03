import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MachineEvent } from "../adapters/adapter.interface";

/** Edge yeniden başlasa bile backend'e teslim edilmemiş telemetriyi koruyan küçük
 * append queue. Yazım geçici dosya + atomic rename ile yapılır; süreç yazım
 * sırasında kapanırsa önceki geçerli dosya korunur. */
export class DurableEventQueue {
  private events: MachineEvent[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  get length() { return this.events.length; }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      this.events = Array.isArray(parsed) ? parsed as MachineEvent[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  peek(): MachineEvent | undefined { return this.events[0]; }

  async push(event: MachineEvent, maxSize: number): Promise<void> {
    this.events.push(event);
    if (this.events.length > maxSize) this.events.splice(0, this.events.length - maxSize);
    return this.schedulePersist();
  }

  async shift(): Promise<void> {
    this.events.shift();
    return this.schedulePersist();
  }

  private schedulePersist(): Promise<void> {
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.persist());
    return this.writeChain;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.events), "utf8");
    await rename(temporary, this.filePath);
  }
}

export class MemoryEventQueue {
  private events: MachineEvent[] = [];
  get length() { return this.events.length; }
  async load() {}
  peek(): MachineEvent | undefined { return this.events[0]; }
  async push(event: MachineEvent, maxSize: number) {
    this.events.push(event);
    if (this.events.length > maxSize) this.events.splice(0, this.events.length - maxSize);
  }
  async shift() { this.events.shift(); }
}
