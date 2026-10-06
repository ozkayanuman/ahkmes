/**
 * MRP II finite-capacity scheduler — pure, deterministic, Prisma-free.
 *
 * Model: forward list scheduling with first-fit placement.
 *  - Work orders are dispatched in rule order (EDD / PRIORITY / FIFO / SPT).
 *  - Operations of a work order run strictly in `seq` order; an operation may
 *    not start before its predecessor ends.
 *  - A machine executes one operation at a time. An operation may be
 *    interrupted only by non-working time (shift end, break, non-working
 *    day) and resumes in the next working window of the same machine; it is
 *    never interleaved with another operation.
 *  - Placement is first-fit: the earliest gap in the machine's working time
 *    (after the earliest-start constraint) that can hold the whole remaining
 *    duration across continuable windows wins. Gaps left by earlier
 *    placements are therefore reused by later, shorter operations.
 *  - Already-running operations (SETUP/IN_PROGRESS/PAUSED/REWORK) are placed
 *    first on their machine from the horizon start with their remaining
 *    minutes, so the plan never displaces live work.
 *
 * Out of scope (explicitly, see docs/CNC-V1-03R and the gap analysis):
 * alternate-machine assignment, setup-time matrices, lot splitting and
 * optimisation beyond the dispatch rule. Everything unplaceable comes back
 * with an explicit reason instead of a silent omission.
 */

export type SchedulingDispatchRule = "EDD" | "PRIORITY" | "FIFO" | "SPT";

export type UnscheduledReason =
  | "NO_OPERATIONS"
  | "NO_MACHINE"
  | "NO_STANDARD_MINUTES"
  | "NO_MACHINE_CAPACITY"
  | "PREDECESSOR_UNSCHEDULED"
  | "HORIZON_EXCEEDED";

export interface SchedulerOperation {
  id: string;
  seq: number;
  name: string;
  machineId: string | null;
  status: string;
  /** Minutes still to be executed; null when the operation has no standard. */
  remainingMinutes: number | null;
}

export interface SchedulerWorkOrder {
  id: string;
  woNo: string;
  priority: number;
  dueDate: Date;
  createdAt: Date;
  operations: SchedulerOperation[];
}

/** A machine working window with breaks already removed; [start, end). */
export interface WorkingWindow {
  start: Date;
  end: Date;
}

export interface SchedulerInput {
  horizonStart: Date;
  horizonEnd: Date;
  dispatchRule: SchedulingDispatchRule;
  workOrders: SchedulerWorkOrder[];
  /** Machines absent from the map have no capacity in the horizon. */
  windowsByMachine: Map<string, WorkingWindow[]>;
  machineNames: Map<string, string>;
}

export interface ScheduledSegment {
  start: Date;
  end: Date;
}

export interface ScheduledOperation {
  workOrderId: string;
  woNo: string;
  operationId: string;
  seq: number;
  name: string;
  machineId: string;
  machineName: string;
  minutes: number;
  start: Date;
  end: Date;
  segments: ScheduledSegment[];
  /** True when the operation was already running and was pinned, not dispatched. */
  pinned: boolean;
}

export interface UnscheduledOperation {
  workOrderId: string;
  woNo: string;
  operationId: string;
  seq: number;
  name: string;
  machineId: string | null;
  reason: UnscheduledReason;
}

export interface ScheduledWorkOrder {
  workOrderId: string;
  woNo: string;
  dueDate: Date;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  scheduledOps: number;
  unscheduledOps: number;
  late: boolean;
  latenessMinutes: number;
}

export interface SchedulerResult {
  workOrders: ScheduledWorkOrder[];
  operations: ScheduledOperation[];
  unscheduled: UnscheduledOperation[];
}

const ACTIVE_STATUSES = new Set(["SETUP", "IN_PROGRESS", "PAUSED", "REWORK"]);
const DONE_STATUSES = new Set(["COMPLETED", "SKIPPED"]);

interface BusyInterval {
  start: number;
  end: number;
}

class MachineTimeline {
  private readonly busy: BusyInterval[] = [];
  constructor(private readonly windows: WorkingWindow[]) {}

  hasCapacity() {
    return this.windows.length > 0;
  }

