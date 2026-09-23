-- CNC-V1-10R: physical fixture check-in/check-out custody lifecycle.
ALTER TYPE "PhysicalFixtureStatus" ADD VALUE 'CHECKED_OUT';

CREATE TYPE "FixtureCustodyAction" AS ENUM ('CHECK_OUT', 'CHECK_IN');

CREATE TABLE "FixtureCustodyEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "physicalFixtureInstanceId" TEXT NOT NULL,
  "action" "FixtureCustodyAction" NOT NULL,
  "fromLocation" TEXT,
  "toLocation" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FixtureCustodyEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FixtureCustodyEvent_physicalFixtureInstanceId_fkey" FOREIGN KEY ("physicalFixtureInstanceId") REFERENCES "PhysicalFixtureInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "FixtureCustodyEvent_tenantId_physicalFixtureInstanceId_createdAt_idx"
  ON "FixtureCustodyEvent"("tenantId", "physicalFixtureInstanceId", "createdAt");
