# SupplySignal AI Ukraine Recipient Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict Ukraine `+380` recipient support for English and Ukrainian
calls while preserving SupplySignal AI's one-call, no-retry, offline-test, and
privacy boundaries.

**Architecture:** Extend `src/domain/call-recipient.ts` with two exact Ukraine
profile variants and keep it as the only source of truth for phone, region,
locale, mask, and presentation. The CALL-E request builder selects one of two
semantically equivalent spoken-task templates from the canonical locale. The
guarded preflight accepts an allowlisted server-only language choice for
Ukraine, fails closed before permit or network access, and retains the existing
single live entry point.

**Tech Stack:** Node.js `22.23.1`, pnpm `11.20.0`, TypeScript 7 CLI with the
repository's TypeScript 6 compatibility API, Zod `4.4.3`, Vitest `4.1.10`,
Next.js `16.3.0`, CALL-E OpenAPI `0.6.0`, PowerShell-compatible verification.

## Global Constraints

- Product authority is
  `docs/superpowers/specs/2026-08-11-supplysignal-ai-ukraine-recipient-profile-design.md`.
- Preserve exact existing `US/en-US` and `KE/en-KE` behavior.
- Add only `UA/en-UA` and `UA/uk-UA`; do not add a generic locale or region
  configuration surface.
- Ukraine phone validation is exactly `^\+380[1-9]\d{8}$` and its display mask
  is exactly `+380 **-***-1234`.
- `SUPPLIER_TEST_LANGUAGE` accepts exact `English` or `Ukrainian` only for an
  approved `+380` number; it must be absent for United States and Kenya.
- The English task text remains byte-for-byte unchanged. The Ukrainian task
  preserves the same disclosure, concise-turn, one-question, decline, and
  no-invention semantics.
- Keep `recipient_result_schema`, metadata, domain values, risk logic, and
  artifact contracts in English and unchanged.
- Keep the existing OpenAPI version, endpoints, stable `Idempotency-Key`, one
  create POST at most, no retry, and no redial.
- Required tests remain deterministic, offline, credential-free, and free of
  live CALL-E or OpenAI access.
- Build all phone-shaped test data from non-sensitive segments. Do not commit a
  participant number, identity, consent evidence, credential, transcript, raw
  provider envelope, or native private path.
- Do not change dependencies, package-manager configuration, persistence,
  state machines, OpenAI, risk logic, artifacts, UI, CI, or deployment.
- Do not push, open a pull request, merge, or place a live call while executing
  this plan. Each external action requires separate owner authorization.
- Correction A18 permits Task 1 to widen only the compile-time country and
  language unions in `scripts/live-preflight.ts` so the repository continues to
  typecheck after the domain presentation contract expands. Task 1 must not add
  `SUPPLIER_TEST_LANGUAGE`, Ukraine runtime acceptance, a new preflight error,
  region/locale output, permit changes, provider construction, or network
  behavior; those remain Task 3 responsibilities.
- Every task uses TDD: focused RED, minimal GREEN, affected verification,
  precise staging, one cohesive commit, then independent specification and
  quality review before the next task.

## File and interface map

- `src/domain/call-recipient.ts`: canonical supported-profile allowlist,
  structural phone validation, language selection, canonical recipient copy,
  deterministic mask, sanitized presentation, bounded validation reason.
- `src/adapters/calle/request.ts`: strict request input boundary and localized
  spoken-task selection; no provider execution occurs here.
- `scripts/live-preflight.ts`: server-only language configuration, bounded
  public error mapping, sanitized pre-authorization display, and the sole
  guarded live composition.
- `docs/operator-runbook.md`: operator setup, same-day support check, consent,
  execution, stop, recovery, and credential-cleanup instructions.
- Colocated `*.test.ts` files: focused domain, adapter, preflight, and regression
  proof. No committed fixture requires a phone or locale change.

---

### Task 1: Add canonical Ukraine recipient variants

**Files:**

- Modify: `src/domain/call-recipient.ts`
- Modify: `src/domain/call-recipient.test.ts`
- Modify: `scripts/live-preflight.ts` (Correction A18 compile-time unions only)

**Interfaces:**

- Consumes: existing `withPlainDataBoundary`, Zod strict schemas, and the
  current `CallRecipient` contract used by application and adapters.
- Produces:

```ts
export type RecipientLanguage = "English" | "Ukrainian";

export type CallRecipientValidationCode =
  | "UNSUPPORTED_RECIPIENT_REGION"
  | "UNSUPPORTED_RECIPIENT_LANGUAGE";

export class CallRecipientValidationError extends Error {
  constructor(readonly code: CallRecipientValidationCode);
}

export function createCallRecipient(input: unknown): CallRecipient;
export function maskPhoneNumber(phoneE164: string): string;
export function getCallRecipientPresentation(input: unknown): {
  readonly country: "United States" | "Kenya" | "Ukraine";
  readonly language: RecipientLanguage;
};
```

- `CallRecipient` remains a strict canonical object with `recipientName`,
  `phoneE164`, `maskedPhone`, `region`, and `locale`. It does not persist a
  duplicate `language` field; presentation derives language from the exact
  region/locale profile.
- Correction A18 preserves the current preflight runtime while widening its
  annotated country and language result types to accept this Task's expanded
  presentation interface.

- [ ] **Step 1: Add synthetic Ukraine constants and positive tests**

