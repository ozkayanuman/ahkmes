# CNC-V1-10R — First Customer Cutover and Support Runbook

**Status:** `READY_FOR_PILOT_EXECUTION` (2026-09-18)

This runbook governs the first customer use of the V1-10R onboarding pack. It
does not replace the deployment runbook, authorize engineering release, or
qualify a controller. The customer remains responsible for confirming business
master data; the AHKMES administrator is responsible for executing only the
reviewed CSVs and retaining the evidence below.

## Roles and change boundary

| Role | Responsibility | Cannot do through this runbook |
| --- | --- | --- |
| Customer data owner | Signs source-data completeness and resolves business duplicates. | Approve a CSV they have not reviewed. |
| AHKMES deployment administrator | Runs dry-runs and approved commits, retains batch IDs and evidence. | Alter a CSV after its dry-run, write directly to PostgreSQL, or bypass validation. |
| Customer production/engineering lead | Confirms master-data ownership and performs controlled releases after import. | Treat a draft BOM/routing as released. |
| Support owner | Owns incident communication, triage and recovery decision record. | Delete an onboarding batch or rewrite an audit trail. |
| Customer controller witness | Executes the selected-controller field record where applicable. | Claim M80 production qualification from simulator evidence. |

Open one change record for the named tenant, plant, data owner, deployment
administrator, approved time window, CSV-package checksum, backup reference,
and controller scope. Do not place passwords, tokens, database URLs, machine
keys, or customer program content in the record.

## Preconditions

1. Complete the production deployment and smoke checklist in
   `CNC-V1-00-DEPLOYMENT-OPERATIONS.md`.
2. Confirm the tenant, plant, initial administrator, legacy product-module
   access and time zone are the intended customer values.
3. Record a PostgreSQL backup and separately confirm the MinIO backup policy.
   Test every restore in an isolated target first; never restore over the
   primary environment merely to undo a CSV mistake.
4. Freeze the reviewed source files in a customer-controlled location. Each
   file must use the exact header downloaded from **Veri Onboarding**. The
   application retains a content checksum and normalized row results, not the
   original file.
5. Define physical warehouse bins in the normal warehouse screen before an
   `OPENING_STOCK` dry-run. Bin creation is intentionally not a CSV import.
6. If a connected M80 is in pilot scope, obtain an approved test window and
   use `CNC-V1-05-M80-FIELD-ACCEPTANCE.md`; its field gate is independent of
   master-data import.

## Controlled import sequence

Use one template per CSV. Upload every file as a dry run first. A dry run
creates no master, stock, lot, compatibility, or inventory-movement record.

| Order | Template | Required prior state | Commit result and review point |
| --- | --- | --- | --- |
| 1 | `CUSTOMERS`, `SUPPLIERS` | Reviewed commercial masters. | New commercial master only; duplicate names are rejected, never updated. |
| 2 | `PARTS`, `MATERIALS` | Approved engineering/master source. | New revisions/materials in draft/master state. |
| 3 | `MACHINES`, `WAREHOUSES` | Intended plant and physical warehouse plan. | Machine/warehouse master. Create bins manually after warehouse commit. |
| 4 | `TOOL_DEFINITIONS`, `TOOL_COMPONENTS`, `FIXTURE_DEFINITIONS` | Reviewed tooling/fixture source. | Versioned definitions; no tool assembly or operation requirement is created. |
| 5 | `TOOL_MACHINE_COMPATIBILITIES`, `FIXTURE_MACHINE_COMPATIBILITIES` | Referenced machine and active definition committed. | New compatibility record only; duplicate pairs are rejected. |
| 6 | `PHYSICAL_TOOLS`, `PHYSICAL_FIXTURES` | Referenced active definition committed. | Traceable physical instance with an `AVAILABLE` state. |
| 7 | `BOMS`, `ROUTINGS` | Referenced part/material committed. | One draft revision per file; each is released only in the normal engineering workflow. |
| 8 | `OPENING_STOCK` | Item, warehouse and exact bin committed; lot values reviewed. | Canonical `OPENING_BALANCE` / `ONBOARDING_IMPORT` ledger movement and optional lot. |

