# SupplySignal AI Concise Call Turns — Design Amendment

**Status:** Approved by the project owner on 2026-08-10

**Date:** 2026-08-10

**Applies to:** `src/adapters/calle/request.ts` call-task construction

**Supersedes:** Only the spoken-turn guidance in the approved SupplySignal AI design

## 1. Purpose

SupplySignal AI must keep the supplier conversation responsive without weakening
its disclosure, evidence, safety, or one-call boundaries. Long agent turns can
increase perceived latency and make the fictional purchase-order scenario harder
for a participant to follow. This amendment adds a minimal conversation policy to
the existing CALL-E task.

## 2. Approved approach

Use a prompt-only policy inside the existing canonical CALL-E request. Do not add
a dialogue engine, a second provider path, new schema fields, or a separate
runtime configuration mode.

The complete AI-assisted and recording disclosure remains mandatory and must be
spoken before the operational questions. After that disclosure, the agent must:

1. keep each spoken turn to one or two short sentences;
2. ask only one question at a time and wait for the recipient's answer;
3. avoid reading the complete purchase order in one turn; and
4. avoid repeating facts that the recipient has already confirmed.

The canonical English instruction added to the CALL-E task is:

```text
After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.
```

This instruction must appear immediately after the existing mandatory disclosure
and before the first purchase-order question.

## 3. Preserved behavior

This amendment does not change:

- the disclosure text or its position as the first conversational instruction;
- the fictional Northstar Components workflow or requested supplier facts;
- `declined`, `no_answer`, or unknown-outcome handling;
- the strict `recipient_result_schema`, including explicit `unknown` values and
  `additionalProperties: false`;
- US `en-US` recipient constraints;
- idempotency, authorization, one-POST, no-retry, or no-redial guarantees;
- provider response validation, deterministic risk assessment, persistence,
  artifacts, replay, API, UI, or deployment behavior; or
- credentials, permissions, dependencies, and external effects.

## 4. Failure and safety behavior

The existing request builder remains authoritative. Unsafe control characters,
invalid input, or a task exceeding the existing 4,000-character bound continue to
fail with the existing bounded `CALL_CREATION_FAILED` error before provider I/O.
The concise-turn policy must never shorten, omit, or defer the mandatory
disclosure. It must not create a fallback call path or a reason to retry a call.

## 5. Verification

Implementation follows TDD and changes only the request builder and its focused
tests.

The focused regression must prove that the generated task:

- retains the complete disclosure before all operational guidance;
- contains the canonical concise-turn instruction exactly once;
- places it after disclosure and before the purchase-order question;
- retains the existing decline and no-answer safeguards; and
- stays within the existing 4,000-character task bound.

After the focused RED/GREEN cycle, run the explicit affected CALL-E adapter tests,
the complete offline repository suite, strict TypeScript, zero-warning lint,
formatting, the production build, `git diff --check`, and the repository-provided
secret/build-clean gates when their implementation files exist.

No live CALL-E request, phone call, credential, browser action, deployment, push,
or publication is part of this amendment. The three live preflight scenarios
remain separately and freshly authorized gates after this change is reviewed and
merged.

## 6. Acceptance criteria

1. The mandatory disclosure remains complete and first.
2. The canonical concise-turn policy appears once, immediately after disclosure.
3. Every post-disclosure turn is instructed to use one or two short sentences.
4. The agent is instructed to ask one question at a time and wait for an answer.
5. The agent is instructed not to read the full purchase order at once or repeat
   confirmed facts.
6. Existing request schema, safety, external-effect, and error behavior remains
   unchanged.
7. All relevant deterministic offline gates pass without credentials or live
   provider access.
