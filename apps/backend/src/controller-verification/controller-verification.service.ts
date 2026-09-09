import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AppException } from "../common/app-exception";
import { PrismaService } from "../prisma/prisma.service";

type Db = PrismaService | Prisma.TransactionClient;
type Verification = "MATCH" | "MISMATCH" | "UNVERIFIED" | "STALE" | "UNSUPPORTED";

export interface ControllerVerificationResult {
  required: boolean;
  verification: Verification;
  reason?: "CNC_OFFLINE" | "CNC_DATA_STALE" | "CNC_PROGRAM_UNVERIFIED" | "CNC_PROGRAM_MISMATCH" | "CNC_ALARM_ACTIVE";
  expectedProgramIdentity?: string;
  observedProgramIdentity?: string | null;
  observation?: {
    ingestedAt: Date;
    connectionState: string;
    machineState: string;
    trustLevel: string;
    connectionGeneration: number;
    alarmCode: string | null;
    alarmText: string | null;
    capabilities: Record<string, boolean>;
  };
}

/**
 * CNC-V1-05's single server-side decision point. Controller data is evidence,
 * not a second MES state machine: this service only admits or rejects the
 * already canonical CNC-V1-04 start/resume transition.
 */
@Injectable()
export class ControllerVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async status(tenantId: string, machineId: string | undefined, expectedProgramIdentity: string | undefined, db: Db = this.prisma): Promise<ControllerVerificationResult> {
    if (!machineId || !expectedProgramIdentity) return { required: false, verification: "UNSUPPORTED" };
    const machine = await db.machine.findFirst({
      where: { id: machineId, tenantId },
      select: { controllerVerificationRequired: true, controllerFreshnessSeconds: true },
    });
    if (!machine || !machine.controllerVerificationRequired) return { required: false, verification: "UNSUPPORTED" };

    const observation = await db.machineControllerObservation.findFirst({
      where: { tenantId, machineId }, orderBy: [{ ingestedAt: "desc" }, { connectionGeneration: "desc" }],
    });
    if (!observation) return { required: true, verification: "UNVERIFIED", reason: "CNC_PROGRAM_UNVERIFIED", expectedProgramIdentity };
    const capabilities = (observation.capabilities && typeof observation.capabilities === "object" ? observation.capabilities : {}) as Record<string, boolean>;
    const base = {
      required: true,
      expectedProgramIdentity,
      observedProgramIdentity: observation.activeProgramIdentity,
      observation: {
        ingestedAt: observation.ingestedAt,
        connectionState: observation.connectionState,
        machineState: observation.machineState,
        trustLevel: observation.trustLevel,
        connectionGeneration: observation.connectionGeneration,
        alarmCode: observation.alarmCode,
        alarmText: observation.alarmText,
        capabilities,
      },
    } as const;

    if (observation.connectionState !== "ONLINE") return { ...base, verification: "UNVERIFIED", reason: "CNC_OFFLINE" };
    if (Date.now() - observation.ingestedAt.getTime() > machine.controllerFreshnessSeconds * 1000) return { ...base, verification: "STALE", reason: "CNC_DATA_STALE" };
    if (!capabilities.ACTIVE_PROGRAM_IDENTITY_READ) return { ...base, verification: "UNSUPPORTED", reason: "CNC_PROGRAM_UNVERIFIED" };
    if (observation.trustLevel === "SIMULATED" || observation.trustLevel === "CONFIGURED" || !observation.activeProgramIdentity) {
      return { ...base, verification: "UNVERIFIED", reason: "CNC_PROGRAM_UNVERIFIED" };
    }
    if (capabilities.ALARM_READ && observation.machineState === "ALARM") return { ...base, verification: "UNVERIFIED", reason: "CNC_ALARM_ACTIVE" };
    if (normalize(observation.activeProgramIdentity) !== normalize(expectedProgramIdentity)) return { ...base, verification: "MISMATCH", reason: "CNC_PROGRAM_MISMATCH" };
    return { ...base, verification: "MATCH" };
  }

  async assertOperationReady(tenantId: string, operation: { machineId: string | null; workOrder: { machineId: string | null }; ncProgramFileName: string | null }, db: Db): Promise<ControllerVerificationResult> {
    const result = await this.status(tenantId, operation.machineId ?? operation.workOrder.machineId ?? undefined, operation.ncProgramFileName ?? undefined, db);
    if (!result.required || result.verification === "MATCH") return result;
    const code = result.reason ?? "CNC_PROGRAM_UNVERIFIED";
    const message: Record<string, string> = {
      CNC_OFFLINE: "CNC controller is offline or has not supplied a current observation",
      CNC_DATA_STALE: "CNC controller observation is stale",
      CNC_PROGRAM_UNVERIFIED: "Active CNC program cannot be verified from a trusted controller observation",
      CNC_PROGRAM_MISMATCH: "Selected controller NC program does not match the released work-order snapshot",
      CNC_ALARM_ACTIVE: "CNC controller reports an active alarm",
    };
    throw new AppException(409, code, message[code]);
  }
}

function normalize(value: string) {
  return value.trim().replaceAll("\\", "/").split("/").pop()!.toLocaleLowerCase("en-US");
}
