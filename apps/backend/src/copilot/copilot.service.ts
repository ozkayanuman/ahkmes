import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCopilotDraftDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { COPILOT_CAPABILITIES } from "./copilot-capabilities";

export interface CopilotMaterialDraft {
  code: string;
  name: string;
  missingFields: Array<"type" | "unit">;
}

type EngineResponse = {
  engine: string;
  status: "DRAFT" | "NO_CHANGES" | "NEEDS_CLARIFICATION" | "SUGGESTION";
  summary: string;
  existing?: Array<{ code: string; name: string }>;
  guidance?: string[];
  suggestions: Array<{ id: string; title: string; route: string; recommendation: string; nextStep: string; risk: string }>;
  actions: Array<{ tool: string; risk: string; requiresConfirmation: boolean; requiresApproval: boolean; drafts: CopilotMaterialDraft[] }>;
  executionAllowed: boolean;
  safety?: string;
};

/**
 * A provider-free, deterministic first command parser. It is intentionally
 * read-only: no model output can call Prisma, application services, or ERP.
 * A future LLM/provider may replace intent extraction behind this same result.
 */
@Injectable()
export class CopilotService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(tenantId: string, pages: "*" | string[], dto: CreateCopilotDraftDto, userId: string) {
    const prompt = dto.prompt.trim();
    const normalizedPrompt = prompt.toLocaleLowerCase("tr-TR");
    const suggestions = COPILOT_CAPABILITIES
      .filter((capability) => pages === "*" || pages.includes(capability.page))
      .filter((capability) => capability.keywords.some((keyword) => normalizedPrompt.includes(keyword.toLocaleLowerCase("tr-TR"))))
      .slice(0, 3)
      .map(({ id, title, route, recommendation, nextStep, risk }) => ({ id, title, route, recommendation, nextStep, risk }));
    const isMaterialRegistration = /malzeme|material/i.test(prompt) && /tan[iı]mla|ekle|olu[sş]tur|create/i.test(prompt);
    const codes = [...new Set(prompt.match(/\b(?:\d{4}|\d\.\d{4})\b/g) ?? [])];

    let response: EngineResponse;
    if (!isMaterialRegistration || codes.length === 0) {
      response = suggestions.length > 0
        ? {
          engine: "deterministic-draft-v1",
          status: "SUGGESTION",
          summary: "Relevant system workflows were found. Complete the requested context before a safe draft can be prepared.",
          suggestions,
          actions: [],
          executionAllowed: false,
        }
        : {
          engine: "deterministic-draft-v1",
          status: "NEEDS_CLARIFICATION",
          summary: "Bu isteği güvenli bir komuta dönüştürmek için desteklenen bir işlem ve gerekli alanlar belirtilmeli.",
          suggestions: [],
          guidance: ["Malzeme tanımlamak için örneğin: '4140, 6082 ve 1.2379 malzemelerini sisteme tanımla' yazın."],
          actions: [],
          executionAllowed: false,
        };
    } else {
      const existing = await this.prisma.material.findMany({
        where: { tenantId, code: { in: codes } },
        select: { code: true, name: true },
      });
      const existingCodes = new Set(existing.map((material) => material.code.toLowerCase()));
      const drafts: CopilotMaterialDraft[] = codes
        .filter((code) => !existingCodes.has(code.toLowerCase()))
        .map((code) => ({ code, name: code, missingFields: ["type", "unit"] }));
      response = {
        engine: "deterministic-draft-v1",
        status: drafts.length === 0 ? "NO_CHANGES" : "DRAFT",
        summary: drafts.length === 0
          ? "İstenen malzemelerin tümü bu tenant içinde zaten kayıtlı."
          : `${drafts.length} malzeme için taslak hazırlandı; kayıt oluşturmadan önce zorunlu alanlar tamamlanmalı.`,
        existing,
        suggestions,
        actions: drafts.length === 0 ? [] : [{
          tool: "material.create",
          risk: "LOW",
          requiresConfirmation: true,
          requiresApproval: false,
          drafts,
        }],
        executionAllowed: false,
        safety: "Bu sürüm yalnızca taslak üretir. Mutasyon, onaylı command gateway ve transaction-içi audit tamamlanana kadar kapalıdır.",
      };
    }

    const approvable = response.status === "DRAFT" && response.actions.length > 0;
    const draft = await this.prisma.copilotDraft.create({
      data: {
        tenantId, prompt, response: response as object,
        status: approvable ? "PENDING_APPROVAL" : "NOT_APPROVABLE",
        createdById: userId,
      },
    });
    return { ...response, draftId: draft.id, approvalStatus: draft.status };
  }

  listDrafts(tenantId: string) {
    return this.prisma.copilotDraft.findMany({
      where: { tenantId },
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async approveDraft(tenantId: string, approvedById: string, id: string) {
    const draft = await this.prisma.copilotDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException("Copilot taslağı bulunamadı");
    if (draft.status !== "PENDING_APPROVAL") throw new ConflictException("Yalnızca onay bekleyen taslaklar onaylanabilir");
    return this.prisma.copilotDraft.update({
      where: { id: draft.id },
      data: { status: "APPROVED", approvedById, approvedAt: new Date() },
    });
  }

  async rejectDraft(tenantId: string, rejectedById: string, id: string) {
    const draft = await this.prisma.copilotDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException("Copilot taslağı bulunamadı");
    if (draft.status !== "PENDING_APPROVAL") throw new ConflictException("Yalnızca onay bekleyen taslaklar reddedilebilir");
    return this.prisma.copilotDraft.update({
      where: { id: draft.id },
      data: { status: "REJECTED", rejectedById, rejectedAt: new Date() },
    });
  }
}
