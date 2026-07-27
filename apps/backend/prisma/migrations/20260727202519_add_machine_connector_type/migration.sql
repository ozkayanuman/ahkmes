-- CreateEnum
CREATE TYPE "MachineConnectorType" AS ENUM ('MANUAL', 'OPC_UA', 'M80');

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "connectorConfig" JSONB,
ADD COLUMN     "connectorType" "MachineConnectorType" NOT NULL DEFAULT 'MANUAL';
