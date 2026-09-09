import { Prisma } from "@prisma/client";
import { getTenantId } from "../common/tenant-context";

type JsonRecord = Record<string, unknown>;

/**
 * AHK-017 çekirdeği: tüm modeller için `tenantId` filtresini/damgasını
 * "hatırlanması gereken bir kural" olmaktan çıkarıp Prisma katmanında
 * zorunlu hale getirir. `getTenantId()` boşsa (login/refresh/machine-key gibi
 * kimliğin henüz bilinmediği adımlar) sorgu DOKUNULMADAN geçer — bu adımlar
 * bilerek tenant-scope dışıdır (bkz. auth.service.ts#login, machine-key.guard.ts).
 *
 * Bilinen sınır: `connect`/`connectOrCreate.where` ile bağlanan id'ler burada
 * doğrulanmaz — çağıran kodun o id'yi zaten tenant-scoped bir okumadan (guard
 * edilmiş findFirst/findUnique) elde ettiği varsayılır. Ham `$queryRaw`/
 * `$executeRaw` çağrıları da bu extension'ın kapsamı dışındadır, ayrıca
 * denetlenmiştir (bkz. AHK-017 plan notu).
 */

export class TenantScopeViolationError extends Error {
  constructor(model: string, op: string, expected: string, actual: unknown) {
    super(`Tenant scope ihlali: ${model}.${op} — beklenen tenant ${expected}, gelen ${String(actual)}`);
    this.name = "TenantScopeViolationError";
  }
}

const MODELS_BY_NAME = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

function uncapitalize(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function hasTenantField(modelName: string): boolean {
  return MODELS_BY_NAME.get(modelName)?.fields.some((f) => f.name === "tenantId") ?? false;
}

export const TENANT_SCOPED_MODELS = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => hasTenantField(m.name)).map((m) => uncapitalize(m.name)),
);

function relationFields(modelName: string) {
  return (MODELS_BY_NAME.get(modelName)?.fields ?? []).filter((f) => f.kind === "object" && f.relationName);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `where` içine tenantId ekler; mevcut bir tenantId varsa context ile uyuşmuyorsa fırlatır. */
export function mergeTenantWhere(modelName: string, where: unknown, tenantId: string): JsonRecord {
  const w: JsonRecord = isRecord(where) ? { ...where } : {};
  if (w.tenantId !== undefined && w.tenantId !== tenantId) {
    throw new TenantScopeViolationError(modelName, "where", tenantId, w.tenantId);
  }
  w.tenantId = tenantId;
  return w;
}

/**
 * create/createMany.data kaydını ve iç içe (nested) tenant-scoped
 * create/createMany/connectOrCreate/upsert.create ilişkilerini tenantId ile
 * damgalar. Recursive — çok seviyeli nested write'ları kapsar.
 */
export function stampRecord(modelName: string, record: unknown, tenantId: string): unknown {
  if (!isRecord(record)) return record;
  const stamped: JsonRecord = { ...record };

  if (hasTenantField(modelName)) {
    if (stamped.tenantId !== undefined && stamped.tenantId !== tenantId) {
      throw new TenantScopeViolationError(modelName, "create", tenantId, stamped.tenantId);
    }
    stamped.tenantId = tenantId;
  }

  for (const field of relationFields(modelName)) {
    const nested = stamped[field.name];
    if (!isRecord(nested)) continue;
    const relatedModel = field.type;
    if (!hasTenantField(relatedModel)) continue;

    if ("create" in nested) {
      nested.create = Array.isArray(nested.create)
        ? nested.create.map((r) => stampRecord(relatedModel, r, tenantId))
        : stampRecord(relatedModel, nested.create, tenantId);
    }
    if (isRecord(nested.createMany) && Array.isArray(nested.createMany.data)) {
      nested.createMany.data = nested.createMany.data.map((r) => stampRecord(relatedModel, r, tenantId));
    }
    for (const key of ["connectOrCreate", "upsert"] as const) {
      const entries = nested[key];
      if (entries === undefined) continue;
      const list = Array.isArray(entries) ? entries : [entries];
      for (const item of list) {
        if (isRecord(item) && "create" in item) item.create = stampRecord(relatedModel, item.create, tenantId);
      }
    }
  }
  return stamped;
}

const WHERE_SCOPED_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const CREATE_STAMPED_OPS = new Set(["create", "createManyAndReturn"]);

export function createTenantScopeExtension() {
  return Prisma.defineExtension({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(uncapitalize(model))) return query(args);
          const tenantId = getTenantId();
          if (!tenantId) return query(args);

          const a = args as JsonRecord;
          if (WHERE_SCOPED_OPS.has(operation)) {
            a.where = mergeTenantWhere(model, a.where, tenantId);
          }
          if (operation === "upsert") {
            a.create = stampRecord(model, a.create, tenantId);
          }
          if (CREATE_STAMPED_OPS.has(operation)) {
            a.data = stampRecord(model, a.data, tenantId);
          }
          if (operation === "createMany") {
            const data = a.data;
            a.data = Array.isArray(data) ? data.map((d) => stampRecord(model, d, tenantId)) : stampRecord(model, data, tenantId);
          }
          return query(a);
        },
      },
    },
  });
}
