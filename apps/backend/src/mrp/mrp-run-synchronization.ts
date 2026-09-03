import { Injectable } from "@nestjs/common";

export type MrpRunSynchronizationPoint = "SNAPSHOT_ESTABLISHED" | "PUBLICATION_STAGED";

/**
 * Deterministic test seam for concurrency evidence. Production deliberately
 * performs no waiting; E2E tests replace this method with explicit barriers.
 */
@Injectable()
export class MrpRunSynchronization {
  async reached(_point: MrpRunSynchronizationPoint, _runId: string): Promise<void> {}
}
