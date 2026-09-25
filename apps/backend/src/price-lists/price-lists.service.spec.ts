import { NotFoundException } from "@nestjs/common";
import { PriceListsService } from "./price-lists.service";

describe("PriceListsService", () => {
  it("creates a customer-specific price list after verifying the customer belongs to the tenant", async () => {
    const prisma: any = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: "cust-a", tenantId: "tenant-1" }) },
      priceList: { create: jest.fn().mockResolvedValue({ id: "pl-1" }) },
    };
    const service = new PriceListsService(prisma);

    await service.createPriceList("tenant-1", { name: "VIP", currency: "try", customerId: "cust-a" });

    expect(prisma.customer.findFirst).toHaveBeenCalledWith({ where: { id: "cust-a", tenantId: "tenant-1" } });
    expect(prisma.priceList.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-1", name: "VIP", currency: "TRY", customerId: "cust-a" }),
    }));
  });

  it("rejects a price list for a customer outside the tenant", async () => {
    const prisma: any = { customer: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PriceListsService(prisma);

    await expect(service.createPriceList("tenant-1", { name: "VIP", currency: "TRY", customerId: "foreign" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("upserts a line only for a part that belongs to the tenant", async () => {
    const prisma: any = {
      priceList: { findFirst: jest.fn().mockResolvedValue({ id: "pl-1", tenantId: "tenant-1" }) },
      part: { findFirst: jest.fn().mockResolvedValue({ id: "part-a", tenantId: "tenant-1" }) },
      priceListLine: { upsert: jest.fn().mockResolvedValue({ id: "line-1" }) },
    };
    const service = new PriceListsService(prisma);

    await service.upsertLine("tenant-1", "pl-1", { partId: "part-a", unitPrice: 125.5, discountPercent: 10 });

    expect(prisma.priceListLine.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { priceListId_partId: { priceListId: "pl-1", partId: "part-a" } },
      create: expect.objectContaining({ unitPrice: 125.5, discountPercent: 10 }),
    }));
  });

  describe("resolve", () => {
    it("prefers a customer-specific list over the default list when both have the part", async () => {
      const prisma: any = {
        priceList: {
          findMany: jest.fn().mockResolvedValue([
            { id: "default-list", customerId: null },
            { id: "customer-list", customerId: "cust-a" },
          ]),
        },
        priceListLine: {
          findFirst: jest.fn()
            .mockResolvedValueOnce({ unitPrice: 90, discountPercent: 5 }) // customer-list, checked first
        },
      };
      const service = new PriceListsService(prisma);

      const result = await service.resolve("tenant-1", "part-a", "cust-a");

      expect(result).toEqual({ priceListId: "customer-list", customerSpecific: true, unitPrice: 90, discountPercent: 5 });
      expect(prisma.priceListLine.findFirst).toHaveBeenCalledTimes(1);
    });

    it("falls back to the default list when the customer list has no line for the part", async () => {
      const prisma: any = {
        priceList: {
          findMany: jest.fn().mockResolvedValue([
            { id: "default-list", customerId: null },
            { id: "customer-list", customerId: "cust-a" },
          ]),
        },
        priceListLine: {
          findFirst: jest.fn()
            .mockResolvedValueOnce(null) // customer-list: no match
            .mockResolvedValueOnce({ unitPrice: 100, discountPercent: null }), // default-list: match
        },
      };
      const service = new PriceListsService(prisma);

      const result = await service.resolve("tenant-1", "part-a", "cust-a");

      expect(result).toEqual({ priceListId: "default-list", customerSpecific: false, unitPrice: 100, discountPercent: null });
    });

    it("returns null when no active list has the part", async () => {
      const prisma: any = {
        priceList: { findMany: jest.fn().mockResolvedValue([]) },
        priceListLine: { findFirst: jest.fn() },
      };
      const service = new PriceListsService(prisma);

      const result = await service.resolve("tenant-1", "part-a");

      expect(result).toBeNull();
      expect(prisma.priceListLine.findFirst).not.toHaveBeenCalled();
    });
  });
});
