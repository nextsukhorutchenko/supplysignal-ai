# SupplySignal AI CALL-E Preflight Integrity Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce avoidable ambiguous CALL-E creates, improve bilingual supplier
fact collection, and reject mechanically invalid terminal preflight evidence
before SupplySignal AI reports a Task 8 scenario as successful.

**Architecture:** Keep the single authorized create POST, stable idempotency key,
existing recovery state machine, persistence format, and three-endpoint CALL-E
boundary unchanged. Split the adapter's fixed create/read timeouts, strengthen
the two allowlisted task prompts, add one pure domain integrity boundary, and
invoke it inside the guarded CLI after terminal reconciliation but before
private success evidence publication.

**Tech Stack:** Node.js `22.23.1`, TypeScript `7.0.2` CLI with TypeScript `6.0.2`
compatibility API, pnpm `11.20.0`, Zod `4.4.3`, Vitest `4.1.10`, Next.js
`16.3.0`, ESLint `9.39.5`, Prettier `3.9.6`, PowerShell-compatible repository
checks.

## Global Constraints

- Product authority is
  `docs/superpowers/specs/2026-08-14-supplysignal-ai-call-e-preflight-integrity-design.md`.
- A create request uses exactly `30_000` milliseconds; GET call and events
  reads each use exactly `15_000` milliseconds.
- The longer create wait must not add retry, redial, a replacement idempotency
  key, a runtime override, or a recovery POST.
- Every guarded process can still execute at most one create POST, and a
  consumed permit is never reset after provider execution begins.
- Preserve full AI disclosure, one short question at a time, canonical
  recipient region/locale, one recipient, strict result schema,
  `additionalProperties: false`, and the 4,000-character task bound.
- Treat provider snapshots as untrusted plain data and validate them through
  existing strict schemas before decision use or publication.
- Invalid terminal evidence crosses the CLI boundary only as
  `PROVIDER_RESULT_INVALID`; never copy transcript text, quantities, phone,
  provider payloads, schema diagnostics, credentials, or native paths.
- The recovered Ukrainian call remains sanitized incident evidence, not a
  formal Task 8 PASS; Task 9 remains blocked.
- Do not alter state transitions, persistence format, authorization digest,
  idempotency derivation, public API routes, UI, OpenAI integration,
  dependencies, or toolchain.
- Mandatory and ordinary tests remain deterministic, offline,
  credential-free, and independent of live CALL-E or OpenAI services.
- Do not place a live call, query CALL-E, open the Dashboard, deploy, merge, or
  release while implementing this plan.
- Keep code, tests, comments, docs, commit messages, and repository artifacts
  in English.
- Preserve unrelated changes and the main checkout's ignored `output/`
  directory.
- The existing draft PR may be updated only after implementation and both
  independent review gates pass; it must remain draft until separately
  authorized.

## File Structure

- `src/adapters/calle/client.ts` — separate fixed create and read timeout
  boundaries without changing retry or response mapping.
- `src/adapters/calle/client.test.ts` — exact timeout, one-POST, GET retry, and
  regression evidence for the client.
- `src/adapters/calle/request.ts` — allowlisted English and Ukrainian supplier
  collection instructions.
- `src/adapters/calle/request.test.ts` — exact bilingual prompt and unchanged
  strict-request contract assertions.
- `src/domain/preflight-integrity.ts` — pure mechanical integrity validator for
  normalized terminal provider snapshots.
- `src/domain/preflight-integrity.test.ts` — positive, negative, boundary,
  privacy, and unsafe-object regression tests.
- `scripts/live-preflight.ts` — guarded composition that invokes the integrity
  validator before successful evidence publication.
- `scripts/live-preflight.test.ts` — actual fake-fetch proof of one POST,
  bounded failure, consumed permit, and no success file.
- `docs/research/2026-08-11-call-e-ambiguous-create-observation.md` — sanitized
  recovered-call classification and integrity findings.
- `docs/operator-runbook.md` — operator meaning of the new timeout and invalid
  evidence result.
- `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md` — Task 6,
  Task 8, and traceability corrections.
- `docs/superpowers/plans/2026-08-12-supplysignal-ai-ambiguous-create-incident-recovery-implementation.md`
  — explicit A21 supersession reference for the create timeout only.

---

### Task 1: Separate CALL-E create and read timeouts

