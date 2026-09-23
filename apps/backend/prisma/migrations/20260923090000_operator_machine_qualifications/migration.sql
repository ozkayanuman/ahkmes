-- Opt-in machine policy keeps existing installations non-blocking until an
-- administrator explicitly enables qualification enforcement per machine.
ALTER TABLE "Machine"
  ADD COLUMN "operatorQualificationRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "OperatorMachineQualificationStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "OperatorMachineQualification" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "status" "OperatorMachineQualificationStatus" NOT NULL DEFAULT 'ACTIVE',
  "qualificationReference" TEXT,
  "expiresAt" TIMESTAMP(3),
  "grantedById" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OperatorMachineQualification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatorMachineQualification_tenantId_machineId_operatorId_key" UNIQUE ("tenantId", "machineId", "operatorId"),
  CONSTRAINT "OperatorMachineQualification_machineId_tenantId_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OperatorMachineQualification_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatorMachineQualification_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatorMachineQualification_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OperatorMachineQualification_tenantId_machineId_status_expiresAt_idx"
  ON "OperatorMachineQualification"("tenantId", "machineId", "status", "expiresAt");
