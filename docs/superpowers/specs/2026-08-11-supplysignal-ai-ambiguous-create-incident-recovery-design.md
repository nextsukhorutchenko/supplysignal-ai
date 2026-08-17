# SupplySignal AI Ambiguous Create Incident and Recovery Amendment

**Status:** Approved design

**Date:** 2026-08-11

**Amendment:** A20

**Scope:** Define the operator recovery workflow and future UI contract for a
CALL-E create request that times out without returning a Developer API call
identifier, even when a real call or billing record may later exist.

## 1. Product authority and scope

This amendment extends the approved SupplySignal AI design with a precise
incident classification, a manual recovery procedure, and mandatory future UI
behavior for an ambiguous CALL-E create result without a Developer API
`call_id`.

It does not change the CALL-E request, the 15-second client timeout, approved
REST endpoints, persistence format, state machine, idempotency derivation,
authorization model, provider mapping, risk logic, artifacts, public replay,
or the number of permitted create attempts.

The existing absolute one-create-POST boundary remains authoritative:

- only the invocation that wins the atomic approval-to-start claim may issue
  the one create POST;
- a later invocation that reads `CALL_STARTING` or `RECONCILING` without a
  stored `call_id` performs no provider create operation;
- reconciliation with a stored `call_id` remains GET-only; and
- an ambiguous result, restart, empty Dashboard, or missing billing details
  never authorizes a retry, redial, or replacement idempotency key.

This amendment explicitly carries Correction A12.1 forward and supersedes any
older plan wording that permits a recovery POST when no `call_id` is stored.

## 2. Incident classification

The application classifies the following condition as **ambiguous create
without Developer API call ID**:

1. `POST /v1/calls` was authorized and submitted once.
2. The client received no valid Developer API `call_id`, including because of
   a timeout, network failure, invalid successful response, or other ambiguous
   create outcome.
3. The provider may still create, route, bill, or complete a real call.
4. The durable run remains `RECONCILING` and the application returns bounded
   `CALL_OUTCOME_PENDING`.

The absence of a response is not evidence that no call occurred. A later ring,
conversation, billing entry, or call record does not convert the run to a
verified result unless the application obtains the authoritative Developer API
`call_id` and terminal resource required by the approved trust flow.

The identifiers are distinct:

| Identifier | Meaning | Recovery authority |
| --- | --- | --- |
| Developer API `call_id` | Identifier returned by the CALL-E Developer REST API | Authoritative for `GET /v1/calls/{call_id}` and event retrieval |
| Local run ID | SupplySignal AI persistence and workflow identifier | Authoritative only inside SupplySignal AI |
| MCP or CLI run identifier | Identifier from optional CALL-E tooling | Informational unless the Developer API explicitly exposes the same `call_id` |
| Billing reference | Identifier displayed by CALL-E Billing | Informational; it must not be inserted or guessed as a Developer API `call_id` |

A `404` from `GET /v1/calls/{billing-reference}` does not prove that the call
did not occur and does not authorize another POST.

## 3. Observation and recovery workflow

When an ambiguous create occurs without a stored `call_id`, the operator must:

1. Stop all call-creation activity for that run immediately.
2. Preserve the private run directory and its immutable history.
3. Begin a 10-minute observation window measured from the client timeout or
   ambiguous response.
4. Monitor the consenting recipient's phone for ringing, a conversation, a
   delayed call, or a duplicate call.
5. Review CALL-E Billing and Call Records as informational surfaces without
   treating an empty screen as proof of failure.
6. Record only the bounded private incident evidence defined below.
7. If an authoritative Developer API `call_id` becomes available, continue
   GET-only reconciliation for that identifier.
8. If a call or charge exists but no Developer API `call_id` is available,
   keep the run in `RECONCILING` and escalate privately to CALL-E support.
9. If nothing is observed during the 10-minute window, keep the result
   unresolved and request a separate owner decision. Do not reuse the run or
   its authorization for another call.

The 10-minute window is an operator observation period, not a network retry
window. It does not extend the client request, poll an unknown identifier,
reset the process-wide permit, or authorize provider mutation.

## 4. Incident evidence and privacy

The private incident record may contain only the minimum evidence needed for
diagnosis:

- scenario name;
- application commit and reviewed CALL-E OpenAPI version;
- approximate UTC request, timeout, ring, answer, and end timestamps when
  observed;
- canonical country, language, region, and locale;
- masked phone number;
- observed duration and cost;
- full Billing reference only in private evidence when one exists;
- participant-observed outcome stated without identity or business secrets;
- Dashboard, Call Records, and Billing visibility;
- whether a delayed or duplicate call occurred; and
- the bounded result of private support escalation.

Repository content, public screenshots, public issues, Discord messages,
artifacts, and replay data must not contain:

- an API key or other credential;
- a full phone number;
- participant identity or consent evidence;
- a full Billing reference;
- raw transcript, audio, provider envelope, or hidden prompt;
- a native private path; or
- an unbounded dependency error.

Public or committed evidence may use an allowlisted projection with a masked
identifier suffix, approximate timestamps, canonical profile, duration, cost,
human observation, and a truthful pass/fail classification.

## 5. Formal preflight gate

