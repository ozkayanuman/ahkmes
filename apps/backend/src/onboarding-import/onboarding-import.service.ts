import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { InventoryMovementType, OnboardingImportStatus, Prisma, StockItemType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseCsv } from "../users/csv";
import { InventoryService } from "../inventory/inventory.service";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { sanitizeInstructionHtml } from "../recipes/recipe-instruction-sanitizer";
import { toCsv } from "../common/csv-export";

export const ONBOARDING_IMPORT_TEMPLATES = ["PARTS", "MATERIALS", "TOOL_DEFINITIONS", "TOOL_COMPONENTS", "FIXTURE_DEFINITIONS", "PHYSICAL_TOOLS", "PHYSICAL_FIXTURES", "TOOL_MACHINE_COMPATIBILITIES", "FIXTURE_MACHINE_COMPATIBILITIES", "BOMS", "ROUTINGS", "CUSTOMERS", "SUPPLIERS", "MACHINES", "WAREHOUSES", "OPENING_STOCK"] as const;
export type OnboardingImportTemplate = (typeof ONBOARDING_IMPORT_TEMPLATES)[number];

type NormalizedRow = Record<string, string | number | boolean | undefined>;
type RowResult = { rowNumber: number; externalKey?: string; normalized?: NormalizedRow; errors: string[] };
type Tx = Prisma.TransactionClient;

const TEMPLATE_HEADERS: Record<OnboardingImportTemplate, { required: string[]; optional: string[] }> = {
  PARTS: { required: ["part_no", "name", "unit"], optional: ["revision", "description", "ideal_cycle_time_sec", "lot_tracking_required"] },
  MATERIALS: { required: ["code", "name", "type", "unit"], optional: ["min_stock", "standard_cost", "lot_tracking_required", "certificate_required"] },
  TOOL_DEFINITIONS: { required: ["code", "name", "tool_type", "life_policy", "maximum_life", "warning_threshold", "life_unit"], optional: ["revision", "manufacturer_code"] },
  TOOL_COMPONENTS: { required: ["code", "name", "component_type"], optional: ["revision", "manufacturer_code"] },
  FIXTURE_DEFINITIONS: { required: ["code", "name", "fixture_type"], optional: ["revision"] },
  PHYSICAL_TOOLS: { required: ["tool_code", "tool_revision", "serial_no", "remaining_life"], optional: ["barcode", "location", "consumed_life"] },
  PHYSICAL_FIXTURES: { required: ["fixture_code", "fixture_revision", "serial_no"], optional: ["barcode", "location"] },
  TOOL_MACHINE_COMPATIBILITIES: { required: ["machine_name", "tool_code", "tool_revision"], optional: [] },
  FIXTURE_MACHINE_COMPATIBILITIES: { required: ["machine_name", "fixture_code", "fixture_revision"], optional: [] },
  BOMS: { required: ["part_no", "part_revision", "bom_revision", "material_code", "qty_per"], optional: ["scrap_pct", "unit", "issue_method", "consume_on_scrap", "notes"] },
  ROUTINGS: { required: ["part_no", "part_revision", "routing_revision", "seq", "name"], optional: ["parameter_name", "parameter_value", "unit", "standard_minutes", "ideal_cycle_time_sec", "instruction_html", "notes"] },
  CUSTOMERS: { required: ["name"], optional: ["contact_name", "email", "phone", "address", "tax_no", "notes"] },
  SUPPLIERS: { required: ["name"], optional: ["contact_name", "email", "phone", "address", "tax_no", "notes", "lead_time_days"] },
  MACHINES: { required: ["name", "model"], optional: ["controller", "hourly_rate", "daily_capacity_minutes"] },
  WAREHOUSES: { required: ["name", "code"], optional: [] },
  OPENING_STOCK: { required: ["item_type", "item_code", "warehouse_code", "bin_code", "quantity"], optional: ["item_revision", "lot_no", "expiry_date", "heat_number", "supplier_lot_no", "certificate_no", "note"] },
};

function text(value: string | undefined) { return value?.trim() ?? ""; }
function optional(value: string | undefined) { const result = text(value); return result || undefined; }
function bool(value: string | undefined, field: string, errors: string[]) {
  const result = optional(value);
  if (!result) return undefined;
  if (["true", "1", "evet", "yes"].includes(result.toLowerCase())) return true;
  if (["false", "0", "hayır", "hayir", "no"].includes(result.toLowerCase())) return false;
  errors.push(`${field} true/false olmalıdır`); return undefined;
}
function number(value: string | undefined, field: string, errors: string[], options: { positive?: boolean; integer?: boolean } = {}) {
  const raw = optional(value);
  if (!raw) return undefined;
  const result = Number(raw.replace(",", "."));
  if (!Number.isFinite(result) || (options.positive && result <= 0) || (options.integer && !Number.isInteger(result))) {
    errors.push(`${field} geçerli ${options.positive ? "pozitif " : ""}sayı olmalıdır`); return undefined;
  }
  return result;
}
function email(value: string | undefined, errors: string[]) {
  const result = optional(value);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) errors.push("email geçerli değildir");
  return result;
}

