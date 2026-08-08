# SupplySignal AI Design Specification

**Status:** Approved

**Approved by:** Project owner

**Approval date:** 2026-08-08

**Target hackathon:** CALL-E: Your Code Is Calling

**Target prize:** Most Practical Use Case

## 1. Product definition

SupplySignal AI is an operator-controlled AI agent that calls a supplier, collects structured delivery facts, detects supply exceptions, and produces an auditable human-review package.

The product demonstrates one fictional purchase order and one consent-based English-language call to a participant with a supported United States phone number. It does not automate procurement decisions or execute business transactions.

## 2. Approved vertical slice

The operator:

1. Creates a fictional purchase order with a supplier, expected quantity, required delivery date, recipient name, and masked phone number.
2. Reviews the exact call plan and questions.
3. Confirms consent, the recipient region, the phone number, and authorization for one call.
4. Initiates exactly one CALL-E call.
5. Waits while the application persists and reconciles the authoritative call identifier.
6. Reviews the structured supplier response and supporting evidence.
7. Confirms the observed call outcome or marks a conflict.
8. Receives a deterministic supply-risk decision and four review artifacts.

The supplier response captures:

- confirmed quantity;
- currently available quantity;
- promised delivery date;
- delay reason; and
- whether human follow-up is required.

The deterministic risk outcome is one of:

- `ON_TRACK`;
- `AT_RISK`;
- `BLOCKED`; or
- `OUTCOME_UNKNOWN`.

The four artifacts are:

- `supplier-call-summary.md`;
- `structured-result.json`;
- `supply-risk-briefing.md`; and
- `audit-record.json`.

The public application displays a sanitized replay of a verified run and cannot place calls.

## 3. Explicitly excluded scope

The first vertical slice excludes:

- batch or parallel calls;
- application-level automatic call retries;
- automatic redialing;
- real ERP or procurement-system integration;
- payments, purchasing, SMS, or email delivery;
- automatic supplier selection;
- automatic approval of a partial delivery;
- real business data;
- public live-call capability; and
- relying on a webhook as the authoritative completion source.

## 4. Architecture

The project is one strict TypeScript package managed with `pnpm`. Next.js provides the operator interface, server routes, and replay interface. The repository is not a monorepo.

### 4.1 Domain

The domain layer defines purchase orders, call authorization, supplier responses, supply-risk decisions, trust status, and run lifecycle. It has no dependency on Next.js, CALL-E, or OpenAI.

### 4.2 CALL-E adapter

The vertical slice integrates through the CALL-E Developer REST API described by OpenAPI contract version `0.6.0`. It does not depend on CLI login or MCP execution. The implementation records the reviewed contract version and validates the required contract surface with fixtures.

The only CALL-E runtime endpoints in scope are:

- `POST /v1/calls` to create one asynchronous call;
- `GET /v1/calls/{call_id}` to read the authoritative call resource; and
- `GET /v1/calls/{call_id}/events` to populate a bounded operator timeline.

The events endpoint is informational and is not an authoritative completion source. The adapter uses a stable, run-derived `Idempotency-Key` for call creation. Reusing the key with the same request must return the original call; an idempotency conflict is a typed failure and must not trigger a new key automatically.

The CALL-E adapter:

- creates at most one call for an authorized run;
- persists the authoritative `call_id` immediately when available;
- polls the existing call instead of creating a replacement;
- normalizes provider responses and failures into bounded application types;
- uses neither batch dispatch nor webhooks in the vertical slice; and
- never implements application-level automatic redialing.

The one recipient is submitted in E.164 format with `region: "US"` and `locale: "en-US"`. The requested `recipient_result_schema` uses explicit required fields, `additionalProperties: false`, bounded strings and numbers, explicit `unknown` enum values when absence must be represented, and no nullable union types. Provider-specific schema constraints are covered by contract fixtures before any live call.

### 4.3 Run state machine

The run lifecycle consists of:

- `DRAFT`;
- `AWAITING_APPROVAL`;
- `CALL_STARTING`;
- `CALL_IN_PROGRESS`;
- `RECONCILING`;
- `PROVIDER_REPORTED_TERMINAL`;
- `COMPLETED`;
- `OUTCOME_UNKNOWN`; and
- `FAILED`.

An SDK or network timeout does not prove that a call failed. When a call may have been created, the application moves to `RECONCILING` and polls the stored identifier. It must not create another call.

CALL-E `CallStatus` values map into application states as follows:

- provider `queued` maps to `CALL_STARTING`;
- provider `in_progress` maps to `CALL_IN_PROGRESS`;
- provider `completed` maps to `PROVIDER_REPORTED_TERMINAL`, never directly to application `COMPLETED`;
- provider `failed` maps to `FAILED` after the bounded provider error is recorded; and
- provider `canceled` maps to `FAILED` without claiming that the business task succeeded or that no dial attempt occurred.