**Files:**
- Modify: `src/adapters/calle/client.ts`
- Modify: `src/adapters/calle/client.test.ts`

**Interfaces:**
- Consumes: the existing `CalleClient`, `CalleGateway`, `CalleError`, stable
  idempotency key, `fetch`, `AbortSignal.timeout`, and GET-only retry loop.
- Produces: a single create POST bounded by `30_000` milliseconds and call/event
  reads bounded by `15_000` milliseconds, with no public API change.

- [ ] **Step 1: Verify the clean task baseline and current shared constant**

Run:

```powershell
git status --short --branch
git log -1 --oneline
rg -n "REQUEST_TIMEOUT_MILLISECONDS|AbortSignal.timeout|createCall|readGet" src/adapters/calle/client.ts src/adapters/calle/client.test.ts
```

Expected: the worktree contains only the approved specification and plan
history; `client.ts` has one shared `15_000` constant used by POST and GET.

- [ ] **Step 2: Write the failing exact-timeout and no-retry tests**

Replace the current create-timeout assertion and add explicit read assertions
in `src/adapters/calle/client.test.ts`:

```typescript
it("bounds the one create request to exactly 30 seconds", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetchMock = vi.fn<typeof fetch>(async () =>
    jsonResponse(await fixture("create-accepted.json"), 201),
  );

  await createClient(fetchMock).createCall(input);

  expect(timeout).toHaveBeenCalledTimes(1);
  expect(timeout).toHaveBeenCalledWith(30_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  timeout.mockRestore();
});

it("keeps call and event reads bounded to exactly 15 seconds", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/events")
      ? jsonResponse(await fixture("events-page.json"))
      : jsonResponse(await fixture("completed-valid.json")),
  );
  const client = createClient(fetchMock);

  await client.getCall("call_demo_001");
  await client.listEvents("call_demo_001");

  expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
    15_000,
    15_000,
  ]);
  timeout.mockRestore();
});

it("reports a create timeout as ambiguous after exactly one POST", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    throw new DOMException("Timed out", "TimeoutError");
  });

  await expect(createClient(fetchMock).createCall(input)).rejects.toMatchObject({
    code: "CALL_OUTCOME_PENDING",
    kind: "ambiguous_create",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
});
```

Keep the existing redirect, strict-response, idempotency-conflict, and transient
GET retry tests unchanged.

- [ ] **Step 3: Run the focused test and record genuine RED**

Run:

```powershell
corepack pnpm vitest run src/adapters/calle/client.test.ts
```

Expected: FAIL because create still requests `15_000` milliseconds. Record the
selected file count, test count, exit code, and failing assertions in the task
report before editing production.

- [ ] **Step 4: Split the two internal timeout constants**

In `src/adapters/calle/client.ts`, replace the shared constant with:

```typescript
const CREATE_REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const READ_REQUEST_TIMEOUT_MILLISECONDS = 15_000;
```

Use the create constant only in the single POST:

```typescript
signal: AbortSignal.timeout(CREATE_REQUEST_TIMEOUT_MILLISECONDS),
```

Use the read constant only inside `readGet`:

```typescript
signal: AbortSignal.timeout(READ_REQUEST_TIMEOUT_MILLISECONDS),
```

Do not modify `GET_RETRY_DELAYS`, `redirect: "error"`, POST error mapping,
request construction, headers, or idempotency behavior.

- [ ] **Step 5: Run focused GREEN and the explicit adapter selection**

Run:

```powershell
corepack pnpm vitest run src/adapters/calle/client.test.ts

$tests = @(
  'src/adapters/calle/client.test.ts'
  'src/adapters/calle/request.test.ts'
  'src/adapters/calle/schemas.test.ts'
  'src/adapters/calle/mapper.test.ts'
)
$tests | ForEach-Object { Write-Output $_ }
corepack pnpm vitest run @tests
```

Expected: the focused test and all four printed adapter tests PASS. Confirm the
existing tests still prove one POST, redirect rejection, strict 201 handling,
and bounded GET retry.

