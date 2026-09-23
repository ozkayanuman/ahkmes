-- Dispatch creation already posts stock. These nullable trace fields make the
-- physical hand-off and later customer receipt independently auditable without
-- changing the historical delivery or inventory-ledger semantics.
ALTER TABLE "Delivery"
  ADD COLUMN "carrierName" TEXT,
  ADD COLUMN "trackingReference" TEXT,
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveryProofReference" TEXT;
