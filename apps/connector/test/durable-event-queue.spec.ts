import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineEvent } from "../src/adapters/adapter.interface";

const fileSystem = vi.hoisted(() => ({
  files: new Map<string, string>(),
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (filePath: string) => {
    const content = fileSystem.files.get(filePath);
    if (content === undefined) {
      const error = new Error("Dosya bulunamadı") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    fileSystem.files.set(filePath, content);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const content = fileSystem.files.get(from);
    if (content === undefined) throw new Error("Geçici kuyruk dosyası yok");
    fileSystem.files.set(to, content);
    fileSystem.files.delete(from);
  }),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: fileSystem.mkdir,
  readFile: fileSystem.readFile,
  writeFile: fileSystem.writeFile,
  rename: fileSystem.rename,
}));

import { DurableEventQueue } from "../src/core/durable-event-queue";

const event = (type: MachineEvent["type"]): MachineEvent => ({
  type,
  timestamp: "2026-08-01T12:00:00.000Z",
  eventId: `event-${type}`,
});

describe("DurableEventQueue", () => {
  beforeEach(() => {
    fileSystem.files.clear();
    fileSystem.mkdir.mockClear();
    fileSystem.readFile.mockClear();
    fileSystem.writeFile.mockClear();
    fileSystem.rename.mockClear();
  });

  it("önceki edge oturumundan kalan olayları yükler", async () => {
    const filePath = "edge/m1.queue.json";
    fileSystem.files.set(filePath, JSON.stringify([event("CYCLE_START")]));
    const queue = new DurableEventQueue(filePath);

    await queue.load();

    expect(queue.length).toBe(1);
    expect(queue.peek()).toMatchObject({ type: "CYCLE_START", eventId: "event-CYCLE_START" });
  });

  it("kuyruk mutasyonlarını geçici dosya ve atomic rename ile kalıcılaştırır", async () => {
    const filePath = "edge/m1.queue.json";
    const queue = new DurableEventQueue(filePath);
    await queue.load();

    await queue.push(event("CYCLE_START"), 10);
    await queue.push(event("PART_COMPLETE"), 10);
    await queue.shift();

    expect(JSON.parse(fileSystem.files.get(filePath)!)).toEqual([event("PART_COMPLETE")]);
    expect(fileSystem.writeFile).toHaveBeenCalledWith(`${filePath}.tmp`, expect.any(String), "utf8");
    expect(fileSystem.rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath);
    expect(fileSystem.files.has(`${filePath}.tmp`)).toBe(false);
  });

  it("sınır aşıldığında en eski olayı kalıcı kuyruğa almadan düşürür", async () => {
    const filePath = "edge/m1.queue.json";
    const queue = new DurableEventQueue(filePath);
    await queue.load();

    await queue.push(event("CYCLE_START"), 2);
    await queue.push(event("PART_COMPLETE"), 2);
    await queue.push(event("CYCLE_END"), 2);

    expect(JSON.parse(fileSystem.files.get(filePath)!)).toEqual([
      event("PART_COMPLETE"),
      event("CYCLE_END"),
    ]);
  });
});