@Injectable()
export class OnboardingImportService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService) {}

  templates() {
    return ONBOARDING_IMPORT_TEMPLATES.map((template) => ({ template, ...TEMPLATE_HEADERS[template] }));
  }

  list(tenantId: string) {
    return this.prisma.onboardingImportBatch.findMany({
      where: { tenantId },
      include: { createdBy: { select: { id: true, name: true, email: true } }, _count: { select: { rowResults: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async findOne(tenantId: string, id: string) {
    const batch = await this.prisma.onboardingImportBatch.findFirst({
      where: { id, tenantId },
      include: { createdBy: { select: { id: true, name: true, email: true } }, rowResults: { orderBy: { rowNumber: "asc" } } },
    });
    if (!batch) throw new NotFoundException("İçe aktarma batch'i bulunamadı");
    return batch;
  }

  async dryRun(tenantId: string, actorId: string, template: string, content: string) {
    const normalizedTemplate = this.assertTemplate(template);
    const rows = parseCsv(content);
    if (rows.length < 2) throw new BadRequestException("CSV başlık ve en az bir veri satırı içermelidir");
    const header = rows[0].map((value) => text(value).toLowerCase());
    this.assertHeaders(normalizedTemplate, header);
    const column = (name: string, row: string[]) => row[header.indexOf(name)];
    const seen = new Set<string>();
    const results: RowResult[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((value) => !text(value))) continue;
      results.push(await this.validateRow(tenantId, normalizedTemplate, (name) => column(name, row), seen, i + 1));
    }
    if (results.length === 0) throw new BadRequestException("CSV içinde veri satırı yok");
    this.validateBatchRows(normalizedTemplate, results);
    const validRows = results.filter((row) => row.errors.length === 0).length;
    const batch = await this.prisma.onboardingImportBatch.create({
      data: {
        tenantId,
        template: normalizedTemplate,
        mode: "DRY_RUN",
        status: validRows === results.length ? "VALIDATED" : "REJECTED",
        sourceChecksum: createHash("sha256").update(content).digest("hex"),
        totalRows: results.length,
        validRows,
        createdById: actorId,
      },
    });
    await this.prisma.onboardingImportRowResult.createMany({ data: results.map((row) => ({ tenantId, batchId: batch.id, rowNumber: row.rowNumber, externalKey: row.externalKey, status: row.errors.length ? "ERROR" : "VALID", normalized: row.normalized as Prisma.InputJsonValue | undefined, errors: row.errors.length ? row.errors : undefined })) });
    return this.findOne(tenantId, batch.id);
  }

  async commit(tenantId: string, actorId: string, id: string) {
    const batch = await this.findOne(tenantId, id);
    if (batch.status !== OnboardingImportStatus.VALIDATED || batch.validRows !== batch.totalRows) {
      throw new ConflictException("Yalnızca hatasız doğrulanmış dry-run batch'i işlenebilir");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const createdRows: { rowId: string; entityId: string }[] = batch.template === "BOMS"
          ? await this.commitBomBatch(tx, tenantId, batch.rowResults)
          : batch.template === "ROUTINGS"
            ? await this.commitRoutingBatch(tx, tenantId, batch.rowResults)
          : await Promise.all(batch.rowResults.map(async (row) => {
              const values = row.normalized as NormalizedRow | null;
              if (!values) throw new ConflictException(`Satır ${row.rowNumber} için doğrulanmış veri yok`);
              return { rowId: row.id, entityId: await this.commitRow(tx, tenantId, actorId, batch.template, values, batch.id, row.id) };
            }));
        for (const created of createdRows) await tx.onboardingImportRowResult.update({ where: { id: created.rowId }, data: { status: "COMMITTED", createdEntityId: created.entityId } });
        const committed = await tx.onboardingImportBatch.update({ where: { id: batch.id }, data: { mode: "COMMIT", status: "COMMITTED", createdRows: createdRows.length, committedAt: new Date() } });
        await writeTransactionalAudit(tx, { tenantId, userId: actorId, entity: "onboarding-import", entityId: batch.id, action: "CREATE", before: { status: "VALIDATED", template: batch.template, sourceChecksum: batch.sourceChecksum }, after: { status: "COMMITTED", createdRows: createdRows.length } });
        return committed;
      });
    } catch (error) {
      // A dry-run may become stale before its atomic commit. Database unique
      // indexes are the final race-safe authority; surface that result as a
      // controlled conflict and retain an actionable batch failure reason.
      const surfaced = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
        ? new ConflictException("Doğrulanan kayıt eşzamanlı oluşturuldu; CSV'yi yeniden dry-run yapın")
        : error;
      const reason = surfaced instanceof Error ? surfaced.message.slice(0, 500) : "Commit failed";
      await this.prisma.onboardingImportBatch.updateMany({ where: { id, tenantId, status: "VALIDATED" }, data: { status: "REJECTED", failureReason: reason } });
      throw surfaced;
    }
  }

  async errorCsv(tenantId: string, id: string) {
    const batch = await this.findOne(tenantId, id);
    const rows = batch.rowResults
      .filter((row) => row.status === "ERROR")
      .map((row) => ({
        rowNumber: row.rowNumber,
        externalKey: row.externalKey ?? "",
        errors: Array.isArray(row.errors) ? row.errors.map(String).join("; ") : "",
      }));
    return toCsv(rows, [
      { key: "rowNumber", header: "satır" },
      { key: "externalKey", header: "iş_anahtarı" },
      { key: "errors", header: "hatalar" },
    ]);
  }

  private assertTemplate(value: string): OnboardingImportTemplate {
    const template = value.trim().toUpperCase();
    if (!ONBOARDING_IMPORT_TEMPLATES.includes(template as OnboardingImportTemplate)) throw new BadRequestException("Desteklenmeyen içe aktarma şablonu");
    return template as OnboardingImportTemplate;
  }

  private assertHeaders(template: OnboardingImportTemplate, header: string[]) {
    const config = TEMPLATE_HEADERS[template];
    const duplicates = header.filter((value, index) => header.indexOf(value) !== index);
    const unknown = header.filter((value) => !config.required.includes(value) && !config.optional.includes(value));
    const missing = config.required.filter((value) => !header.includes(value));
    if (duplicates.length || unknown.length || missing.length) {
      throw new BadRequestException(`CSV başlığı geçersiz: ${[missing.length ? `eksik: ${missing.join(", ")}` : "", unknown.length ? `bilinmeyen: ${unknown.join(", ")}` : "", duplicates.length ? `tekrar: ${[...new Set(duplicates)].join(", ")}` : ""].filter(Boolean).join("; ")}`);
    }
  }

  private validateBatchRows(template: OnboardingImportTemplate, rows: RowResult[]) {
    if (template !== "BOMS" && template !== "ROUTINGS") return;
    const revision = template === "BOMS" ? "bomRevision" : "routingRevision";
    const roots = new Set(rows.flatMap((row) => row.normalized ? [`${row.normalized.partNo}@${row.normalized.partRevision}:${revision}@${row.normalized[revision]}`] : []));
    const sequenceInvalid = template === "ROUTINGS" && rows.some((row, index) => row.normalized && row.normalized.seq !== index + 1);
    if (roots.size <= 1 && !sequenceInvalid) return;
    for (const row of rows) {
      row.errors.push(template === "BOMS" ? "Bir BOMS dosyası yalnızca tek parça/revizyon/BOM revizyonu içerebilir" : roots.size > 1 ? "Bir ROUTINGS dosyası yalnızca tek parça/revizyon/routing revizyonu içerebilir" : "Routing seq değerleri 1’den başlayıp kesintisiz olmalıdır");
      row.normalized = undefined;
    }
  }

  private async validateRow(tenantId: string, template: OnboardingImportTemplate, value: (name: string) => string | undefined, seen: Set<string>, rowNumber: number): Promise<RowResult> {
    const errors: string[] = [];
    const required = (name: string) => { const result = text(value(name)); if (!result) errors.push(`${name} zorunludur`); return result; };
    const unique = (key: string) => { if (seen.has(key)) errors.push("CSV içinde tekrar eden iş anahtarı"); else seen.add(key); };
    let normalized: NormalizedRow = {};
    let externalKey = "";

    if (template === "PARTS") {
      const partNo = required("part_no"); const revision = optional(value("revision")) ?? "A";
      externalKey = `${partNo}@${revision}`; unique(`PART:${externalKey}`);
      normalized = { partNo, revision, name: required("name"), unit: required("unit"), description: optional(value("description")), idealCycleTimeSec: number(value("ideal_cycle_time_sec"), "ideal_cycle_time_sec", errors, { positive: true }), lotTrackingRequired: bool(value("lot_tracking_required"), "lot_tracking_required", errors) };
      if (await this.prisma.part.findFirst({ where: { tenantId, partNo, revision } })) errors.push("part_no + revision zaten kayıtlı");
    } else if (template === "MATERIALS") {
      const code = required("code"); externalKey = code; unique(`MATERIAL:${code}`); const type = required("type").toUpperCase();
      if (!["RAW", "CONSUMABLE"].includes(type)) errors.push("type RAW veya CONSUMABLE olmalıdır");
      normalized = { code, name: required("name"), type, unit: required("unit"), minStock: number(value("min_stock"), "min_stock", errors), standardCost: number(value("standard_cost"), "standard_cost", errors), lotTrackingRequired: bool(value("lot_tracking_required"), "lot_tracking_required", errors), certificateRequired: bool(value("certificate_required"), "certificate_required", errors) };
      if (await this.prisma.material.findFirst({ where: { tenantId, code } })) errors.push("code zaten kayıtlı");
    } else if (template === "TOOL_DEFINITIONS") {
      const code = required("code"); const revision = optional(value("revision")) ?? "A";
      externalKey = `${code}@${revision}`; unique(`TOOL:${externalKey}`);
      const lifePolicy = required("life_policy").toUpperCase();
      if (!["TIME", "CYCLE", "PART_COUNT"].includes(lifePolicy)) errors.push("life_policy TIME, CYCLE veya PART_COUNT olmalıdır");
      const maximumLife = number(value("maximum_life"), "maximum_life", errors, { positive: true });
      const warningThreshold = number(value("warning_threshold"), "warning_threshold", errors);
      if (warningThreshold !== undefined && warningThreshold < 0) errors.push("warning_threshold negatif olamaz");
      if (maximumLife !== undefined && warningThreshold !== undefined && warningThreshold > maximumLife) errors.push("warning_threshold maximum_life değerini aşamaz");
      normalized = { code, revision, name: required("name"), toolType: required("tool_type"), lifePolicy, maximumLife, warningThreshold, lifeUnit: required("life_unit"), manufacturerCode: optional(value("manufacturer_code")) };
      if (await this.prisma.toolDefinition.findFirst({ where: { tenantId, code, revision } })) errors.push("code + revision zaten kayıtlı");
    } else if (template === "TOOL_COMPONENTS" || template === "FIXTURE_DEFINITIONS") {
      const code = required("code"); const revision = optional(value("revision")) ?? "A";
      externalKey = `${code}@${revision}`; unique(`${template}:${externalKey}`);
      if (template === "TOOL_COMPONENTS") {
        normalized = { code, revision, name: required("name"), componentType: required("component_type"), manufacturerCode: optional(value("manufacturer_code")) };
        if (await this.prisma.toolComponent.findFirst({ where: { tenantId, code, revision } })) errors.push("code + revision zaten kayıtlı");
      } else {
        normalized = { code, revision, name: required("name"), fixtureType: required("fixture_type") };
        if (await this.prisma.fixtureDefinition.findFirst({ where: { tenantId, code, revision } })) errors.push("code + revision zaten kayıtlı");
      }
    } else if (template === "PHYSICAL_TOOLS") {
      const toolCode = required("tool_code"); const toolRevision = required("tool_revision"); const serialNo = required("serial_no"); externalKey = serialNo; unique(`PHYSICAL_TOOL:${serialNo}`);
      const tool = await this.prisma.toolDefinition.findFirst({ where: { tenantId, code: toolCode, revision: toolRevision, isActive: true } });
      const remainingLife = number(value("remaining_life"), "remaining_life", errors); const consumedLife = number(value("consumed_life"), "consumed_life", errors) ?? 0;
      if (remainingLife === undefined || remainingLife < 0) errors.push("remaining_life negatif olamaz");
      if (consumedLife < 0) errors.push("consumed_life negatif olamaz");
      if (!tool) errors.push("tool_code + tool_revision bulunamadı veya aktif değil"); else if ((remainingLife ?? 0) + consumedLife > Number(tool.maximumLife)) errors.push("toplam ömür maksimum ömrü aşamaz");
      if (await this.prisma.physicalToolInstance.findFirst({ where: { tenantId, serialNo } })) errors.push("serial_no zaten kayıtlı");
      normalized = { toolCode, toolRevision, serialNo, remainingLife, consumedLife, barcode: optional(value("barcode")), location: optional(value("location")) };
    } else if (template === "PHYSICAL_FIXTURES") {
      const fixtureCode = required("fixture_code"); const fixtureRevision = required("fixture_revision"); const serialNo = required("serial_no"); externalKey = serialNo; unique(`PHYSICAL_FIXTURE:${serialNo}`);
      if (!(await this.prisma.fixtureDefinition.findFirst({ where: { tenantId, code: fixtureCode, revision: fixtureRevision, isActive: true } }))) errors.push("fixture_code + fixture_revision bulunamadı veya aktif değil");
      if (await this.prisma.physicalFixtureInstance.findFirst({ where: { tenantId, serialNo } })) errors.push("serial_no zaten kayıtlı");
      normalized = { fixtureCode, fixtureRevision, serialNo, barcode: optional(value("barcode")), location: optional(value("location")) };
    } else if (template === "TOOL_MACHINE_COMPATIBILITIES") {
      const machineName = required("machine_name"); const toolCode = required("tool_code"); const toolRevision = required("tool_revision");
      externalKey = `${machineName}:${toolCode}@${toolRevision}`; unique(`TOOL_MACHINE_COMPATIBILITY:${externalKey}`);
      const [machine, tool] = await Promise.all([
        this.prisma.machine.findFirst({ where: { tenantId, name: { equals: machineName, mode: "insensitive" } } }),
        this.prisma.toolDefinition.findFirst({ where: { tenantId, code: toolCode, revision: toolRevision, isActive: true } }),
      ]);
      if (!machine) errors.push("machine_name bulunamadı");
      if (!tool) errors.push("tool_code + tool_revision bulunamadı veya aktif değil");
      if (machine && tool && await this.prisma.toolMachineCompatibility.findFirst({ where: { tenantId, machineId: machine.id, toolDefinitionId: tool.id } })) errors.push("makine ve takım uyumluluğu zaten kayıtlı");
      normalized = { machineName, toolCode, toolRevision };
    } else if (template === "FIXTURE_MACHINE_COMPATIBILITIES") {
      const machineName = required("machine_name"); const fixtureCode = required("fixture_code"); const fixtureRevision = required("fixture_revision");
      externalKey = `${machineName}:${fixtureCode}@${fixtureRevision}`; unique(`FIXTURE_MACHINE_COMPATIBILITY:${externalKey}`);
      const [machine, fixture] = await Promise.all([
        this.prisma.machine.findFirst({ where: { tenantId, name: { equals: machineName, mode: "insensitive" } } }),
        this.prisma.fixtureDefinition.findFirst({ where: { tenantId, code: fixtureCode, revision: fixtureRevision, isActive: true } }),
      ]);
      if (!machine) errors.push("machine_name bulunamadı");
      if (!fixture) errors.push("fixture_code + fixture_revision bulunamadı veya aktif değil");
      if (machine && fixture && await this.prisma.fixtureMachineCompatibility.findFirst({ where: { tenantId, machineId: machine.id, fixtureDefinitionId: fixture.id } })) errors.push("makine ve fikstür uyumluluğu zaten kayıtlı");
      normalized = { machineName, fixtureCode, fixtureRevision };
    } else if (template === "BOMS") {
      const partNo = required("part_no"); const partRevision = required("part_revision"); const bomRevision = required("bom_revision"); const materialCode = required("material_code");
      externalKey = `${partNo}@${partRevision}:BOM@${bomRevision}:${materialCode}`; unique(`BOM:${externalKey}`);
      const qtyPer = number(value("qty_per"), "qty_per", errors, { positive: true });
      const scrapPct = number(value("scrap_pct"), "scrap_pct", errors);
      if (scrapPct !== undefined && (scrapPct < 0 || scrapPct > 100)) errors.push("scrap_pct 0 ile 100 arasında olmalıdır");
      const issueMethod = (optional(value("issue_method")) ?? "MANUAL_ISSUE").toUpperCase();
      if (!["MANUAL_ISSUE", "BACKFLUSH"].includes(issueMethod)) errors.push("issue_method MANUAL_ISSUE veya BACKFLUSH olmalıdır");
      const consumeOnScrap = bool(value("consume_on_scrap"), "consume_on_scrap", errors) ?? true;
      const [part, material] = await Promise.all([this.prisma.part.findFirst({ where: { tenantId, partNo, revision: partRevision } }), this.prisma.material.findFirst({ where: { tenantId, code: materialCode } })]);
      if (!part) errors.push("part_no + part_revision bulunamadı");
      if (!material) errors.push("material_code bulunamadı");
      if (part && await this.prisma.bomHeader.findFirst({ where: { tenantId, partId: part.id, revision: bomRevision } })) errors.push("part + bom_revision zaten kayıtlı");
      normalized = { partNo, partRevision, bomRevision, materialCode, qtyPer, scrapPct, unit: optional(value("unit")) ?? material?.unit, issueMethod, consumeOnScrap, notes: optional(value("notes")) };
    } else if (template === "ROUTINGS") {
      const partNo = required("part_no"); const partRevision = required("part_revision"); const routingRevision = required("routing_revision");
      const seq = number(value("seq"), "seq", errors, { positive: true, integer: true });
      externalKey = `${partNo}@${partRevision}:ROUTING@${routingRevision}:${seq ?? "?"}`; unique(`ROUTING:${externalKey}`);
      const standardMinutes = number(value("standard_minutes"), "standard_minutes", errors);
      if (standardMinutes !== undefined && standardMinutes < 0) errors.push("standard_minutes negatif olamaz");
      const idealCycleTimeSec = number(value("ideal_cycle_time_sec"), "ideal_cycle_time_sec", errors, { positive: true });
      const part = await this.prisma.part.findFirst({ where: { tenantId, partNo, revision: partRevision } });
      if (!part) errors.push("part_no + part_revision bulunamadı");
      if (part && await this.prisma.recipeHeader.findFirst({ where: { tenantId, partId: part.id, revision: routingRevision } })) errors.push("part + routing_revision zaten kayıtlı");
      normalized = { partNo, partRevision, routingRevision, seq, name: required("name"), parameterName: optional(value("parameter_name")), parameterValue: optional(value("parameter_value")), unit: optional(value("unit")), standardMinutes, idealCycleTimeSec, instructionHtml: optional(value("instruction_html")), notes: optional(value("notes")) };
    } else if (template === "CUSTOMERS" || template === "SUPPLIERS") {
      const name = required("name"); externalKey = name.toLocaleLowerCase("tr"); unique(`${template}:${externalKey}`);
      const existing = template === "CUSTOMERS" ? await this.prisma.customer.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" } } }) : await this.prisma.supplier.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" } } });
      if (existing) errors.push("name zaten kayıtlı; içe aktarma mevcut kaydı güncellemez");
      normalized = { name, contactName: optional(value("contact_name")), email: email(value("email"), errors), phone: optional(value("phone")), address: optional(value("address")), taxNo: optional(value("tax_no")), notes: optional(value("notes")), ...(template === "SUPPLIERS" ? { leadTimeDays: number(value("lead_time_days"), "lead_time_days", errors, { integer: true }) } : {}) };
    } else if (template === "MACHINES") {
      const name = required("name"); externalKey = name.toLocaleLowerCase("tr"); unique(`MACHINE:${externalKey}`);
      if (await this.prisma.machine.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" } } })) errors.push("name zaten kayıtlı");
      normalized = { name, model: required("model"), controller: optional(value("controller")), hourlyRate: number(value("hourly_rate"), "hourly_rate", errors), dailyCapacityMinutes: number(value("daily_capacity_minutes"), "daily_capacity_minutes", errors, { positive: true }) };
    } else if (template === "WAREHOUSES") {
      const name = required("name"); const code = required("code"); externalKey = code; unique(`WAREHOUSE:${code}`);
      if (await this.prisma.warehouse.findFirst({ where: { tenantId, OR: [{ name: { equals: name, mode: "insensitive" } }, { code }] } })) errors.push("name veya code zaten kayıtlı");
      normalized = { name, code };
    } else {
      const itemType = required("item_type").toUpperCase(); const itemCode = required("item_code"); const warehouseCode = required("warehouse_code"); const binCode = required("bin_code"); const itemRevision = optional(value("item_revision")) ?? "A";
      externalKey = `${itemType}:${itemCode}:${itemRevision}:${warehouseCode}:${binCode}:${optional(value("lot_no")) ?? "-"}`; unique(`OPENING:${externalKey}`);
      if (!["MATERIAL", "PART"].includes(itemType)) errors.push("item_type MATERIAL veya PART olmalıdır");
      const quantity = number(value("quantity"), "quantity", errors, { positive: true });
      const warehouse = await this.prisma.warehouse.findFirst({ where: { tenantId, code: warehouseCode }, include: { bins: true } });
      if (!warehouse) errors.push("warehouse_code bulunamadı"); else if (!warehouse.bins.some((bin) => bin.code === binCode)) errors.push("bin_code bulunamadı");
      if (itemType === "MATERIAL" && !(await this.prisma.material.findFirst({ where: { tenantId, code: itemCode } }))) errors.push("item_code malzeme olarak bulunamadı");
      if (itemType === "PART" && !(await this.prisma.part.findFirst({ where: { tenantId, partNo: itemCode, revision: itemRevision } }))) errors.push("item_code + item_revision parça olarak bulunamadı");
      const lotNo = optional(value("lot_no")); if (lotNo && await this.prisma.lot.findFirst({ where: { tenantId, lotNo } })) errors.push("lot_no zaten kayıtlı");
      const expiryDate = optional(value("expiry_date")); if (expiryDate && Number.isNaN(Date.parse(expiryDate))) errors.push("expiry_date ISO tarih olmalıdır");
      normalized = { itemType, itemCode, itemRevision, warehouseCode, binCode, quantity, lotNo, expiryDate, heatNumber: optional(value("heat_number")), supplierLotNo: optional(value("supplier_lot_no")), certificateNo: optional(value("certificate_no")), note: optional(value("note")) };
    }
    return { rowNumber, externalKey, normalized: errors.length ? undefined : normalized, errors };
  }

  private async commitRow(tx: Tx, tenantId: string, actorId: string, template: OnboardingImportTemplate, row: NormalizedRow, batchId: string, rowId: string): Promise<string> {
    if (template === "PARTS") return (await tx.part.create({ data: { tenantId, partNo: row.partNo as string, revision: row.revision as string, name: row.name as string, unit: row.unit as string, description: row.description as string | undefined, idealCycleTimeSec: row.idealCycleTimeSec as number | undefined, lotTrackingRequired: row.lotTrackingRequired as boolean | undefined } })).id;
    if (template === "MATERIALS") return (await tx.material.create({ data: { tenantId, code: row.code as string, name: row.name as string, type: row.type as any, unit: row.unit as string, minStock: row.minStock as number | undefined, standardCost: row.standardCost as number | undefined, lotTrackingRequired: row.lotTrackingRequired as boolean | undefined, certificateRequired: row.certificateRequired as boolean | undefined } })).id;
    if (template === "TOOL_DEFINITIONS") return (await tx.toolDefinition.create({ data: { tenantId, code: row.code as string, revision: row.revision as string, name: row.name as string, toolType: row.toolType as string, lifePolicy: row.lifePolicy as any, maximumLife: row.maximumLife as number, warningThreshold: row.warningThreshold as number, lifeUnit: row.lifeUnit as string, manufacturerCode: row.manufacturerCode as string | undefined } })).id;
    if (template === "TOOL_COMPONENTS") return (await tx.toolComponent.create({ data: { tenantId, code: row.code as string, revision: row.revision as string, name: row.name as string, componentType: row.componentType as string, manufacturerCode: row.manufacturerCode as string | undefined } })).id;
    if (template === "FIXTURE_DEFINITIONS") return (await tx.fixtureDefinition.create({ data: { tenantId, code: row.code as string, revision: row.revision as string, name: row.name as string, fixtureType: row.fixtureType as string } })).id;
    if (template === "PHYSICAL_TOOLS") { const definition = await tx.toolDefinition.findFirstOrThrow({ where: { tenantId, code: row.toolCode as string, revision: row.toolRevision as string, isActive: true } }); return (await tx.physicalToolInstance.create({ data: { tenantId, toolDefinitionId: definition.id, serialNo: row.serialNo as string, barcode: row.barcode as string | undefined, location: row.location as string | undefined, consumedLife: row.consumedLife as number, remainingLife: row.remainingLife as number, status: "AVAILABLE" } })).id; }
    if (template === "PHYSICAL_FIXTURES") { const definition = await tx.fixtureDefinition.findFirstOrThrow({ where: { tenantId, code: row.fixtureCode as string, revision: row.fixtureRevision as string, isActive: true } }); return (await tx.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId: definition.id, serialNo: row.serialNo as string, barcode: row.barcode as string | undefined, location: row.location as string | undefined, status: "AVAILABLE" } })).id; }
    if (template === "TOOL_MACHINE_COMPATIBILITIES") {
      const [machine, tool] = await Promise.all([
        tx.machine.findFirstOrThrow({ where: { tenantId, name: { equals: row.machineName as string, mode: "insensitive" } } }),
        tx.toolDefinition.findFirstOrThrow({ where: { tenantId, code: row.toolCode as string, revision: row.toolRevision as string, isActive: true } }),
      ]);
      if (await tx.toolMachineCompatibility.findFirst({ where: { tenantId, machineId: machine.id, toolDefinitionId: tool.id } })) throw new ConflictException("Makine ve takım uyumluluğu zaten kayıtlı");
      return (await tx.toolMachineCompatibility.create({ data: { tenantId, machineId: machine.id, toolDefinitionId: tool.id } })).id;
    }
    if (template === "FIXTURE_MACHINE_COMPATIBILITIES") {
      const [machine, fixture] = await Promise.all([
        tx.machine.findFirstOrThrow({ where: { tenantId, name: { equals: row.machineName as string, mode: "insensitive" } } }),
        tx.fixtureDefinition.findFirstOrThrow({ where: { tenantId, code: row.fixtureCode as string, revision: row.fixtureRevision as string, isActive: true } }),
      ]);
      if (await tx.fixtureMachineCompatibility.findFirst({ where: { tenantId, machineId: machine.id, fixtureDefinitionId: fixture.id } })) throw new ConflictException("Makine ve fikstür uyumluluğu zaten kayıtlı");
      return (await tx.fixtureMachineCompatibility.create({ data: { tenantId, machineId: machine.id, fixtureDefinitionId: fixture.id } })).id;
    }
    if (template === "CUSTOMERS") return (await tx.customer.create({ data: { tenantId, name: row.name as string, contactName: row.contactName as string | undefined, email: row.email as string | undefined, phone: row.phone as string | undefined, address: row.address as string | undefined, taxNo: row.taxNo as string | undefined, notes: row.notes as string | undefined } })).id;
    if (template === "SUPPLIERS") return (await tx.supplier.create({ data: { tenantId, name: row.name as string, contactName: row.contactName as string | undefined, email: row.email as string | undefined, phone: row.phone as string | undefined, address: row.address as string | undefined, taxNo: row.taxNo as string | undefined, notes: row.notes as string | undefined, leadTimeDays: row.leadTimeDays as number | undefined } })).id;
    if (template === "MACHINES") return (await tx.machine.create({ data: { tenantId, name: row.name as string, model: row.model as string, controller: row.controller as string | undefined, hourlyRate: row.hourlyRate as number | undefined, dailyCapacityMinutes: row.dailyCapacityMinutes as number | undefined } })).id;
    if (template === "WAREHOUSES") return (await tx.warehouse.create({ data: { tenantId, name: row.name as string, code: row.code as string } })).id;

    const itemType = row.itemType as StockItemType;
    const item = itemType === "MATERIAL"
      ? await tx.material.findFirstOrThrow({ where: { tenantId, code: row.itemCode as string } })
      : await tx.part.findFirstOrThrow({ where: { tenantId, partNo: row.itemCode as string, revision: row.itemRevision as string } });
    const warehouse = await tx.warehouse.findFirstOrThrow({ where: { tenantId, code: row.warehouseCode as string }, include: { bins: true } });
    const bin = warehouse.bins.find((candidate) => candidate.code === row.binCode);
    if (!bin) throw new ConflictException("Doğrulanan raf artık bulunamadı");
    const lotNo = row.lotNo as string | undefined;
    const lot = lotNo ? await tx.lot.create({ data: { tenantId, lotNo, itemType, itemId: item.id, expiryDate: row.expiryDate ? new Date(row.expiryDate as string) : undefined, heatNumber: row.heatNumber as string | undefined, supplierLotNo: row.supplierLotNo as string | undefined, certificateNo: row.certificateNo as string | undefined } }) : undefined;
    const movement = await this.inventory.record(tx, { tenantId, itemType, itemId: item.id, quantityDelta: row.quantity as number, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "ONBOARDING_IMPORT", sourceId: batchId, sourceLineId: rowId, binId: bin.id, lotId: lot?.id, createdById: actorId, note: row.note as string | undefined });
    return movement.id;
  }

  private async commitBomBatch(tx: Tx, tenantId: string, rows: Array<{ id: string; rowNumber: number; normalized: Prisma.JsonValue | null }>): Promise<Array<{ rowId: string; entityId: string }>> {
    const values = rows.map((row) => {
      if (!row.normalized || Array.isArray(row.normalized) || typeof row.normalized !== "object") throw new ConflictException(`Satır ${row.rowNumber} için doğrulanmış veri yok`);
      return { rowId: row.id, values: row.normalized as NormalizedRow };
    });
    const first = values[0]?.values;
    if (!first) throw new ConflictException("BOM batch'i boş");
    const part = await tx.part.findFirstOrThrow({ where: { tenantId, partNo: first.partNo as string, revision: first.partRevision as string } });
    if (await tx.bomHeader.findFirst({ where: { tenantId, partId: part.id, revision: first.bomRevision as string } })) throw new ConflictException("part + bom_revision artık kayıtlı");
    const materialCodes = values.map(({ values: row }) => row.materialCode as string);
    const materials = await tx.material.findMany({ where: { tenantId, code: { in: materialCodes } } });
    if (materials.length !== new Set(materialCodes).size) throw new ConflictException("Doğrulanan BOM malzemesi artık bulunamadı");
    const bom = await tx.bomHeader.create({ data: { tenantId, partId: part.id, revision: first.bomRevision as string, notes: first.notes as string | undefined, isActive: false, status: "DRAFT" } });
    await tx.bomLine.createMany({ data: values.map(({ values: row }) => ({ tenantId, bomHeaderId: bom.id, itemType: "MATERIAL", itemId: materials.find((material) => material.code === row.materialCode)?.id!, qtyPer: row.qtyPer as number, scrapPct: row.scrapPct as number | undefined, unit: row.unit as string | undefined, issueMethod: row.issueMethod as any, consumeOnScrap: row.consumeOnScrap as boolean })) });
    return values.map(({ rowId }) => ({ rowId, entityId: bom.id }));
  }

  private async commitRoutingBatch(tx: Tx, tenantId: string, rows: Array<{ id: string; rowNumber: number; normalized: Prisma.JsonValue | null }>): Promise<Array<{ rowId: string; entityId: string }>> {
    const values = rows.map((row) => {
      if (!row.normalized || Array.isArray(row.normalized) || typeof row.normalized !== "object") throw new ConflictException(`Satır ${row.rowNumber} için doğrulanmış veri yok`);
      return { rowId: row.id, values: row.normalized as NormalizedRow };
    });
    const first = values[0]?.values;
    if (!first) throw new ConflictException("Routing batch'i boş");
    const part = await tx.part.findFirstOrThrow({ where: { tenantId, partNo: first.partNo as string, revision: first.partRevision as string } });
    if (await tx.recipeHeader.findFirst({ where: { tenantId, partId: part.id, revision: first.routingRevision as string } })) throw new ConflictException("part + routing_revision artık kayıtlı");
    const routing = await tx.recipeHeader.create({ data: { tenantId, partId: part.id, revision: first.routingRevision as string, notes: first.notes as string | undefined, isActive: false, status: "DRAFT" } });
    await tx.recipeStep.createMany({ data: values.map(({ values: row }) => ({ tenantId, recipeHeaderId: routing.id, seq: row.seq as number, name: row.name as string, parameterName: row.parameterName as string | undefined, parameterValue: row.parameterValue as string | undefined, unit: row.unit as string | undefined, standardMinutes: row.standardMinutes as number | undefined, idealCycleTimeSec: row.idealCycleTimeSec as number | undefined, instructionHtml: sanitizeInstructionHtml(row.instructionHtml as string | undefined) })) });
    return values.map(({ rowId }) => ({ rowId, entityId: routing.id }));
  }
}