Add these values near the existing Kenya constants in
`src/domain/call-recipient.test.ts`:

```ts
const ukraineLowerBoundary = ["+380", "100", "000", "000"].join("");
const ukraineUpperBoundary = ["+380", "999", "999", "999"].join("");

const validUkraineEnglishRecipient = {
  recipientName: "Consenting participant",
  phoneE164: ukraineLowerBoundary,
  maskedPhone: "+380 **-***-0000",
  region: "UA",
  locale: "en-UA",
} as const;

const validUkraineUkrainianRecipient = {
  ...validUkraineEnglishRecipient,
  locale: "uk-UA",
} as const;
```

Add one parameterized test that requires an explicit language and proves both
canonical variants:

```ts
it.each([
  ["English", validUkraineEnglishRecipient],
  ["Ukrainian", validUkraineUkrainianRecipient],
] as const)("creates the canonical Ukraine %s recipient", (language, expected) => {
  expect(
    createCallRecipient({
      recipientName: "  Consenting participant  ",
      phoneE164: ukraineLowerBoundary,
      language,
    }),
  ).toEqual(expected);
  expect(getCallRecipientPresentation(expected)).toEqual({
    country: "Ukraine",
    language,
  });
});

it("uses the deterministic Ukraine mask", () => {
  expect(maskPhoneNumber(ukraineUpperBoundary)).toBe("+380 **-***-9999");
});
```

- [ ] **Step 2: Add strict negative and language-policy tests**

Add exact structural rejection cases:

```ts
it.each([
  ["local format", ["0", "67", "000", "0000"].join("")],
  ["zero national prefix", ["+380", "000", "000", "000"].join("")],
  ["too short", ["+380", "100", "000", "00"].join("")],
  ["too long", ["+380", "100", "000", "000", "0"].join("")],
  ["spaces", ["+380 ", "100 ", "000 000"].join("")],
  ["hyphens", ["+380-", "100-", "000-000"].join("")],
  ["extension", ["+380", "100", "000", "000", "x1"].join("")],
])("rejects Ukraine %s before canonicalization", (_case, phoneE164) => {
  expect(() =>
    createCallRecipient({
      recipientName: "Consenting participant",
      phoneE164,
      language: "Ukrainian",
    }),
  ).toThrow();
});
```

Add language-selection and cross-profile tests:

```ts
it("requires an exact Ukraine language", () => {
  for (const language of [undefined, "ukrainian", "Ukrainian ", "French"]) {
    try {
      createCallRecipient({
        recipientName: "Consenting participant",
        phoneE164: ukraineLowerBoundary,
        ...(language === undefined ? {} : { language }),
      });
      throw new Error("Expected Ukraine language rejection");
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_RECIPIENT_LANGUAGE" });
    }
  }
});

it.each([
  [validRecipient.phoneE164, "English"],
  [kenyaLowerBoundary, "English"],
] as const)("rejects a language override for %s", (phoneE164, language) => {
  try {
    createCallRecipient({
      recipientName: "Consenting participant",
      phoneE164,
      language,
    });
    throw new Error("Expected language override rejection");
  } catch (error: unknown) {
    expect(error).toMatchObject({
      code: "UNSUPPORTED_RECIPIENT_LANGUAGE",
    });
  }
});
```

Extend the existing mismatch test to reject:

- a Ukraine phone with `US/en-US` or `KE/en-KE`;
- a Ukraine English value changed to `uk-UA` without rebuilding the canonical
  variant;
- a Ukraine Ukrainian value changed to `en-UA` with an inconsistent expected
  presentation assertion; and
- a US or Kenya phone paired with either Ukraine locale.

Add a `safeParse` privacy assertion proving the malformed raw Ukraine value is
absent from `JSON.stringify(result.error)` and `result.error.message`.

- [ ] **Step 3: Add accessor-safety tests**

Add a language accessor regression beside the current Kenya phone accessor
test:

```ts
it("rejects an accessor-backed Ukraine language without reading its getter", () => {
  let calls = 0;
  const input = {
    recipientName: "Consenting participant",
    phoneE164: ukraineLowerBoundary,
  };
  Object.defineProperty(input, "language", {
    enumerable: true,
    get() {
      calls += 1;
      return "Ukrainian";
    },
  });

  expect(() => createCallRecipient(input)).toThrow();
  expect(calls).toBe(0);
});
```

Retain the existing inherited-property and plain-data coverage through the
current `withPlainDataBoundary` wrapper. Do not add direct property reads before
that wrapper parses the input.

- [ ] **Step 4: Run the focused test and record genuine RED**

Run:

```powershell
pnpm vitest run src/domain/call-recipient.test.ts
```

Expected: exit code `1`. The new cases fail because `UA`, `en-UA`, `uk-UA`, the
Ukraine mask, explicit language selection, and the bounded validation code are
not implemented. Existing US and Kenya cases remain selected and green.

- [ ] **Step 5: Implement the bounded profile model**

In `src/domain/call-recipient.ts`, add exact patterns:

```ts
const UA_E164_PATTERN = /^\+380[1-9]\d{8}$/;
const UA_MASKED_PHONE_PATTERN = /^\+380 \*\*-\*\*\*-\d{4}$/;

export type RecipientLanguage = "English" | "Ukrainian";
export type CallRecipientValidationCode =
  | "UNSUPPORTED_RECIPIENT_REGION"
  | "UNSUPPORTED_RECIPIENT_LANGUAGE";

export class CallRecipientValidationError extends Error {
  constructor(readonly code: CallRecipientValidationCode) {
    super("Unsupported call recipient");
    this.name = "CallRecipientValidationError";
  }
}
```

