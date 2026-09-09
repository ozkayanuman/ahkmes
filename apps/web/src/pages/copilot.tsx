import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { ApiError, apiPost } from "../lib/api";
import { Button, Card, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface MaterialDraft {
  code: string;
  name: string;
  missingFields: string[];
}
interface CopilotResponse {
  status: "DRAFT" | "NO_CHANGES" | "NEEDS_CLARIFICATION" | "SUGGESTION";
  summary: string;
  existing?: Array<{ code: string; name: string }>;
  suggestions?: Array<{
    id: string;
    title: string;
    route: string;
    recommendation: string;
    nextStep: string;
    risk: string;
  }>;
  actions: Array<{
    tool: string;
    risk: string;
    requiresConfirmation: boolean;
    requiresApproval: boolean;
    drafts: MaterialDraft[];
  }>;
  executionAllowed: boolean;
  safety?: string;
}

export function CopilotPage() {
  const [prompt, setPrompt] = useState("4140, 6082 ve 1.2379 malzemelerini sisteme tanımla");
  const toast = useToast();
  const draft = useMutation({
    mutationFn: () => apiPost<CopilotResponse>("/copilot/drafts", { prompt }),
    onError: (error) => {
      const message = error instanceof ApiError ? (error.body as { message?: string } | null)?.message : undefined;
      toast(message ?? "Copilot taslağı oluşturulamadı", "error");
    },
  });

  const result = draft.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-6 w-6 text-brand-600" /> AI Copilot</h1>
        <p className="mt-1 text-sm text-slate-600">İsteğinizi taslağa dönüştürür, mükerrerleri ve eksik alanları gösterir. Bu sürüm kayıt oluşturmaz.</p>
      </div>
      <Card className="space-y-3 p-5">
        <Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ne yapmak istiyorsunuz?" />
        <div className="flex justify-end"><Button disabled={draft.isPending || prompt.trim().length < 3} onClick={() => draft.mutate()}>{draft.isPending ? "İnceleniyor..." : "Taslak oluştur"}</Button></div>
      </Card>
      {result && (
        <Card className="space-y-4 p-5">
          <div>
            <p className="font-semibold">{result.summary}</p>
            <p className="mt-1 text-sm text-amber-700">{result.safety ?? "Mutasyon kapalı."}</p>
          </div>
          {(result.existing ?? []).length > 0 && <p className="text-sm text-slate-600">Mevcut kayıtlar: {result.existing?.map((item) => `${item.code} (${item.name})`).join(", ")}</p>}
          {(result.suggestions ?? []).map((suggestion) => (
            <div key={suggestion.id} className="rounded border border-brand-100 bg-brand-50 p-4">
              <p className="font-medium">{suggestion.title} <span className="text-sm font-normal text-slate-600">· Risk: {suggestion.risk}</span></p>
              <p className="mt-1 text-sm text-slate-700">{suggestion.recommendation}</p>
              <p className="mt-1 text-sm text-slate-600">Sonraki bilgi: {suggestion.nextStep}</p>
              <a href={suggestion.route} className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">İlgili modülü aç</a>
            </div>
          ))}
          {result.actions.map((action) => (
            <div key={action.tool} className="rounded border border-slate-200 p-4">
              <p className="font-medium">Önerilen komut: {action.tool}</p>
              <p className="text-sm text-slate-600">Risk: {action.risk} · Kullanıcı onayı gerekir: {action.requiresConfirmation ? "Evet" : "Hayır"}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {action.drafts.map((item) => <li key={item.code}><strong>{item.code}</strong>: eksik alanlar — {item.missingFields.join(", ")}</li>)}
              </ul>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
