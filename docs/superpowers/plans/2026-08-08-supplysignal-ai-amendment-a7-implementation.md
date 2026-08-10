# SupplySignal AI Amendment A7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace field-specific untrusted-object preflights with one canonical plain-data boundary used by every current public domain object or array schema.

**Architecture:** A new pure `plain-data` module traverses unknown values through prototypes, own keys, and own data descriptors, enforces fixed budgets, and constructs a behavior-free canonical copy before Zod sees the input. Existing domain schemas retain their current business rules and types but enter through the shared wrapper; persisted unknown JSON fields reuse a stricter shared limit profile.

**Tech Stack:** Node.js `22.23.1`, pnpm `11.20.0`, TypeScript `7.0.2`, Zod `4.4.3`, Vitest `4.1.10`, ESLint `9.39.5`, Prettier `3.9.6`.

## Correction A7.2 execution note (Approved)

Before independent re-review, add RED/GREEN regressions showing that strict
public schema failures do not disclose a raw unknown key or value and instead
expose only `Expected safe plain JSON data`. Route every downstream failure of
the eight public object/array schemas through that same bounded failure.

Change completion to require published artifacts, ensure each successful
`transitionRun` result validates through `runRecordSchema`, and keep the
existing schema, consistency, and `HUMAN_CONFIRMED` requirements. Add exact
persisted JSON depth `8`/`9` and container-entry `128`/`129` regressions that
remain below the general boundary limits, plus a zero-invocation assertion for
the dense accessor-backed array case. No other behavior is authorized.

## Global Constraints

- The approved base specification is `docs/superpowers/specs/2026-08-08-supplysignal-ai-design.md`.
- The approved amendment is `docs/superpowers/specs/2026-08-08-supplysignal-ai-amendment-a7-plain-data-boundary-design.md`.
- This plan is the corrective Task 3A plan and supersedes only the field-specific plain-data preflights introduced during Task 3 review corrections.
- Preserve all existing authorization, risk, lifecycle, trust, persisted-completion, and artifact-state semantics.
- Do not change dependencies, package-manager configuration, public product behavior, APIs, UI, persistence, CALL-E integration, OpenAI integration, artifact publication, or external effects.
- Use descriptor-only traversal for untrusted values. Do not fall back to ordinary property reads.
- Reject unsupported shapes and inspection failures with the bounded message `Expected safe plain JSON data`; do not expose raw values or accessor output.
- Keep the general limits exact: depth `16`, container entries `512`, total nodes `4096`, combined key/string characters `1,048,576`, and key length `256`.
- Keep the persisted unknown-value limits exact: depth `8`, container entries `128`, key length `256`, string length `4,096`, and serialized JSON length `32,768`.
- Reject own accessors, custom prototypes and their inherited behavior, class instances, non-JSON values, cycles, sparse arrays, non-enumerable data fields, symbol keys, and the keys `__proto__`, `prototype`, and `constructor`.
- Permit ordinary inputs whose direct prototype is `Object.prototype`, but never read or copy inherited `Object.prototype` properties; pass only the null-prototype canonical copy to Zod.
- Arbitrary JavaScript proxies are unsupported. Reflection failures must fail closed, while future transport adapters remain responsible for raw-size limiting followed by JSON parsing.
- Follow TDD: capture RED, implement the minimum approved behavior, capture GREEN, run the affected suite and gates, then commit.
- Keep code, tests, comments, documentation, commits, and repository artifacts in English.
- Do not begin main-plan Task 4 until the complete Task 3 range receives independent `Spec PASS` and `Quality Approved` verdicts.

## File Structure

