-- MES-TOOL-001: reusable persistent action grants. Bootstrap is explicit role
-- data, not an implicit administrator bypass.
CREATE TABLE "ActionPermissionGrant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "role" "Role",
  "userId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActionPermissionGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActionPermissionGrant_subject" CHECK (("role" IS NOT NULL) <> ("userId" IS NOT NULL)),
  CONSTRAINT "ActionPermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ActionPermissionGrant_tenantId_action_idx" ON "ActionPermissionGrant"("tenantId", "action");
CREATE UNIQUE INDEX "ActionPermissionGrant_tenantId_action_role_key" ON "ActionPermissionGrant"("tenantId", "action", "role") WHERE "role" IS NOT NULL;
CREATE UNIQUE INDEX "ActionPermissionGrant_tenantId_action_userId_key" ON "ActionPermissionGrant"("tenantId", "action", "userId") WHERE "userId" IS NOT NULL;

WITH default_grants(action, role) AS (
  VALUES
    ('TOOL_READ', 'ADMIN'::"Role"), ('TOOL_READ', 'PLANNER'::"Role"), ('TOOL_READ', 'FOREMAN'::"Role"), ('TOOL_READ', 'OPERATOR'::"Role"),
    ('FIXTURE_READ', 'ADMIN'::"Role"), ('FIXTURE_READ', 'PLANNER'::"Role"), ('FIXTURE_READ', 'FOREMAN'::"Role"), ('FIXTURE_READ', 'OPERATOR'::"Role"),
    ('TOOL_MANAGE', 'ADMIN'::"Role"), ('TOOL_MANAGE', 'PLANNER'::"Role"),
    ('TOOL_ASSEMBLY_MANAGE', 'ADMIN'::"Role"), ('TOOL_ASSEMBLY_MANAGE', 'PLANNER'::"Role"),
    ('TOOL_LIFE_ADJUST', 'ADMIN'::"Role"),
    ('FIXTURE_MANAGE', 'ADMIN'::"Role"), ('FIXTURE_MANAGE', 'PLANNER'::"Role"),
    ('OPERATION_SETUP_MANAGE', 'ADMIN'::"Role"), ('OPERATION_SETUP_MANAGE', 'PLANNER'::"Role"), ('OPERATION_SETUP_MANAGE', 'FOREMAN'::"Role"),
    ('OPERATION_SETUP_VERIFY', 'ADMIN'::"Role"), ('OPERATION_SETUP_VERIFY', 'FOREMAN'::"Role")
)
INSERT INTO "ActionPermissionGrant" ("id", "tenantId", "action", "role", "createdAt", "updatedAt")
SELECT md5(t."id" || ':' || g.action || ':' || g.role::text), t."id", g.action, g.role, now(), now()
FROM "Tenant" t CROSS JOIN default_grants g;