An ambiguous call without a Developer API `call_id` is incident evidence, not
a successful truthfulness preflight.

The observed Ukrainian call may demonstrate that the `UA/uk-UA` route placed a
call and supported interactive Ukrainian speech. It does not establish that
the application received, validated, or reconciled the provider's structured
result. It therefore cannot satisfy Task 8 by itself.

Task 9 remains blocked until a new, separately authorized preflight produces
all of the following:

1. exactly one create POST and no retry or redial;
2. an authoritative Developer API `call_id`;
3. a terminal provider resource retrieved through the approved GET path;
4. a non-fabricated structured result and evidence appropriate to the named
   scenario;
5. a physical human observation consistent with the provider result; and
6. a sanitized, independently reviewed preflight report.

Each new live scenario requires fresh project-owner authorization and current
participant readiness. This amendment grants no live-call authority.

## 6. Future Task 13 UI contract

Task 13 must render an explicit neutral or amber recovery state for
`RECONCILING` without a `call_id`. It must not use a generic success, failure,
or retry presentation.

The UI must display this bounded message:

> **Call response timed out**
>
> The call may still occur even though no Developer API call ID was received.
> Do not start another call. Monitor the recipient phone and CALL-E Billing for
> 10 minutes, then follow the recovery instructions.

The recovery panel displays only:

- the `RECONCILING` status;
- masked recipient;
- canonical country, language, region, and locale;
- approximate UTC attempt time;
- `Developer API call ID: Not received`;
- the 10-minute observation checklist; and
- a short explanation that a Billing reference is not an API `call_id`.

The only permitted actions are:

- **View recovery instructions**;
- **Record observation**;
- **Copy sanitized support summary**; and
- **Stop future processing**.

The recovery panel must not render or enable:

- Retry;
- Redial;
- Start another call;
- generation or entry of another idempotency key;
- entry of a Billing reference as a Developer API `call_id`;
- a completed or failed result inferred only from timeout; or
- a claim that an active provider call can be cancelled.

Refresh and process restart must preserve the unresolved presentation. The UI
may poll only when a stored Developer API `call_id` exists; no-ID
`RECONCILING` is a manual-observation state and performs no provider request.

## 7. Future UI verification requirements

Task 13 component and browser tests must prove that:

- ambiguous create never renders success or confirmed failure;
- no retry, redial, or start-another-call control is present;
- no-ID `RECONCILING` performs zero CALL-E provider operations;
- stored-ID reconciliation remains GET-only;
- refresh and restart preserve the recovery state and its one-call boundary;
- the observation checklist and exact bounded warning are accessible;
- the support summary contains no full phone, credential, full Billing
  reference, native path, raw provider data, or participant identity;
- a Billing reference cannot be submitted as `call_id`; and
- **Stop future processing** does not claim cancellation of a call that may
  already be active.

These are future Task 13 requirements. This amendment does not implement the
UI or add artificial runtime tests to a documentation-only change.

## 8. Documentation implementation

The documentation implementation for this amendment must:

- add the complete ambiguous-create procedure to
  `docs/operator-runbook.md`;
- add a sanitized, time-bounded research observation for the Ukrainian
  incident without committing private evidence;
- update Task 13 in the main implementation plan with the recovery panel,
  actions, exclusions, and future tests;
- correct obsolete plan wording that permits a recovery POST without a stored
  `call_id`; and
- state explicitly that Task 9 remains blocked.

No runtime source, API route, domain type, persistence schema, dependency,
provider configuration, timeout, or CI behavior changes in this documentation
implementation.

## 9. Verification

Because the immediate implementation is documentation-only, it must not add
artificial behavior tests. Verification consists of:

- repository formatting checks applicable to Markdown;
- `git diff --check`;
- internal link and terminology review;
- a contradiction scan against Correction A12.1 and the current runtime;
- a manual scan of changed files for credentials, full phone numbers, full
  Billing references, participant identity, raw provider data, and native
  private paths; and
- focused diff and repository-status inspection.

No live CALL-E request, phone call, browser action, provider lookup, push,
deployment, or public publication is part of this amendment.

## 10. Acceptance criteria

1. Ambiguous create without `call_id` is documented as `RECONCILING` and
   `CALL_OUTCOME_PENDING`, never as success or confirmed failure.
2. The operator observes for 10 minutes and never retries or redials the run.
3. Developer API `call_id`, local run ID, optional-tool identifier, and Billing
   reference are explicitly distinguished.
4. Recovery with a stored `call_id` is GET-only; recovery without one is manual
   and performs no provider request.
5. The sanitized Ukrainian observation is useful but is not a formal
   truthfulness preflight PASS.
6. Task 9 remains blocked until a separately authorized call has an
   authoritative `call_id`, terminal result, consistent human observation, and
   independently reviewed sanitized evidence.
7. Future Task 13 UI provides the exact recovery state, safe actions, and
   prohibited controls defined above.
8. Repository documentation contains no credential, full phone, participant
   identity, consent evidence, full Billing reference, raw transcript, raw
   provider envelope, or native private path.
9. Runtime behavior, external APIs, persistence, dependencies, and live-call
   authority remain unchanged.