- `src/domain/plain-data.ts` — owns canonical descriptor-only traversal, general and persisted limit profiles, the schema wrapper, and the bounded persisted JSON schema.
- `src/domain/plain-data.test.ts` — owns canonicalization, budget, getter, prototype, error, and public-schema boundary regressions.
- `src/domain/purchase-order.ts` — wraps the purchase-order object schema.
- `src/domain/call-recipient.ts` — wraps both the exported recipient schema and the internal unknown-input schema used by `createCallRecipient`.
- `src/domain/supplier-response.ts` — separates internal object definitions from the two wrapped public response schemas.
- `src/domain/risk.ts` — wraps the public risk discriminated union without changing risk decisions.
- `src/domain/authorization.ts` — wraps the public authorization object schema.
- `src/domain/run.ts` — consumes the shared wrapper and persisted JSON schema, then removes duplicated traversal and preflight code.
- Existing focused domain tests — remain the behavioral regression suite and receive only boundary cases that belong to their existing public entrypoints.
- `.superpowers/sdd/2026-08-08-supplysignal-ai-implementation/task-3-report.md` — records corrective RED/GREEN evidence, checks, commit, and unavailable secret scanning truthfully.
- `.superpowers/sdd/2026-08-08-supplysignal-ai-implementation/progress.md` — records the A7 architecture gate and Task 3A result.

---

### Task 3A: Centralize untrusted plain-data validation

**Files:**

- Create: `src/domain/plain-data.ts`
- Create: `src/domain/plain-data.test.ts`
- Modify: `src/domain/purchase-order.ts`
- Modify: `src/domain/call-recipient.ts`
- Modify: `src/domain/supplier-response.ts`
- Modify: `src/domain/risk.ts`
- Modify: `src/domain/authorization.ts`
- Modify: `src/domain/run.ts`
- Modify when a focused regression belongs there: `src/domain/purchase-order.test.ts`
- Modify when a focused regression belongs there: `src/domain/call-recipient.test.ts`
- Modify when a focused regression belongs there: `src/domain/supplier-response.test.ts`
- Modify when a focused regression belongs there: `src/domain/risk.test.ts`
- Modify when a focused regression belongs there: `src/domain/authorization.test.ts`
- Modify: `src/domain/run.test.ts`
- Update ignored report: `.superpowers/sdd/2026-08-08-supplysignal-ai-implementation/task-3-report.md`
- Update ignored ledger: `.superpowers/sdd/2026-08-08-supplysignal-ai-implementation/progress.md`

**Interfaces:**

- Consumes: current Zod object and array schemas plus the approved A7 limit profiles.
- Produces: `canonicalizePlainData(input: unknown): PlainDataResult`, `withPlainDataBoundary<TOutput>(schema: z.ZodType<TOutput>): z.ZodType<TOutput>`, and `persistedJsonValueSchema: z.ZodType<unknown>`.
- Preserves: `PurchaseOrder`, `CallRecipient`, `SupplierResponse`, `SupplyRisk`, `CallAuthorization`, `ProviderEvidenceSnapshot`, `RunRecord`, `assessSupplyRisk`, `transitionRun`, and `canCompleteRun` public behavior.

- [ ] **Step 1: Write the failing canonicalization tests**

Create `src/domain/plain-data.test.ts` before the module exists. Define ordinary nested JSON fixtures without accessors and test that the returned tree is semantically equal but detached from the source. Assert `Object.getPrototypeOf(result.value) === null` for object roots, new array identity for arrays, and null prototypes for nested object elements.

Use descriptor-created hostile values so test setup does not execute the behavior it is testing:

```ts
function createOwnGetterValue() {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, "unsafe", {
    enumerable: true,
    get() {
      calls += 1;
      return "should-not-run";
    },
  });
  return { input, calls: () => calls };
}

function createInheritedGetterValue() {
  let calls = 0;
  const prototype = {};
  Object.defineProperty(prototype, "unsafe", {
    enumerable: true,
    get() {
      calls += 1;
      return "should-not-run";
    },
  });
  return { input: Object.create(prototype), calls: () => calls };
}
```

Assert both values fail and both counters remain `0`. Add explicit failures for an own setter, a non-enumerable data property, a class instance, `Date`, `Map`, `Set`, symbol keys, functions, symbols, bigint, `undefined`, `NaN`, infinities, cycles, sparse arrays, and accessor-backed array indexes.

