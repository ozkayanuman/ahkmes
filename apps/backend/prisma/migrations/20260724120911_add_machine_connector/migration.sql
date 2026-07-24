-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "activeWorkOrderId" TEXT,
ADD COLUMN     "connectorKeyHash" TEXT,
ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "lastStatus" TEXT;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_activeWorkOrderId_fkey" FOREIGN KEY ("activeWorkOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
