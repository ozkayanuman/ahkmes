import { FixtureMaintenanceService } from "./fixture-maintenance.service";

describe("FixtureMaintenanceService policy evaluation", () => {
  const service = new FixtureMaintenanceService({} as any);
  const now = new Date("2026-08-03T12:00:00.000Z");

  it("keeps fixture counter policy states distinct from operational fixture status", () => {
    const policy = { id: "policy", revision: 2, enforcement: "BLOCKING", policyType: "CYCLE", interval: 10, warningThreshold: 2 };
    const fixture = { maintenanceCycleCount: 8, maintenancePartCount: 0 };
    const current = (service as any).maintenanceEvaluation(policy, { counterAfter: 0, completedAt: now }, fixture, now);
    expect(current.state).toBe("WARNING");
    expect(current.warnings).toEqual(["Fikstür bakım sayaç eşiğine yaklaştı"]);
    expect(current.blockers).toEqual([]);

    const overdue = (service as any).maintenanceEvaluation(policy, { counterAfter: 0, completedAt: now }, { ...fixture, maintenanceCycleCount: 10 }, now);
    expect(overdue.state).toBe("OVERDUE");
    expect(overdue.blockers).toEqual(["Fikstür bakım sayacı vadesi geçti"]);
  });

  it("does not accept generic or historic maintenance as evidence for a new policy", () => {
    const policy = { id: "policy", revision: 1, enforcement: "BLOCKING", policyType: "PART_COUNT", interval: 100, warningThreshold: 10 };
    const result = (service as any).maintenanceEvaluation(policy, undefined, { maintenanceCycleCount: 0, maintenancePartCount: 0 }, now);
    expect(result.state).toBe("UNKNOWN");
    expect(result.blockers).toEqual(["Bu politika için doğrulanmış bakım kaydı yok"]);
  });
});