Also prove the A7.1 distinction for an ordinary object. Inside a `try/finally`
block, temporarily define a uniquely named enumerable getter on
`Object.prototype`, canonicalize an otherwise valid ordinary object, and delete
the property in `finally`. Assert canonicalization succeeds, the getter counter
remains `0`, and the canonical result does not have the inherited probe as an
own property. Do not run this test concurrently inside the file.

Construct reserved keys with `Object.defineProperty` so `__proto__` is an own data property rather than object-literal syntax:

```ts
const polluted = Object.create(null);
Object.defineProperty(polluted, "__proto__", {
  configurable: true,
  enumerable: true,
  value: "rejected",
  writable: true,
});
```

Test the exact general limits:

- a nested object chain at depth `16` succeeds and depth `17` fails;
- a dense array of `512` values succeeds and `513` fails;
- a tree of exactly `4096` visited nodes succeeds and the same tree with one additional primitive fails;
- a root string of `1,048,576` characters succeeds and one of `1,048,577` fails; and
- a non-reserved key of `256` characters succeeds and one of `257` fails.

For the exact node test, use one root array with `511` child arrays. Give every child seven primitive elements and give the first child seven additional primitive elements. This produces `1 + 511 + 3,584 = 4,096` nodes. Add one primitive to the second child for the failing case.

Wrap a minimal strict Zod object through `withPlainDataBoundary` and assert an invalid input returns the exact issue message without including a hostile string stored in the rejected value:

```ts
const schema = withPlainDataBoundary(
  z.strictObject({ value: z.string() }),
);
const result = schema.safeParse(Object.create({ value: "RAW_SECRET_MARKER" }));

expect(result.success).toBe(false);
if (!result.success) {
  expect(result.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: "Expected safe plain JSON data" }),
    ]),
  );
  expect(JSON.stringify(result.error.issues)).not.toContain("RAW_SECRET_MARKER");
}
```

Add a proxy whose `getPrototypeOf` trap throws. Assert validation fails with the bounded message. Do not assert that proxy traps are side-effect free; the approved specification explicitly excludes arbitrary proxies from the supported transport format.

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
pnpm vitest run src/domain/plain-data.test.ts
```

Expected: exit `1` because `src/domain/plain-data.ts` does not exist. Record the exact missing-module failure in the Task 3 report.

- [ ] **Step 3: Implement the descriptor-only canonicalizer**

Create `src/domain/plain-data.ts` with private immutable limit profiles and these public interfaces:

```ts
import { z } from "zod";

export type PlainDataResult =
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false };

export function canonicalizePlainData(input: unknown): PlainDataResult;

export function withPlainDataBoundary<TOutput>(
  schema: z.ZodType<TOutput>,
): z.ZodType<TOutput>;

export const persistedJsonValueSchema: z.ZodType<unknown>;
```

Use these exact private profiles:

```ts
const GENERAL_LIMITS = Object.freeze({
  maxDepth: 16,
  maxContainerEntries: 512,
  maxNodes: 4096,
  maxCharacters: 1_048_576,
  maxKeyLength: 256,
  maxStringLength: 1_048_576,
  maxSerializedLength: undefined,
});

