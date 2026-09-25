-- Price list / discount management (ERP standalone-sellability gap).
-- customerId null on PriceList means a general/default list; a
-- customer-specific list takes priority when both match a part.
CREATE TABLE "PriceList" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "customerId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceList_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PriceList_tenantId_customerId_isActive_idx" ON "PriceList"("tenantId", "customerId", "isActive");

CREATE TABLE "PriceListLine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "discountPercent" DECIMAL(5,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriceListLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceListLine_priceListId_partId_key" UNIQUE ("priceListId", "partId"),
  CONSTRAINT "PriceListLine_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PriceListLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PriceListLine_tenantId_idx" ON "PriceListLine"("tenantId");
