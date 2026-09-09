-- DropForeignKey
ALTER TABLE "FixtureCalibrationPolicy" DROP CONSTRAINT "FixtureCalibrationPolicy_fixtureDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "FixtureCalibrationRecord" DROP CONSTRAINT "FixtureCalibrationRecord_physicalFixtureInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "FixtureMachineCompatibility" DROP CONSTRAINT "FixtureMachineCompatibility_fixtureDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "FixtureMachineCompatibility" DROP CONSTRAINT "FixtureMachineCompatibility_machineId_fkey";

-- DropForeignKey
ALTER TABLE "FixtureMaintenanceEvent" DROP CONSTRAINT "FixtureMaintenanceEvent_physicalFixtureInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "FixtureMaintenancePolicy" DROP CONSTRAINT "FixtureMaintenancePolicy_fixtureDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "NcProgram" DROP CONSTRAINT "NcProgram_parentRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "OperationFixtureRequirement" DROP CONSTRAINT "OperationFixtureRequirement_fixtureDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "OperationFixtureRequirement" DROP CONSTRAINT "OperationFixtureRequirement_recipeStepId_fkey";

-- DropForeignKey
ALTER TABLE "OperationFixtureRequirement" DROP CONSTRAINT "OperationFixtureRequirement_workOrderOperationId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupAssignment" DROP CONSTRAINT "OperationSetupAssignment_fixtureRequirementId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupAssignment" DROP CONSTRAINT "OperationSetupAssignment_physicalFixtureInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupAssignment" DROP CONSTRAINT "OperationSetupAssignment_physicalToolInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupAssignment" DROP CONSTRAINT "OperationSetupAssignment_toolRequirementId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupAssignment" DROP CONSTRAINT "OperationSetupAssignment_verificationId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupSnapshot" DROP CONSTRAINT "OperationSetupSnapshot_verificationId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupVerification" DROP CONSTRAINT "OperationSetupVerification_machineId_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupVerification" DROP CONSTRAINT "OperationSetupVerification_verifiedById_fkey";

-- DropForeignKey
ALTER TABLE "OperationSetupVerification" DROP CONSTRAINT "OperationSetupVerification_workOrderOperationId_fkey";

-- DropForeignKey
ALTER TABLE "OperationToolRequirement" DROP CONSTRAINT "OperationToolRequirement_recipeStepId_fkey";

-- DropForeignKey
ALTER TABLE "OperationToolRequirement" DROP CONSTRAINT "OperationToolRequirement_toolAssemblyId_fkey";

-- DropForeignKey
ALTER TABLE "OperationToolRequirement" DROP CONSTRAINT "OperationToolRequirement_toolDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "OperationToolRequirement" DROP CONSTRAINT "OperationToolRequirement_workOrderOperationId_fkey";

-- DropForeignKey
ALTER TABLE "PhysicalFixtureInstance" DROP CONSTRAINT "PhysicalFixtureInstance_fixtureDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "PhysicalToolInstance" DROP CONSTRAINT "PhysicalToolInstance_toolAssemblyId_fkey";

-- DropForeignKey
ALTER TABLE "PhysicalToolInstance" DROP CONSTRAINT "PhysicalToolInstance_toolDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "ToolAssembly" DROP CONSTRAINT "ToolAssembly_toolDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "ToolAssemblyComponent" DROP CONSTRAINT "ToolAssemblyComponent_toolAssemblyId_fkey";

-- DropForeignKey
ALTER TABLE "ToolAssemblyComponent" DROP CONSTRAINT "ToolAssemblyComponent_toolComponentId_fkey";

-- DropForeignKey
ALTER TABLE "ToolLifeEvent" DROP CONSTRAINT "ToolLifeEvent_physicalToolInstanceId_fkey";

-- DropForeignKey
ALTER TABLE "ToolLifeEvent" DROP CONSTRAINT "ToolLifeEvent_workOrderOperationId_fkey";

