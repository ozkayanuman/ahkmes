import { runFiniteScheduler, sortByDispatchRule, type SchedulerWorkOrder, type WorkingWindow } from "./finite-scheduler";

const T = (iso: string) => new Date(iso);
const H_START = T("2026-10-12T05:00:00.000Z");
const H_END = T("2026-10-19T05:00:00.000Z");

/** 08:00–12:00 and 12:30–17:00 Istanbul (05:00–09:00Z, 09:30–14:00Z) for the given days. */
function dayWindows(days: string[]): WorkingWindow[] {
  return days.flatMap((d) => [
    { start: T(`${d}T05:00:00.000Z`), end: T(`${d}T09:00:00.000Z`) },
    { start: T(`${d}T09:30:00.000Z`), end: T(`${d}T14:00:00.000Z`) },
  ]);
}

function wo(partial: Partial<SchedulerWorkOrder> & { id: string }): SchedulerWorkOrder {
  return {
    woNo: partial.id.toUpperCase(),
    priority: 5,
    dueDate: T("2026-10-16T21:00:00.000Z"),
    createdAt: T("2026-10-01T00:00:00.000Z"),
    operations: [],
    ...partial,
  };
}

function run(workOrders: SchedulerWorkOrder[], windows: Record<string, WorkingWindow[]>, rule: "EDD" | "PRIORITY" | "FIFO" | "SPT" = "EDD") {
  return runFiniteScheduler({
    horizonStart: H_START,
    horizonEnd: H_END,
    dispatchRule: rule,
    workOrders,
    windowsByMachine: new Map(Object.entries(windows)),
    machineNames: new Map([["m1", "VMC-1"], ["m2", "VMC-2"]]),
  });
}

