-- MES-FIXTURE-MAINT-001: explicit default action grants; no implicit administrator bypass.
WITH default_grants(action, role) AS (
  VALUES
    ('FIXTURE_MAINT_READ', 'ADMIN'::"Role"), ('FIXTURE_MAINT_READ', 'PLANNER'::"Role"), ('FIXTURE_MAINT_READ', 'FOREMAN'::"Role"), ('FIXTURE_MAINT_READ', 'OPERATOR'::"Role"),
    ('FIXTURE_MAINT_MANAGE', 'ADMIN'::"Role"), ('FIXTURE_MAINT_MANAGE', 'PLANNER'::"Role"),
    ('FIXTURE_CALIBRATION_RECORD', 'ADMIN'::"Role"), ('FIXTURE_CALIBRATION_RECORD', 'PLANNER'::"Role"), ('FIXTURE_CALIBRATION_RECORD', 'FOREMAN'::"Role"),
    ('FIXTURE_MAINT_OVERRIDE', 'ADMIN'::"Role")
)
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT md5(t."id" || ':' || g.action || ':' || g.role::text), t."id", g.action, g.role, now(), now()
FROM "Tenant" t CROSS JOIN default_grants g
ON CONFLICT DO NOTHING;