- [ ] **Step 6: Run task-level static gates**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
git diff --check
git status --short
```

Expected: all commands exit `0`; status lists only the two Task 1 files plus
already approved documentation artifacts.

- [ ] **Step 7: Commit only the timeout correction**

Run:

```powershell
git add src/adapters/calle/client.ts src/adapters/calle/client.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "fix: separate CALL-E request timeouts"
```

Expected: one focused commit containing only the client and its test.

- [ ] **Step 8: Pass independent Task 1 reviews**

Request one specification-compliance review and one code-quality review against
the Task 1 commit and A21. Do not begin Task 2 until both report no unresolved
Critical or Important findings. Reproduce every accepted finding with a failing
test before a corrective implementation commit.

---

### Task 2: Harden bilingual supplier evidence collection

**Files:**
- Modify: `src/adapters/calle/request.ts`
- Modify: `src/adapters/calle/request.test.ts`

**Interfaces:**
- Consumes: `CreateSupplierCall`, canonical `en-US`, `en-KE`, `en-UA`, and
  `uk-UA` recipient profiles, approved fictional PO identity, and the frozen
  `recipientResultSchema`.
- Produces: exact English and Ukrainian task strings containing the A21
  clarification, non-invention, follow-up, refusal, and unknown-value rules.

- [ ] **Step 1: Add exact failing English and Ukrainian prompt assertions**

Extend the task constants in `src/adapters/calle/request.test.ts` with these
exact English lines:

```typescript
"Collect the confirmed quantity, quantity available now, and quantity delayed as three separate answers.",
"If those three quantities do not reconcile, repeat all three values and ask exactly one clarification question. Never calculate, repair, or invent a quantity for the recipient.",
"Set human follow-up to yes only after an explicit request for a manager, transfer, callback, or other human follow-up. Set it to no after an explicit refusal of human follow-up. Use unknown when the conversation does not establish the answer.",
```

Add these exact Ukrainian counterparts:

```typescript
"Отримайте окремі відповіді про підтверджену кількість, кількість, доступну зараз, і кількість із затримкою.",
"Якщо ці три кількості не узгоджуються, повторіть усі три значення та поставте рівно одне уточнювальне питання. Ніколи не обчислюйте, не виправляйте й не вигадуйте кількість замість співрозмовника.",
"Позначайте потребу у зв’язку з людиною як yes лише після прямого прохання про менеджера, переведення дзвінка, зворотний дзвінок або інший контакт із людиною. Позначайте no після прямої відмови від такого контакту. Використовуйте unknown, якщо розмова не встановила відповідь.",
```

Keep the disclosure as line 2 and concise-turn policy as line 3. Add assertions
that each task contains each new rule once, remains at most 4,000 characters,
and that `recipient_result_schema` is still the same frozen strict object with
`additionalProperties: false`.

- [ ] **Step 2: Run the request test and record genuine RED**

Run:

```powershell
corepack pnpm vitest run src/adapters/calle/request.test.ts
```

Expected: FAIL because neither task builder contains the new A21 text. Record
the selected file count, test count, exit code, and exact prompt mismatches.

- [ ] **Step 3: Implement the minimal task-string change**

In `buildEnglishTask`, place the three approved English lines after the
existing quantity/date question and before the delay-reason question. Preserve
the disclosure, concise-turn line, fictional identity, and final refusal/no
answer rule.

In `buildUkrainianTask`, place the three approved Ukrainian lines at the same
semantic position. Preserve `Northstar Components` and `PO-2048` exactly as
approved fictional identifiers.

Do not add arithmetic validation to JSON Schema, alter locale routing, mutate
`recipientResultSchema`, or use provider-generated text in the task.

- [ ] **Step 4: Run focused GREEN and explicit request-boundary selection**

Run:

```powershell
corepack pnpm vitest run src/adapters/calle/request.test.ts

$tests = @(
  'src/adapters/calle/request.test.ts'
  'src/adapters/calle/client.test.ts'
  'src/domain/call-recipient.test.ts'
)
$tests | ForEach-Object { Write-Output $_ }
corepack pnpm vitest run @tests
```

Expected: all three printed files PASS. Confirm `en-US`, `en-KE`, and `en-UA`
use the exact English task; `uk-UA` uses the exact Ukrainian task; unsafe
inline values still fail before fetch.

- [ ] **Step 5: Run task-level static gates**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
git diff --check
git status --short
```

Expected: all commands exit `0`; no runtime file outside the request boundary
changed.

- [ ] **Step 6: Commit only the bilingual collection correction**

