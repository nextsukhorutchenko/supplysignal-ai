# SupplySignal AI Kenya Recipient Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict Kenya English recipient profile beside the existing United States profile and route both profiles consistently through domain validation, CALL-E request construction, and the guarded live preflight.

**Architecture:** Keep one immutable recipient-profile allowlist in the domain layer. Canonicalize every supported recipient into a coherent phone, mask, region, and locale before the CALL-E adapter or preflight can use it; the adapter copies only canonical values, and the preflight displays only a sanitized country/language/mask projection. Preserve the current one-call permit, lifecycle, private evidence, and no-retry/no-redial boundaries.

**Tech Stack:** TypeScript 7 native compiler with the repository TypeScript 6 compatibility package, Zod 4, Vitest 4, pnpm 11, ESLint 9, Prettier 3, Next.js 16.

## Global Constraints

- Product authority is `docs/superpowers/specs/2026-08-10-supplysignal-ai-kenya-recipient-profile-design.md` together with the still-applicable base specification and Amendments A7-A15.
- Preserve the exact United States profile `^\+1[2-9]\d{9}$`, `US`, `en-US`, and mask `+1 ***-***-1234`.
- Add the exact Kenya profile `^\+254[1-9]\d{8}$`, `KE`, `en-KE`, and mask `+254 ***-**-1234`.
- Derive region and locale from validated recipient data. Do not read either value from environment variables or command-line arguments.
- Keep the complete disclosure, concise-turn prompt, strict result schema, stable idempotency key, one create attempt, no retry, and no redial behavior unchanged.
- Unsupported, malformed, accessor-backed, or cross-profile input must fail before `fetch` without exposing the full phone, raw validation details, or native paths.
- Do not add a dependency, endpoint, error code, runtime mode, provider fallback, UI implementation, or unrelated refactor.
- Keep code, tests, documentation, UI copy, and commits in English.
- Assemble all test phone-shaped values from non-sensitive string segments. Never commit the participant's number, identity, consent evidence, API key, or provider envelope.
- Run only deterministic offline tests. No implementation or verification step may contact CALL-E, use credentials, ring a phone, retry the prior ambiguous hotline run, or authorize a live Kenyan preflight.
- Preserve the unrelated untracked `output/` directory.

---

### Task 1: Canonicalize United States and Kenya recipient profiles

**Files:**
- Modify: `src/domain/call-recipient.test.ts`
- Modify: `src/domain/call-recipient.ts`
- Reference: `src/domain/plain-data.ts`
- Reference: `src/domain/plain-data.test.ts`

**Interfaces:**
- Consumes: `withPlainDataBoundary(schema)`, the existing recipient input fields `recipientName`, `phoneE164`, and the optional existing `region`/`locale` pair.
- Produces: `callRecipientSchema`, `createCallRecipient(input: unknown): CallRecipient`, `maskPhoneNumber(phoneE164: string): string`, and `getCallRecipientPresentation(input: unknown): { readonly country: "United States" | "Kenya"; readonly language: "English" }`.
- Preserves: the persisted `CallRecipient` fields `recipientName`, `phoneE164`, `maskedPhone`, `region`, and `locale` without adding persistence fields.

- [ ] **Step 1: Confirm the exact branch and starting state**

Run:

```powershell
git status --short --branch
git log -3 --oneline --decorate
git diff --check
```

Expected: branch `feat/kenya-recipient-profile`; the approved specification and this plan are committed; no unexpected tracked changes exist. Preserve `output/` and all unrelated owner files.

- [ ] **Step 2: Add focused Kenyan profile tests before production edits**

In `src/domain/call-recipient.test.ts`, construct non-sensitive boundary-shaped values without a complete phone literal:

```ts
const kenyaLowerBoundary = ["+254", "100", "000", "000"].join("");
const kenyaUpperBoundary = ["+254", "999", "999", "999"].join("");

const validKenyaRecipient = {
  recipientName: "Consenting participant",
  phoneE164: kenyaLowerBoundary,
  maskedPhone: "+254 ***-**-0000",
  region: "KE",
  locale: "en-KE",
} as const;
```

Add tests with these exact behaviors:

```ts
it("creates the canonical Kenya English recipient from the phone", () => {
  expect(
    createCallRecipient({
      recipientName: "  Consenting participant  ",
      phoneE164: kenyaLowerBoundary,
    }),
  ).toEqual(validKenyaRecipient);
  expect(maskPhoneNumber(kenyaUpperBoundary)).toBe("+254 ***-**-9999");
  expect(getCallRecipientPresentation(validKenyaRecipient)).toEqual({
    country: "Kenya",
    language: "English",
  });
});

it.each([
  ["local format", ["07", "00", "000", "000"].join("")],
  ["zero national prefix", ["+254", "000", "000", "000"].join("")],
  ["too short", ["+254", "100", "000", "00"].join("")],
  ["too long", ["+254", "100", "000", "000", "0"].join("")],
  ["spaces", ["+254 ", "100 ", "000 000"].join("")],
  ["extension", ["+254", "100", "000", "000", "x1"].join("")],
])("rejects Kenya %s before canonicalization", (_case, phoneE164) => {
  expect(() =>
    createCallRecipient({
      recipientName: "Consenting participant",
      phoneE164,
    }),
  ).toThrow();
});

it("rejects every cross-profile region and locale pair", () => {
  expect(() =>
    createCallRecipient({
      recipientName: "Consenting participant",
      phoneE164: kenyaLowerBoundary,
      region: "US",
      locale: "en-US",
    }),
  ).toThrow();
  expect(() =>
    callRecipientSchema.parse({
      ...validKenyaRecipient,
      locale: "en-US",
    }),
  ).toThrow();
});
```

Retain the existing United States assertions and add a presentation assertion for `{ country: "United States", language: "English" }`.

Add one Kenya accessor regression that defines an enumerable getter on `phoneE164`, calls `createCallRecipient`, expects rejection, and asserts the getter count remains zero.

- [ ] **Step 3: Run the focused domain test and record genuine RED**

Run:

```powershell
pnpm vitest run src/domain/call-recipient.test.ts
```

Expected: exit code 1 because Kenya is rejected and `getCallRecipientPresentation` does not exist. Existing United States tests remain green.

- [ ] **Step 4: Implement the immutable profile allowlist and strict schemas**

In `src/domain/call-recipient.ts`, keep the current US pattern and add:

```ts
const KE_E164_PATTERN = /^\+254[1-9]\d{8}$/;
const KE_MASKED_PHONE_PATTERN = /^\+254 \*\*\*-\*\*-\d{4}$/;

const RECIPIENT_PROFILES = {
  US: {
    region: "US",
    locale: "en-US",
    country: "United States",
    language: "English",
    phonePattern: US_E164_PATTERN,
    mask: (phoneE164: string) => `+1 ***-***-${phoneE164.slice(-4)}`,
  },
  KE: {
    region: "KE",
    locale: "en-KE",
    country: "Kenya",
    language: "English",
    phonePattern: KE_E164_PATTERN,
    mask: (phoneE164: string) => `+254 ***-**-${phoneE164.slice(-4)}`,
  },
} as const;
```

Build `callRecipientSchema` as a `z.union` of two strict object schemas. Each branch must use its exact phone regex, mask regex, literal region, literal locale, and a branch-local refinement requiring `maskedPhone === maskPhoneNumber(phoneE164)`.

Change the plain-data input schema to accept `recipientName`, `phoneE164`, and an optional paired `region`/`locale`. The permitted pairs are only `US/en-US` and `KE/en-KE`; require both values together or neither. `createCallRecipient` must resolve the profile from `phoneE164`, reject an explicit mismatch, and return a `callRecipientSchema.parse(...)` canonical copy.

Implement presentation without adding persisted fields:

```ts
export function getCallRecipientPresentation(input: unknown): {
  readonly country: "United States" | "Kenya";
  readonly language: "English";
} {
  const recipient = callRecipientSchema.parse(input);
  const profile = RECIPIENT_PROFILES[recipient.region];
  return { country: profile.country, language: profile.language };
}
```

Do not export the regexes or add mutable configuration.

- [ ] **Step 5: Run focused domain tests and verify GREEN**

Run:

```powershell
pnpm vitest run src/domain/call-recipient.test.ts src/domain/plain-data.test.ts
```

