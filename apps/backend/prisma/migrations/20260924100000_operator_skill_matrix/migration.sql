-- Cross-machine operator skill/competency matrix — additional to, and
-- independent of, the single-machine binary OperatorMachineQualification
-- gate added earlier. Reuses OperatorMachineQualificationStatus for
-- OperatorSkill.status (same ACTIVE/REVOKED lifecycle).
CREATE TYPE "OperatorSkillLevel" AS ENUM ('TRAINEE', 'QUALIFIED', 'EXPERT');

CREATE TABLE "Skill" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Skill_tenantId_code_key" UNIQUE ("tenantId", "code")
);

CREATE INDEX "Skill_tenantId_idx" ON "Skill"("tenantId");

CREATE TABLE "OperatorSkill" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "level" "OperatorSkillLevel" NOT NULL,
  "status" "OperatorMachineQualificationStatus" NOT NULL DEFAULT 'ACTIVE',
  "certificateReference" TEXT,
  "expiresAt" TIMESTAMP(3),
  "grantedById" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OperatorSkill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatorSkill_tenantId_operatorId_skillId_key" UNIQUE ("tenantId", "operatorId", "skillId"),
  CONSTRAINT "OperatorSkill_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatorSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OperatorSkill_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatorSkill_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OperatorSkill_tenantId_skillId_status_expiresAt_idx"
  ON "OperatorSkill"("tenantId", "skillId", "status", "expiresAt");

CREATE TABLE "MachineRequiredSkill" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "minLevel" "OperatorSkillLevel" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MachineRequiredSkill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MachineRequiredSkill_tenantId_machineId_skillId_key" UNIQUE ("tenantId", "machineId", "skillId"),
  CONSTRAINT "MachineRequiredSkill_machineId_tenantId_fkey" FOREIGN KEY ("machineId", "tenantId") REFERENCES "Machine"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MachineRequiredSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MachineRequiredSkill_tenantId_machineId_idx" ON "MachineRequiredSkill"("tenantId", "machineId");
