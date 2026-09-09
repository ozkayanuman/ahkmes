-- AHK-006: Onay hedefinin talep anındaki değişmez bağlamı ve kanıt özeti.
ALTER TABLE "ApprovalRequest" ADD COLUMN "requestSnapshot" JSONB;
ALTER TABLE "ApprovalRequest" ADD COLUMN "requestHash" TEXT;