Represent the allowlist as four immutable entries keyed by exact locale, not
region alone:

```ts
const RECIPIENT_PROFILES = {
  "en-US": {
    region: "US",
    locale: "en-US",
    country: "United States",
    language: "English",
    phonePattern: US_E164_PATTERN,
    mask: (phoneE164: string) => `+1 ***-***-${phoneE164.slice(-4)}`,
  },
  "en-KE": {
    region: "KE",
    locale: "en-KE",
    country: "Kenya",
    language: "English",
    phonePattern: KE_E164_PATTERN,
    mask: (phoneE164: string) => `+254 ***-**-${phoneE164.slice(-4)}`,
  },
  "en-UA": {
    region: "UA",
    locale: "en-UA",
    country: "Ukraine",
    language: "English",
    phonePattern: UA_E164_PATTERN,
    mask: (phoneE164: string) => `+380 **-***-${phoneE164.slice(-4)}`,
  },
  "uk-UA": {
    region: "UA",
    locale: "uk-UA",
    country: "Ukraine",
    language: "Ukrainian",
    phonePattern: UA_E164_PATTERN,
    mask: (phoneE164: string) => `+380 **-***-${phoneE164.slice(-4)}`,
  },
} as const;
```

Create strict canonical schema branches for all four exact profiles. Each
branch must validate its own phone pattern, literal region, literal locale,
masked-phone pattern, and branch-local equality with the deterministic mask.
Wrap the final four-branch union with `withPlainDataBoundary`.

Extend the input schema with:

```ts
language: z.string().max(32).optional(),
region: z.enum(["US", "KE", "UA"]).optional(),
locale: z.enum(["en-US", "en-KE", "en-UA", "uk-UA"]).optional(),
```

The bounded string intentionally reaches the domain policy so unknown, padded,
or differently cased values receive the same bounded language code instead of
a raw schema error. After the plain-data parse:

1. Resolve the country by exact phone pattern. If no country matches, throw
   `CallRecipientValidationError("UNSUPPORTED_RECIPIENT_REGION")`.
2. For US or Kenya, reject any `language` value with
   `UNSUPPORTED_RECIPIENT_LANGUAGE`.
3. For Ukraine, require `English` or `Ukrainian`; choose `en-UA` or `uk-UA`
   exactly.
4. Reject an explicit mismatched region as `UNSUPPORTED_RECIPIENT_REGION` and
   a mismatched locale as `UNSUPPORTED_RECIPIENT_LANGUAGE`.
5. Return a new `callRecipientSchema.parse(...)` canonical copy.

`maskPhoneNumber` may resolve the country-level mask because both Ukraine
language variants use the same mask. `getCallRecipientPresentation` must select
the profile using the validated recipient's exact `locale`, not `region` alone.

- [ ] **Step 6: Apply the Correction A18 compile-time compatibility change**

In `scripts/live-preflight.ts`, import the Task 1 `RecipientLanguage` type and
widen only these two existing annotations:

```ts
country: "United States" | "Kenya" | "Ukraine";
language: RecipientLanguage;
```

Apply them to the current `PreflightSummary` and `requireConfiguration` return
type. Do not change `requireConfiguration` logic, environment reads, public
error codes, sanitized output fields, permit ordering, execution composition,
provider setup, or filesystem behavior. Ukraine still fails in the current
preflight because Task 3 has not introduced its mandatory language input.

- [ ] **Step 7: Run focused GREEN and affected domain/application tests**

Run:

```powershell
pnpm vitest run src/domain/call-recipient.test.ts
pnpm vitest run src/domain/call-recipient.test.ts src/application/create-run.test.ts src/domain/run.test.ts src/domain/trust.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
```

Expected: every command exits `0`. The application tests prove canonical
recipients still persist through the existing A16 branch without changing
`createRun`.

- [ ] **Step 8: Review, stage, and commit Task 1 only**

Inspect:

```powershell
git diff -- src/domain/call-recipient.ts src/domain/call-recipient.test.ts scripts/live-preflight.ts
git status --short
```

Stage and commit only the three owned files:

```powershell
git add -- src/domain/call-recipient.ts src/domain/call-recipient.test.ts scripts/live-preflight.ts
git diff --cached --check
git diff --cached -- src/domain/call-recipient.ts src/domain/call-recipient.test.ts scripts/live-preflight.ts
git commit -m "feat: add Ukraine recipient profiles"
```

Expected: one cohesive domain-and-compile-compatibility commit. The preflight
diff contains annotations only. `output/`, `.env.local`, `tmp/`, private
evidence, and generated files remain unstaged.

- [ ] **Step 9: Pass Task 1 independent review gate**

Dispatch two fresh read-only reviewers against the Task 1 commit:

1. Specification reviewer: verify the exact regex, masks, four profile pairs,
   explicit Ukraine language, US/KE language prohibition, sanitized errors,
   unchanged A16 canonical-recipient behavior, and exact A18 compile-only scope.
2. Quality reviewer: inspect plain-data/accessor safety, cross-profile totality,
   duplicate-pattern resolution, type narrowing, mutation/alias behavior, test
   boundary quality, and participant-data hygiene.

