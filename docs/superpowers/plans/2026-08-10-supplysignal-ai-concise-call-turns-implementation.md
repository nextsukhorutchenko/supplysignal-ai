# SupplySignal AI Concise Call Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved concise-turn instruction to the canonical CALL-E task without changing disclosure, structured-result, one-call, or error behavior.

**Architecture:** Keep the change inside the existing pure request builder. Extend its focused test to lock the exact prompt text and ordering, then add the canonical instruction as one array entry between the disclosure and first purchase-order question. No new module, dependency, configuration, provider operation, or live call is required.

**Tech Stack:** TypeScript 7 native compiler with the repository TypeScript 6 compatibility package, Vitest 4, Zod 4, pnpm 11, ESLint 9, Prettier 3, Next.js 16.

## Global Constraints

- The applicable authority is `docs/superpowers/specs/2026-08-10-supplysignal-ai-concise-call-turns-design.md`.
- Keep the existing complete disclosure unchanged and before all operational guidance.
- Add this exact instruction once: `After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.`
- Place the instruction immediately after the disclosure and before the first purchase-order question.
- Preserve the fictional Northstar Components workflow, decline/no-answer safeguards, strict recipient-result schema, US/en-US constraints, 4,000-character task bound, idempotency, one-POST, no-retry, and no-redial behavior.
- Do not add dependencies, configuration, runtime modes, schemas, provider paths, retries, external effects, or unrelated refactors.
- Keep code, tests, documentation, and commit messages in English.
- Run only deterministic offline checks; do not use credentials or contact CALL-E during this plan.

---

### Task 1: Enforce the concise-turn policy in the canonical CALL-E request

**Files:**
- Modify: `src/adapters/calle/request.test.ts`
- Modify: `src/adapters/calle/request.ts`
- Reference: `docs/superpowers/specs/2026-08-10-supplysignal-ai-concise-call-turns-design.md`

**Interfaces:**
- Consumes: `buildCreateCallRequest(input: CreateSupplierCall)` and its existing `request.task: string` output.
- Produces: the same request shape and public exports, with only the approved prompt sentence added to `request.task`.

- [ ] **Step 1: Confirm the starting scope and clean state**

Run:

```powershell
git status --short --branch
git diff --check
```

Expected: branch `feat/concise-call-turns`, no unexpected tracked changes, and a clean diff check. Preserve any unrelated owner changes if present.

- [ ] **Step 2: Add the focused regression test before production code**

In `src/adapters/calle/request.test.ts`, add these constants near the existing fixture:

```ts
const mandatoryDisclosure =
  "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.";
const conciseTurnInstruction =
  "After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.";
const firstPurchaseOrderQuestion =
  "Ask about fictional purchase order PO-2048 from Northstar Components.";
```

Add this test inside `describe("buildCreateCallRequest", ...)`:

```ts
it("keeps disclosure complete and applies the concise-turn policy before operational questions", () => {
  const { task } = buildCreateCallRequest(input);
  const taskLines = task.split("\n");

  expect(taskLines).toEqual(
    expect.arrayContaining([
      mandatoryDisclosure,
      conciseTurnInstruction,
      firstPurchaseOrderQuestion,
    ]),
  );
  expect(taskLines.filter((line) => line === conciseTurnInstruction)).toHaveLength(
    1,
  );
  expect(taskLines.indexOf(mandatoryDisclosure)).toBe(1);
  expect(taskLines.indexOf(conciseTurnInstruction)).toBe(
    taskLines.indexOf(mandatoryDisclosure) + 1,
  );
  expect(taskLines.indexOf(firstPurchaseOrderQuestion)).toBe(
    taskLines.indexOf(conciseTurnInstruction) + 1,
  );
  expect(task).toContain(
    "If the recipient declines, stop politely and do not invent answers.",
  );
  expect(task).toContain(
    "If nobody answers, do not infer supplier facts.",
  );
  expect(task.length).toBeLessThanOrEqual(4_000);
});
```

