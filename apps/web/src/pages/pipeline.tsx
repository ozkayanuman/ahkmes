import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select } from "../components/ui";
import { useToast } from "../components/toast";

type Stage = "NEW" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
type ActivityType = "NOTE" | "CALL" | "EMAIL" | "MEETING";

interface OpportunityRow {
  id: string;
  title: string;
  stage: Stage;
  estimatedValue: string | null;
  expectedCloseDate: string | null;
  lostReason: string | null;
  nextFollowUpAt: string | null;
  customer: { id: string; name: string };
}

interface OpportunityActivity {
  id: string;
  type: ActivityType;
  note: string;
  occurredAt: string;
  nextFollowUpAt: string | null;
  author: { id: string; name: string };
}

interface PipelineStageSummary {
  stage: Stage;
  count: number;
  totalValue: string | null;
}

interface PipelineSummary {
  byStage: PipelineStageSummary[];
  openTotalValue: number;
}

const STAGES: Stage[] = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"];

const STAGE_LABEL: Record<Stage, string> = {
  NEW: "Yeni",
  QUALIFIED: "Nitelikli",
  PROPOSAL: "Teklif",
  WON: "Kazanıldı",
  LOST: "Kaybedildi",
};

const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  NOTE: "Not",
  CALL: "Telefon",
  EMAIL: "E-posta",
  MEETING: "Toplantı",
};

