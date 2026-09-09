import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { ProductEdition, ProductModule } from "@prisma/client";
import { editionAtLeast, getEntitlementModuleDefinition, PRODUCT_MODULE_CATALOG } from "@ahkmes/shared-types";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { PrismaService } from "../prisma/prisma.service";

const CATALOG = Object.values(ProductModule);

@Injectable()
export class PlatformModulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const configured = await this.prisma.tenantModuleEntitlement.findMany({ where: { tenantId } });
    const enabled = new Map(configured.map((item) => [item.module, item.isEnabled]));
    return CATALOG.map((module) => {
      const definition = getEntitlementModuleDefinition(module);
      if (!definition) throw new Error(`Missing entitlement catalogue definition: ${module}`);
      return {
        module,
        isEnabled: definition.requiredCore ? true : (enabled.get(module) ?? true),
        configured: enabled.has(module),
        suite: definition.suite,
        name: definition.name,
        description: definition.description,
        requiredCore: definition.requiredCore,
        tenantToggleable: definition.tenantToggleable,
        implementationStatus: definition.implementationStatus,
        canonicalModules: definition.canonicalModules,
        edition: PRODUCT_MODULE_CATALOG.find((entry) => entry.code === module)?.edition,
      };
    });
  }

  catalog() {
    return PRODUCT_MODULE_CATALOG;
  }

  async set(tenantId: string, userId: string, module: ProductModule, isEnabled: boolean) {
    const definition = getEntitlementModuleDefinition(module);
    if (!definition) throw new BadRequestException("Bilinmeyen ürün modülü");
    if (definition.requiredCore && !isEnabled) {
      throw new BadRequestException("Zorunlu Platform Core modülü kapatılamaz");
    }
    if (!definition.tenantToggleable) {
      throw new BadRequestException("Bu modül henüz tenant tarafından etkinleştirilebilir değildir");
    }
    if (isEnabled) {
      const catalogEntry = PRODUCT_MODULE_CATALOG.find((entry) => entry.code === module);
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { edition: true } });
      if (catalogEntry && !editionAtLeast(tenant.edition, catalogEntry.edition)) {
        throw new BadRequestException(`Bu modül ${catalogEntry.edition} lisans seviyesi gerektirir`);
      }
    }
    // updateMany's state predicate is the concurrency boundary: only the request
    // that really changes the persisted state may emit an audit event. Creation
    // races are resolved by the unique (tenantId,module) constraint and retried.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const changed = await tx.tenantModuleEntitlement.updateMany({
            where: { tenantId, module, isEnabled: { not: isEnabled } },
            data: { isEnabled },
          });
          if (changed.count === 1) {
            const entitlement = await tx.tenantModuleEntitlement.findUniqueOrThrow({
              where: { tenantId_module: { tenantId, module } },
            });
            await writeTransactionalAudit(tx, {
              tenantId,
              userId,
              entity: "tenant-module-entitlements",
              entityId: entitlement.id,
              action: "UPDATE",
              before: { tenantId, module, isEnabled: !isEnabled },
              after: entitlement,
            });
            return entitlement;
          }

          const current = await tx.tenantModuleEntitlement.findUnique({
            where: { tenantId_module: { tenantId, module } },
          });
          if (current) return current;

          const entitlement = await tx.tenantModuleEntitlement.create({
            data: { tenantId, module, isEnabled },
          });
          await writeTransactionalAudit(tx, {
            tenantId,
            userId,
            entity: "tenant-module-entitlements",
            entityId: entitlement.id,
            action: "CREATE",
            after: entitlement,
          });
          return entitlement;
        });
        return result;
      } catch (error) {
        // A concurrent first write can make create() hit the unique key. The
        // next attempt observes the winner and returns it without duplicate audit.
        if ((error as { code?: string }).code !== "P2002" || attempt === 2) throw error;
      }
    }
    throw new ConflictException("Modül durumu eşzamanlı güncellenemedi");
  }

  async getEdition(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { edition: true } });
    return tenant.edition;
  }

  async setEdition(tenantId: string, userId: string, edition: ProductEdition) {
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({ where: { id: tenantId }, data: { edition } });
      await writeTransactionalAudit(tx, {
        tenantId,
        userId,
        entity: "tenant",
        entityId: tenantId,
        action: "UPDATE",
        before: { edition: before.edition },
        after: { edition: updated.edition },
      });
      return updated;
    });
  }
}
