# CNC-V1-05 — Mitsubishi M80 Controller Production Qualification

## Current status

**SOFTWARE_READY_FIELD_VALIDATION_REQUIRED.** Simulator, adapter-contract, and PostgreSQL tests prove the software boundary only. No representative Mitsubishi M80 controller has been field-tested, so no machine is field-qualified.

## Canonical boundary

`WorkOrderOperation` and `ProductionRun` remain the canonical MES state. Controller observations are read-only evidence: they do not start a physical cycle, create MES quantities, consume material, receive inventory, or change a work order. The backend uses persisted evidence only for protected MES start/resume. Manual/non-connected machines retain their existing workflow.

The connector owns transport polling. The backend owns tenant-scoped persistence, current-state lookup, and gate policy. The HMI displays server state/errors and cannot bypass a gate.

## Capability and support matrix

| Capability | Software state | Qualification |
| --- | --- | --- |
| CONNECTIVITY, MACHINE_STATE_READ, CYCLE_STATE_READ | Implemented | Simulator verified |
| ACTIVE_PROGRAM_IDENTITY_READ | Implemented with explicit configured address | Simulator verified; field address/protocol pending |
| ALARM_READ, PART_COUNTER_READ | Implemented as observations | Simulator verified |
| PROGRAM_CONTENT_READ, PROGRAM_CHECKSUM_READ | Not supported | Not supported |
| FEED_OVERRIDE_READ, SPINDLE_STATE_READ | Not supported | Not supported |
| PROGRAM_TRANSFER, REMOTE_START | Not supported | Not supported |

Part count is diagnostic/trace evidence only, never production-quantity authority. A released checksum is expected data only; V1 makes no controller checksum/content-readback claim.

## Trust, state, and freshness

Trust levels are `SIMULATED`, `CONFIGURED`, `OBSERVED`, and `CONTROLLER_VERIFIED`; they are never interchangeable. A configured/simulated observation cannot verify a program. Connection state is `UNKNOWN`, `CONNECTING`, `ONLINE`, `DEGRADED`, or `OFFLINE`. Machine state is normalized while retaining raw diagnostic data.

Each observation persists machine/tenant, controller and ingestion time, connection generation, capability set, active program identity, state, alarm, and part counter. The indexed newest row is the current-state projection; prior rows are retained for diagnostics and later OEE evidence.

Protected machines have a configurable freshness threshold (5–3600 seconds). Expected program identity is read from the immutable released WO snapshot and compared against fresh observed controller identity as `MATCH`, `MISMATCH`, `UNVERIFIED`, `STALE`, or `UNSUPPORTED`. Only `MATCH` passes. Server errors are `CNC_OFFLINE`, `CNC_DATA_STALE`, `CNC_PROGRAM_UNVERIFIED`, `CNC_PROGRAM_MISMATCH`, and `CNC_ALARM_ACTIVE`.

Reconnect increments connection generation and requires a fresh observation, so a pre-disconnect match cannot authorize resume. Connector/controller restart likewise requires a fresh read. Disconnect during an active MES run changes controller evidence only; it never auto-pauses, completes, scraps, or changes physical-machine state.

## Configuration, diagnostics, and security

M80 machine configuration is tenant/plant/machine scoped: adapter type, host/port, explicit program-identity address, required-verification policy, and freshness timeout. Invalid endpoint/port, M80 policy on another adapter, and required verification without a program address are server-rejected; no silent downgrade exists. HMI and Automation Gateway show connection, observation age, expected/observed NC, verification result, state, alarm, and blocking reason without exposing credentials.

The raw M80/EZSocket prototype is not asserted to provide encryption or authentication. Deploy the connector in a segmented customer OT network and do not expose controller endpoints publicly. Existing connector-to-backend machine-key protections remain in force. There is no V1 verification override, program transfer, or remote cycle start.

## Field qualification boundary

`VERIFIED_DONE` requires a real M80 to prove connection, actual machine state, active program A match, program B mismatch/block, stale/disconnect, reconnect after changing to B, and safe restart recovery. Follow `CNC-V1-05-M80-FIELD-ACCEPTANCE.md`; until its mandatory evidence exists, commercial wording must remain software-ready pending named-machine field qualification.