function fmtCurrency(value: number | string | null) {
  if (value === null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function OpportunityActivityModal({ opportunity, onClose }: { opportunity: OpportunityRow; onClose: () => void }) {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<ActivityType>("NOTE");
  const [note, setNote] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [clearFollowUp, setClearFollowUp] = useState(false);
  const activities = useQuery({
    queryKey: ["/opportunities", opportunity.id, "activities"],
    queryFn: () => apiGet<OpportunityActivity[]>(`/opportunities/${opportunity.id}/activities`),
  });
  const create = useMutation({
    mutationFn: () => apiPost(`/opportunities/${opportunity.id}/activities`, {
      type,
      note,
      ...(nextFollowUpAt ? { nextFollowUpAt: new Date(nextFollowUpAt).toISOString() } : {}),
      ...(clearFollowUp ? { nextFollowUpAt: null } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/opportunities", opportunity.id, "activities"] });
      qc.invalidateQueries({ queryKey: ["/opportunities"] });
      setNote("");
      setNextFollowUpAt("");
      setClearFollowUp(false);
    },
    onError: () => toast("Aktivite kaydedilemedi", "error"),
  });

  return (
    <Modal open title={`${opportunity.title} — Aktivite ve Takip`} onClose={onClose}>
      <div className="mb-4 max-h-64 space-y-3 overflow-y-auto">
        {activities.isLoading && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {activities.data?.length === 0 && <p className="text-sm text-slate-400">Henüz aktivite yok.</p>}
        {activities.data?.map((activity) => (
          <div key={activity.id} className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700">{ACTIVITY_TYPE_LABEL[activity.type]}</span>
              <span className="text-xs text-slate-400">{fmtDate(activity.occurredAt)}</span>
            </div>
            <p className="mt-1 text-slate-700">{activity.note}</p>
            <div className="mt-1 text-xs text-slate-400">{activity.author.name}</div>
            {activity.nextFollowUpAt && <div className="mt-1 text-xs text-blue-600">Sonraki takip: {fmtDate(activity.nextFollowUpAt)}</div>}
          </div>
        ))}
      </div>
      {canWrite && <div className="space-y-3 border-t border-slate-200 pt-4">
        <div>
          <Label htmlFor="activityType">Aktivite türü</Label>
          <Select id="activityType" value={type} onChange={(event) => setType(event.target.value as ActivityType)}>
            {Object.entries(ACTIVITY_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="activityNote">Not</Label>
          <textarea id="activityNote" className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="nextFollowUpAt">Sonraki takip</Label>
          <Input id="nextFollowUpAt" type="datetime-local" disabled={clearFollowUp} value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} />
          <label className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={clearFollowUp} onChange={(event) => setClearFollowUp(event.target.checked)} />
            Planlanmış takibi kapat
          </label>
        </div>
        <div className="flex justify-end">
          <Button disabled={!note.trim() || create.isPending} onClick={() => create.mutate()}>Aktivite Kaydet</Button>
        </div>
      </div>}
    </Modal>
  );
}

export function PipelinePage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [activeOpportunity, setActiveOpportunity] = useState<OpportunityRow | null>(null);

  const opportunities = useQuery({
    queryKey: ["/opportunities"],
    queryFn: () => apiGet<OpportunityRow[]>("/opportunities"),
  });
  const summary = useQuery({
    queryKey: ["/opportunities/pipeline-summary"],
    queryFn: () => apiGet<PipelineSummary>("/opportunities/pipeline-summary"),
  });

  const setStage = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: Stage }) => apiPatch(`/opportunities/${id}`, { stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/opportunities"] });
      qc.invalidateQueries({ queryKey: ["/opportunities/pipeline-summary"] });
    },
    onError: () => toast("Aşama güncellenemedi", "error"),
  });

  const summaryByStage = new Map((summary.data?.byStage ?? []).map((s) => [s.stage, s]));
  const rowsByStage = new Map<Stage, OpportunityRow[]>(STAGES.map((s) => [s, []]));
  for (const o of opportunities.data ?? []) {
    rowsByStage.get(o.stage)?.push(o);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Satış Hattı (Pipeline)</h1>
        <div className="text-sm text-slate-500">
          Açık fırsat toplam değeri:{" "}
          <span className="font-semibold text-slate-700">{fmtCurrency(summary.data?.openTotalValue ?? null)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((stage) => {
          const stageSummary = summaryByStage.get(stage);
          return (
            <div key={stage} className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-3">
                <div className="font-semibold text-slate-700">{STAGE_LABEL[stage]}</div>
                <div className="text-xs text-slate-500">
                  {stageSummary?.count ?? 0} fırsat · {fmtCurrency(stageSummary?.totalValue ?? null)}
                </div>
              </div>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
                {(rowsByStage.get(stage) ?? []).length === 0 && (
                  <div className="text-xs text-slate-400">Kayıt yok</div>
                )}
                {(rowsByStage.get(stage) ?? []).map((o) => (
                  <div key={o.id} className="rounded-md bg-slate-50 p-2 text-sm">
                    <div className="font-medium text-slate-700">{o.title}</div>
                    <div className="text-xs text-slate-500">{o.customer.name}</div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                      <span>{fmtCurrency(o.estimatedValue)}</span>
                      {o.expectedCloseDate && <span>{fmtDate(o.expectedCloseDate)}</span>}
                    </div>
                    {o.nextFollowUpAt && (
                      <div className={`mt-1 text-xs ${new Date(o.nextFollowUpAt) < new Date() ? "font-medium text-amber-700" : "text-blue-600"}`}>
                        Takip: {fmtDate(o.nextFollowUpAt)}
                      </div>
                    )}
                    {o.stage === "LOST" && o.lostReason && (
                      <div className="mt-1 text-xs text-red-600">{o.lostReason}</div>
                    )}
                    {canWrite && (
                      <div>
                      <Select
                        id={`opp-stage-${o.id}`}
                        aria-label={`${o.title} aşaması`}
                        className="mt-2 text-xs"
                        value={o.stage}
                        onChange={(e) => setStage.mutate({ id: o.id, stage: e.target.value as Stage })}
                      >
                        {STAGES.map((s) => (
                          <option key={s} value={s}>
                            {STAGE_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                      </div>
                    )}
                    <Button variant="ghost" className="mt-1 w-full px-2 py-1 text-xs" onClick={() => setActiveOpportunity(o)}>
                      Aktivite / Takip
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {activeOpportunity && <OpportunityActivityModal opportunity={activeOpportunity} onClose={() => setActiveOpportunity(null)} />}
    </div>
  );
}
