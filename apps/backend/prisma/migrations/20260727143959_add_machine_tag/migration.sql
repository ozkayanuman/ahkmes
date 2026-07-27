-- CreateEnum
CREATE TYPE "MachineTagDataType" AS ENUM ('NUMBER', 'STRING', 'BOOLEAN');

-- CreateTable
CREATE TABLE "MachineTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "dataType" "MachineTagDataType" NOT NULL DEFAULT 'STRING',
    "lastValue" TEXT,
    "lastValueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineTag_tenantId_idx" ON "MachineTag"("tenantId");

-- CreateIndex
CREATE INDEX "MachineTag_machineId_idx" ON "MachineTag"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineTag_machineId_name_key" ON "MachineTag"("machineId", "name");

-- AddForeignKey
ALTER TABLE "MachineTag" ADD CONSTRAINT "MachineTag_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