Run:

```powershell
git add src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "fix: clarify supplier call evidence"
```

Expected: one focused commit containing only the request builder and its test.

- [ ] **Step 7: Pass independent Task 2 reviews**

Request fresh specification-compliance and code-quality reviews. Reviewers must
verify exact bilingual semantics, disclosure ordering, task bound, locale
mapping, strict frozen schema, and absence of prompt-as-validation. Stop before
Task 3 until both reviews have no unresolved Critical or Important findings.

---

### Task 3: Add the pure integrity boundary and guarded composition

**Files:**
- Create: `src/domain/preflight-integrity.ts`
- Create: `src/domain/preflight-integrity.test.ts`
- Modify: `scripts/live-preflight.ts`
- Modify: `scripts/live-preflight.test.ts`

**Interfaces:**
- Consumes: `providerEvidenceSnapshotSchema`, `ProviderEvidenceSnapshot`,
  `supplierResponseSchema`, `SupplierResponse`, `AppError`,
  `PreflightScenario`, the process-global permit, terminal reconciliation, and
  create-only private evidence publication.
- Produces:

```typescript
export type PreflightEvidenceScenario = "answered" | "declined" | "no_answer";

export type ValidatedPreflightEvidence = Readonly<{
  snapshot: ProviderEvidenceSnapshot;
  response: SupplierResponse;
}>;

export function validatePreflightEvidenceIntegrity(
  scenario: PreflightEvidenceScenario,
  input: unknown,
): ValidatedPreflightEvidence;
```

- [ ] **Step 1: Create strict test fixtures through public domain types**

In `src/domain/preflight-integrity.test.ts`, define a valid answered snapshot
without a full phone, credential, native path, or provider envelope:

```typescript
const answeredSnapshot: ProviderEvidenceSnapshot = {
  callId: "call_demo_integrity_001",
  status: "completed",
  observedAt: "2026-08-14T10:00:00.000Z",
  taskCompleted: true,
  completionConfidence: { score: 0.98, label: "high" },
  transcript: [
    { speaker: "bot", text: "How many fictional units are ready now?" },
    {
      speaker: "user",
      text: "Three hundred fifty are ready and one hundred fifty are delayed.",
    },
  ],
  structuredResult: {
    contactOutcome: "reached",
    confirmedQuantity: 500,
    availableQuantity: 350,
    delayedQuantity: 150,
    promisedDeliveryDate: "2026-08-22",
    delayReason: "Component shortage",
    followUpRequired: "yes",
    unableToFulfill: "no",
  },
  evidence: [],
};
```

Create a valid declined snapshot with `contactOutcome: "declined"`, reconciled
zero quantities, unknown unavailable facts, `followUpRequired: "no"`, and one
non-empty user refusal turn. Create a valid no-answer snapshot with
`taskCompleted: false`, `completionConfidence: null`, empty transcript/evidence,
zero quantities, and every unavailable fact exactly `"unknown"`.

- [ ] **Step 2: Write the complete failing integrity matrix**

Add tests that require:

```typescript
expect(
  validatePreflightEvidenceIntegrity("answered", answeredSnapshot),
).toMatchObject({
  snapshot: { status: "completed" },
  response: {
    contactOutcome: "reached",
    confirmedQuantity: 500,
    availableQuantity: 350,
    delayedQuantity: 150,
  },
});
```

Add separate assertions that reject each of these values with exactly
`PROVIDER_RESULT_INVALID`:

```typescript
const recoveredInconsistent = {
  ...answeredSnapshot,
  structuredResult: {
    ...answeredSnapshot.structuredResult,
    availableQuantity: 17,
    delayedQuantity: 5,
  },
};

const reachedWithoutUserTurn = {
  ...answeredSnapshot,
  transcript: [{ speaker: "bot", text: "Please confirm the quantities." }],
};

const completedWithoutResult = {
  ...answeredSnapshot,
  structuredResult: null,
};
```

Also test accepted declined and no-answer snapshots; rejected
answered/declined/no-answer outcome mismatches; rejected extra root and nested
properties; rejected custom prototypes; rejected root, nested-object, and array
accessors with getter counters remaining `0`; and a raw marker such as
`RAW_INVALID_PROVIDER_MARKER` never appearing in the error name, message, code,
or serialized public projection.

