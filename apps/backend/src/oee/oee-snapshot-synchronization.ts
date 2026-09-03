import { Injectable } from "@nestjs/common";

export type OeeSnapshotSynchronizationPoint = "SNAPSHOT_ESTABLISHED";

/**
 * Deterministic test seam for proving one OEE fact snapshot. Production
 * deliberately does not wait here.
 */
@Injectable()
export class OeeSnapshotSynchronization {
  async reached(_point: OeeSnapshotSynchronizationPoint): Promise<void> {}
}
