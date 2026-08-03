-- Existing FIXTURE_READ is the canonical read grant for fixture maintenance/calibration summaries.
-- Remove the short-lived duplicate grant introduced during this forward-only delivery.
DELETE FROM "ActionPermissionGrant" WHERE "action" = 'FIXTURE_MAINT_READ';