-- DropForeignKey
ALTER TABLE "ToolMachineCompatibility" DROP CONSTRAINT "ToolMachineCompatibility_machineId_fkey";

-- DropForeignKey
ALTER TABLE "ToolMachineCompatibility" DROP CONSTRAINT "ToolMachineCompatibility_toolAssemblyId_fkey";

-- DropForeignKey
ALTER TABLE "ToolMachineCompatibility" DROP CONSTRAINT "ToolMachineCompatibility_toolDefinitionId_fkey";

-- DropIndex
DROP INDEX "Lot_tenantId_itemType_itemId_acceptanceStatus_idx";

-- AlterTable
ALTER TABLE "RecipeStep" ADD COLUMN     "instructionHtml" TEXT;

-- AlterTable
ALTER TABLE "WorkOrderOperation" ADD COLUMN     "instructionHtml" TEXT;

-- CreateIndex
CREATE INDEX "FixtureDefinition_tenantId_isActive_idx" ON "FixtureDefinition"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "OperationSetupAssignment_tenantId_physicalToolInstanceId_is_idx" ON "OperationSetupAssignment"("tenantId", "physicalToolInstanceId", "isActive");

-- CreateIndex
CREATE INDEX "OperationSetupAssignment_tenantId_physicalFixtureInstanceId_idx" ON "OperationSetupAssignment"("tenantId", "physicalFixtureInstanceId", "isActive");

-- CreateIndex
CREATE INDEX "OperationSetupSnapshot_tenantId_verificationId_idx" ON "OperationSetupSnapshot"("tenantId", "verificationId");

-- CreateIndex
CREATE INDEX "ToolAssembly_tenantId_toolDefinitionId_idx" ON "ToolAssembly"("tenantId", "toolDefinitionId");

-- CreateIndex
CREATE INDEX "ToolAssemblyComponent_tenantId_toolAssemblyId_idx" ON "ToolAssemblyComponent"("tenantId", "toolAssemblyId");

-- CreateIndex
CREATE INDEX "ToolMachineCompatibility_tenantId_toolDefinitionId_idx" ON "ToolMachineCompatibility"("tenantId", "toolDefinitionId");

-- CreateIndex
CREATE INDEX "ToolMachineCompatibility_tenantId_toolAssemblyId_idx" ON "ToolMachineCompatibility"("tenantId", "toolAssemblyId");

