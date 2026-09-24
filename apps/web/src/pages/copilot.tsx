import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { Button, Card, Textarea } from "../components/ui";
import { useToast } from "../components/toast";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";

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
  draftId: string;
  approvalStatus: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "NOT_APPROVABLE";
}

interface CopilotDraftHistoryRow {
  id: string;
  prompt: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "NOT_APPROVABLE";
  createdAt: string;
  createdBy: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
  approvedAt?: string | null;
  rejectedBy?: { id: string; name: string } | null;
  rejectedAt?: string | null;
}

const DRAFT_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Onay bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  NOT_APPROVABLE: "Onaylanabilir eylem yok",
};
const DRAFT_STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-900",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  NOT_APPROVABLE: "bg-slate-100 text-slate-500",
};

export function CopilotPage() {
  const { user } = useAuth();
  const canApprove = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("4140, 6082 ve 1.2379 malzemelerini sisteme tanımla");
  const toast = useToast();
  const draft = useMutation({
    mutationFn: () => apiPost<CopilotResponse>("/copilot/drafts", { prompt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/copilot/drafts"] }),
    onError: (error) => {
      const message = error instanceof ApiError ? (error.body as { message?: string } | null)?.message : undefined;
      toast(message ?? "Copilot taslağı oluşturulamadı", "error");
    },
  });
  const history = useQuery({ queryKey: ["/copilot/drafts"], queryFn: () => apiGet<CopilotDraftHistoryRow[]>("/copilot/drafts") });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => apiPost(`/copilot/drafts/${id}/${action}`, {}),
    onSuccess: () => { toast("Kaydedildi.", "success"); qc.invalidateQueries({ queryKey: ["/copilot/drafts"] }); },
    onError: () => toast("İşlem başarısız", "error"),
  });

  const result = draft.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-6 w-6 text-brand-600" /> AI Copilot</h1>
        <p className="mt-1 text-sm text-slate-600">İsteğinizi taslağa dönüştürür, mükerrerleri ve eksik alanları gösterir; her taslak kaydedilir. Onay yalnızca "yürütmeye hazır" işaretler — kayıt oluşturmayı kendisi yapmaz, mutasyon ilgili modülün kendi ekranından elle tetiklenir.</p>
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
          {result.approvalStatus === "PENDING_APPROVAL" && (
            <p className="text-sm text-slate-600">Bu taslak onay bekliyor durumunda kaydedildi — aşağıdaki geçmişten onaylayabilir/reddedebilirsiniz.</p>
          )}
        </Card>
      )}
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Taslak Geçmişi</h2>
        {history.isLoading ? <p className="text-sm text-slate-500">Yükleniyor…</p> : (history.data ?? []).length === 0 ? <p className="text-sm text-slate-500">Henüz taslak yok.</p> : (
          <div className="space-y-2">
            {history.data?.map((row) => (
              <div key={row.id} className="rounded border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-slate-700">{row.prompt}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.createdBy.name} · {fmtDate(row.createdAt)}
                      {row.approvedBy && ` · onaylayan: ${row.approvedBy.name}${row.approvedAt ? ` (${fmtDate(row.approvedAt)})` : ""}`}
                      {row.rejectedBy && ` · reddeden: ${row.rejectedBy.name}${row.rejectedAt ? ` (${fmtDate(row.rejectedAt)})` : ""}`}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${DRAFT_STATUS_BADGE[row.status]}`}>{DRAFT_STATUS_LABEL[row.status]}</span>
                </div>
                {canApprove && row.status === "PENDING_APPROVAL" && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, action: "approve" })}>Onayla</Button>
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, action: "reject" })}>Reddet</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
