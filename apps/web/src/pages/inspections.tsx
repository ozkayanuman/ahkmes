import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface WorkOrderOption {
  id: string;
  woNo: string;
}
interface InspectionRow {
  id: string;
  insNo: string;
  checkpointName: string;
  result: "PASS" | "FAIL";
  inspectedAt: string;
  workOrder: { id: string; woNo: string };
  inspectedBy: { id: string; name: string };
  nonConformance: { id: string; failureType: string } | null;
}
interface QualityPlanCheck {
  id: string;
  seq: number;
  checkpointName: string;
  unit: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  requiresMeasurement: boolean;
}
interface QualityPlan {
  id: string;
  name: string;
  revision: string;
  isActive: boolean;
  checks: QualityPlanCheck[];
}
interface QualityPlanCheckDraft {
  checkpointName: string;
  unit: string;
  lowerLimit: string;
  upperLimit: string;
  requiresMeasurement: boolean;
}

const emptyQualityPlanCheck = (): QualityPlanCheckDraft => ({
  checkpointName: "",
  unit: "",
  lowerLimit: "",
  upperLimit: "",
  requiresMeasurement: false,
});

export function InspectionsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [workOrderId, setWorkOrderId] = useState("");
  const [checkpointName, setCheckpointName] = useState("");
  const [qualityPlanCheckId, setQualityPlanCheckId] = useState("");
  const [measurementValue, setMeasurementValue] = useState("");
  const [result, setResult] = useState<"PASS" | "FAIL">("PASS");
  const [notes, setNotes] = useState("");
  const [plansOpen, setPlansOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planRevision, setPlanRevision] = useState("A");
  const [planChecks, setPlanChecks] = useState<QualityPlanCheckDraft[]>([emptyQualityPlanCheck()]);
  const [revisionSource, setRevisionSource] = useState<QualityPlan | null>(null);
  const [nextRevision, setNextRevision] = useState("");

  const inspections = useQuery({
    queryKey: ["/inspections"],
    queryFn: () => apiGet<InspectionRow[]>("/inspections"),
  });
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
    enabled: open,
  });
  const qualityPlans = useQuery({
    queryKey: ["/quality-plans"],
    queryFn: () => apiGet<QualityPlan[]>("/quality-plans"),
    enabled: open || plansOpen,
  });
  const selectedCheck = (qualityPlans.data ?? [])
    .filter((plan) => plan.isActive)
    .flatMap((plan) => plan.checks)
    .find((check) => check.id === qualityPlanCheckId);

  const create = useMutation({
    mutationFn: () => apiPost("/inspections", {
      workOrderId,
      checkpointName: selectedCheck?.checkpointName ?? checkpointName,
      result,
      ...(qualityPlanCheckId ? { qualityPlanCheckId } : {}),
      ...(measurementValue.trim() ? { measurementValue: Number(measurementValue), measurementUnit: selectedCheck?.unit ?? undefined } : {}),
      ...(notes ? { notes } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/inspections"] });
      qc.invalidateQueries({ queryKey: ["/non-conformances"] });
      setOpen(false);
      setCheckpointName("");
      setQualityPlanCheckId("");
      setMeasurementValue("");
      setNotes("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Muayene kaydedilemedi", "error");
    },
  });

  const createPlan = useMutation({
    mutationFn: () => apiPost("/quality-plans", {
      name: planName,
      revision: planRevision,
      checks: planChecks.map((check, index) => ({
        seq: index + 1,
        checkpointName: check.checkpointName,
        ...(check.unit ? { unit: check.unit } : {}),
        ...(check.lowerLimit.trim() ? { lowerLimit: Number(check.lowerLimit) } : {}),
        ...(check.upperLimit.trim() ? { upperLimit: Number(check.upperLimit) } : {}),
        requiresMeasurement: check.requiresMeasurement,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/quality-plans"] });
      setPlansOpen(false);
      setPlanName("");
      setPlanRevision("A");
      setPlanChecks([emptyQualityPlanCheck()]);
      toast("Kalite plani olusturuldu", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Kalite plani olusturulamadi", "error");
    },
  });

  const revisePlan = useMutation({
    mutationFn: () => apiPost(`/quality-plans/${revisionSource!.id}/revisions`, { revision: nextRevision }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/quality-plans"] });
      setRevisionSource(null);
      setNextRevision("");
      toast("Yeni kalite planı revizyonu oluşturuldu; önceki revizyon pasifleştirildi", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Kalite planı revize edilemedi", "error");
    },
  });

  function openCreate() {
    setWorkOrderId("");
    setCheckpointName("");
    setQualityPlanCheckId("");
    setMeasurementValue("");
    setResult("PASS");
    setNotes("");
    setOpen(true);
  }

  function openPlans() {
    setPlanName("");
    setPlanRevision("A");
    setPlanChecks([emptyQualityPlanCheck()]);
    setPlansOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Muayene / Kontrol Kayıtları</h1>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openPlans}>Kalite Planlari</Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Yeni Muayene
            </Button>
          </div>
        )}
      </div>

      {inspections.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "İş Emri", "Kontrol Noktası", "Sonuç", "Uygunsuzluk", "Muayene Eden", "Tarih"]}>
        {(inspections.data ?? []).length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(inspections.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.insNo}</td>
            <td className="px-4 py-3">{row.workOrder.woNo}</td>
            <td className="px-4 py-3">{row.checkpointName}</td>
            <td className="px-4 py-3">
              <span
                className={
                  row.result === "PASS"
                    ? "inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700"
                    : "inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700"
                }
              >
                {row.result === "PASS" ? "Uygun" : "Uygun Değil"}
              </span>
            </td>
            <td className="px-4 py-3">
              {row.nonConformance ? (
                <Link to="/non-conformances" className="text-brand-700 hover:underline">
                  {row.nonConformance.failureType}
                </Link>
              ) : (
                "—"
              )}
            </td>
            <td className="px-4 py-3">{row.inspectedBy.name}</td>
            <td className="px-4 py-3">{fmtDate(row.inspectedAt)}</td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Muayene" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="workOrder">İş Emri</Label>
            <Select id="workOrder" required value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">Seçin…</option>
              {workOrders.data?.map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.woNo}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="qualityPlanCheck">Kalite plan kontrolu (opsiyonel)</Label>
            <Select
              id="qualityPlanCheck"
              value={qualityPlanCheckId}
              onChange={(e) => {
                setQualityPlanCheckId(e.target.value);
                setMeasurementValue("");
              }}
            >
              <option value="">Manuel kontrol noktasi</option>
              {(qualityPlans.data ?? []).filter((plan) => plan.isActive).flatMap((plan) => plan.checks.map((check) => (
                <option key={check.id} value={check.id}>
                  {plan.name} rev.{plan.revision} / {check.seq}. {check.checkpointName}
                </option>
              )))}
            </Select>
          </div>
          <div>
            <Label htmlFor="checkpointName">Kontrol Noktası</Label>
            <Input
              id="checkpointName"
              required={!qualityPlanCheckId}
              disabled={!!qualityPlanCheckId}
              placeholder="Örn: İlk Parça Kontrolü"
              value={checkpointName}
              onChange={(e) => setCheckpointName(e.target.value)}
            />
          </div>
          {selectedCheck && (
            <div>
              <Label htmlFor="measurementValue">
                Olcum degeri{selectedCheck.unit ? ` (${selectedCheck.unit})` : ""}
                {selectedCheck.requiresMeasurement ? " *" : ""}
              </Label>
              <Input
                id="measurementValue"
                type="number"
                step="any"
                required={selectedCheck.requiresMeasurement}
                value={measurementValue}
                onChange={(e) => setMeasurementValue(e.target.value)}
                placeholder={[
                  selectedCheck.lowerLimit !== null ? `Alt: ${selectedCheck.lowerLimit}` : "",
                  selectedCheck.upperLimit !== null ? `Ust: ${selectedCheck.upperLimit}` : "",
                ].filter(Boolean).join(" / ") || "Olcum girin"}
              />
              {(selectedCheck.lowerLimit !== null || selectedCheck.upperLimit !== null) && (
                <p className="mt-1 text-xs text-slate-500">
                  Tolerans: {selectedCheck.lowerLimit ?? "-"} - {selectedCheck.upperLimit ?? "-"}
                </p>
              )}
            </div>
          )}
          <div>
            <Label htmlFor="result">Sonuç</Label>
            <Select id="result" value={result} onChange={(e) => setResult(e.target.value as "PASS" | "FAIL")}>
              <option value="PASS">Uygun</option>
              <option value="FAIL">Uygun Değil</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {result === "FAIL" && (
            <p className="text-sm text-amber-600">
              "Uygun Değil" seçilirse otomatik olarak bir uygunsuzluk (NonConformance) kaydı oluşturulacak.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={plansOpen} title="Kalite Planlari" onClose={() => setPlansOpen(false)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createPlan.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            Plan satirlari muayene kaydinda kontrol noktasi ve tolerans kaynagi olarak kullanilir.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="qualityPlanName">Plan adi</Label>
              <Input id="qualityPlanName" required value={planName} onChange={(e) => setPlanName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="qualityPlanRevision">Revizyon</Label>
              <Input id="qualityPlanRevision" required value={planRevision} onChange={(e) => setPlanRevision(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Kontrol satirlari</h3>
              <Button type="button" variant="outline" onClick={() => setPlanChecks((checks) => [...checks, emptyQualityPlanCheck()])}>
                <Plus className="h-4 w-4" /> Satir ekle
              </Button>
            </div>
            {planChecks.map((check, index) => (
              <div key={index} className="rounded border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-medium">
                  <span>{index + 1}. satir</span>
                  {planChecks.length > 1 && (
                    <Button type="button" variant="outline" onClick={() => setPlanChecks((checks) => checks.filter((_, i) => i !== index))}>
                      Kaldir
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`plan-check-name-${index}`}>Kontrol noktasi</Label>
                    <Input
                      id={`plan-check-name-${index}`}
                      required
                      value={check.checkpointName}
                      onChange={(e) => setPlanChecks((checks) => checks.map((item, i) => i === index ? { ...item, checkpointName: e.target.value } : item))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`plan-check-unit-${index}`}>Birim</Label>
                    <Input
                      id={`plan-check-unit-${index}`}
                      placeholder="mm, HRC, adet"
                      value={check.unit}
                      onChange={(e) => setPlanChecks((checks) => checks.map((item, i) => i === index ? { ...item, unit: e.target.value } : item))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`plan-check-lower-${index}`}>Alt tolerans</Label>
                    <Input
                      id={`plan-check-lower-${index}`}
                      type="number"
                      step="any"
                      value={check.lowerLimit}
                      onChange={(e) => setPlanChecks((checks) => checks.map((item, i) => i === index ? { ...item, lowerLimit: e.target.value } : item))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`plan-check-upper-${index}`}>Ust tolerans</Label>
                    <Input
                      id={`plan-check-upper-${index}`}
                      type="number"
                      step="any"
                      value={check.upperLimit}
                      onChange={(e) => setPlanChecks((checks) => checks.map((item, i) => i === index ? { ...item, upperLimit: e.target.value } : item))}
                    />
                  </div>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={check.requiresMeasurement}
                    onChange={(e) => setPlanChecks((checks) => checks.map((item, i) => i === index ? { ...item, requiresMeasurement: e.target.checked } : item))}
                  />
                  Olcum girilmesi zorunlu
                </label>
              </div>
            ))}
          </div>
          {(qualityPlans.data ?? []).length > 0 && (
            <div className="border-t border-slate-200 pt-3 text-sm text-slate-600">
              <p className="mb-2">Kayitli planlar:</p>
              <div className="space-y-2">
                {(qualityPlans.data ?? []).map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2">
                    <span>{plan.name} rev.{plan.revision} {plan.isActive ? "(aktif)" : "(yerine yenisi geçti)"}</span>
                    {plan.isActive && (
                      <Button type="button" variant="outline" onClick={() => { setRevisionSource(plan); setNextRevision(""); }}>
                        Yeni revizyon
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPlansOpen(false)}>Vazgec</Button>
            <Button type="submit" disabled={createPlan.isPending}>Plani kaydet</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!revisionSource} title="Kalite Planı Revizyonu" onClose={() => setRevisionSource(null)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            revisePlan.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            {revisionSource?.name} rev.{revisionSource?.revision} kontrol satırlarıyla kopyalanır; önceki revizyon pasifleştirilir. Geçmiş muayeneler eski revizyona bağlı kalır.
          </p>
          <div>
            <Label htmlFor="nextQualityPlanRevision">Yeni revizyon</Label>
            <Input id="nextQualityPlanRevision" required value={nextRevision} onChange={(e) => setNextRevision(e.target.value)} placeholder="Örn. B" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRevisionSource(null)}>Vazgec</Button>
            <Button type="submit" disabled={revisePlan.isPending}>Revizyonu oluştur</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
