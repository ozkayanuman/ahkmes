import { Injectable } from "@nestjs/common";
import type { CreateCopilotDraftDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { COPILOT_CAPABILITIES } from "./copilot-capabilities";

export interface CopilotMaterialDraft {
  code: string;
  name: string;
  missingFields: Array<"type" | "unit">;
}

/**
 * A provider-free, deterministic first command parser. It is intentionally
 * read-only: no model output can call Prisma, application services, or ERP.
 * A future LLM/provider may replace intent extraction behind this same result.
 */
@Injectable()
export class CopilotService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(tenantId: string, pages: "*" | string[], dto: CreateCopilotDraftDto) {
    const prompt = dto.prompt.trim();
    const normalizedPrompt = prompt.toLocaleLowerCase("tr-TR");
    const suggestions = COPILOT_CAPABILITIES
      .filter((capability) => pages === "*" || pages.includes(capability.page))
      .filter((capability) => capability.keywords.some((keyword) => normalizedPrompt.includes(keyword.toLocaleLowerCase("tr-TR"))))
      .slice(0, 3)
      .map(({ id, title, route, recommendation, nextStep, risk }) => ({ id, title, route, recommendation, nextStep, risk }));
    const isMaterialRegistration = /malzeme|material/i.test(prompt) && /tan[iı]mla|ekle|olu[sş]tur|create/i.test(prompt);
    const codes = [...new Set(prompt.match(/\b(?:\d{4}|\d\.\d{4})\b/g) ?? [])];

    if (!isMaterialRegistration || codes.length === 0) {
      if (suggestions.length > 0) {
        return {
          engine: "deterministic-draft-v1",
          status: "SUGGESTION" as const,
          summary: "Relevant system workflows were found. Complete the requested context before a safe draft can be prepared.",
          suggestions,
          actions: [],
          executionAllowed: false,
        };
      }
      return {
        engine: "deterministic-draft-v1",
        status: "NEEDS_CLARIFICATION" as const,
        summary: "Bu isteği güvenli bir komuta dönüştürmek için desteklenen bir işlem ve gerekli alanlar belirtilmeli.",
        suggestions: [],
        guidance: ["Malzeme tanımlamak için örneğin: '4140, 6082 ve 1.2379 malzemelerini sisteme tanımla' yazın."],
        actions: [],
        executionAllowed: false,
      };
    }

    const existing = await this.prisma.material.findMany({
      where: { tenantId, code: { in: codes } },
      select: { code: true, name: true },
    });
    const existingCodes = new Set(existing.map((material) => material.code.toLowerCase()));
    const drafts: CopilotMaterialDraft[] = codes
      .filter((code) => !existingCodes.has(code.toLowerCase()))
      .map((code) => ({ code, name: code, missingFields: ["type", "unit"] }));

    return {
      engine: "deterministic-draft-v1",
      status: drafts.length === 0 ? "NO_CHANGES" as const : "DRAFT" as const,
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
}
