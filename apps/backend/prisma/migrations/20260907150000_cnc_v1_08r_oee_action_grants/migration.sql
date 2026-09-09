-- CNC-V1-08R: explicit OEE read and loss-reason administration grants.
-- Existing tenants receive the same least-privilege defaults as fresh seeds.
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, tenant."id", grants.action, grants.role::"Role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" tenant
CROSS JOIN (VALUES
  ('OEE_READ', 'ADMIN'),
  ('OEE_READ', 'PLANNER'),
  ('OEE_READ', 'FOREMAN'),
  ('OEE_READ', 'OPERATOR'),
  ('OEE_LOSS_REASON_ADMIN', 'ADMIN')
) AS grants(action, role)
WHERE NOT EXISTS (
  SELECT 1
  FROM "ActionPermissionGrant" existing
  WHERE existing."tenantId" = tenant."id"
    AND existing."action" = grants.action
    AND existing."role" = grants.role::"Role"
);
