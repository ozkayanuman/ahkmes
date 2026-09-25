import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Select } from "../components/ui";
import { useToast } from "../components/toast";

type Stage = "NEW" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";

interface OpportunityRow {
  id: string;
  title: string;
  stage: Stage;
  estimatedValue: string | null;
  expectedCloseDate: string | null;
  lostReason: string | null;
  customer: { id: string; name: string };
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

function fmtCurrency(value: number | string | null) {
  if (value === null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

export function PipelinePage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "SALES"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();

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
                    {o.stage === "LOST" && o.lostReason && (
                      <div className="mt-1 text-xs text-red-600">{o.lostReason}</div>
                    )}
                    {canWrite && (
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
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