For each file, the administrator must:

1. Select the matching template and upload the frozen CSV.
2. Check that the result is `VALIDATED`, every row is valid, and the displayed
   external keys and normalized values match the reviewed source.
3. Record the batch ID, timestamp, actor, input checksum, template and row
   count in the change record.
4. Obtain the data-owner approval for that displayed batch, then use the
   explicit commit confirmation.
5. Confirm `COMMITTED`, the expected created-row count, and the corresponding
   master/ledger result before moving to a dependent file.

`REJECTED` batches are evidence, not candidates for repair or commit. Correct
the source in a new file, repeat the dry run, and record the new batch ID.

## Pilot smoke and handover

After imports are complete, the administrator and customer lead jointly check:

- Each expected customer, supplier, part, material, machine, warehouse,
  definition, physical asset and compatibility appears only once in the
  intended tenant.
- Draft BOM/routing revisions are reviewed and released by the controlled
  engineering workflow, not by CSV import.
- Opening-stock balances, lots and `OPENING_BALANCE` movements reconcile to
  the signed opening-count source.
- A sample work order can select the intended released engineering definition;
  a required tool/fixture setup is blocked when its compatibility is absent.
- The audit/history view shows the actor, checksum, rows and final result for
  each committed batch.
- The team can find `/health/ready`, deployment logs and the support contact
  path without using an administrator password.

Train and obtain attendance/acknowledgement from these audiences before the
first live production shift:

| Audience | Minimum exercise |
| --- | --- |
| Tenant administrator | Download a template, run a dry run, inspect errors, commit an approved batch and find its history. |
| Engineering/planning | Review imported draft BOM/routing, perform the normal release workflow, create a controlled work order. |
| Shop-floor operator | Follow HMI start/pause/report/complete controls; understand that controller state and part count do not create automatic inventory postings. |
| Maintenance/tooling | Read compatibility and asset state; identify that unavailable/incorrect assets block verified setup. |
| Support owner | Locate request ID and relevant batch/WO/machine identifier while excluding credentials and payloads from tickets. |

## Incident and recovery decision

| Condition | Immediate action | Resolution boundary |
| --- | --- | --- |
| Dry run has validation errors | Do not commit. Correct source and submit a new dry run. | No domain data was written. |
| Commit returns conflict/failure | Stop dependent imports, retain batch ID and error category, verify batch result. | The commit transaction is atomic; do not retry by direct database writes. |
| Wrong but successfully committed master data | Stop use of the affected master and open a controlled correction change. | Never delete or overwrite onboarding/audit history. Use the owning controlled workflow or a forward correction. |
| Opening-stock reconciliation mismatch | Stop material execution for the affected item/bin, preserve ledger evidence, reconcile against the signed count. | Correct with audited inventory actions; do not edit balance columns. |
| Suspected broad data corruption | Stop rollout, take a fresh backup, and assess isolated restore to the last approved point. | Primary restore requires the deployment runbook's approved-change process and matching MinIO recovery. |
| Controller evidence issue | Keep MES/manual operations within approved policy; do not claim qualification. | Execute the field-acceptance record with the customer witness. |

## Completion evidence

The change record is complete only when it contains:

- source-file package checksum and customer data-owner approval;
- every dry-run and committed batch ID with actor, timestamp, row counts and
  final status;
- opening-stock reconciliation signed by the data owner;
- pilot smoke results and role-training acknowledgements;
- backup reference, restore-drill reference and support contact/incident path;
- the selected-controller field-acceptance result or an explicit declaration
  that the pilot uses no controller-qualified gate.

The runbook does not make the customer commercially live by itself. The
remaining customer-facing release decision requires this evidence, approved
support ownership, and field acceptance for every selected controller.