Do not begin Task 2 unless both reviewers report no unresolved Critical or
Important finding. Any behavioral correction starts with a new focused failing
test and receives its own corrective commit and both re-reviews.

---

### Task 2: Map Ukraine profiles and localize the spoken task

**Files:**

- Modify: `src/adapters/calle/request.ts`
- Modify: `src/adapters/calle/request.test.ts`

**Interfaces:**

- Consumes: Task 1 `CallRecipient` variants, especially exact `en-UA` and
  `uk-UA` locales.
- Produces: the existing `prepareCreateCallRequest` and
  `buildCreateCallRequest` interfaces with unchanged request shape. Locale
  selects one of two bounded task templates; no new public adapter method is
  introduced.

- [ ] **Step 1: Add canonical Ukraine request fixtures in the test**

Add segmented synthetic input values:

```ts
const ukrainePhone = ["+380", "100", "000", "000"].join("");

const ukraineEnglishInput: CreateSupplierCall = {
  ...input,
  recipient: {
    recipientName: "Consenting participant",
    phoneE164: ukrainePhone,
    maskedPhone: "+380 **-***-0000",
    region: "UA",
    locale: "en-UA",
  },
};

const ukraineUkrainianInput: CreateSupplierCall = {
  ...ukraineEnglishInput,
  recipient: {
    ...ukraineEnglishInput.recipient,
    locale: "uk-UA",
  },
};
```

Extend the mapping test with exact expected recipients:

```ts
expect(buildCreateCallRequest(ukraineEnglishInput).recipients).toEqual([
  { phones: [ukrainePhone], region: "UA", locale: "en-UA" },
]);
expect(buildCreateCallRequest(ukraineUkrainianInput).recipients).toEqual([
  { phones: [ukrainePhone], region: "UA", locale: "uk-UA" },
]);
```

- [ ] **Step 2: Lock the current English task byte-for-byte**

Define the expected current English task from the existing seven lines:

```ts
const expectedEnglishTask = [
  "You are SupplySignal AI, an automated calling agent.",
  "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.",
  "After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.",
  "Ask about fictional purchase order PO-2048 from Northstar Components.",
  "Confirm the quantity expected (500), quantity ready now, quantity delayed, and promised delivery date relative to 2026-08-15.",
  "Ask for the delay reason, whether human follow-up is required, and whether the supplier is unable to fulfill the order.",
  "If the recipient declines, stop politely and do not invent answers. If nobody answers, do not infer supplier facts.",
].join("\n");

it.each([input, kenyaInput, ukraineEnglishInput])(
  "keeps the approved English task unchanged for $recipient.locale",
  (profileInput) => {
    expect(buildCreateCallRequest(profileInput).task).toBe(expectedEnglishTask);
  },
);
```

- [ ] **Step 3: Add the exact Ukrainian task contract test**

Use this approved localized task:

```ts
const expectedUkrainianTask = [
  "Ви — SupplySignal AI, автоматизований агент для телефонних дзвінків.",
  "Негайно повідомте, що співрозмовник розмовляє з автоматизованим агентом на основі ШІ, сценарій із постачальником є вигаданим, а дзвінок може записуватися для схваленої демонстрації на хакатоні.",
  "Після повного повідомлення говоріть стисло й природно: одне або два короткі речення. Ставте лише одне питання за раз і дочекайтеся відповіді. Не зачитуйте все замовлення одразу та не повторюйте вже підтверджені факти.",
  "Запитайте про вигадане замовлення на закупівлю PO-2048 від Northstar Components.",
  "Підтвердьте очікувану кількість (500), кількість, готову зараз, кількість із затримкою та обіцяну дату поставки відносно 2026-08-15.",
  "Запитайте про причину затримки, потребу у зв’язку з менеджером і чи може постачальник виконати замовлення.",
  "Якщо співрозмовник відмовляється, ввічливо завершіть розмову й не вигадуйте відповіді. Якщо ніхто не відповідає, не робіть висновків про факти щодо постачальника.",
].join("\n");

it("uses the complete approved Ukrainian spoken task", () => {
  const request = buildCreateCallRequest(ukraineUkrainianInput);

  expect(request.task).toBe(expectedUkrainianTask);
  expect(request.task.length).toBeLessThanOrEqual(4_000);
  expect(request.recipient_result_schema).toBe(recipientResultSchema);
  expect(request.metadata).toEqual({ workflow_run_id: "run_001" });
});
```

Add explicit ordering assertions: disclosure is line index `1`, concise-turn
instruction immediately follows it, and the first order question immediately
follows the concise-turn instruction. Assert the words expressing decline and
no-invention behavior occur once. Do not test language quality through a live
call in this task.

- [ ] **Step 4: Add cross-profile request rejection tests**

Extend the existing invalid-recipient table with:

```ts
[
  "Ukraine phone paired with the US profile",
  {
    phoneE164: ukrainePhone,
    maskedPhone: "+380 **-***-0000",
    region: "US",
    locale: "en-US",
  },
],
[
  "Ukraine English phone paired with an unapproved locale",
  {
    phoneE164: ukrainePhone,
    maskedPhone: "+380 **-***-0000",
    region: "UA",
    locale: "ru-UA",
  },
],
[
  "US phone paired with the Ukraine Ukrainian profile",
  { region: "UA", locale: "uk-UA" },
],
```

Each must throw only `CALL_CREATION_FAILED`. The error string must not include
the synthetic raw phone or localized prompt internals.

