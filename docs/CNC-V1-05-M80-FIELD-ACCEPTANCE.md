# CNC-V1-05 — Mitsubishi M80 Field Acceptance Record

## Preconditions

- Approved maintenance/test window and safe non-production program.
- Customer approval for network interruption and controller restart testing.
- Released AHKMES NC snapshot **A** and distinct controller program **B**.
- Connector is in the OT network; controller endpoint is never public.
- Do not record passwords, tokens, proprietary program content, or secrets here.

## Environment record

| Field | Evidence |
| --- | --- |
| Date/time/timezone | |
| Tenant/plant | |
| Machine identifier | |
| M80 model/controller version | |
| Adapter build | |
| Tester/customer witness | |
| Logs/screenshots (restricted reference) | |

## Mandatory acceptance cases

| ID | Procedure | Expected result | Actual raw/normalized evidence | Result |
| --- | --- | --- | --- | --- |
| M80-01 | Connect approved endpoint. | Fresh `ONLINE` observation and identity/state where available. | | |
| M80-02 | Observe safe idle/ready condition. | Raw and normalized state are timestamped. | | |
| M80-03 | MES expects A; select/load A. | Actual A, `MATCH`, and protected start/resume allowed after other gates. | | |
| M80-04 | MES expects A; select B. | Actual B, `MISMATCH`, protected start/resume blocked. | | |
| M80-05 | Safely interrupt network. | `OFFLINE`/`STALE`; cached A cannot pass gate. | | |
| M80-06 | While isolated select B; reconnect. | Fresh new-generation B observation, `MISMATCH`, protected transition blocked. | | |
| M80-07 | Exceed freshness threshold safely. | `STALE`; protected transition blocked. | | |
| M80-08 | Approved controller reboot/equivalent. | Old evidence loses trust; fresh state/program read after recovery. | | |
| M80-09 | Safe approved alarm test, if possible. | Alarm is represented and gate blocks; otherwise record `FIELD_NOT_TESTED`. | | |
| M80-10 | Safe test cycle. | Supported state transition is timestamped; no automatic MES quantity/inventory posting. | | |

## Qualification record

| Capability | Result | Evidence/limitations |
| --- | --- | --- |
| CONNECTIVITY | NOT YET FIELD TESTED | |
| MACHINE_STATE_READ | NOT YET FIELD TESTED | |
| ACTIVE_PROGRAM_IDENTITY_READ | NOT YET FIELD TESTED | |
| PROGRAM_CHECKSUM_READ | NOT SUPPORTED | No controller checksum claim. |
| ALARM_READ | NOT YET FIELD TESTED | |
| PART_COUNTER_READ | OBSERVATION ONLY | Not production accounting authority. |
| PROGRAM_TRANSFER | NOT SUPPORTED | |
| REMOTE_START | NOT SUPPORTED | |

Final approver: ____________________  Date: ____________________

`VERIFIED_DONE` is prohibited until M80-01 through M80-08 have real-machine evidence. Simulator/emulator/tag evidence is not field evidence.