describe("runFiniteScheduler", () => {
  it("tek operasyonu ilk vardiya penceresine yerleştirir", () => {
    const result = run([wo({ id: "wo1", operations: [{ id: "op1", seq: 1, name: "Kaba", machineId: "m1", status: "PENDING", remainingMinutes: 60 }] })], { m1: dayWindows(["2026-10-12"]) });

    expect(result.unscheduled).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].start).toEqual(T("2026-10-12T05:00:00.000Z"));
    expect(result.operations[0].end).toEqual(T("2026-10-12T06:00:00.000Z"));
    expect(result.operations[0].machineName).toBe("VMC-1");
    expect(result.workOrders[0]).toMatchObject({ woNo: "WO1", late: false, scheduledOps: 1, unscheduledOps: 0 });
  });

  it("bir operasyon molada/vardiya sonunda kesilip aynı makinede devam eder — başka bir operasyonla iç içe geçmez", () => {
    // 4h morning window; 5h operation must spill 1h into the afternoon window.
    const result = run([wo({ id: "wo1", operations: [{ id: "op1", seq: 1, name: "Kaba", machineId: "m1", status: "PENDING", remainingMinutes: 300 }] })], { m1: dayWindows(["2026-10-12"]) });

    const op = result.operations[0];
    expect(op.segments).toEqual([
      { start: T("2026-10-12T05:00:00.000Z"), end: T("2026-10-12T09:00:00.000Z") },
      { start: T("2026-10-12T09:30:00.000Z"), end: T("2026-10-12T10:30:00.000Z") },
    ]);
    expect(op.end).toEqual(T("2026-10-12T10:30:00.000Z"));
  });

  it("aynı iş emrinin operasyonları seq sırasıyla, öncülü bitmeden başlamadan zincirlenir", () => {
    const result = run(
      [
        wo({
          id: "wo1",
          operations: [
            { id: "op2", seq: 2, name: "Finiş", machineId: "m2", status: "PENDING", remainingMinutes: 30 },
            { id: "op1", seq: 1, name: "Kaba", machineId: "m1", status: "PENDING", remainingMinutes: 120 },
          ],
        }),
      ],
      { m1: dayWindows(["2026-10-12"]), m2: dayWindows(["2026-10-12"]) },
    );

    const [first, second] = result.operations;
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.start.getTime()).toBeGreaterThanOrEqual(first.end.getTime());
    expect(second.start).toEqual(T("2026-10-12T07:00:00.000Z"));
  });

  it("aynı makinede iki iş emri çakışmaz; sevk kuralı sırayı belirler (EDD: erken termin önce)", () => {
    const early = wo({ id: "early", dueDate: T("2026-10-13T00:00:00.000Z"), operations: [{ id: "e1", seq: 1, name: "A", machineId: "m1", status: "PENDING", remainingMinutes: 60 }] });
    const late = wo({ id: "late", dueDate: T("2026-10-18T00:00:00.000Z"), createdAt: T("2026-09-01T00:00:00.000Z"), operations: [{ id: "l1", seq: 1, name: "B", machineId: "m1", status: "PENDING", remainingMinutes: 60 }] });

    const edd = run([late, early], { m1: dayWindows(["2026-10-12"]) }, "EDD");
    expect(edd.operations.map((o) => o.woNo)).toEqual(["EARLY", "LATE"]);
    expect(edd.operations[1].start).toEqual(edd.operations[0].end);

    const fifo = run([late, early], { m1: dayWindows(["2026-10-12"]) }, "FIFO");
    expect(fifo.operations.map((o) => o.woNo)).toEqual(["LATE", "EARLY"]);
  });

  it("first-fit: kısa bir operasyon, daha önce bırakılmış boşluğa geri yerleşir", () => {
    // wo1 op1 on m1 (60'), then op2 on m2 (60') → m2 is idle 05:00–06:00.
    // wo2 (dispatched later) has a 30' op on m2 and should take that idle gap.
    const wo1 = wo({
      id: "wo1",
      dueDate: T("2026-10-13T00:00:00.000Z"),
      operations: [
        { id: "a1", seq: 1, name: "A", machineId: "m1", status: "PENDING", remainingMinutes: 60 },
        { id: "a2", seq: 2, name: "B", machineId: "m2", status: "PENDING", remainingMinutes: 60 },
      ],
    });
    const wo2 = wo({ id: "wo2", dueDate: T("2026-10-14T00:00:00.000Z"), operations: [{ id: "b1", seq: 1, name: "C", machineId: "m2", status: "PENDING", remainingMinutes: 30 }] });

    const result = run([wo1, wo2], { m1: dayWindows(["2026-10-12"]), m2: dayWindows(["2026-10-12"]) });
    const b1 = result.operations.find((o) => o.operationId === "b1")!;
    expect(b1.start).toEqual(T("2026-10-12T05:00:00.000Z"));
    expect(b1.end).toEqual(T("2026-10-12T05:30:00.000Z"));
  });

  it("boşluk yetersizse operasyon araya sıkıştırılmaz, bir sonraki uygun yere alınır", () => {
    const wo1 = wo({
      id: "wo1",
      dueDate: T("2026-10-13T00:00:00.000Z"),
      operations: [
        { id: "a1", seq: 1, name: "A", machineId: "m1", status: "PENDING", remainingMinutes: 60 },
        { id: "a2", seq: 2, name: "B", machineId: "m2", status: "PENDING", remainingMinutes: 60 },
      ],
    });
    // 90' does not fit the 60' gap before a2 on m2 → must start after a2 ends (07:00Z).
    const wo2 = wo({ id: "wo2", dueDate: T("2026-10-14T00:00:00.000Z"), operations: [{ id: "b1", seq: 1, name: "C", machineId: "m2", status: "PENDING", remainingMinutes: 90 }] });

    const result = run([wo1, wo2], { m1: dayWindows(["2026-10-12"]), m2: dayWindows(["2026-10-12"]) });
    const b1 = result.operations.find((o) => o.operationId === "b1")!;
    expect(b1.start).toEqual(T("2026-10-12T07:00:00.000Z"));
    expect(b1.end).toEqual(T("2026-10-12T08:30:00.000Z"));
  });

  it("çalışmayan güne taşan iş bir sonraki çalışma gününe devam eder ve gecikme dakikası hesaplanır", () => {
    // Only Monday and Wednesday work; 8.5h/day. A 10h op finishes Wednesday 06:30Z.
    const windows = dayWindows(["2026-10-12", "2026-10-14"]);
    const result = run(
      [wo({ id: "wo1", dueDate: T("2026-10-13T00:00:00.000Z"), operations: [{ id: "op1", seq: 1, name: "A", machineId: "m1", status: "PENDING", remainingMinutes: 600 }] })],
      { m1: windows },
    );

    expect(result.operations[0].end).toEqual(T("2026-10-14T06:30:00.000Z"));
    expect(result.workOrders[0].late).toBe(true);
    expect(result.workOrders[0].latenessMinutes).toBe(30 * 60 + 30);
  });

  it("açık nedenlerle planlanamayan operasyonları raporlar ve zincirin devamını PREDECESSOR_UNSCHEDULED yapar", () => {
    const result = run(
      [
        wo({ id: "noMachine", operations: [{ id: "n1", seq: 1, name: "A", machineId: null, status: "PENDING", remainingMinutes: 10 }, { id: "n2", seq: 2, name: "B", machineId: "m1", status: "PENDING", remainingMinutes: 10 }] }),
        wo({ id: "noStd", operations: [{ id: "s1", seq: 1, name: "A", machineId: "m1", status: "PENDING", remainingMinutes: null }] }),
        wo({ id: "noCap", operations: [{ id: "c1", seq: 1, name: "A", machineId: "m2", status: "PENDING", remainingMinutes: 10 }] }),
        wo({ id: "tooLong", operations: [{ id: "t1", seq: 1, name: "A", machineId: "m1", status: "PENDING", remainingMinutes: 8 * 60 + 31 }] }),
        wo({ id: "empty" }),
      ],
      { m1: dayWindows(["2026-10-12"]) },
    );

    const reasons = Object.fromEntries(result.unscheduled.map((u) => [u.operationId || u.woNo, u.reason]));
    expect(reasons).toEqual({
      n1: "NO_MACHINE",
      n2: "PREDECESSOR_UNSCHEDULED",
      s1: "NO_STANDARD_MINUTES",
      c1: "NO_MACHINE_CAPACITY",
      t1: "HORIZON_EXCEEDED",
      EMPTY: "NO_OPERATIONS",
    });
    expect(result.operations).toEqual([]);
    expect(result.workOrders.find((w) => w.woNo === "TOOLONG")).toMatchObject({ plannedStart: null, plannedEnd: null, late: false, unscheduledOps: 1 });
  });

  it("çalışan (IN_PROGRESS) operasyon ufuk başında sabitlenir ve sevk sırası ne olursa olsun önce yerleşir", () => {
    const running = wo({
      id: "running",
      dueDate: T("2026-10-18T00:00:00.000Z"),
      operations: [{ id: "r1", seq: 1, name: "A", machineId: "m1", status: "IN_PROGRESS", remainingMinutes: 120 }],
    });
    const urgent = wo({ id: "urgent", dueDate: T("2026-10-12T12:00:00.000Z"), operations: [{ id: "u1", seq: 1, name: "B", machineId: "m1", status: "PENDING", remainingMinutes: 60 }] });

    const result = run([urgent, running], { m1: dayWindows(["2026-10-12"]) }, "EDD");
    const r1 = result.operations.find((o) => o.operationId === "r1")!;
    const u1 = result.operations.find((o) => o.operationId === "u1")!;
    expect(r1.pinned).toBe(true);
    expect(r1.start).toEqual(H_START);
    expect(u1.start).toEqual(r1.end);
  });

  it("tamamlanmış operasyonlar atlanır, kalan süresi sıfır olan operasyon zinciri bozmadan sıfır uzunlukta işaretlenir", () => {
    const result = run(
      [
        wo({
          id: "wo1",
          operations: [
            { id: "d1", seq: 1, name: "Done", machineId: "m1", status: "COMPLETED", remainingMinutes: 100 },
            { id: "z1", seq: 2, name: "Zero", machineId: "m1", status: "PENDING", remainingMinutes: 0 },
            { id: "p1", seq: 3, name: "Pending", machineId: "m1", status: "PENDING", remainingMinutes: 30 },
          ],
        }),
      ],
      { m1: dayWindows(["2026-10-12"]) },
    );

    expect(result.operations.map((o) => o.operationId)).toEqual(["z1", "p1"]);
    expect(result.operations[0].minutes).toBe(0);
    expect(result.operations[1].start).toEqual(H_START);
  });
});

