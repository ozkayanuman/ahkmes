-- AlterTable: Unit'ten Digital Twin konumu kaldırılıyor (hiyerarşi ile dijital ikiz ayrıştırılıyor)
ALTER TABLE "Unit" DROP COLUMN "posX";
ALTER TABLE "Unit" DROP COLUMN "posY";

-- AlterTable: Digital Twin konumu artık doğrudan Machine'de
ALTER TABLE "Machine" ADD COLUMN "posX" DOUBLE PRECISION;
ALTER TABLE "Machine" ADD COLUMN "posY" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "MachineConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromMachineId" TEXT NOT NULL,
    "toMachineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineConnection_tenantId_idx" ON "MachineConnection"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineConnection_fromMachineId_toMachineId_key" ON "MachineConnection"("fromMachineId", "toMachineId");

-- AddForeignKey
ALTER TABLE "MachineConnection" ADD CONSTRAINT "MachineConnection_fromMachineId_fkey" FOREIGN KEY ("fromMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineConnection" ADD CONSTRAINT "MachineConnection_toMachineId_fkey" FOREIGN KEY ("toMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