- [ ] **Step 3: Run the new domain test and record genuine RED**

Run:

```powershell
corepack pnpm vitest run src/domain/preflight-integrity.test.ts
```

Expected: FAIL because `src/domain/preflight-integrity.ts` does not exist.
Record the selected file count, test count, exit code, and missing-module
failure before production creation.

- [ ] **Step 4: Implement the pure validator through existing boundaries**

Create `src/domain/preflight-integrity.ts`:

```typescript
import { AppError } from "./errors.js";
import {
  providerEvidenceSnapshotSchema,
  type ProviderEvidenceSnapshot,
} from "./run.js";
import {
  supplierResponseSchema,
  type SupplierResponse,
} from "./supplier-response.js";

export type PreflightEvidenceScenario =
  | "answered"
  | "declined"
  | "no_answer";

export type ValidatedPreflightEvidence = Readonly<{
  snapshot: ProviderEvidenceSnapshot;
  response: SupplierResponse;
}>;

function invalid(): never {
  throw new AppError("PROVIDER_RESULT_INVALID");
}

function hasNonEmptyUserTurn(snapshot: ProviderEvidenceSnapshot): boolean {
  return snapshot.transcript.some(
    (turn) => turn.speaker === "user" && turn.text.trim().length > 0,
  );
}

function isTruthfulNoAnswer(
  snapshot: ProviderEvidenceSnapshot,
  response: SupplierResponse,
): boolean {
  return (
    response.contactOutcome === "no_answer" &&
    response.confirmedQuantity === 0 &&
    response.availableQuantity === 0 &&
    response.delayedQuantity === 0 &&
    response.promisedDeliveryDate === "unknown" &&
    response.delayReason === "unknown" &&
    response.followUpRequired === "unknown" &&
    response.unableToFulfill === "unknown" &&
    snapshot.taskCompleted === false &&
    snapshot.completionConfidence === null &&
    snapshot.transcript.length === 0 &&
    snapshot.evidence.length === 0
  );
}

export function validatePreflightEvidenceIntegrity(
  scenario: PreflightEvidenceScenario,
  input: unknown,
): ValidatedPreflightEvidence {
  const snapshotResult = providerEvidenceSnapshotSchema.safeParse(input);
  if (!snapshotResult.success || snapshotResult.data.status !== "completed") {
    return invalid();
  }

  const responseResult = supplierResponseSchema.safeParse(
    snapshotResult.data.structuredResult,
  );
  if (!responseResult.success) {
    return invalid();
  }

  const snapshot = snapshotResult.data;
  const response = responseResult.data;
  const acceptable =
    scenario === "no_answer"
      ? isTruthfulNoAnswer(snapshot, response)
      : hasNonEmptyUserTurn(snapshot) &&
        response.contactOutcome ===
          (scenario === "answered" ? "reached" : "declined");

  if (!acceptable) {
    return invalid();
  }

  return Object.freeze({ snapshot, response });
}
```

Do not log Zod issues, raw input, transcript excerpts, or rejected quantities.
Do not change `supplierResponseSchema` or make the CALL-E mapper reject
inconsistent but structurally normalized evidence; Task 9 still owns review of
persisted provider facts.

- [ ] **Step 5: Run focused domain GREEN and coverage**

Run:

```powershell
corepack pnpm vitest run src/domain/preflight-integrity.test.ts
corepack pnpm vitest run --coverage src/domain/preflight-integrity.test.ts src/domain/supplier-response.test.ts src/domain/run.test.ts
```

Expected: the new test passes; focused coverage includes every validator branch
and proves arithmetic inconsistency, unsafe object shapes, scenario mismatch,
truthful declined, and truthful no-answer handling.

- [ ] **Step 6: Write failing guarded-composition regressions**

In `scripts/live-preflight.test.ts`, add a helper that derives an inconsistent
completed response from `completed-valid.json` by changing only
`available_quantity` to `17` and `delayed_quantity` to `5` while keeping
`confirmed_quantity` at `500`.

Use `runGuardedCli` with fake fetch to prove:

```typescript
expect(result.error).toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
expect(result.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"))
  .toHaveLength(1);
await expect(
  readFile(resolve(privateRoot, guardedRunId, "result.json")),
).rejects.toThrow();
```