- [ ] **Step 5: Run focused RED**

Run:

```powershell
pnpm vitest run src/adapters/calle/request.test.ts
```

Expected: exit code `1`. Ukraine mapping is rejected and the Ukrainian task is
not selected. Existing English disclosure, schema, idempotency, and safety
tests remain selected.

- [ ] **Step 6: Implement locale-selected task builders**

In `src/adapters/calle/request.ts`, extract the current seven English lines
without changing their text:

```ts
function buildEnglishTask(input: CreateSupplierCall): string {
  return [
    "You are SupplySignal AI, an automated calling agent.",
    "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.",
    "After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.",
    `Ask about fictional purchase order ${input.order.purchaseOrderRef} from ${input.order.supplierName}.`,
    `Confirm the quantity expected (${input.order.expectedQuantity}), quantity ready now, quantity delayed, and promised delivery date relative to ${input.order.requiredDeliveryDate}.`,
    "Ask for the delay reason, whether human follow-up is required, and whether the supplier is unable to fulfill the order.",
    "If the recipient declines, stop politely and do not invent answers. If nobody answers, do not infer supplier facts.",
  ].join("\n");
}
```

Add the Ukrainian builder using the exact seven lines from Step 3 and dynamic
validated order fields:

```ts
function buildUkrainianTask(input: CreateSupplierCall): string {
  return [
    "Ви — SupplySignal AI, автоматизований агент для телефонних дзвінків.",
    "Негайно повідомте, що співрозмовник розмовляє з автоматизованим агентом на основі ШІ, сценарій із постачальником є вигаданим, а дзвінок може записуватися для схваленої демонстрації на хакатоні.",
    "Після повного повідомлення говоріть стисло й природно: одне або два короткі речення. Ставте лише одне питання за раз і дочекайтеся відповіді. Не зачитуйте все замовлення одразу та не повторюйте вже підтверджені факти.",
    `Запитайте про вигадане замовлення на закупівлю ${input.order.purchaseOrderRef} від ${input.order.supplierName}.`,
    `Підтвердьте очікувану кількість (${input.order.expectedQuantity}), кількість, готову зараз, кількість із затримкою та обіцяну дату поставки відносно ${input.order.requiredDeliveryDate}.`,
    "Запитайте про причину затримки, потребу у зв’язку з менеджером і чи може постачальник виконати замовлення.",
    "Якщо співрозмовник відмовляється, ввічливо завершіть розмову й не вигадуйте відповіді. Якщо ніхто не відповідає, не робіть висновків про факти щодо постачальника.",
  ].join("\n");
}
```

Select only from the canonical locale:

```ts
const task =
  input.recipient.locale === "uk-UA"
    ? buildUkrainianTask(input)
    : buildEnglishTask(input);
```

Keep safe-inline validation before interpolation and retain the existing
`MAX_CALL_TASK_LENGTH` check after building either template. Do not introduce a
language input to the adapter; canonical locale is authoritative.

- [ ] **Step 7: Run focused and affected GREEN**

Run:

```powershell
pnpm vitest run src/adapters/calle/request.test.ts
pnpm vitest run src/domain/call-recipient.test.ts src/adapters/calle/request.test.ts src/adapters/calle/client.test.ts src/application/start-run.test.ts src/application/reconcile-run.test.ts tests/integration/call-lifecycle.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
```

Expected: every command exits `0`. Client and lifecycle tests prove no provider
or retry behavior changed.

- [ ] **Step 8: Review, stage, and commit Task 2 only**

```powershell
git diff -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git status --short
git add -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git diff --cached --check
git diff --cached -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git commit -m "feat: localize Ukraine supplier calls"
```

Expected: exactly the adapter source and focused test are committed.

- [ ] **Step 9: Pass Task 2 independent review gate**

Dispatch two fresh read-only reviewers:

1. Specification reviewer: compare both task templates line-by-line against
   the approved design, verify exact `UA` mappings, unchanged English text,
   unchanged result schema/metadata/OpenAPI contract, and no live execution.
2. Quality reviewer: inspect prompt injection boundaries, Unicode/control
   handling, task-size checks, locale exhaustiveness, request canonicalization,
   idempotency, redirect/no-retry protections, test mutation resistance, and
   absence of raw values in bounded errors.

Stop before Task 3 until both reviews have no unresolved Critical or Important
finding. Corrections require focused RED, minimal GREEN, a corrective commit,
and both re-reviews.

---

### Task 3: Extend the guarded preflight and operator runbook

**Files:**

- Modify: `scripts/live-preflight.ts`
- Modify: `scripts/live-preflight.test.ts`
- Modify: `docs/operator-runbook.md`

**Interfaces:**

- Consumes: Task 1 `createCallRecipient`,
  `CallRecipientValidationError`, `CallRecipient`, and presentation; Task 2
  locale-selected request builder through the existing real composition.
- Produces:

```ts
type PreflightErrorCode =
  | /* existing codes */
  | "UNSUPPORTED_RECIPIENT_LANGUAGE";

export type PreflightSummary = {
  scenario: PreflightScenario;
  maskedPhone: string;
  country: "United States" | "Kenya" | "Ukraine";
  language: "English" | "Ukrainian";
  region: CallRecipient["region"];
  locale: CallRecipient["locale"];
  status: RunRecord["status"];
  providerStatus: ProviderEvidenceSnapshot["status"] | "not_available";
  eventCount: number;
};
```