const PERSISTED_JSON_LIMITS = Object.freeze({
  maxDepth: 8,
  maxContainerEntries: 128,
  maxNodes: 4096,
  maxCharacters: 1_048_576,
  maxKeyLength: 256,
  maxStringLength: 4_096,
  maxSerializedLength: 32_768,
});

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SAFE_PLAIN_DATA_MESSAGE = "Expected safe plain JSON data";
```

The private visitor must perform these actions in order:

1. Increment and check the global node count before processing the value.
2. Accept `null`, strings, booleans, and finite numbers; update the global character count for strings.
3. Reject every other primitive type.
4. Reject an object already in the current ancestor set.
5. Call `Object.getPrototypeOf` inside the top-level `try` block.
6. For arrays, require exactly `Array.prototype`, a data `length` descriptor, a permitted length, no keys except `length` and every dense canonical index, and an enumerable own data descriptor at every index. Recurse on descriptor values and build a new dense array.
7. For objects, require exactly `Object.prototype` or `null`, inspect only the input's own keys, and never enumerate or read either permitted prototype. Require no more than the permitted number of own keys, string-only non-reserved keys, permitted key lengths, and enumerable own data descriptors. Recurse on descriptor values and define them on a new `Object.create(null)` result.
8. Remove each container from the ancestor set in a `finally` block so a rejected branch cannot corrupt traversal state.
9. After a successful canonical tree is built, enforce `maxSerializedLength` when the selected profile defines it. Serialize only the canonical tree, never the raw input.
10. Catch every reflection or serialization exception and return `{ success: false }`.

Create a private Zod transform that adds exactly one custom issue with `SAFE_PLAIN_DATA_MESSAGE` and returns `z.NEVER` on failure. Implement the public wrapper by piping that transform into the supplied schema. Build `persistedJsonValueSchema` from the same transform using `PERSISTED_JSON_LIMITS`.

Do not cast through `any`, do not stringify rejected raw input, and do not export a way for callers to weaken the approved limits.

- [ ] **Step 4: Run the canonicalization tests and capture GREEN**

Run:

```powershell
pnpm vitest run src/domain/plain-data.test.ts
```

Expected: exit `0`; every canonicalization, getter, prototype, reserved-key, failure-message, and exact-budget case passes.

- [ ] **Step 5: Add failing public-schema boundary regressions**

Extend `src/domain/plain-data.test.ts` with imports for all eight approved public schemas and `createCallRecipient`. Define complete valid fixtures for purchase order, recipient, supplier response, risk, authorization, provider evidence, and run record using the same fictional `Northstar Components`, `PO-2026-001`, US `en-US`, and 2026 timestamps already used in the focused domain tests.

Use this helper to place a valid record on a custom prototype without invoking its getter:

```ts
function putOnAccessorPrototype<T extends Record<string, unknown>>(value: T) {
  let calls = 0;
  const prototype = {};
  Object.defineProperty(prototype, "inheritedOnly", {
    enumerable: true,
    get() {
      calls += 1;
      return "should-not-run";
    },
  });
  const input = Object.assign(Object.create(prototype), value) as unknown;
  return { input, calls: () => calls };
}
```

Create a parameterized matrix containing exactly:

```ts
[
  ["purchaseOrderSchema", purchaseOrderSchema, validOrder],
  ["callRecipientSchema", callRecipientSchema, validRecipient],
  ["supplierResponseFactsSchema", supplierResponseFactsSchema, validResponse],
  ["supplierResponseSchema", supplierResponseSchema, validResponse],
  ["supplyRiskSchema", supplyRiskSchema, validRisk],
  ["callAuthorizationSchema", callAuthorizationSchema, validAuthorization],
  [
    "providerEvidenceSnapshotSchema",
    providerEvidenceSnapshotSchema,
    validProviderSnapshot,
  ],
  ["runRecordSchema", runRecordSchema, validRun],
] as const;
```

For every case, assert the custom-prototype value is rejected and the inherited getter counter is `0`. Add a separate `createCallRecipient` assertion using a custom-prototype input so the internal schema protecting its `unknown` argument is covered. Retain the general canonicalizer regression proving that an `Object.prototype` probe is ignored, not copied, and never executed.

Add the exact reviewer regression to `src/domain/run.test.ts`: place `providerSnapshot` on a custom prototype getter for a run record and place `structuredResult` on a custom prototype getter for a provider snapshot. In both cases assert `runRecordSchema.safeParse` fails and the counter remains `0`.

- [ ] **Step 6: Run the schema boundary regressions and capture RED**

Run:

```powershell
pnpm vitest run src/domain/plain-data.test.ts src/domain/run.test.ts
```

Expected: exit `1`. The current public schemas accept at least the custom-prototype cases, and the current run preflights accept and invoke the inherited required-field accessors identified by independent review. Record the exact failing assertions and getter counts.

- [ ] **Step 7: Route every approved schema through the shared boundary**

In each domain module, keep the existing Zod definition as a private base and export only the wrapped version. Use explicit names so nested schemas can reuse the base without accidentally adding a second business refinement.

Apply these exact transformations:

```ts
const purchaseOrderObjectSchema = z.strictObject({
  supplierName: z.string().trim().min(1).max(MAX_SUPPLIER_NAME_LENGTH),
  purchaseOrderRef: z.string().trim().min(1).max(MAX_PURCHASE_ORDER_REF_LENGTH),
  expectedQuantity: z.number().int().positive().max(MAX_QUANTITY),
  requiredDeliveryDate: dateOnlySchema,
});