Within the same isolated module/process-permit context, invoke the guarded CLI
a second time and assert `PREFLIGHT_CALL_LIMIT_REACHED` with the POST count
still exactly `1`. Add an accepted answered composition test using the unchanged
valid fixture. Add rejected completed/no-result, reached/no-user-turn, and
scenario/outcome mismatch cases through local fake `Response` objects only.

- [ ] **Step 7: Run the guarded-composition tests and record genuine RED**

Run:

```powershell
corepack pnpm vitest run scripts/live-preflight.test.ts
```

Expected: FAIL because the inconsistent completed result is published as
success. Record the selected file count, test count, exit code, one-POST count,
and unexpected `result.json` publication before editing the composition.

- [ ] **Step 8: Add the CLI error code and invoke the gate before success**

In `scripts/live-preflight.ts`, import:

```typescript
import { validatePreflightEvidenceIntegrity } from "../src/domain/preflight-integrity.js";
```

Extend `PreflightErrorCode` with:

```typescript
| "PROVIDER_RESULT_INVALID";
```

After the terminal/no-ID guard and before `collectEvents` or returning the
execution result, add:

```typescript
if (current.providerSnapshot === undefined) {
  fail("PROVIDER_RESULT_INVALID");
}
try {
  validatePreflightEvidenceIntegrity(input.scenario, current.providerSnapshot);
} catch {
  fail("PROVIDER_RESULT_INVALID");
}
```

This placement ensures invalid terminal evidence cannot reach
`writePrivateEvidence`. It must not reset the consumed process permit or issue
another POST.

- [ ] **Step 9: Run the explicit Task 3 affected selection**

Run:

```powershell
corepack pnpm vitest run scripts/live-preflight.test.ts

$tests = @(
  'src/domain/preflight-integrity.test.ts'
  'src/domain/supplier-response.test.ts'
  'src/domain/run.test.ts'
  'src/adapters/calle/mapper.test.ts'
  'src/application/start-run.test.ts'
  'src/application/reconcile-run.test.ts'
  'tests/integration/call-lifecycle.test.ts'
  'scripts/live-preflight.test.ts'
)
$tests | ForEach-Object { Write-Output $_ }
corepack pnpm vitest run @tests
```

Expected: the focused guarded-composition test and all eight printed files pass.
Exactly one fake POST occurs, `result.json` is absent for invalid evidence, and
the permit remains consumed. Record the actual file/test counts and exit
status; do not trust a wildcard or unprinted broad filter.

- [ ] **Step 10: Run task-level repository gates**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
git diff --check
git status --short
```

Expected: all commands exit `0`; the runtime diff is limited to the four Task 3
files.

- [ ] **Step 11: Commit the validator and guarded composition**

Run:

```powershell
git add src/domain/preflight-integrity.ts src/domain/preflight-integrity.test.ts scripts/live-preflight.ts scripts/live-preflight.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "fix: reject invalid preflight evidence"
```

Expected: one focused commit containing only the pure boundary, CLI wiring, and
their tests.

- [ ] **Step 12: Pass independent Task 3 reviews**

Request fresh specification-compliance and code-quality reviews. Reviewers must
verify the plain-data/accessor boundary, exact arithmetic rule, scenario
mapping, no-answer sentinel, bounded error, one-POST permit semantics, no
success publication, no mapper/trust-workflow expansion, and deterministic
offline composition. Stop before Task 4 until both reviews have no unresolved
Critical or Important findings.

---

### Task 4: Record the incident outcome, run whole-branch gates, and update the draft PR

**Files:**
- Modify: `docs/research/2026-08-11-call-e-ambiguous-create-observation.md`
- Modify: `docs/operator-runbook.md`
- Modify: `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md`
- Modify: `docs/superpowers/plans/2026-08-12-supplysignal-ai-ambiguous-create-incident-recovery-implementation.md`
- Read-only: `docs/superpowers/specs/2026-08-14-supplysignal-ai-call-e-preflight-integrity-design.md`

**Interfaces:**
- Consumes: the approved A21 specification, Task 1–3 commits, sanitized support
  facts, the current draft PR, and the repository verification gates.
- Produces: truthful operator/research/plan documentation, a verified branch,
  two whole-branch review verdicts, and an updated draft PR that remains
  unmerged.

- [ ] **Step 1: Update the sanitized incident observation**

Add a `## Support recovery` section to
`docs/research/2026-08-11-call-e-ambiguous-create-observation.md` containing
only this allowlisted projection:

```markdown
## Support recovery

CALL-E support later recovered the authoritative Developer API record. The
provider reported a completed Ukrainian call and indicated that call planning
took approximately 20 seconds, longer than the application's former 15-second
create-response wait. Audio was unavailable.

The normalized structured result was not mechanically trustworthy: confirmed
quantity was 500, while available and delayed quantities were 17 and 5. The
private transcript also contained an explicit refusal of manager contact while
the structured result marked human follow-up as required. The full call ID,
transcript, account identity, participant phone, and support trace remain
private.

This recovery confirms the ambiguous-create diagnosis and motivates Correction
A21. It does not convert the incident into a Task 8 PASS. The recovered result
fails deterministic quantity reconciliation and requires human review that is
outside Task 8.
```

Do not include any fragment of the full recovered `call_id`, Billing reference,
account name, phone, private path, or verbatim transcript.

- [ ] **Step 2: Update operator timeout and invalid-result instructions**

In `docs/operator-runbook.md`, state exactly:

```markdown
- The single create POST waits up to 30 seconds for its response. Call and event
  reads remain bounded to 15 seconds. The longer create wait is not a retry or
  redial permission.
- `PROVIDER_RESULT_INVALID` means a terminal provider snapshot failed the
  mechanical Task 8 integrity boundary. Preserve the private run, do not publish
  a success artifact, do not retry or redial, record the scenario as failed, and
  escalate only sanitized facts.
```

Add an operator checklist requiring arithmetic reconciliation, a non-empty user
turn for answered/declined scenarios, exact no-answer sentinels, and explicit
comparison of transcript versus structured follow-up. Keep Task 9 blocked after
any conflict.

- [ ] **Step 3: Correct the main and A20 implementation plans**

In `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md`:

- change Task 6's create timeout expectation to `30_000` and retain `15_000`
  for GET call/events;
- add the A21 pure integrity gate and composition assertions to Task 8;
- retain exactly one create POST and GET-only stored-ID reconciliation;
- add A21 to the traceability table; and
- keep Task 9 blocked until three new separately authorized scenarios satisfy
  the approved evidence gate.

In
`docs/superpowers/plans/2026-08-12-supplysignal-ai-ambiguous-create-incident-recovery-implementation.md`,
replace only the obsolete fixed-timeout statement with:

```markdown
Correction A21 supersedes only the create-response timeout: the single POST may
wait 30 seconds, while GET call/events remain bounded to 15 seconds. Every A20
no-retry, no-redial, manual no-ID recovery, and incident-classification rule
remains unchanged.
```

- [ ] **Step 4: Verify documentation formatting, contradictions, and privacy**

Run:

```powershell
$docs = @(
  'docs/research/2026-08-11-call-e-ambiguous-create-observation.md'
  'docs/operator-runbook.md'
  'docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md'
  'docs/superpowers/plans/2026-08-12-supplysignal-ai-ambiguous-create-incident-recovery-implementation.md'
  'docs/superpowers/specs/2026-08-14-supplysignal-ai-call-e-preflight-integrity-design.md'
)
corepack pnpm exec prettier --check @docs
git diff --check
rg -n "15-second create|create timeout.*15|Task 8: PASS|Task 9: unblocked" @docs
```

Expected: formatting and diff checks exit `0`; the obsolete/unsafe claims are
absent except in clearly historical incident wording. Inspect every search hit
manually rather than suppressing it.

Run an addition-only privacy check without printing matched values:

```powershell
$patterns = @(
  '\+380\d{9}'
  '\+1\d{10}'
  'Bearer\s+[A-Za-z0-9._-]{12,}'
  '[A-Za-z]:\\[^\r\n]+'
)
$added = git diff --unified=0 main...HEAD | Where-Object {
  $_ -match '^\+' -and $_ -notmatch '^\+\+\+'
}
$violations = @()
foreach ($pattern in $patterns) {
  if ($added | Select-String -Pattern $pattern -Quiet) {
    $violations += $pattern
  }
}
if ($violations.Count -ne 0) {
  throw "Addition-only privacy scan found disallowed pattern classes."
}
```