-- AddForeignKey
ALTER TABLE "ToolAssembly" ADD CONSTRAINT "ToolAssembly_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAssemblyComponent" ADD CONSTRAINT "ToolAssemblyComponent_toolAssemblyId_fkey" FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAssemblyComponent" ADD CONSTRAINT "ToolAssemblyComponent_toolComponentId_fkey" FOREIGN KEY ("toolComponentId") REFERENCES "ToolComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalToolInstance" ADD CONSTRAINT "PhysicalToolInstance_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalToolInstance" ADD CONSTRAINT "PhysicalToolInstance_toolAssemblyId_fkey" FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalFixtureInstance" ADD CONSTRAINT "PhysicalFixtureInstance_fixtureDefinitionId_fkey" FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureMaintenancePolicy" ADD CONSTRAINT "FixtureMaintenancePolicy_fixtureDefinitionId_fkey" FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureCalibrationPolicy" ADD CONSTRAINT "FixtureCalibrationPolicy_fixtureDefinitionId_fkey" FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureMaintenanceEvent" ADD CONSTRAINT "FixtureMaintenanceEvent_physicalFixtureInstanceId_fkey" FOREIGN KEY ("physicalFixtureInstanceId") REFERENCES "PhysicalFixtureInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureCalibrationRecord" ADD CONSTRAINT "FixtureCalibrationRecord_physicalFixtureInstanceId_fkey" FOREIGN KEY ("physicalFixtureInstanceId") REFERENCES "PhysicalFixtureInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolMachineCompatibility" ADD CONSTRAINT "ToolMachineCompatibility_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolMachineCompatibility" ADD CONSTRAINT "ToolMachineCompatibility_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolMachineCompatibility" ADD CONSTRAINT "ToolMachineCompatibility_toolAssemblyId_fkey" FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureMachineCompatibility" ADD CONSTRAINT "FixtureMachineCompatibility_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureMachineCompatibility" ADD CONSTRAINT "FixtureMachineCompatibility_fixtureDefinitionId_fkey" FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationToolRequirement" ADD CONSTRAINT "OperationToolRequirement_recipeStepId_fkey" FOREIGN KEY ("recipeStepId") REFERENCES "RecipeStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationToolRequirement" ADD CONSTRAINT "OperationToolRequirement_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationToolRequirement" ADD CONSTRAINT "OperationToolRequirement_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationToolRequirement" ADD CONSTRAINT "OperationToolRequirement_toolAssemblyId_fkey" FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationFixtureRequirement" ADD CONSTRAINT "OperationFixtureRequirement_recipeStepId_fkey" FOREIGN KEY ("recipeStepId") REFERENCES "RecipeStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationFixtureRequirement" ADD CONSTRAINT "OperationFixtureRequirement_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationFixtureRequirement" ADD CONSTRAINT "OperationFixtureRequirement_fixtureDefinitionId_fkey" FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupVerification" ADD CONSTRAINT "OperationSetupVerification_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupVerification" ADD CONSTRAINT "OperationSetupVerification_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupVerification" ADD CONSTRAINT "OperationSetupVerification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupAssignment" ADD CONSTRAINT "OperationSetupAssignment_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "OperationSetupVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupAssignment" ADD CONSTRAINT "OperationSetupAssignment_toolRequirementId_fkey" FOREIGN KEY ("toolRequirementId") REFERENCES "OperationToolRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupAssignment" ADD CONSTRAINT "OperationSetupAssignment_fixtureRequirementId_fkey" FOREIGN KEY ("fixtureRequirementId") REFERENCES "OperationFixtureRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupAssignment" ADD CONSTRAINT "OperationSetupAssignment_physicalToolInstanceId_fkey" FOREIGN KEY ("physicalToolInstanceId") REFERENCES "PhysicalToolInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupAssignment" ADD CONSTRAINT "OperationSetupAssignment_physicalFixtureInstanceId_fkey" FOREIGN KEY ("physicalFixtureInstanceId") REFERENCES "PhysicalFixtureInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSetupSnapshot" ADD CONSTRAINT "OperationSetupSnapshot_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "OperationSetupVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolLifeEvent" ADD CONSTRAINT "ToolLifeEvent_physicalToolInstanceId_fkey" FOREIGN KEY ("physicalToolInstanceId") REFERENCES "PhysicalToolInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolLifeEvent" ADD CONSTRAINT "ToolLifeEvent_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NcProgram" ADD CONSTRAINT "NcProgram_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "NcProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "FixtureCalibrationPolicy_tenantId_fixtureDefinitionId_isActive_" RENAME TO "FixtureCalibrationPolicy_tenantId_fixtureDefinitionId_isAct_idx";

-- RenameIndex
ALTER INDEX "FixtureCalibrationRecord_tenantId_physicalFixtureInstanceId_val" RENAME TO "FixtureCalibrationRecord_tenantId_physicalFixtureInstanceId_idx";

-- RenameIndex
ALTER INDEX "FixtureMaintenanceEvent_tenantId_physicalFixtureInstanceId_crea" RENAME TO "FixtureMaintenanceEvent_tenantId_physicalFixtureInstanceId__idx";

-- RenameIndex
ALTER INDEX "FixtureMaintenanceEvent_tenant_policy_completed_idx" RENAME TO "FixtureMaintenanceEvent_tenantId_fixtureMaintenancePolicyId_idx";

-- RenameIndex
ALTER INDEX "FixtureMaintenancePolicy_tenantId_fixtureDefinitionId_isActive_" RENAME TO "FixtureMaintenancePolicy_tenantId_fixtureDefinitionId_isAct_idx";