- `runCliPreflight()` remains parameterless and the sole exported route to the
  private live composition. Do not export the executor, composition, writer,
  provider, prompt, filesystem, or permit.

- [ ] **Step 1: Extend test helpers without leaking environment state**

Add segmented Ukraine data:

```ts
const ukrainePhone = ["+380", "100", "000", "000"].join("");
```

Extend `GuardedCliOptions`:

```ts
type GuardedCliOptions = {
  apiKey?: string;
  phone?: string;
  language?: string;
  phrase?: string;
  interactive?: boolean;
  fetchMock?: typeof fetch;
  mockFileSystem?: (
    actual: typeof import("node:fs/promises"),
  ) => Partial<typeof import("node:fs/promises")>;
};
```

In `runGuardedCli`, save the original
`process.env.SUPPLIER_TEST_LANGUAGE`, set or delete it from `options.language`,
and restore it in `finally` exactly as the API key and phone are restored. This
helper change is test-only and must not create a production injection path.

- [ ] **Step 2: Add pre-permit zero-network language tests**

Use `createPreflightProcess` with spies:

```ts
it.each([
  [undefined, "missing"],
  ["ukrainian", "wrong case"],
  ["Ukrainian ", "padded"],
  ["French", "unsupported"],
] as const)("rejects %s Ukraine language before authorization", async (language) => {
  const { createPreflightProcess } = await freshModule();
  const run = createPreflightProcess();
  const input = validInput({
    env: {
      CALLE_API_KEY: apiKey,
      SUPPLIER_TEST_PHONE: ukrainePhone,
      ...(language === undefined
        ? {}
        : { SUPPLIER_TEST_LANGUAGE: language }),
    },
  });

  await expect(run(input)).rejects.toMatchObject({
    code: "UNSUPPORTED_RECIPIENT_LANGUAGE",
  });
  expect(input.prompt).not.toHaveBeenCalled();
  expect(input.execute).not.toHaveBeenCalled();
  expect(input.writePrivateEvidence).not.toHaveBeenCalled();
  expect(JSON.stringify((input.writeOutput as ReturnType<typeof vi.fn>).mock.calls))
    .not.toContain(language ?? "missing");
});
```

Add US/KE extra-language cases with the same expected code and zero prompt,
execute, evidence, and POST calls.

- [ ] **Step 3: Add sanitized Ukraine profile tests**

For each exact language, run the injected preflight process and assert the
canonical execution input and summary:

```ts
it.each([
  ["English", "en-UA"],
  ["Ukrainian", "uk-UA"],
] as const)("derives the canonical Ukraine %s profile", async (language, locale) => {
  const { createPreflightProcess } = await freshModule();
  const run = createPreflightProcess();
  const input = validInput({
    env: {
      CALLE_API_KEY: apiKey,
      SUPPLIER_TEST_PHONE: ukrainePhone,
      SUPPLIER_TEST_LANGUAGE: language,
    },
  });

  const summary = await run(input);

  expect(input.execute).toHaveBeenCalledWith({
    scenario: "answered",
    apiKey,
    recipient: {
      recipientName: "Consenting participant",
      phoneE164: ukrainePhone,
      maskedPhone: "+380 **-***-0000",
      region: "UA",
      locale,
    },
  });
  expect(summary).toMatchObject({
    country: "Ukraine",
    language,
    region: "UA",
    locale,
    maskedPhone: "+380 **-***-0000",
  });
  const output = JSON.stringify(
    (input.writeOutput as ReturnType<typeof vi.fn>).mock.calls,
  );
  expect(output).toContain("Ukraine");
  expect(output).toContain(language);
  expect(output).toContain("UA");
  expect(output).toContain(locale);
  expect(output).not.toContain(ukrainePhone);
});
```

- [ ] **Step 4: Add actual guarded-composition tests with one fake POST**

Add two `runGuardedCli` cases using `language: "English"` and
`language: "Ukrainian"`. For each:

```ts
const result = await runGuardedCli({
  apiKey,
  phone: ukrainePhone,
  language,
});

expect(result.error).toBeUndefined();
expect(
  result.fetchMock.mock.calls.filter(
    ([, request]) => request?.method === "POST",
  ),
).toHaveLength(1);
const [, postRequest] = result.fetchMock.mock.calls.find(
  ([, request]) => request?.method === "POST",
) ?? [];
const body = JSON.parse(String(postRequest?.body)) as {
  recipients: readonly { phones: readonly string[]; region: string; locale: string }[];
  task: string;
};
expect(body.recipients).toEqual([
  { phones: [ukrainePhone], region: "UA", locale },
]);
expect(body.task).toContain(
  language === "Ukrainian"
    ? "автоматизованим агентом на основі ШІ"
    : "AI-assisted fictional supplier demo",
);
expect(result.output).not.toContain(ukrainePhone);
```

Use `try/finally` and `removeSession(guardedRunId)` exactly as existing guarded
tests do. These are local fake `Response` objects; no real fetch is permitted.

- [ ] **Step 5: Run focused RED**

Run:

```powershell
pnpm vitest run scripts/live-preflight.test.ts
```

Expected: exit code `1`. The new error code, environment variable, Ukraine
profile, region/locale display, and guarded composition are absent. Existing
permit/filesystem tests remain selected.

- [ ] **Step 6: Implement the fail-closed language guard**

In `scripts/live-preflight.ts`:

1. Import `CallRecipientValidationError` and `RecipientLanguage` from the
   domain module.
2. Add `UNSUPPORTED_RECIPIENT_LANGUAGE` to `PreflightErrorCode`.
3. Extend country/language summary unions and add canonical `region`/`locale`.
4. Read `env.SUPPLIER_TEST_LANGUAGE` only inside `requireConfiguration`.
5. Reject any defined value other than exact `English` or `Ukrainian` before
   invoking `createCallRecipient`.
6. Pass the exact value as optional `language` to `createCallRecipient`.
7. Catch `CallRecipientValidationError` and map its code exactly. Map all other
   recipient validation failures to `UNSUPPORTED_RECIPIENT_REGION` without
   copying the raw error or input.

The core shape is:

```ts
const language = env.SUPPLIER_TEST_LANGUAGE;
if (
  language !== undefined &&
  language !== "English" &&
  language !== "Ukrainian"
) {
  fail("UNSUPPORTED_RECIPIENT_LANGUAGE");
}

try {
  const recipient = createCallRecipient({
    recipientName: "Consenting participant",
    phoneE164: phone,
    ...(language === undefined ? {} : { language }),
  });
  const presentation = getCallRecipientPresentation(recipient);
  return { apiKey, recipient, ...presentation };
} catch (error: unknown) {
  if (error instanceof CallRecipientValidationError) {
    fail(error.code);
  }
  fail("UNSUPPORTED_RECIPIENT_REGION");
}
```

Before prompting, extend sanitized output with:

```ts
`Region: ${configuration.recipient.region}`,
`Locale: ${configuration.recipient.locale}`,
```

Populate the same fields in `PreflightSummary`. Do not move configuration
validation after interactivity or permit reservation.

- [ ] **Step 7: Update the operator runbook**

In `docs/operator-runbook.md`:

- change all “United States and Kenya” scope statements to “United States,
  Kenya, and Ukraine”;
- add both Ukraine rows with the exact regex, mask, region, locale, and language;
- explain that `SUPPLIER_TEST_LANGUAGE` is required only for Ukraine and must be
  absent for US/KE;
- add the exact PowerShell setup:

```powershell
# United States or Kenya
Remove-Item Env:SUPPLIER_TEST_LANGUAGE -ErrorAction SilentlyContinue

# Ukraine English
$env:SUPPLIER_TEST_LANGUAGE = "English"

# Ukraine Ukrainian
$env:SUPPLIER_TEST_LANGUAGE = "Ukrainian"
```

- change the phone prompt to “Consenting US, Kenya, or Ukraine recipient in
  strict E.164 format”;
- require same-day `UA + selected language` verification against the official
  supported-regions table;
- state that Ukraine currently uses an international line primarily intended
  for testing;
- add `UNSUPPORTED_RECIPIENT_LANGUAGE` to recovery guidance;
- include `SUPPLIER_TEST_LANGUAGE` in credential cleanup; and
- preserve all consent, no-retry, ambiguous-create, Dashboard, evidence,
  filesystem, and escalation guidance.

Do not include a full Ukraine phone, participant identity, consent evidence,
credential, raw transcript, or provider envelope.

- [ ] **Step 8: Run focused and affected GREEN**

Run:

```powershell
pnpm vitest run scripts/live-preflight.test.ts
pnpm vitest run src/domain/call-recipient.test.ts src/application/create-run.test.ts src/application/start-run.test.ts src/application/reconcile-run.test.ts src/adapters/calle/request.test.ts src/adapters/calle/client.test.ts scripts/live-preflight.test.ts tests/integration/call-lifecycle.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
```

Expected: every command exits `0`. The explicit selection covers domain,
canonical application storage, request construction, client behavior, guarded
composition, and lifecycle no-retry behavior.

- [ ] **Step 9: Prove the no-credential CLI still fails before network**

Run in the repository root:

```powershell
Remove-Item Env:CALLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_PHONE -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_LANGUAGE -ErrorAction SilentlyContinue
pnpm tsx scripts/live-preflight.ts --scenario answered
```

Expected: nonzero exit with only bounded
`PREFLIGHT_CONFIGURATION_REQUIRED`. No phone rings, no CALL-E request occurs,
and no private result is published.

- [ ] **Step 10: Review, stage, and commit Task 3 only**

```powershell
git diff -- scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
git status --short
git add -- scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
git diff --cached --check
git diff --cached -- scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
git commit -m "feat: guard Ukraine CALL-E preflight"
```

Expected: exactly the guarded preflight, its test, and runbook are committed.
Do not stage `output/`, `.env.local`, `tmp/`, private evidence, or generated
files.

- [ ] **Step 11: Pass Task 3 independent review gate**

Dispatch two fresh read-only reviewers:

1. Specification reviewer: verify exact environment rules, bounded error
   mapping, validation-before-permit ordering, sanitized country/language/
   region/locale/mask display, one fake POST for each UA language, updated
   runbook, and absence of live execution.
2. Quality reviewer: inspect module-global permit preservation, live-entrypoint
   exports, environment restoration, zero-network negative tests, provider
   injection resistance, filesystem evidence and cleanup regressions, Unicode
   output, private-data handling, and no-retry lifecycle preservation.

Do not begin the whole-branch gate until both reviewers have no unresolved
Critical or Important finding. Corrections use focused RED/GREEN, a separate
commit, and both re-reviews.

---

### Task 4: Verify and review the complete amendment branch