  /**
   * First-fit placement of `durationMs` starting no earlier than `earliest`.
   * Returns the occupied segments or null when the horizon cannot hold it.
   */
  place(earliest: number, durationMs: number): ScheduledSegment[] | null {
    const free = this.freeSegments(earliest);
    for (let i = 0; i < free.length; i += 1) {
      const segments: ScheduledSegment[] = [];
      let remaining = durationMs;
      let j = i;
      while (j < free.length && remaining > 0) {
        const seg = free[j];
        // Continuation across windows is allowed only through non-working
        // time, never across another operation's busy interval.
        if (j > i && this.busyBetween(free[j - 1].end, seg.start)) break;
        const take = Math.min(remaining, seg.end - seg.start);
        segments.push({ start: new Date(seg.start), end: new Date(seg.start + take) });
        remaining -= take;
        j += 1;
      }
      if (remaining <= 0) {
        for (const s of segments) this.insertBusy(s.start.getTime(), s.end.getTime());
        return segments;
      }
    }
    return null;
  }

  private busyBetween(from: number, to: number) {
    return this.busy.some((b) => b.start < to && b.end > from);
  }

  private insertBusy(start: number, end: number) {
    const idx = this.busy.findIndex((b) => b.start > start);
    if (idx === -1) this.busy.push({ start, end });
    else this.busy.splice(idx, 0, { start, end });
  }

  /** Working time minus busy time, clipped at `earliest`, as [start,end) ms pairs. */
  private freeSegments(earliest: number): BusyInterval[] {
    const out: BusyInterval[] = [];
    for (const w of this.windows) {
      let cursor = Math.max(w.start.getTime(), earliest);
      const end = w.end.getTime();
      if (cursor >= end) continue;
      for (const b of this.busy) {
        if (b.end <= cursor) continue;
        if (b.start >= end) break;
        if (b.start > cursor) out.push({ start: cursor, end: b.start });
        cursor = Math.max(cursor, b.end);
        if (cursor >= end) break;
      }
      if (cursor < end) out.push({ start: cursor, end });
    }
    return out;
  }
}

function minutesToMs(minutes: number) {
  return Math.round(minutes * 60_000);
}

function totalRemaining(wo: SchedulerWorkOrder) {
  return wo.operations.reduce((sum, op) => sum + (DONE_STATUSES.has(op.status) ? 0 : op.remainingMinutes ?? 0), 0);
}

export function sortByDispatchRule(workOrders: SchedulerWorkOrder[], rule: SchedulingDispatchRule) {
  const byCreated = (a: SchedulerWorkOrder, b: SchedulerWorkOrder) => a.createdAt.getTime() - b.createdAt.getTime() || a.woNo.localeCompare(b.woNo);
  const byDue = (a: SchedulerWorkOrder, b: SchedulerWorkOrder) => a.dueDate.getTime() - b.dueDate.getTime();
  const byPriority = (a: SchedulerWorkOrder, b: SchedulerWorkOrder) => a.priority - b.priority;
  const sorted = [...workOrders];
  switch (rule) {
    case "EDD":
      return sorted.sort((a, b) => byDue(a, b) || byPriority(a, b) || byCreated(a, b));
    case "PRIORITY":
      return sorted.sort((a, b) => byPriority(a, b) || byDue(a, b) || byCreated(a, b));
    case "SPT":
      return sorted.sort((a, b) => totalRemaining(a) - totalRemaining(b) || byDue(a, b) || byCreated(a, b));
    case "FIFO":
    default:
      return sorted.sort((a, b) => byCreated(a, b) || byDue(a, b));
  }
}