export const purchaseOrderSchema = withPlainDataBoundary(
  purchaseOrderObjectSchema,
);
```

```ts
const callRecipientObjectSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(US_E164_PATTERN),
    maskedPhone: z.string().regex(MASKED_PHONE_PATTERN),
    region: z.literal("US"),
    locale: z.literal("en-US"),
  })
  .refine(
    (recipient) =>
      recipient.maskedPhone === maskPhoneNumber(recipient.phoneE164),
    { message: "Masked phone must match the phone number", path: ["maskedPhone"] },
  );

export const callRecipientSchema = withPlainDataBoundary(
  callRecipientObjectSchema,
);

const callRecipientInputSchema = withPlainDataBoundary(
  z.strictObject({
    recipientName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(US_E164_PATTERN),
    region: z.literal("US"),
    locale: z.literal("en-US"),
  }),
);
```

In `supplier-response.ts`, define one private `supplierResponseFactsObjectSchema`. Export `supplierResponseFactsSchema` as its wrapped form. Export `supplierResponseSchema` as a separately wrapped `supplierResponseFactsObjectSchema.refine(...)` using the unchanged quantity reconciliation rule.

In `risk.ts`, assign the unchanged discriminated union to a private `supplyRiskObjectSchema`, then export `withPlainDataBoundary(supplyRiskObjectSchema)`. Do not change canonical reason-code validation or `assessSupplyRisk`.

In `authorization.ts`, wrap the unchanged strict authorization object. Do not wrap `isoTimestampSchema`.

In `run.ts`:

- import `persistedJsonValueSchema` and `withPlainDataBoundary`;
- delete every `MAX_PERSISTED_JSON_*` constant;
- delete `JsonBudget`, `addSerializedLength`, `isBoundedJsonValue`, `visitJsonValue`, `boundedJsonValueSchema`, `hasAccessorBackedOwnProperty`, `preflightProviderEvidenceInput`, and `preflightRunRecordInput`;
- use `persistedJsonValueSchema` for required `structuredResult` and optional `humanReview`;
- export `providerEvidenceSnapshotSchema` as `withPlainDataBoundary(providerEvidenceSnapshotObjectSchema)`; and
- export `runRecordSchema` as `withPlainDataBoundary(runRecordObjectSchema)`.

Do not change the transition table, `DomainError`, `transitionRun`, the persisted `COMPLETED` super-refinement, or `canCompleteRun`.

- [ ] **Step 8: Run the affected domain suites and capture GREEN**

Run the explicit file list so PowerShell does not pass an unexpanded wildcard:

```powershell
pnpm vitest run src/domain/plain-data.test.ts src/domain/purchase-order.test.ts src/domain/call-recipient.test.ts src/domain/supplier-response.test.ts src/domain/risk.test.ts src/domain/authorization.test.ts src/domain/run.test.ts src/domain/trust.test.ts
```

Expected: exit `0`; Vitest reports exactly eight selected test files, all tests pass, and getter counters remain `0`.

- [ ] **Step 9: Run focused coverage and prove the full domain selection**

Run:

```powershell
pnpm vitest run src/domain/plain-data.test.ts src/domain/purchase-order.test.ts src/domain/call-recipient.test.ts src/domain/supplier-response.test.ts src/domain/risk.test.ts src/domain/authorization.test.ts src/domain/run.test.ts src/domain/trust.test.ts --coverage --coverage.include=src/domain/plain-data.ts --coverage.include=src/domain/purchase-order.ts --coverage.include=src/domain/call-recipient.ts --coverage.include=src/domain/supplier-response.ts --coverage.include=src/domain/risk.ts --coverage.include=src/domain/authorization.ts --coverage.include=src/domain/run.ts --coverage.include=src/domain/trust.ts
```

Expected: exit `0`; the coverage report includes all eight listed source modules. Record the statement, branch, function, and line totals without inventing a percentage threshold not required by the approved specification.

Then prove what the broad domain selection contains before running it:

```powershell
$domainTests = @(rg --files src/domain -g '*.test.ts' | Sort-Object)
$domainTests
pnpm vitest run @domainTests
```

Expected: the printed list contains every current domain test file, Vitest selects the same count, and the command exits `0`.

- [ ] **Step 10: Run repository gates and inspect the change**

Run each command separately and record every exit status:

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
git status --short
git diff -- src/domain
```

