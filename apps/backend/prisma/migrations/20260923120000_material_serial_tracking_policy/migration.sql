-- Expand only: existing material execution stays unchanged until a planner
-- explicitly enables serial allocation for the material.
ALTER TABLE "Material"
  ADD COLUMN "serialTrackingRequired" BOOLEAN NOT NULL DEFAULT false;