describe("sortByDispatchRule", () => {
  const a = wo({ id: "a", priority: 3, dueDate: T("2026-10-15T00:00:00.000Z"), createdAt: T("2026-10-02T00:00:00.000Z"), operations: [{ id: "a1", seq: 1, name: "", machineId: "m1", status: "PENDING", remainingMinutes: 200 }] });
  const b = wo({ id: "b", priority: 1, dueDate: T("2026-10-16T00:00:00.000Z"), createdAt: T("2026-10-01T00:00:00.000Z"), operations: [{ id: "b1", seq: 1, name: "", machineId: "m1", status: "PENDING", remainingMinutes: 50 }] });

  it("EDD termin, PRIORITY düşük sayı (daha acil), FIFO oluşturma, SPT en kısa toplam süre", () => {
    expect(sortByDispatchRule([a, b], "EDD").map((w) => w.id)).toEqual(["a", "b"]);
    expect(sortByDispatchRule([a, b], "PRIORITY").map((w) => w.id)).toEqual(["b", "a"]);
    expect(sortByDispatchRule([a, b], "FIFO").map((w) => w.id)).toEqual(["b", "a"]);
    expect(sortByDispatchRule([a, b], "SPT").map((w) => w.id)).toEqual(["b", "a"]);
  });
});