Expected: exit `0` and no matched value printed. Also inspect `git diff
main...HEAD` manually for raw transcript, account identity, full Billing
reference, API key, phone, or native private path.

- [ ] **Step 5: Commit the documentation correction**

Run:

```powershell
git add docs/research/2026-08-11-call-e-ambiguous-create-observation.md docs/operator-runbook.md docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md docs/superpowers/plans/2026-08-12-supplysignal-ai-ambiguous-create-incident-recovery-implementation.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs: record recovered preflight integrity failure"
```

Expected: one documentation-only commit; the already approved A21
specification and this implementation plan remain in their own commits.

- [ ] **Step 6: Prove the full affected selection and repository gate**

Run:

```powershell
$tests = @(
  'src/adapters/calle/client.test.ts'
  'src/adapters/calle/request.test.ts'
  'src/adapters/calle/schemas.test.ts'
  'src/adapters/calle/mapper.test.ts'
  'src/domain/preflight-integrity.test.ts'
  'src/domain/supplier-response.test.ts'
  'src/domain/run.test.ts'
  'src/application/start-run.test.ts'
  'src/application/reconcile-run.test.ts'
  'tests/integration/call-lifecycle.test.ts'
  'scripts/live-preflight.test.ts'
)
$tests | ForEach-Object { Write-Output $_ }
corepack pnpm vitest run @tests
corepack pnpm verify
git diff --check main...HEAD
git status --short --branch
```

Expected: all eleven printed tests pass; `pnpm verify` passes formatting,
typecheck, zero-warning lint, the complete offline test suite, and production
build; the whole-branch diff is clean; build does not change tracked files.

Check the repository-provided enforcement scripts truthfully:

```powershell
if (Test-Path 'scripts/scan-secrets.mjs') {
  corepack pnpm scan:secrets
} else {
  Write-Output 'UNAVAILABLE: scripts/scan-secrets.mjs is not implemented.'
}
if (Test-Path 'scripts/assert-build-clean.mjs') {
  corepack pnpm check:build-clean
} else {
  Write-Output 'UNAVAILABLE: scripts/assert-build-clean.mjs is not implemented.'
}
```

Expected: run each script only if its implementation file exists. Record an
absent implementation as unavailable, never passing.

- [ ] **Step 7: Perform whole-branch self-review and independent reviews**

Inspect:

```powershell
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
git status --short --branch
```

Self-review the complete A21 range for exact timeout separation, one-POST
behavior, bilingual semantics, strict plain-data validation, bounded error,
permit consumption, no success publication, sanitized docs, and unchanged Task
9 gate.

Then request two fresh read-only reviewers:

1. specification compliance against the approved A21 specification;
2. code quality, safety, privacy, race behavior, and regression resistance.

Do not update the remote PR until both reviews report no unresolved Critical or
Important findings. For each accepted finding, add a genuine failing regression
test first, make the smallest correction, rerun affected/full gates, create a
separate corrective commit, and repeat both reviews.

- [ ] **Step 8: Push and update the existing draft PR without merging**

After all gates and reviews pass, run:

```powershell
git push origin docs/incident-recovery-amendment
gh pr view 5 --json number,url,isDraft,state,headRefName,baseRefName
```

Update PR #5's title and body so they truthfully include:

- A20 incident/recovery documentation;
- A21 create timeout split;
- bilingual clarification/follow-up prompt hardening;
- pure Task 8 integrity gate;
- offline test and review results;
- repository secret/build-clean scripts reported unavailable if still absent;
- no live call or provider request during implementation;
- Task 9 still blocked; and
- PR remains draft.

Verify:

```powershell
gh pr view 5 --json url,isDraft,state,mergeable,headRefOid,statusCheckRollup
git status --short --branch
```

Expected: the PR URL is unchanged, `isDraft` is `true`, branch is pushed, and
the local tracked tree is clean. Do not mark Ready for review, merge, delete the
branch/worktree, deploy, or release without a separate owner command.

## Completion Handoff

Correction A21 is ready for owner review only when Tasks 1–4 are complete, the
offline repository gate passes, the addition-only privacy scan is clean, both
independent whole-branch reviews have no unresolved Critical or Important
findings, and draft PR #5 truthfully reflects the branch. Completion does not
authorize a live call, formal three-scenario preflight, Task 9, Ready-for-review,
merge, deployment, or release.
