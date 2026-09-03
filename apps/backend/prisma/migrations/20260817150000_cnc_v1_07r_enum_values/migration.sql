-- CNC-V1-07R: add new enum values ahead of the schema migration that uses them.
-- PostgreSQL forbids using a new enum value in the same transaction that adds it
-- (error 55P04), so these ADD VALUE statements must be committed in an earlier
-- migration before 20260817160000_cnc_v1_07r_cmms_release_closure runs.

ALTER TYPE "DowntimeEventSource" ADD VALUE 'MAINTENANCE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'MAINTENANCE_ISSUE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'MAINTENANCE_RETURN';
ALTER TYPE "MaintenanceOrderStatus" ADD VALUE 'DRAFT';
ALTER TYPE "MaintenanceOrderStatus" ADD VALUE 'RELEASED';
ALTER TYPE "MaintenanceOrderStatus" ADD VALUE 'ON_HOLD';