Unknown provider status values fail closed as `OUTCOME_UNKNOWN`. Recipient and attempt statuses are retained as evidence but cannot independently complete a run.

### 4.4 Deterministic validator

The validator strictly parses external data, compares the supplier response with the purchase order, detects contradictions among the transcript, evidence, and structured result, and computes the authoritative risk outcome.

An LLM cannot set or change the risk outcome, quantities, dates, trust status, or artifact completion state.

### 4.5 OpenAI briefing adapter

The OpenAI adapter receives only sanitized, validated facts. It may create an explanatory briefing but cannot introduce or change critical facts. Its structured output is validated again before publication.

### 4.6 Artifact writer

The artifact writer publishes the four-file package atomically within a validated run directory. It does not expose credentials, full phone numbers, raw provider envelopes, hidden prompts, or unrestricted native paths. A partial or failed package is never marked complete.

### 4.7 Next.js application

The application has two explicit runtime modes:

- **Local operator mode:** server-only credentials and an approval-gated real call.
- **Hosted replay mode:** no CALL-E credentials, no call endpoint, and no mutation capability.

### 4.8 Persistence

Runs are stored on the local filesystem under a validated root. Private runtime records and sanitized public replay data are separate representations. A committed replay fixture contains only reviewed, non-sensitive data.

## 5. Data flow

The approved primary flow is:

`Operator -> manual approval -> CALL-E adapter -> stored call_id -> polling -> strict validation -> deterministic risk decision -> OpenAI briefing -> atomic four-artifact package -> sanitized replay`

## 6. Safety and external effects

A real call requires explicit, run-specific confirmation that:

- the recipient consented to the call;
- the recipient consented to recording and publication for the demo;
- the number belongs to a supported region;
- the number was reviewed for correctness; and
- the call uses fictional business data.

Each authorization permits at most one call. Repeated submissions, browser refreshes, network retries, and duplicate requests must not create another call.

Because an active CALL-E call cannot be guaranteed to support cancellation, the UI uses the truthful label `Stop future processing`. It must not claim to cancel an active call.

The hosted replay receives no CALL-E API key and exposes no route capable of placing a call.

## 7. Trust model

CALL-E output is untrusted external data. A provider-reported terminal state is not automatically a verified business fact.

Each run has one trust status:

- `UNVERIFIED_PROVIDER_RESULT`;
- `CONSISTENCY_CHECK_PASSED`;
- `HUMAN_CONFIRMED`;
- `CONFLICT_DETECTED`; or
- `OUTCOME_UNKNOWN`.

A run may reach `COMPLETED` only after strict schema validation, consistency validation, and explicit human confirmation. Missing transcripts, delayed calls, contradictory evidence, unusable audio, or implausible terminal results prevent completion.

Provider `task_completed` and `completion_confidence` values are advisory evidence only. Neither value, alone or together, can produce `CONSISTENCY_CHECK_PASSED`, `HUMAN_CONFIRMED`, or application `COMPLETED`.

## 8. Error contract

External failures are mapped to the following bounded error codes before crossing application boundaries:

- `AUTHORIZATION_REQUIRED`;
- `UNSUPPORTED_RECIPIENT_REGION`;
- `CALL_NOT_READY`;
- `CALL_CREATION_FAILED`;
- `CALL_OUTCOME_PENDING`;
- `CALL_AUDIO_UNUSABLE`;
- `PROVIDER_RESULT_INVALID`;
- `PROVIDER_RESULT_CONFLICT`;
- `OPENAI_BRIEFING_FAILED`; and
- `ARTIFACT_PUBLICATION_FAILED`.

Raw provider errors, tokens, phone numbers, internal prompts, and provider trace envelopes are not returned to the browser or written to public artifacts.

## 9. Operator interface

The interface contains five stages:

1. **Purchase Order:** fictional order data, masked recipient, `US` region, and `English` language.
2. **Call Plan & Safety Approval:** exact questions, AI disclosure, consent confirmations, limitations, and `Authorize one call`.
3. **Live Run:** bounded state, sanitized event timeline, masked call identifier, and `Stop future processing`.
4. **Human Confirmation:** extracted answers, evidence summary, consistency warnings, confirmation, audited correction, or conflict declaration. A correction creates a separate operator-confirmed value with the original value, replacement value, reason, and timestamp; it never overwrites the original provider response.
5. **Supply Risk Briefing:** authoritative risk status, expected-versus-confirmed quantity, required-versus-promised date, exception reason, recommended human action, trust status, audit trail, and artifact downloads.

## 10. Demonstration scenario

The fictional supplier is `Northstar Components`. Purchase order `PO-2048` requires 500 units by the required date.

During the consented call, the supplier representative confirms:

- 350 units are ready;
- 150 units are delayed;
- the promised date is later than the required date;
- the delay is caused by a component shortage; and
- human follow-up is required.

The deterministic result is `AT_RISK`. The briefing recommends that a human decide whether to accept a partial shipment or engage an alternative supplier.

## 11. Public replay and video

The hosted demo displays the verified run as a `Verified sanitized replay`. It removes the phone number and the participant's identity. Audio is excluded unless separately approved for public release. The replay never claims to be a new live execution.

The public video is under three minutes and shows:

- the purchase order and call plan;
- manual authorization;
- a split-screen excerpt of the real consented call;
- the structured result and trust gate;
- the deterministic risk decision; and
- the four artifacts.

## 12. Preflight gate

Before expanding the product beyond the minimum CALL-E integration, the team performs three controlled calls to the same consenting participant:

1. an answered call following the expected scenario;
2. an answered call in which the participant explicitly declines; and
3. an intentionally unanswered call.

For each call, the team compares the physical observation, timestamps, transcript, structured result, evidence, and any delayed provider retries.

If CALL-E produces fabricated or materially inconsistent outcomes, the team stops expansion and revisits the product design. It must not encode unreliable behavior as a passing invariant.

## 13. Testing and CI

Every behavior change follows test-driven development: failing test, minimal implementation, passing test, and refactor.

Required automated coverage includes:

- risk-decision boundaries;
- single-use call authorization;
- duplicate-call prevention;
- timeout reconciliation;
- strict external schemas;
- invalid and conflicting provider results;
- the human-confirmation completion gate;
- phone, transcript, and trace sanitization;
- atomic four-artifact publication;
- absence of call capability in replay mode; and
- primary operator and public replay browser flows.

Required CI is deterministic, offline, credential-free, and based on committed sanitized fixtures. It runs strict TypeScript checks, formatting, zero-warning lint, tests, build, post-build tree-cleanliness checks, and secret scanning. Dependencies are pinned, the lockfile is frozen, and third-party GitHub Actions are pinned to full commit SHAs.

Live CALL-E and OpenAI checks are manual, bounded, explicitly environment-gated, and reported separately from required CI.

## 14. Optional operator tooling

The portable CALL-E skill, `@call-e/cli`, and MCP tools `plan_call`, `run_call`, and `get_call_run` may be installed globally for manual setup verification or an explicitly authorized preflight. They are not application dependencies, CI dependencies, deployment dependencies, or runtime integration paths.

CLI authentication uses its browser OAuth flow and local cache. The cache remains outside the repository and is never copied into deployment. On Windows, operator documentation must use native PowerShell environment-variable syntax instead of copying the installation guide's Unix `env` command form.

Setup verification may check authentication and tool availability but must not place a call. Any preflight call remains subject to the same run-specific consent and authorization boundary as an application call.

## 15. Repository and release

The project resides in `D:\2026 AI\SupplySignal AI` and is published as the public repository `nextsukhorutchenko/supplysignal-ai` with an Apache 2.0 license. Code, documentation, tests, UI text, commits, and repository artifacts are written in English.

LineageGuard AI remains an independent completed project. Its source code is not copied into this repository.

Before submission, the project requires:

- a clean whole-branch review;
- green required CI;
- a replay-only public deployment;
- a Git tag and GitHub Release;
- setup and operator documentation;
- public examples of all four artifacts;
- a contribution pull request to `CALLE-AI/awesome-phone-call-agents`;
- a public video under three minutes; and
- a complete Devpost submission.

Consent evidence remains private and must not contain publicly exposed personal data.

## 16. Acceptance criteria

The vertical slice is accepted only when all of the following are true:

1. A run cannot create a real call without explicit one-time authorization.
2. A run cannot create more than one CALL-E call, including after timeout or duplicate submission.
3. The authoritative call identifier is persisted and reconciled without redialing.
4. Untrusted CALL-E and OpenAI outputs are size-bounded, strictly validated, and sanitized.
5. A provider-reported result cannot become `COMPLETED` without consistency validation and human confirmation.
6. The risk result is deterministic and cannot be overridden by an LLM.
7. A completed run publishes exactly four valid artifacts atomically.
8. A failed, conflicting, timed-out, or incomplete run is never represented as completed.
9. Hosted replay mode contains no CALL-E credential or callable external-effect route.
10. Required CI passes without secrets, live services, or mutable external dependencies.
11. The three-call preflight is documented truthfully before the final demo.
12. The public replay and video contain no unapproved personal information or credentials.
13. The runtime integration conforms to the reviewed CALL-E OpenAPI `0.6.0` surface, uses `US` and `en-US`, and fails closed on unknown provider status values.
14. CLI, MCP, OAuth cache, and the portable CALL-E skill are absent from required application runtime, CI, and hosted replay deployment.