This test checks exact prompt text, uniqueness, adjacency, disclosure-first ordering, preserved declined/no-answer behavior, and the existing bound.

- [ ] **Step 3: Run the focused test and record genuine RED**

Run:

```powershell
pnpm vitest run src/adapters/calle/request.test.ts
```

Expected: exit code 1 because `conciseTurnInstruction` is absent. Existing tests should remain green. Do not edit the assertion to fit current behavior.

- [ ] **Step 4: Add the minimal canonical prompt line**

In `buildCanonicalCreateCallRequest` in `src/adapters/calle/request.ts`, insert exactly one string immediately after the disclosure entry:

```ts
const task = [
  "You are SupplySignal AI, an automated calling agent.",
  "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.",
  "After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.",
  `Ask about fictional purchase order ${input.order.purchaseOrderRef} from ${input.order.supplierName}.`,
  `Confirm the quantity expected (${input.order.expectedQuantity}), quantity ready now, quantity delayed, and promised delivery date relative to ${input.order.requiredDeliveryDate}.`,
  "Ask for the delay reason, whether human follow-up is required, and whether the supplier is unable to fulfill the order.",
  "If the recipient declines, stop politely and do not invent answers. If nobody answers, do not infer supplier facts.",
].join("\n");
```

Do not extract new configuration or change any other request field.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
pnpm vitest run src/adapters/calle/request.test.ts
```

Expected: all tests in `request.test.ts` pass with exit code 0.

- [ ] **Step 6: Run explicit affected CALL-E adapter tests**

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

Expected: the four printed files are exactly the intended adapter selection and all selected tests pass.

- [ ] **Step 7: Run the complete deterministic repository gate**

Run:

```powershell
pnpm verify
```

Expected: formatting, strict type checking, zero-warning lint, the full offline test suite, and the production build all pass. Do not describe a missing or skipped command as passing.

- [ ] **Step 8: Run repository enforcement scripts only when their files exist**

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
```

Expected: each available gate passes. Record absent implementation files as unavailable, not passing. Independently inspect the changed prompt/test for credentials, phone numbers, raw provider data, and native paths.

- [ ] **Step 9: Inspect the final diff and repository state**

Run:

```powershell
git diff --check
git diff -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git status --short
```

Expected: the behavior diff is limited to the exact prompt instruction and its regression test; no generated build files, secrets, credentials, live evidence, or unrelated changes appear.

- [ ] **Step 10: Commit the implementation separately**

Run:

```powershell
git add -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git diff --cached --check
git diff --cached -- src/adapters/calle/request.ts src/adapters/calle/request.test.ts
git commit -m "feat: keep CALL-E turns concise"
```

Expected: one implementation commit containing only the two approved source/test files. Do not push.

- [ ] **Step 11: Run independent specification and quality review gates**

Dispatch two fresh read-only reviewers against the implementation commit:

1. Specification reviewer: compare the approved specification, this plan, and the actual diff; require `SPEC PASS` with no unresolved acceptance-criteria gap.
2. Quality reviewer: inspect ordering, exact-once behavior, mutation resistance of tests, preserved request schema/bounds/safeguards, privacy, and scope; require `QUALITY APPROVED` with no unresolved Critical or Important finding.

If either reviewer finds a defect, stop. Reproduce the finding with a failing test before changing production code, obtain owner approval for any authority-changing correction, create a separate corrective commit, rerun all applicable gates, and repeat both independent reviews.

- [ ] **Step 12: Hand off without performing external effects**

Report the commits, RED/GREEN evidence, affected/full gate results, diff/status result, unavailable enforcement scripts, and both review verdicts. Explicitly state that no live CALL-E request, phone call, credential use, browser action, deployment, push, or publication occurred.

Do not begin the three live preflight scenarios until this branch is reviewed and merged and the owner gives fresh, scenario-specific authorization with the participant ready and consenting.