Expected: both explicitly selected files pass. Existing US parsing, plain-data rejection, masking, and zero-getter-read tests remain green.

- [ ] **Step 6: Run domain coverage and static gates**

Run:

```powershell
pnpm vitest run --coverage src/domain/call-recipient.test.ts src/domain/plain-data.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all commands exit 0. Formatting or lint fixes must remain limited to the two owned Task 1 files.

- [ ] **Step 7: Inspect and commit Task 1**

Run:

```powershell
git diff --check
git diff -- src/domain/call-recipient.ts src/domain/call-recipient.test.ts
git add -- src/domain/call-recipient.ts src/domain/call-recipient.test.ts
git diff --cached --check
git diff --cached -- src/domain/call-recipient.ts src/domain/call-recipient.test.ts
git commit -m "feat: add Kenya recipient profile"
```

Expected: one commit containing only the domain implementation and focused tests. Do not push and do not run a live preflight.

- [ ] **Step 8: Run Task 1 specification and quality gates**

Dispatch two fresh read-only reviewers against the Task 1 commit. The specification reviewer must confirm the exact two-profile allowlist, strict patterns, inference, mismatch rejection, mask, and unchanged persisted shape. The quality reviewer must inspect plain-data/accessor safety, Zod union behavior, error privacy, mutation resistance, US regressions, and scope. Stop before Task 2 unless the verdicts are `SPEC PASS` and `QUALITY APPROVED` with no unresolved Critical or Important finding.

---

### Task 2: Map the canonical recipient profile into CALL-E requests

**Files:**
- Modify: `src/adapters/calle/request.test.ts`
- Modify: `src/adapters/calle/request.ts`
- Reference: `src/adapters/calle/client.test.ts`
- Reference: `src/adapters/calle/client.ts`

**Interfaces:**
- Consumes: `CreateSupplierCall.recipient: CallRecipient` from Task 1 and `prepareCreateCallRequest(input: unknown)`.
- Produces: the unchanged CALL-E request shape with `recipients[0].region` and `recipients[0].locale` copied from the canonical recipient.
- Preserves: `CALLE_OPENAPI_VERSION`, `recipientResultSchema`, task disclosure and concise-turn text, idempotency behavior, metadata allowlist, and error code `CALL_CREATION_FAILED`.

- [ ] **Step 1: Add a focused Kenya mapping regression before production edits**

In `src/adapters/calle/request.test.ts`, assemble a Kenyan value and add:

```ts
const kenyaPhone = ["+254", "100", "000", "000"].join("");
const kenyaInput: CreateSupplierCall = {
  ...input,
  recipient: {
    recipientName: "Consenting participant",
    phoneE164: kenyaPhone,
    maskedPhone: "+254 ***-**-0000",
    region: "KE",
    locale: "en-KE",
  },
};

it("maps each canonical recipient profile without a US override", () => {
  expect(buildCreateCallRequest(input).recipients).toEqual([
    { phones: [fictionalPhone], region: "US", locale: "en-US" },
  ]);
  expect(buildCreateCallRequest(kenyaInput).recipients).toEqual([
    { phones: [kenyaPhone], region: "KE", locale: "en-KE" },
  ]);
});
```

Extend the invalid-recipient table with a Kenya number paired with `US/en-US` and a US number paired with `KE/en-KE`. Both must throw only `CALL_CREATION_FAILED`.

- [ ] **Step 2: Run the request test and record genuine RED**

Run:

```powershell
pnpm vitest run src/adapters/calle/request.test.ts
```

Expected: exit code 1 because the current recipient schema rejects Kenya or the request still emits `US/en-US`. Existing prompt, result-schema, metadata, and safety tests remain green.

- [ ] **Step 3: Replace only the hardcoded request profile**

In `buildCanonicalCreateCallRequest` in `src/adapters/calle/request.ts`, replace:

```ts
region: "US",
locale: "en-US",
```

with:

```ts
region: input.recipient.region,
locale: input.recipient.locale,
```

Make no other request-body or prompt change.

- [ ] **Step 4: Run focused and affected adapter tests**

First prove the selected files:

```powershell
$files = @(
  'src/adapters/calle/request.test.ts',
  'src/adapters/calle/schemas.test.ts',
  'src/adapters/calle/mapper.test.ts',
  'src/adapters/calle/client.test.ts'
)
$files | ForEach-Object { Write-Output $_ }
pnpm vitest run @files
```

Expected: exactly four printed adapter test files and all tests pass. The client invalid-input regression must still prove that rejected canonical input performs no fetch.

- [ ] **Step 5: Run static gates and inspect the exact mapping diff**

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
git diff -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
```

