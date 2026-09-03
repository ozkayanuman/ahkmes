-- CNC-V1-03R database release constraints. Composite relationships prevent a
-- tenant-scoped MRP row from referencing another tenant's plant/run/proposal.

CREATE UNIQUE INDEX "Plant_id_tenantId_key" ON "Plant"("id", "tenantId");
CREATE UNIQUE INDEX "MrpRun_id_tenantId_key" ON "MrpRun"("id", "tenantId");
CREATE UNIQUE INDEX "MrpProposal_id_tenantId_key" ON "MrpProposal"("id", "tenantId");
CREATE UNIQUE INDEX "MrpException_id_tenantId_key" ON "MrpException"("id", "tenantId");
CREATE UNIQUE INDEX "PurchaseRequisition_id_tenantId_key" ON "PurchaseRequisition"("id", "tenantId");
CREATE UNIQUE INDEX "WorkOrder_mrpProposalId_tenantId_key" ON "WorkOrder"("mrpProposalId", "tenantId");
CREATE UNIQUE INDEX "PurchaseRequisition_mrpProposalId_tenantId_key" ON "PurchaseRequisition"("mrpProposalId", "tenantId");
CREATE UNIQUE INDEX "MrpRun_one_running_per_plant_key" ON "MrpRun"("tenantId", "plantId") WHERE "status" = 'RUNNING';

ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_horizon_check" CHECK ("horizonEnd" >= "planningDate");
ALTER TABLE "MrpPlanningParameter" ADD CONSTRAINT "MrpPlanningParameter_nonnegative_check" CHECK ("leadTimeWorkingDays" >= 0 AND "safetyStock" >= 0 AND "rescheduleToleranceDays" >= 0);
ALTER TABLE "MrpIndependentDemand" ADD CONSTRAINT "MrpIndependentDemand_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "MrpProposal" ADD CONSTRAINT "MrpProposal_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "MrpPegging" ADD CONSTRAINT "MrpPegging_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpPlanningParameter" ADD CONSTRAINT "MrpPlanningParameter_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpIndependentDemand" ADD CONSTRAINT "MrpIndependentDemand_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpProposal" ADD CONSTRAINT "MrpProposal_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpProposal" ADD CONSTRAINT "MrpProposal_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "MrpRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpPegging" ADD CONSTRAINT "MrpPegging_proposal_tenant_fkey" FOREIGN KEY ("proposalId", "tenantId") REFERENCES "MrpProposal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MrpException" ADD CONSTRAINT "MrpException_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpException" ADD CONSTRAINT "MrpException_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "MrpRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpBucket" ADD CONSTRAINT "MrpBucket_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MrpBucket" ADD CONSTRAINT "MrpBucket_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "MrpRun"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_plant_tenant_fkey" FOREIGN KEY ("plantId", "tenantId") REFERENCES "Plant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_proposal_tenant_fkey" FOREIGN KEY ("mrpProposalId", "tenantId") REFERENCES "MrpProposal"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_parent_tenant_fkey" FOREIGN KEY ("purchaseRequisitionId", "tenantId") REFERENCES "PurchaseRequisition"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_mrp_proposal_tenant_fkey" FOREIGN KEY ("mrpProposalId", "tenantId") REFERENCES "MrpProposal"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