Expected: typecheck, zero-warning lint, formatting, and diff checks exit `0`. The diff contains only A7 domain implementation and tests. No dependency, configuration, UI, adapter, API, or persistence file changes are present.

Check whether the repository-provided scanner exists:

```powershell
Test-Path scripts/scan-secrets.mjs
```

If it returns `True`, run `pnpm scan:secrets` and require exit `0`. If it returns `False`, record the scanner as unavailable because it is scheduled for main-plan Task 16; do not describe secret scanning as passing and do not create the script early.

- [ ] **Step 11: Update the ignored execution evidence**

Append a fourth corrective section to `task-3-report.md` containing:

- the independent inherited-accessor finding that triggered A7;
- the approved A7 specification and plan paths;
- exact RED commands, exit codes, failing assertions, and getter counts;
- exact GREEN and coverage commands, selected file/test counts, and exit codes;
- gate results;
- unavailable secret-scanner status when applicable; and
- confirmation that no live CALL-E/OpenAI, browser, build, deployment, or external-effect check ran.

Update `progress.md` to keep Task 3 in progress until independent review passes. Do not mark Task 3 or Task 3A complete before both review verdicts pass.

- [ ] **Step 12: Commit the corrective implementation**

Stage only the approved source and test files. The ignored SDD report and ledger remain local execution evidence.

```powershell
git add -- src/domain/plain-data.ts src/domain/plain-data.test.ts src/domain/purchase-order.ts src/domain/purchase-order.test.ts src/domain/call-recipient.ts src/domain/call-recipient.test.ts src/domain/supplier-response.ts src/domain/supplier-response.test.ts src/domain/risk.ts src/domain/risk.test.ts src/domain/authorization.ts src/domain/authorization.test.ts src/domain/run.ts src/domain/run.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "fix: centralize untrusted plain-data validation"
```

If an allowed test file did not need a change, omit it from the final `git add` command. Never stage an unchanged or unrelated file merely because it appears in the approved list.

Expected: one corrective commit containing only the required A7 domain code and tests. `git status --short` is clean after the commit.

- [ ] **Step 13: Run the independent full-range review gate**

Generate and inspect the complete Task 3 range from the last approved Task 2 commit through the A7 corrective commit:

```powershell
git diff --check 43a1680..HEAD
git diff --stat 43a1680..HEAD
git diff 43a1680..HEAD -- src/domain
```

Dispatch an independent read-only specification reviewer against:

- the approved base specification;
- the approved A7 specification;
- the main implementation-plan Task 3 section;
- this Task 3A plan;
- the Task 3 report; and
- the complete `43a1680..HEAD` domain diff.

Require `Spec PASS` with no unresolved findings. Then dispatch a separate independent read-only quality reviewer over the same complete range and require `Quality Approved` with no unresolved findings.

If either reviewer finds a defect, stop at the review gate. Route the finding through `superpowers:receiving-code-review`, reproduce it with a failing test, and obtain owner authority before another architectural change. Do not begin main-plan Task 4.

After both verdicts pass, record Task 3A and Task 3 complete in the SDD ledger and resume the approved main implementation plan at Task 4.

---

## Completion Handoff

Task 3A is complete only when the corrective commit exists, all recorded checks are truthful, the worktree is clean, and the full Task 3 range has both `Spec PASS` and `Quality Approved`. No push, pull request, deployment, live provider call, or external publication is part of this corrective plan.