Expected: all commands exit 0 and the production diff is only the two canonical recipient property reads.

- [ ] **Step 6: Commit Task 2 separately**

Run:

```powershell
git add -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git diff --cached --check
git diff --cached -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git commit -m "feat: route canonical CALL-E recipient profiles"
```

Expected: one commit containing only request mapping and its focused tests. Do not push or contact CALL-E.

- [ ] **Step 7: Run Task 2 specification and quality gates**

Dispatch two fresh read-only reviewers. The specification reviewer must confirm exact `US/en-US` and `KE/en-KE` mapping with all unchanged CALL-E contracts. The quality reviewer must inspect that canonicalization precedes mapping, no raw/mismatched input reaches `fetch`, no prompt or schema drift occurred, and no new retry/fallback was introduced. Stop before Task 3 unless both reviews pass with no unresolved Critical or Important finding.

---

### Task 3: Extend the guarded preflight and operator runbook

**Files:**
- Modify: `scripts/live-preflight.test.ts`
- Modify: `scripts/live-preflight.ts`
- Modify: `docs/operator-runbook.md`

**Interfaces:**
- Consumes: `CallRecipient`, `createCallRecipient(input)`, and `getCallRecipientPresentation(input)` from Task 1; the existing guarded CLI and live lifecycle.
- Produces: `PreflightExecutionInput` carrying a canonical `recipient: CallRecipient`; `PreflightSummary` adding `country: "United States" | "Kenya"` and `language: "English"`; sanitized pre-authorization output containing scenario, masked recipient, country, and language.
- Preserves: parameterless `runCliPreflight()`, exact phrase `AUTHORIZE ONE CALL`, process-wide atomic permit, maximum one POST, no retry/redial, canonical private evidence root, bounded polling/events, and create-only evidence commit.

- [ ] **Step 1: Write preflight profile and zero-network tests first**

In `scripts/live-preflight.test.ts`, add:

```ts
const kenyaPhone = ["+254", "100", "000", "000"].join("");
```

Update `terminalRun` to copy `input.recipient` instead of reconstructing a US recipient. Update `validInput` only as required by the new `PreflightExecutionInput` type.

Add a process-level test:

```ts
it("derives and displays the canonical Kenya English profile", async () => {
  const { createPreflightProcess } = await freshModule();
  const run = createPreflightProcess();
  const execute = vi.fn(async (input: PreflightExecutionInput) =>
    terminalRun(input),
  );
  const writeOutput = vi.fn<(message: string) => void>();
  const input = validInput({
    env: { CALLE_API_KEY: apiKey, SUPPLIER_TEST_PHONE: kenyaPhone },
    execute,
    writeOutput,
  });

  await expect(run(input)).resolves.toMatchObject({
    country: "Kenya",
    language: "English",
    maskedPhone: "+254 ***-**-0000",
  });
  expect(execute).toHaveBeenCalledWith({
    scenario: "answered",
    apiKey,
    recipient: {
      recipientName: "Consenting participant",
      phoneE164: kenyaPhone,
      maskedPhone: "+254 ***-**-0000",
      region: "KE",
      locale: "en-KE",
    },
  });
  expect(JSON.stringify(writeOutput.mock.calls)).not.toContain(kenyaPhone);
  expect(JSON.stringify(writeOutput.mock.calls)).toContain("Kenya");
  expect(JSON.stringify(writeOutput.mock.calls)).toContain("English");
});
```

Replace the old “non-US” invalid table with unsupported-country and malformed-number cases, including segmented malformed Kenyan values. Assert `UNSUPPORTED_RECIPIENT_REGION`, zero `execute` calls, zero prompt calls where applicable, and absence of the raw invalid value in output.