**Files:**

- Review: all tracked changes from the design base through Task 3
- Update only if evidence requires it: the approved plan's checkbox state or an
  ignored local execution report

**Interfaces:**

- Consumes: Tasks 1–3 reviewed commits.
- Produces: a clean, review-approved feature branch ready for a separately
  authorized push/PR workflow. It does not produce a live-call authorization.

- [ ] **Step 1: Prove the exact test inventory before broad execution**

Run:

```powershell
rg --files -g "*.test.ts" src scripts tests | Sort-Object
```

Save the printed list in the execution report. Do not claim a broad suite
without this selection proof.

- [ ] **Step 2: Run focused coverage and the explicit affected suite**

Run:

```powershell
pnpm vitest run --coverage src/domain/call-recipient.test.ts src/adapters/calle/request.test.ts scripts/live-preflight.test.ts
pnpm vitest run src/domain/call-recipient.test.ts src/application/create-run.test.ts src/application/start-run.test.ts src/application/reconcile-run.test.ts src/adapters/calle/request.test.ts src/adapters/calle/client.test.ts scripts/live-preflight.test.ts tests/integration/call-lifecycle.test.ts
```

Expected: both commands exit `0`. Record test counts and coverage values
truthfully; the plan does not invent a new coverage threshold.

- [ ] **Step 3: Run all repository gates**

Run:

```powershell
pnpm verify
git diff --check main...HEAD
```

Expected: formatting, typecheck, zero-warning lint, full test selection, and
production build exit `0`; the branch diff is whitespace-clean.

- [ ] **Step 4: Run available secret and build-clean enforcement**

Use the repository scripts only when their implementation files exist:

```powershell
if (Test-Path scripts/scan-secrets.mjs) {
  pnpm scan:secrets
} else {
  Write-Warning "scan:secrets unavailable: scripts/scan-secrets.mjs is absent"
}

if (Test-Path scripts/assert-build-clean.mjs) {
  pnpm check:build-clean
} else {
  $before = git status --porcelain=v1 --untracked-files=no
  pnpm build
  $after = git status --porcelain=v1 --untracked-files=no
  if ($before -ne $after) {
    throw "Tracked worktree changed during build"
  }
  Write-Warning "check:build-clean unavailable; tracked pre/post-build status matched"
}
```

Never describe an absent enforcement script as passing. If the build changes a
tracked file, stop and diagnose instead of deleting or reverting user work.

- [ ] **Step 5: Inspect privacy, scope, and repository status**

Run tracked-content scans that do not read ignored `.env.local`:

```powershell
git grep -n -E "BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}" -- .
if ($LASTEXITCODE -eq 1) { Write-Output "Tracked common-secret scan: clean" }

git grep -n -E "\+380[0-9]{9}" -- .
if ($LASTEXITCODE -eq 1) { Write-Output "Tracked full Ukraine phone scan: clean" }

git diff --stat main...HEAD
git diff --name-only main...HEAD
git status --short --branch
```

Expected: no tracked credential or contiguous full Ukraine number; changed
files stay within the approved specification, plan, domain, adapter, preflight,
tests, and runbook. The pre-existing untracked `output/` may remain and must not
be staged, modified, or described as generated by this amendment.

- [ ] **Step 6: Perform a whole-branch self-review**

Read the complete branch diff:

```powershell
git diff --unified=80 main...HEAD -- docs/superpowers/specs/2026-08-11-supplysignal-ai-ukraine-recipient-profile-design.md docs/superpowers/plans/2026-08-11-supplysignal-ai-ukraine-recipient-profile-implementation.md src/domain/call-recipient.ts src/domain/call-recipient.test.ts src/adapters/calle/request.ts src/adapters/calle/request.test.ts scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
```

Check every acceptance criterion, English/Ukraine semantic parity, exact
profile pairs, environment fail-closed ordering, accessor safety, bounded
errors, request canonicalization, one-call permit, no retry/redial, private
evidence safety, test isolation, documentation truthfulness, and diff scope.

- [ ] **Step 7: Pass final independent specification and quality reviews**

Dispatch two fresh reviewers who did not implement Tasks 1–3:

1. Whole-branch specification reviewer: trace every design acceptance criterion
   to code, tests, and runbook evidence and return PASS only with no unresolved
   gap.
2. Whole-branch quality reviewer: inspect the entire branch for Critical,
   Important, and Minor findings in correctness, privacy, security, error
   bounding, concurrency, provider behavior, filesystem safety, localization,
   maintainability, test quality, and accidental scope.

Any Critical or Important finding blocks completion. Reproduce it with a
focused failing test, obtain owner authority if it changes the approved design,
implement the smallest correction, create a separate corrective commit, rerun
all proportionate gates, and repeat both reviews.

- [ ] **Step 8: Produce the completion handoff without external effects**

Report:

- branch and commit list;
- exact focused, affected, full, typecheck, lint, format, build, coverage, diff,
  secret-scan, and build-clean results;
- unavailable or skipped checks truthfully;
- independent review verdicts;
- unchanged/untracked files preserved;
- confirmation that no live CALL-E/OpenAI request, phone call, push, PR, merge,
  or deployment occurred; and
- the next separately authorized workflow: finish branch, push, PR, CI, merge,
  sync `main`, then request a fresh one-call Ukraine preflight authorization.

Do not place a Ukraine call as a completion check. The reviewed offline branch
is the deliverable of this plan.
