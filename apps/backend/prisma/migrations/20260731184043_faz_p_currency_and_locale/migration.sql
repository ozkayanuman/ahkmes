-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'TRY';

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'TRY';

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'TRY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'tr',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul';