Add a guarded actual-composition test using `runGuardedCli({ apiKey, phone: kenyaPhone, fetchMock })`. Capture the one fake POST body and assert exactly one POST with:

```ts
expect(postBody.recipients).toEqual([
  { phones: [kenyaPhone], region: "KE", locale: "en-KE" },
]);
```

The fake fetch must use only committed fixtures and must not perform network I/O.

- [ ] **Step 2: Run the focused preflight test and record genuine RED**

Run:

```powershell
pnpm vitest run scripts/live-preflight.test.ts
```

Expected: exit code 1 because the current configuration hardcodes US, `PreflightExecutionInput` carries only a phone, and the summary lacks country/language. Existing authorization and filesystem-safety tests remain green.

- [ ] **Step 3: Carry one canonical recipient through the guarded process**

In `scripts/live-preflight.ts`:

1. Import `type CallRecipient` and `getCallRecipientPresentation`.
2. Change `PreflightExecutionInput` from `phone: string` to
   `recipient: CallRecipient`.
3. Add `country` and `language` to `PreflightSummary`.
4. Make `requireConfiguration` call `createCallRecipient` with only
   `recipientName` and `phoneE164`, then derive the presentation from that
   canonical recipient.
5. Include country/language in the sanitized pre-authorization output.
6. Pass the exact canonical recipient to `execute`.
7. In `executeLivePreflight`, pass `input.recipient` into `createRun`; remove
   both hardcoded US fields and every duplicate phone-only reconstruction.

The core construction should follow this shape:

```ts
const recipient = createCallRecipient({
  recipientName: "Consenting participant",
  phoneE164: phone,
});
const presentation = getCallRecipientPresentation(recipient);

return { apiKey, recipient, ...presentation };
```

The authorization display must remain sanitized:

```ts
input.writeOutput(
  [
    `Scenario: ${scenario}`,
    `Recipient: ${configuration.recipient.maskedPhone}`,
    `Country: ${configuration.country}`,
    `Language: ${configuration.language}`,
  ].join("\n"),
);
```

Do not add region/locale environment variables, a phone argument, an injectable live provider, a permit reset, or a second execution path.

- [ ] **Step 4: Run focused preflight tests and verify GREEN**

Run:

```powershell
pnpm vitest run scripts/live-preflight.test.ts
```

Expected: all focused tests pass, including both recipient profiles, zero-network rejection, exact one fake POST for the Kenya composition test, authorization concurrency, alternate CWD, directory identity, byte attestation, cleanup, and post-commit behavior.

- [ ] **Step 5: Update the operator runbook without private data**

In `docs/operator-runbook.md`:

- replace “accepts only a United States E.164 number” with the exact US and Kenya profile table;
- state that `region` and `locale` are derived, not operator inputs;
- change the participant readiness text to “owns the reviewed supported phone number”;
- change the PowerShell prompt to “Consenting US or Kenya recipient in strict E.164 format”;
- require the operator to verify displayed country, language, and mask;
- explain that Kenya currently uses an international line primarily intended for testing;
- link the official supported-regions table and require a same-day `KE + English` support check before a Kenyan live preflight;
- replace “does not call non-US numbers” with “calls only the approved US and Kenya profiles”; and
- retain every existing consent, one-call, ambiguous-outcome, evidence, privacy, recovery, and cleanup instruction unchanged.

Do not include the participant's full number, name, consent evidence, or API key.

- [ ] **Step 6: Run explicit affected tests and repository gates**

First prove the selected affected files:

```powershell
$files = @(
  'src/domain/call-recipient.test.ts',
  'src/domain/plain-data.test.ts',
  'src/domain/run.test.ts',
  'src/application/create-run.test.ts',
  'src/application/authorize-run.test.ts',
  'src/application/idempotency.test.ts',
  'src/application/start-run.test.ts',
  'src/application/reconcile-run.test.ts',
  'src/adapters/calle/request.test.ts',
  'src/adapters/calle/client.test.ts',
  'src/adapters/filesystem/run-store.test.ts',
  'tests/integration/call-lifecycle.test.ts',
  'tests/integration/run-store-concurrency.test.ts',
  'scripts/live-preflight.test.ts'
)
$files | ForEach-Object { Write-Output $_ }
pnpm vitest run @files
```

