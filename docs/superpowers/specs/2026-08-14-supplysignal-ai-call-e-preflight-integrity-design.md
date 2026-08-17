# SupplySignal AI CALL-E Preflight Integrity Correction (A21)

**Status:** Approved design

**Date:** 2026-08-14

**Scope:** Narrow correction to the Task 8 CALL-E client timeout, bilingual
supplier-call instructions, and preflight evidence integrity gate. This
specification does not authorize a live call, Task 9 implementation, retry,
redial, persistence expansion, or merge.

## 1. Authority and evidence

This correction extends, and is subordinate to, the approved SupplySignal AI
product design, canonical recipient-profile specifications, and Amendment A20
except where Section 3 explicitly supersedes the create-request timeout:

- `docs/superpowers/specs/2026-08-08-supplysignal-ai-design.md`;
- `docs/superpowers/specs/2026-08-10-supplysignal-ai-kenya-recipient-profile-design.md`;
- `docs/superpowers/specs/2026-08-11-supplysignal-ai-ukraine-recipient-profile-design.md`;
- `docs/superpowers/specs/2026-08-11-supplysignal-ai-ambiguous-create-incident-recovery-design.md`;
- `AGENTS.md`.

CALL-E support recovered the Ukrainian call that the application created on
2026-08-11 after the create request timed out. The private support result
established these facts:

- the server accepted the call and returned an authoritative Developer API
  `call_id` to support tooling, but the application did not receive it;
- CALL-E call planning took about 20 seconds, exceeding the application's
  15-second client timeout;
- the provider completed the Ukrainian call without a calling-provider outage;
- CALL-E stored a transcript and structured result, while audio was unavailable;
- the recovered structured result reported confirmed quantity `500`, available
  quantity `17`, and delayed quantity `5`;
- the transcript contained an explicit refusal of manager transfer, while the
  structured result reported that follow-up was required; and
- a separate CALL-E visibility issue prevented the API-originated call from
  appearing in Dashboard Recents/Search.

The private transcript, participant phone, account identity, full recovered
`call_id`, and support trace remain outside Git. Repository documentation may
contain only an allowlisted sanitized projection and a masked call identifier.

## 2. Problem statement

The existing integration fails safely after an ambiguous create, but the fixed
15-second timeout is shorter than the observed CALL-E planning duration. It can
therefore disconnect before a successful create response contains the
authoritative identifier. Increasing only the create-response wait reduces this
avoidable ambiguity without granting another create attempt.

Separately, the recovered result proves that provider extraction can be
structurally valid while contradicting arithmetic or the transcript. The
existing domain already rejects unreconciled quantities through
`supplierResponseSchema`, and deterministic risk assessment returns
`OUTCOME_UNKNOWN` for inconsistent facts. Task 8, however, needs an explicit
integrity gate before a terminal provider result can be described as acceptable
preflight evidence.

Task 9 remains the authority for evidence citations, operator corrections,
conflict declarations, and immutable human confirmation. A21 must not duplicate
or prematurely implement that trust workflow.

## 3. Timeout correction

The CALL-E client must use two fixed server-side timeout constants:

- create request: `30_000` milliseconds;
- GET call and events reads: `15_000` milliseconds.

This section narrowly supersedes A20's statement that the 15-second client
timeout is unchanged and the corresponding 15-second create-request instruction
in the main implementation plan. It does not supersede any A20 recovery rule.

The create timeout is only a longer wait for the response to the single
authorized POST. It must not add:

- an automatic or manual retry path inside the client;
- redialing;
- a replacement idempotency key;
- a configurable browser, CLI, or environment override;
- a recovery POST after process restart; or
- a claim that 30 seconds eliminates ambiguous creates.

Any timeout, network exception, ambiguous 2xx response, unreadable 201 response,
or uncertain server failure after the POST begins remains
`CALL_OUTCOME_PENDING` with kind `ambiguous_create`. Existing no-ID recovery
remains manual. Stored-ID reconciliation remains GET-only.

## 4. Bilingual task hardening

The English and Ukrainian CALL-E task builders must preserve the complete AI
disclosure and the existing concise-turn policy. They must also instruct the
agent to:

1. ask one short question at a time;
2. collect confirmed, available-now, and delayed quantities separately;
3. when the three quantities do not reconcile, repeat the three values and ask
   exactly one clarification question;
4. never calculate, repair, or invent a quantity on the recipient's behalf;
5. set human follow-up to `yes` only after an explicit request for a manager,
   transfer, callback, or other human follow-up;
6. set human follow-up to `no` after an explicit refusal of human follow-up;
7. use `unknown` when the conversation does not establish the answer; and
8. stop politely after an explicit refusal to continue.

The request remains bounded to 4,000 characters, uses the canonical recipient's
region and locale, keeps one recipient, and retains the strict result schema
with `additionalProperties: false`. Prompt instructions improve collection but
are never treated as validation.

## 5. Pure preflight integrity boundary

A new small, deterministic domain module validates whether a normalized
terminal provider snapshot is mechanically suitable for Task 8 review. It must
accept untrusted input only through existing plain-data and strict domain
boundaries.

For an answered or declined observation, an acceptable snapshot requires:

- provider status `completed`;
- a non-null structured result;
- successful `supplierResponseSchema` validation, including
  `availableQuantity + delayedQuantity === confirmedQuantity`;
- at least one bounded, non-empty user transcript turn; and
- a contact outcome consistent with the named Task 8 scenario at the mechanical
  level (`reached` for answered and `declined` for declined).

For a no-answer observation, an acceptable snapshot requires the existing
truthful no-answer sentinel: `contactOutcome === "no_answer"`, zero quantities,
and explicit unknown values for unavailable supplier facts. It must not infer
supplier facts from a completed provider resource.

