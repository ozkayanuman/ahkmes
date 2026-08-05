-- MES-OPERATOR-HMI-001: persistent HMI actions. This is explicit bootstrap data,
-- not an administrator bypass; tenant-specific grants can still be changed later.
WITH default_grants(action, role) AS (
  VALUES
    ('HMI_READ', 'ADMIN'::"Role"), ('HMI_READ', 'PLANNER'::"Role"), ('HMI_READ', 'FOREMAN'::"Role"), ('HMI_READ', 'OPERATOR'::"Role"),
    ('HMI_START', 'ADMIN'::"Role"), ('HMI_START', 'PLANNER'::"Role"), ('HMI_START', 'FOREMAN'::"Role"), ('HMI_START', 'OPERATOR'::"Role"),
    ('HMI_COMPLETE', 'ADMIN'::"Role"), ('HMI_COMPLETE', 'PLANNER'::"Role"), ('HMI_COMPLETE', 'FOREMAN'::"Role"), ('HMI_COMPLETE', 'OPERATOR'::"Role")
)
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT md5(t."id" || ':' || g.action || ':' || g.role::text), t."id", g.action, g.role, now(), now()
FROM "Tenant" t CROSS JOIN default_grants g
ON CONFLICT DO NOTHING;