Expected: exactly fourteen printed test files and all pass.

Then run:

```powershell
pnpm verify
```

Expected: formatting, strict type checking, zero-warning lint, the full offline test suite, and the production Next.js build all exit 0. Capture repository status before and after the build and require no new tracked changes.

- [ ] **Step 7: Run enforcement scripts truthfully and inspect hygiene**

Run:

```powershell
if (Test-Path 'scripts/scan-secrets.mjs') {
  pnpm scan:secrets
} else {
  Write-Output 'UNAVAILABLE: scripts/scan-secrets.mjs'
}

if (Test-Path 'scripts/assert-build-clean.mjs') {
  pnpm check:build-clean
} else {
  Write-Output 'UNAVAILABLE: scripts/assert-build-clean.mjs'
}

git diff --check
git status --short
```

Expected: every available gate passes. Missing script files are recorded as unavailable, not passing. Manually inspect the changed files for API keys, full participant numbers, identities, consent evidence, raw provider data, and native private paths.

- [ ] **Step 8: Commit Task 3 separately**

Run:

```powershell
git add -- scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
git diff --cached --check
git diff --cached -- scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
git commit -m "feat: guard Kenya CALL-E preflight"
```

Expected: one commit containing exactly the guarded preflight, tests, and operator documentation. Do not stage `output/`, `.env.local`, `tmp/`, private evidence, or generated files.

- [ ] **Step 9: Run Task 3 specification and quality gates**

Dispatch two fresh read-only reviewers. The specification reviewer must verify profile derivation, sanitized output, zero-network rejection, exact one fake POST, unchanged live authorization, and runbook traceability. The quality reviewer must inspect permit concurrency, bypass exports, full-number leakage, canonical recipient aliasing, private evidence publication, fake-fetch isolation, and the full diff for regressions. Stop unless both verdicts pass with no unresolved Critical or Important finding.

---

### Task 4: Complete the whole-branch review and handoff

**Files:**
- Review: `docs/superpowers/specs/2026-08-10-supplysignal-ai-kenya-recipient-profile-design.md`
- Review: `docs/superpowers/plans/2026-08-10-supplysignal-ai-kenya-recipient-profile-implementation.md`
- Review: all Task 1-3 changed source, test, and runbook files

**Interfaces:**
- Consumes: the three independently reviewed implementation commits.
- Produces: a reviewed feature branch ready for an explicitly authorized push/PR workflow; it does not produce live evidence or authorize a call.

- [ ] **Step 1: Prove the whole branch scope**

Run:

```powershell
git merge-base main HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: only the approved specification, implementation plan, Task 1-3 files, and their separate commits appear. `output/`, `.env.local`, `tmp/`, credentials, and private evidence do not appear.

- [ ] **Step 2: Run fresh final verification**

Run:

```powershell
pnpm verify
git diff --check main...HEAD
git status --short --branch
```

Run each repository enforcement script only if its implementation file exists, using the conditional commands from Task 3. Expected: all available checks pass; the tracked worktree is clean; unrelated `output/` remains untouched and untracked.

- [ ] **Step 3: Run independent whole-branch reviews**

Dispatch two new read-only reviewers against `main...HEAD`:

1. Specification reviewer: require complete coverage of all ten acceptance criteria, exact authority supersession, and no hidden US-only runtime path.
2. Quality reviewer: require no unresolved Critical or Important issue in validation, mapping, preflight authorization, privacy, filesystem safety, test isolation, documentation, or scope.

Any finding must be reproduced with a failing test before production edits. Authority-changing corrections require project-owner approval and a separate corrective commit followed by fresh gates and both reviews.

- [ ] **Step 4: Report the implementation without external effects**

Report each commit, RED/GREEN evidence, affected/full verification, unavailable gates, final review verdicts, branch status, and the exact files changed. Explicitly state that no live CALL-E request, credential use, phone call, browser action, deployment, push, PR, merge, or publication occurred during the implementation plan.

Do not run the Kenyan preflight until the reviewed branch is merged, current `KE + English` support is rechecked, the participant is ready, and the project owner gives a fresh authorization naming exactly one scenario and one call with no retry/redial.