The integrity boundary intentionally does not determine whether a transcript
semantically supports every structured field. The operator must compare the
private transcript and structured result. Task 9 later owns exact evidence IDs,
corrections, conflict declarations, and confirmation.

Invalid input returns a bounded `PROVIDER_RESULT_INVALID` failure. The failure
must not copy a transcript excerpt, phone, quantity, provider payload, native
path, or schema diagnostic across the CLI boundary.

## 6. Live preflight composition

The guarded live preflight invokes the pure integrity boundary only after
terminal reconciliation and before reporting a successful scenario result.
The named scenario is part of the validation input.

If the integrity gate fails:

- the CLI exits nonzero with only `PROVIDER_RESULT_INVALID`;
- the process-global one-call permit remains consumed;
- no second create request is possible in the process;
- no success evidence file is published;
- the private run store remains available for local incident investigation;
- the run is not labelled a Task 8 PASS; and
- Task 9 remains blocked.

This correction does not add a post-call browser workflow, provider-identity
input, Billing import, recovered-call import, or new persistence field.

## 7. Recovered-call classification

The recovered Ukrainian call is sanitized incident evidence, not a formal
Northstar preflight PASS. It proves:

- Ukraine routing and Ukrainian conversation worked for the consented call;
- the application can time out before CALL-E returns an authoritative ID;
- no retry/redial was the correct response; and
- deterministic validation is necessary because provider extraction can be
  materially inconsistent.

It does not satisfy the Task 8 gate because the application did not receive the
authoritative ID, audio is unavailable, and the structured result conflicts
with both arithmetic and the transcript. Repository documentation must retain
`Task 8: failed` and `Task 9: blocked` for this observation.

## 8. TDD requirements

### 8.1 Client timeout tests

Tests must first fail against the current shared 15-second timeout, then prove:

- create uses exactly `30_000` milliseconds;
- GET call and events use exactly `15_000` milliseconds;
- a create timeout invokes fetch exactly once and yields
  `CALL_OUTCOME_PENDING`/`ambiguous_create`; and
- redirect, strict-response, and existing GET retry behavior are unchanged.

### 8.2 Request tests

English and Ukrainian request tests must fail before the prompt change and then
prove the approved clarification, non-invention, and follow-up semantics are
present while disclosure, canonical locale mapping, strict result schema, and
the 4,000-character bound remain intact.

### 8.3 Integrity tests

Focused positive, negative, boundary, and regression coverage must include:

- accepted answered facts `500 = 350 + 150`;
- rejected recovered-result shape `500 != 17 + 5`;
- rejected reached outcome without a user transcript turn;
- rejected completed snapshot without structured result;
- accepted truthful declined and no-answer scenarios;
- rejected scenario/outcome mismatch;
- rejected unknown properties, custom prototypes, and accessor-backed input
  without invoking getters; and
- bounded failure text that contains none of the raw invalid values.

### 8.4 Composition tests

The existing guarded CLI test seam and fake fetch must prove that an invalid
completed result:

- performs exactly one create POST;
- returns `PROVIDER_RESULT_INVALID`;
- cannot publish successful private evidence;
- cannot reset the one-call permit or create another call; and
- uses no live service, credential, browser, or real phone.

## 9. Verification and review gates

Implementation must run, in order:

1. focused RED/GREEN tests for each changed boundary;
2. an explicit affected-file test selection whose selected files are printed;
3. the full offline `pnpm verify` gate;
4. typecheck, zero-warning lint, formatting, production build, and
   `git diff --check` through the repository gate;
5. an addition-only privacy scan that does not print matched values; and
6. independent specification-compliance and code-quality reviews with no
   unresolved Critical or Important findings.

The repository secret-scanner implementation remains truthfully unavailable
until its planned task creates the target file. It must not be described as
passing.

No live CALL-E request, OpenAI request, phone call, provider lookup, Dashboard
mutation, deploy, merge, or release is part of implementation verification.

## 10. Files and scope

Expected runtime and test files:

- `src/adapters/calle/client.ts`;
- `src/adapters/calle/client.test.ts`;
- `src/adapters/calle/request.ts`;
- `src/adapters/calle/request.test.ts`;
- `src/domain/preflight-integrity.ts`;
- `src/domain/preflight-integrity.test.ts`;
- `scripts/live-preflight.ts`;
- `scripts/live-preflight.test.ts`.

Expected documentation updates:

- this specification;
- the sanitized ambiguous-create observation;
- `docs/operator-runbook.md`;
- the main implementation plan's Task 8 and traceability sections; and
- the A20 implementation plan only where it must reference this superseding
  correction.

The correction does not change application state transitions, persistence
format, authorization digest, idempotency derivation, public API routes, UI,
OpenAI integration, dependencies, or toolchain.

## 11. Acceptance criteria

Correction A21 is complete only when:

1. a create response may be awaited for 30 seconds while each call/events read
   remains bounded to 15 seconds;
2. every run can still invoke the create gateway at most once;
3. both task languages contain the approved clarification and follow-up rules;
4. the recovered inconsistent quantity shape cannot pass the integrity gate;
5. invalid terminal evidence yields only `PROVIDER_RESULT_INVALID`;
6. the complete offline verification and both independent reviews pass;
7. committed documentation contains no full transcript, phone, account name,
   private path, credential, or full recovered `call_id`;
8. the draft pull request truthfully describes the runtime correction;
9. the pull request remains draft until separately authorized; and
10. Task 9 remains blocked until a new, separately authorized three-scenario
    preflight produces authoritative API IDs, terminal GET results, physical
    observations consistent with provider evidence, and reviewed sanitized
    evidence.