export function runFiniteScheduler(input: SchedulerInput): SchedulerResult {
  const horizonStart = input.horizonStart.getTime();
  const horizonEnd = input.horizonEnd.getTime();
  const timelines = new Map<string, MachineTimeline>();
  for (const [machineId, windows] of input.windowsByMachine) {
    const clipped = windows
      .filter((w) => w.end.getTime() > horizonStart && w.start.getTime() < horizonEnd)
      .map((w) => ({ start: new Date(Math.max(w.start.getTime(), horizonStart)), end: new Date(Math.min(w.end.getTime(), horizonEnd)) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (clipped.length > 0) timelines.set(machineId, new MachineTimeline(clipped));
  }

  const operations: ScheduledOperation[] = [];
  const unscheduled: UnscheduledOperation[] = [];
  /** Operation end time per work order, carried as the next operation's earliest start. */
  const lastEndByWo = new Map<string, number>();
  const brokenChain = new Set<string>();

  const machineName = (id: string) => input.machineNames.get(id) ?? id;

  const placeOperation = (wo: SchedulerWorkOrder, op: SchedulerOperation, pinned: boolean) => {
    if (brokenChain.has(wo.id)) {
      unscheduled.push({ workOrderId: wo.id, woNo: wo.woNo, operationId: op.id, seq: op.seq, name: op.name, machineId: op.machineId, reason: "PREDECESSOR_UNSCHEDULED" });
      return;
    }
    const fail = (reason: UnscheduledReason) => {
      brokenChain.add(wo.id);
      unscheduled.push({ workOrderId: wo.id, woNo: wo.woNo, operationId: op.id, seq: op.seq, name: op.name, machineId: op.machineId, reason });
    };
    if (!op.machineId) return fail("NO_MACHINE");
    if (op.remainingMinutes === null) return fail("NO_STANDARD_MINUTES");
    const timeline = timelines.get(op.machineId);
    if (!timeline || !timeline.hasCapacity()) return fail("NO_MACHINE_CAPACITY");
    const earliest = Math.max(horizonStart, lastEndByWo.get(wo.id) ?? horizonStart);
    if (op.remainingMinutes <= 0) {
      // Nothing left to run: zero-length marker at the earliest start keeps the chain intact.
      lastEndByWo.set(wo.id, earliest);
      operations.push({ workOrderId: wo.id, woNo: wo.woNo, operationId: op.id, seq: op.seq, name: op.name, machineId: op.machineId, machineName: machineName(op.machineId), minutes: 0, start: new Date(earliest), end: new Date(earliest), segments: [], pinned });
      return;
    }
    const segments = timeline.place(earliest, minutesToMs(op.remainingMinutes));
    if (!segments) return fail("HORIZON_EXCEEDED");
    const start = segments[0].start;
    const end = segments[segments.length - 1].end;
    lastEndByWo.set(wo.id, end.getTime());
    operations.push({ workOrderId: wo.id, woNo: wo.woNo, operationId: op.id, seq: op.seq, name: op.name, machineId: op.machineId, machineName: machineName(op.machineId), minutes: op.remainingMinutes, start, end, segments, pinned });
  };

  const ordered = sortByDispatchRule(input.workOrders, input.dispatchRule).map((wo) => ({
    ...wo,
    operations: [...wo.operations].sort((a, b) => a.seq - b.seq),
  }));

  // Pass 1: pin live operations so dispatch never displaces running work.
  for (const wo of ordered) {
    for (const op of wo.operations) {
      if (ACTIVE_STATUSES.has(op.status)) placeOperation(wo, op, true);
    }
  }

  // Pass 2: dispatch the remaining operations in rule order.
  const woRows: ScheduledWorkOrder[] = [];
  for (const wo of ordered) {
    const pending = wo.operations.filter((op) => !DONE_STATUSES.has(op.status) && !ACTIVE_STATUSES.has(op.status));
    if (wo.operations.length === 0) {
      unscheduled.push({ workOrderId: wo.id, woNo: wo.woNo, operationId: "", seq: 0, name: "", machineId: null, reason: "NO_OPERATIONS" });
    }
    for (const op of pending) placeOperation(wo, op, false);

    const mine = operations.filter((o) => o.workOrderId === wo.id);
    const unmine = unscheduled.filter((u) => u.workOrderId === wo.id);
    const plannedStart = mine.length > 0 ? new Date(Math.min(...mine.map((o) => o.start.getTime()))) : null;
    const plannedEnd = mine.length > 0 ? new Date(Math.max(...mine.map((o) => o.end.getTime()))) : null;
    const latenessMs = plannedEnd ? plannedEnd.getTime() - wo.dueDate.getTime() : 0;
    woRows.push({
      workOrderId: wo.id,
      woNo: wo.woNo,
      dueDate: wo.dueDate,
      plannedStart,
      plannedEnd,
      scheduledOps: mine.length,
      unscheduledOps: unmine.length,
      late: latenessMs > 0,
      latenessMinutes: latenessMs > 0 ? Math.round(latenessMs / 60_000) : 0,
    });
  }

  return { workOrders: woRows, operations, unscheduled };
}
