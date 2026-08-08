# SupplySignal AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, operator-controlled Next.js application that places one consented CALL-E supplier call, verifies the result, computes deterministic supply risk, publishes four auditable artifacts, and exposes only a sanitized replay publicly.

**Architecture:** Use one strict TypeScript package with pure domain modules, explicit application ports, a server-only CALL-E REST adapter, a deterministic trust and risk pipeline, an OpenAI explanatory adapter, filesystem persistence, and a replay-only hosted mode. Complete the minimum CALL-E slice and pass the three-call truthfulness preflight before expanding into the full UI and release surface.

**Tech Stack:** Node.js `22.23.1`, pnpm `11.20.0`, Next.js `16.3.0`, React `19.2.8`, TypeScript `7.0.2`, Zod `4.4.3`, OpenAI SDK `7.4.0`, Vitest `4.1.10`, Playwright `1.62.1`, ESLint `10.8.1`, Prettier `3.9.6`.

## Global Constraints

- The approved specification at `docs/superpowers/specs/2026-08-08-supplysignal-ai-design.md` is product authority.
- Keep one `pnpm` TypeScript package; do not introduce a monorepo.
- Use CALL-E Developer REST API OpenAPI `0.6.0` only through `POST /v1/calls`, `GET /v1/calls/{call_id}`, and `GET /v1/calls/{call_id}/events`.
- Use one E.164 recipient with `region: "US"` and `locale: "en-US"`.
- Use a stable run-derived `Idempotency-Key`; never generate a replacement key after an ambiguous create result.
- Do not use CALL-E webhooks, batch calls, application-level redialing, or automatic retries that can create another call.
- Treat CALL-E, OpenAI, transcript, evidence, metadata, and persisted external content as untrusted.
- Provider `completed`, `task_completed`, and `completion_confidence` never directly produce application `COMPLETED`.
- Require strict validation, consistency checks, and explicit human confirmation before completion.
- Keep CALL-E and OpenAI credentials server-only, untracked, and absent from hosted replay mode.
- Keep required CI deterministic, offline, credential-free, and independent of CALL-E and OpenAI.
- Keep code, tests, documentation, UI copy, commits, and repository artifacts in English.
- Use fictional business data and never commit participant identity, phone number, consent evidence, raw provider envelopes, or unsanitized transcripts.
- Use TDD for behavior: failing focused test, observed failure, minimal implementation, passing focused test, affected suite, then commit.
- Stop after Task 8 if the three-call preflight exposes fabricated, delayed, or materially inconsistent outcomes.

## File Structure

### Application shell and UI

- `app/layout.tsx` — root metadata and document shell.
- `app/page.tsx` — selects local operator or hosted replay entrypoint from validated server configuration.
- `app/replay/page.tsx` — explicit public replay route.
- `app/globals.css` — shared visual system without a CSS framework.
- `components/operator-workflow.tsx` — five-stage operator workflow coordinator.
- `components/purchase-order-form.tsx` — fictional purchase-order input.
- `components/safety-approval.tsx` — consent and one-call authorization surface.
- `components/live-run-panel.tsx` — bounded run status and event timeline.
- `components/human-confirmation.tsx` — evidence review, corrections, conflict declaration, and confirmation.
- `components/risk-briefing.tsx` — risk result and artifact links.
- `components/replay-view.tsx` — sanitized read-only replay.

### Domain and application

- `src/domain/purchase-order.ts` — purchase-order types and validation.
- `src/domain/call-recipient.ts` — private recipient identity, E.164 number, region, locale, and masked view.
- `src/domain/supplier-response.ts` — normalized supplier-response types and invariants.
- `src/domain/risk.ts` — deterministic risk decision.
- `src/domain/authorization.ts` — immutable one-call consent and authorization contract.
- `src/domain/run.ts` — run record and lifecycle transitions.
- `src/domain/trust.ts` — trust states and completion gate.
- `src/domain/consistency.ts` — deterministic provider-evidence consistency checks.
- `src/domain/errors.ts` — bounded application errors.
- `src/application/ports.ts` — `RunStore`, `CalleGateway`, `BriefingPort`, and clock/ID interfaces.
- `src/application/create-run.ts` — create a draft run.
- `src/application/authorize-run.ts` — bind one-time authorization to a run.
- `src/application/idempotency.ts` — stable create-call request identity derivation.
- `src/application/start-run.ts` — claim and create one call idempotently.
- `src/application/reconcile-run.ts` — poll and normalize the existing call.
- `src/application/confirm-run.ts` — record human confirmation or conflict without overwriting provider data.
- `src/application/complete-run.ts` — compute risk, generate briefing, and publish artifacts.

### External adapters

- `src/adapters/calle/request.ts` — exact CALL-E request builder and recipient JSON schema.
- `src/adapters/calle/schemas.ts` — strict OpenAPI `0.6.0` response validation.
- `src/adapters/calle/mapper.ts` — provider-to-domain status and evidence mapping.
- `src/adapters/calle/client.ts` — bounded fetch, bearer auth, idempotency header, GET polling, and events.
- `src/adapters/openai/schema.ts` — strict briefing facts and output schemas.
- `src/adapters/openai/briefing.ts` — Responses API implementation of `BriefingPort`.
- `src/adapters/filesystem/run-store.ts` — versioned atomic run persistence and start claim.
- `src/adapters/filesystem/artifact-writer.ts` — atomic four-file package publication.
- `src/replay/sanitize.ts` — private-run to public-replay projection.
- `src/replay/schema.ts` — versioned strict public replay contract.
- `src/replay/load.ts` — validated committed replay loading.
- `src/server/env.ts` — mode-aware environment parsing.
- `src/server/container.ts` — server-only dependency composition.
- `src/server/http.ts` — bounded HTTP parsing and error projection.

### Routes, scripts, tests, and evidence

- `app/api/runs/route.ts` — create and read runs.
- `app/api/runs/[runId]/authorize/route.ts` — one-call authorization.
- `app/api/runs/[runId]/start/route.ts` — start or safely resume call creation.
- `app/api/runs/[runId]/reconcile/route.ts` — poll existing call.
- `app/api/runs/[runId]/confirm/route.ts` — human confirmation or conflict.
- `app/api/runs/[runId]/complete/route.ts` — publish the reviewed package.
- `app/api/runs/[runId]/artifacts/[artifactName]/route.ts` — allowlisted artifact download.
- `scripts/live-preflight.ts` — explicit interactive, owner-authorized three-scenario harness.
- `scripts/assert-build-clean.mjs` — compare tracked/unignored tree state before and after build.
- `scripts/scan-secrets.mjs` — deterministic tracked/unignored secret-pattern scan.
- `tests/fixtures/calle/*.json` — sanitized OpenAPI contract fixtures.
- `tests/fixtures/openai/*.json` — sanitized briefing contract fixtures.
- `tests/integration/*.test.ts` — adapter, persistence, and use-case integration tests.
- `tests/e2e/operator.spec.ts` — local operator happy path with fake ports.
- `tests/e2e/replay.spec.ts` — public replay and absence-of-mutation checks.
- `examples/northstar/` — final sanitized four-artifact package.
- `docs/verification/call-e-preflight.md` — truthful sanitized preflight record.
- `docs/operator-runbook.md` — Windows setup, consent, live-call, and recovery instructions.
- `.github/workflows/ci.yml` — least-privileged required offline CI.
- `render.yaml` — replay-only deployment with no secret configuration.

---

### Task 1: Bootstrap the strict repository and application shell

**Files:**
- Create: `.gitattributes`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `.nvmrc`
- Create: `.prettierignore`
- Create: `.env.example`
- Create: `AGENTS.md`
- Create: `LICENSE`
- Create: `README.md`
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `src/config/product.ts`
- Test: `src/config/product.test.ts`

**Interfaces:**
- Produces: `PRODUCT_NAME`, `PRODUCT_TAGLINE`, and a runnable strict Next.js shell used by all later tasks.

- [ ] **Step 1: Create the package manifest with exact versions and scripts**

Use `packageManager: "pnpm@11.20.0"`, `engines.node: "22.23.1"`, and exact dependency versions from the plan header. Define scripts `dev`, `build`, `start`, `typecheck`, `lint`, `format:check`, `test`, `test:coverage`, `test:e2e`, `scan:secrets`, `check:build-clean`, and `verify`.

- [ ] **Step 2: Install with the pinned package manager**

Run: `corepack prepare pnpm@11.20.0 --activate`

Run: `pnpm install --save-exact`

Expected: `pnpm-lock.yaml` is created and all manifest versions remain exact.

- [ ] **Step 3: Write the failing product metadata test**

```ts
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "./product";

describe("product metadata", () => {
  it("uses the approved SupplySignal identity", () => {
    expect(PRODUCT_NAME).toBe("SupplySignal AI");
    expect(PRODUCT_TAGLINE).toBe(
      "Call suppliers. Verify delivery risk. Keep the evidence.",
    );
  });
});
```

- [ ] **Step 4: Run the focused test and observe the expected failure**

Run: `pnpm vitest run src/config/product.test.ts`

Expected: FAIL because `src/config/product.ts` does not exist.

- [ ] **Step 5: Implement the product constants and minimal page**

```ts
export const PRODUCT_NAME = "SupplySignal AI";
export const PRODUCT_TAGLINE =
  "Call suppliers. Verify delivery risk. Keep the evidence.";
```

Render these constants from `app/page.tsx`. Keep the page static and free of credentials.

```tsx
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../src/config/product";

export default function HomePage() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>{PRODUCT_TAGLINE}</p>
    </main>
  );
}
```

- [ ] **Step 6: Add repository guardrails**

Set `.gitattributes` to `* text=auto eol=lf`. Ignore `.env*` except `.env.example`, `.next/`, `node_modules/`, `coverage/`, `playwright-report/`, `test-results/`, `runs/`, `tmp/`, and private preflight files. Document English repository content, TDD, untrusted boundaries, one-call authorization, offline CI, and secret rules in `AGENTS.md`.

```gitattributes
* text=auto eol=lf
```

```gitignore
.env*
!.env.example
.next/
node_modules/
coverage/
playwright-report/
test-results/
runs/
tmp/
```

- [ ] **Step 7: Verify the bootstrap**

Run: `pnpm vitest run src/config/product.test.ts`

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`

Expected: all commands exit `0`; Next.js produces no warnings; `git diff --check` is clean.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: bootstrap SupplySignal AI"
```

**Review gate:** Confirm exact versions, no copied LineageGuard source, no secrets, and a minimal application shell.

---

### Task 2: Implement purchase-order, supplier-response, and risk domain logic

**Files:**
- Create: `src/domain/purchase-order.ts`
- Create: `src/domain/purchase-order.test.ts`
- Create: `src/domain/call-recipient.ts`
- Create: `src/domain/call-recipient.test.ts`
- Create: `src/domain/supplier-response.ts`
- Create: `src/domain/supplier-response.test.ts`
- Create: `src/domain/risk.ts`
- Create: `src/domain/risk.test.ts`
- Create: `src/domain/errors.ts`

**Interfaces:**
- Produces: `PurchaseOrder`, `SupplierResponse`, `SupplyRisk`, `assessSupplyRisk(order, response)`.

```ts
export type PurchaseOrder = {
  supplierName: string;
  purchaseOrderRef: string;
  expectedQuantity: number;
  requiredDeliveryDate: string;
};

export type CallRecipient = {
  recipientName: string;
  phoneE164: string;
  maskedPhone: string;
  region: "US";
  locale: "en-US";
};

export type SupplierResponse = {
  contactOutcome: "reached" | "declined" | "no_answer" | "unknown";
  confirmedQuantity: number;
  availableQuantity: number;
  delayedQuantity: number;
  promisedDeliveryDate: string | "unknown";
  delayReason: string;
  followUpRequired: "yes" | "no" | "unknown";
  unableToFulfill: "yes" | "no" | "unknown";
};

export type SupplyRisk = {
  status: "ON_TRACK" | "AT_RISK" | "BLOCKED" | "OUTCOME_UNKNOWN";
  reasonCodes: readonly string[];
};
```

- [ ] **Step 1: Write failing validation and risk tests**

Cover positive and negative quantities, ISO date-only strings, overlong text, US E.164 phone validation, exact `US`/`en-US`, deterministic phone masking, recipient-name bounds, `availableQuantity + delayedQuantity === confirmedQuantity`, no-answer, refusal, zero availability, partial quantity, late date, required follow-up, and on-time complete delivery.

```ts
it("marks the approved demo scenario AT_RISK", () => {
  expect(assessSupplyRisk(order500, response350Ready)).toEqual({
    status: "AT_RISK",
    reasonCodes: ["PARTIAL_AVAILABILITY", "LATE_PROMISE", "HUMAN_FOLLOW_UP"],
  });
});
```

- [ ] **Step 2: Run focused tests and observe missing-module failures**

Run: `pnpm vitest run src/domain/purchase-order.test.ts src/domain/call-recipient.test.ts src/domain/supplier-response.test.ts src/domain/risk.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement strict Zod schemas and deterministic rules**

Apply these rules in order:

1. Non-`reached` outcome, `unknown` required fact, or inconsistent quantities -> `OUTCOME_UNKNOWN`.
2. `unableToFulfill === "yes"` or `availableQuantity === 0` -> `BLOCKED`.
3. Partial availability, promised date after the required date, or `followUpRequired === "yes"` -> `AT_RISK`.
4. Complete quantity, date on or before required date, no follow-up, and no blocking signal -> `ON_TRACK`.

Return stable sorted reason codes; never include free-form model text.

```ts
export function assessSupplyRisk(
  order: PurchaseOrder,
  response: SupplierResponse,
): SupplyRisk {
  const parsedOrder = purchaseOrderSchema.parse(order);
  const parsed = supplierResponseSchema.parse(response);
  if (
    parsed.contactOutcome !== "reached" ||
    parsed.promisedDeliveryDate === "unknown" ||
    parsed.followUpRequired === "unknown" ||
    parsed.unableToFulfill === "unknown" ||
    parsed.availableQuantity + parsed.delayedQuantity !== parsed.confirmedQuantity
  ) {
    return { status: "OUTCOME_UNKNOWN", reasonCodes: ["INSUFFICIENT_FACTS"] };
  }
  if (parsed.unableToFulfill === "yes" || parsed.availableQuantity === 0) {
    return { status: "BLOCKED", reasonCodes: ["UNABLE_TO_FULFILL"] };
  }
  const reasons = [
    parsed.availableQuantity < parsedOrder.expectedQuantity
      ? "PARTIAL_AVAILABILITY"
      : undefined,
    parsed.promisedDeliveryDate > parsedOrder.requiredDeliveryDate
      ? "LATE_PROMISE"
      : undefined,
    parsed.followUpRequired === "yes" ? "HUMAN_FOLLOW_UP" : undefined,
  ].filter((value): value is string => value !== undefined);
  return reasons.length > 0
    ? { status: "AT_RISK", reasonCodes: reasons }
    : { status: "ON_TRACK", reasonCodes: [] };
}
```

Define the recipient and bounded error contracts explicitly:

```ts
export const callRecipientSchema = z.strictObject({
  recipientName: z.string().trim().min(1).max(120),
  phoneE164: z.string().regex(/^\+1[2-9]\d{9}$/),
  maskedPhone: z.string().regex(/^\+1 \*\*\*-\*\*\*-\d{4}$/),
  region: z.literal("US"),
  locale: z.literal("en-US"),
});

export const APP_ERROR_CODES = [
  "AUTHORIZATION_REQUIRED",
  "UNSUPPORTED_RECIPIENT_REGION",
  "CALL_NOT_READY",
  "CALL_CREATION_FAILED",
  "CALL_OUTCOME_PENDING",
  "CALL_AUDIO_UNUSABLE",
  "PROVIDER_RESULT_INVALID",
  "PROVIDER_RESULT_CONFLICT",
  "OPENAI_BRIEFING_FAILED",
  "ARTIFACT_PUBLICATION_FAILED",
] as const;
```

- [ ] **Step 4: Run focused and coverage tests**

Run: `pnpm vitest run src/domain/*.test.ts`

Run: `pnpm vitest run --coverage src/domain/*.test.ts`

Expected: PASS with branch coverage for every risk rule.

- [ ] **Step 5: Commit**

```bash
git add src/domain
git commit -m "feat: add deterministic supply risk domain"
```

**Review gate:** Independently verify rule ordering, boundary cases, and that no LLM or provider field controls risk directly.

---

### Task 3: Implement run lifecycle and trust completion gate

**Files:**
- Create: `src/domain/authorization.ts`
- Create: `src/domain/authorization.test.ts`
- Create: `src/domain/run.ts`
- Create: `src/domain/run.test.ts`
- Create: `src/domain/trust.ts`
- Create: `src/domain/trust.test.ts`

**Interfaces:**
- Consumes: `PurchaseOrder`, `CallRecipient`, `SupplierResponse`, `SupplyRisk` from Task 2.
- Produces: `CallAuthorization`, `ProviderEvidenceSnapshot`, `RunRecord`, `RunStatus`, `TrustStatus`, `transitionRun`, `canCompleteRun`.

```ts
export type RunStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "CALL_STARTING"
  | "CALL_IN_PROGRESS"
  | "RECONCILING"
  | "PROVIDER_REPORTED_TERMINAL"
  | "COMPLETED"
  | "OUTCOME_UNKNOWN"
  | "FAILED";

export type TrustStatus =
  | "UNVERIFIED_PROVIDER_RESULT"
  | "CONSISTENCY_CHECK_PASSED"
  | "HUMAN_CONFIRMED"
  | "CONFLICT_DETECTED"
  | "OUTCOME_UNKNOWN";

export type CallAuthorization = {
  consentToCall: true;
  consentToRecord: true;
  consentToPublish: true;
  supportedRegionConfirmed: true;
  phoneReviewed: true;
  fictionalDataConfirmed: true;
  authorizedAt: string;
  authorizationDigest: string;
};

export type ProviderEvidenceSnapshot = {
  callId: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled" | "unknown";
  observedAt: string;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  transcript: readonly { speaker: "bot" | "user" | "unknown"; text: string }[];
  structuredResult: unknown;
  evidence: readonly { id: string; excerpt: string; turnIndexes: readonly number[] }[];
};

export type RunRecord = {
  id: string;
  version: number;
  status: RunStatus;
  trustStatus: TrustStatus;
  order: PurchaseOrder;
  recipient: CallRecipient;
  authorization?: CallAuthorization;
  idempotencyKey?: string;
  requestDigest?: string;
  callId?: string;
  providerSnapshot?: ProviderEvidenceSnapshot;
  schemaValidation: "not_run" | "passed" | "failed";
  consistencyValidation: "not_run" | "passed" | "failed";
  humanReview?: unknown;
  risk?: SupplyRisk;
  artifactState: "none" | "ready" | "published" | "failed";
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 1: Write the failing transition matrix tests**

Test every allowed transition and representative forbidden transitions, including direct provider `completed` to application `COMPLETED`.

```ts
it("forbids completion without human confirmation", () => {
  expect(() =>
    transitionRun(providerTerminalRun, "COMPLETED"),
  ).toThrowError("RUN_TRANSITION_FORBIDDEN");
});
```

- [ ] **Step 2: Run and observe the expected failure**

Run: `pnpm vitest run src/domain/authorization.test.ts src/domain/run.test.ts src/domain/trust.test.ts`

Expected: FAIL because lifecycle functions are missing.

- [ ] **Step 3: Implement the explicit transition table and completion predicate**

`canCompleteRun` returns true only when schema validation passed, consistency validation passed, trust status is `HUMAN_CONFIRMED`, and all four artifacts are ready for atomic publication.

```ts
const ALLOWED_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  DRAFT: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["CALL_STARTING"],
  CALL_STARTING: ["CALL_IN_PROGRESS", "RECONCILING", "FAILED"],
  CALL_IN_PROGRESS: ["RECONCILING", "PROVIDER_REPORTED_TERMINAL", "FAILED"],
  RECONCILING: ["CALL_STARTING", "CALL_IN_PROGRESS", "PROVIDER_REPORTED_TERMINAL", "OUTCOME_UNKNOWN", "FAILED"],
  PROVIDER_REPORTED_TERMINAL: ["COMPLETED", "OUTCOME_UNKNOWN", "FAILED"],
  COMPLETED: [],
  OUTCOME_UNKNOWN: [],
  FAILED: [],
};

export function canCompleteRun(run: RunRecord): boolean {
  return (
    run.status === "PROVIDER_REPORTED_TERMINAL" &&
    run.schemaValidation === "passed" &&
    run.consistencyValidation === "passed" &&
    run.trustStatus === "HUMAN_CONFIRMED" &&
    run.artifactState === "ready"
  );
}

export function transitionRun(run: RunRecord, next: RunStatus): RunRecord {
  if (!ALLOWED_TRANSITIONS[run.status].includes(next)) {
    throw new DomainError("RUN_TRANSITION_FORBIDDEN");
  }
  if (next === "COMPLETED" && !canCompleteRun(run)) {
    throw new DomainError("RUN_TRANSITION_FORBIDDEN");
  }
  return { ...run, status: next, version: run.version + 1 };
}
```

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/domain/authorization.test.ts src/domain/run.test.ts src/domain/trust.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/authorization.ts src/domain/authorization.test.ts src/domain/run.ts src/domain/run.test.ts src/domain/trust.ts src/domain/trust.test.ts
git commit -m "feat: enforce run and trust state machines"
```

**Review gate:** Confirm all transitions fail closed and provider flags remain advisory.

---

### Task 4: Define application ports and one-time authorization

**Files:**
- Create: `src/application/ports.ts`
- Create: `src/application/create-run.ts`
- Create: `src/application/create-run.test.ts`
- Create: `src/application/authorize-run.ts`
- Create: `src/application/authorize-run.test.ts`

**Interfaces:**
- Consumes: domain types from Tasks 2-3.
- Produces: `RunStore`, `CalleGateway`, `BriefingPort`, `Clock`, `IdGenerator`, `createRun`, `authorizeRun`.

```ts
export interface RunStore {
  create(run: RunRecord): Promise<void>;
  read(runId: string): Promise<RunRecord>;
  compareAndSwap(
    runId: string,
    expectedVersion: number,
    next: RunRecord,
  ): Promise<RunRecord>;
}

export interface Clock {
  now(): string;
  sleep(milliseconds: number): Promise<void>;
}

export interface IdGenerator {
  next(): string;
}

export type CreateSupplierCall = {
  runId: string;
  idempotencyKey: string;
  order: PurchaseOrder;
  recipient: CallRecipient;
};

export type CalleCallSnapshot = ProviderEvidenceSnapshot;

export type CalleEventPage = {
  events: readonly { id: string; type: string; occurredAt: string; summary: string }[];
  nextCursor: string | null;
};

export interface CalleGateway {
  createCall(input: CreateSupplierCall): Promise<CalleCallSnapshot>;
  getCall(callId: string): Promise<CalleCallSnapshot>;
  listEvents(callId: string, cursor?: string): Promise<CalleEventPage>;
}

export type BriefingFacts = {
  risk: SupplyRisk;
  expectedQuantity: number;
  availableQuantity: number;
  delayedQuantity: number;
  requiredDeliveryDate: string;
  promisedDeliveryDate: string | "unknown";
  delayReason: string;
  humanAction: "ACCEPT_PARTIAL" | "CONTACT_ALTERNATIVE" | "FOLLOW_UP";
};

export type BriefingExplanation = {
  title: string;
  explanation: string;
  recommendation: string;
  echoedFacts: Omit<BriefingFacts, "risk" | "delayReason" | "humanAction"> & {
    riskStatus: SupplyRisk["status"];
  };
};

export interface BriefingPort {
  generate(facts: BriefingFacts): Promise<BriefingExplanation>;
}

```

- [ ] **Step 1: Write failing authorization tests**

Test all confirmations required, authorization bound to one run, no phone stored in the authorization digest, reauthorization rejection after call start, and expired form revision rejection.

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run src/application/create-run.test.ts src/application/authorize-run.test.ts`

Expected: FAIL because application functions are missing.

- [ ] **Step 3: Implement create and authorize use cases**

Compute `authorizationDigest` from the canonical non-secret approval payload and run ID. Persist only the masked phone display value in the public run view; keep the full phone in the private run record.

```ts
export async function authorizeRun(
  deps: { store: RunStore; clock: Clock },
  input: { runId: string; expectedVersion: number; authorization: CallAuthorization },
): Promise<RunRecord> {
  const current = await deps.store.read(input.runId);
  if (current.status !== "AWAITING_APPROVAL") {
    throw new AppError("AUTHORIZATION_REQUIRED");
  }
  const next = {
    ...current,
    authorization: Object.freeze(input.authorization),
    version: current.version + 1,
    updatedAt: deps.clock.now(),
  };
  return deps.store.compareAndSwap(input.runId, input.expectedVersion, next);
}
```

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/application/create-run.test.ts src/application/authorize-run.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application src/domain/errors.ts
git commit -m "feat: add one-time call authorization"
```

**Review gate:** Verify authorization is explicit, immutable after call start, and does not leak the full phone.

---

### Task 5: Implement versioned filesystem run persistence

**Files:**
- Create: `src/adapters/filesystem/run-store.ts`
- Create: `src/adapters/filesystem/run-store.test.ts`
- Test: `tests/integration/run-store-concurrency.test.ts`

**Interfaces:**
- Implements: `RunStore` from Task 4.
- Produces: `FileRunStore({ root, clock })` with atomic create, read, and compare-and-swap.

- [ ] **Step 1: Write failing path, atomicity, and concurrency tests**

Use isolated temporary directories. Test invalid run IDs, traversal attempts, create-only behavior, stale-version rejection, concurrent compare-and-swap where exactly one writer wins, interrupted temporary files, and cleanup.

```ts
it("allows exactly one concurrent start claim", async () => {
  const results = await Promise.allSettled([
    store.compareAndSwap(id, 1, claimA),
    store.compareAndSwap(id, 1, claimB),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});
```

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run src/adapters/filesystem/run-store.test.ts tests/integration/run-store-concurrency.test.ts`

Expected: FAIL because `FileRunStore` is missing.

- [ ] **Step 3: Implement constrained atomic persistence**

Validate run IDs with `/^[a-z0-9][a-z0-9_-]{0,63}$/`. Write to a same-directory temporary file opened with exclusive creation, fsync, then rename. Implement compare-and-swap with an exclusive lock file and bounded stale-lock detection based only on the injected clock.

```ts
const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class FileRunStore implements RunStore {
  constructor(private readonly options: { root: string; clock: Clock }) {}

  async create(run: RunRecord): Promise<void> {
    // Validate the ID, create a same-directory temporary file exclusively,
    // fsync it, then rename it to the create-only final path.
  }

  async read(runId: string): Promise<RunRecord> {
    // Resolve only the validated child path and strictly parse its JSON.
  }

  async compareAndSwap(
    runId: string,
    expectedVersion: number,
    next: RunRecord,
  ): Promise<RunRecord> {
    // Hold the exclusive run lock, re-read, compare, atomically replace, release.
  }
}
```

- [ ] **Step 4: Run focused tests and inspect temporary directories**

Run: `pnpm vitest run src/adapters/filesystem/run-store.test.ts tests/integration/run-store-concurrency.test.ts`

Expected: PASS; no temporary or lock files remain.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/filesystem/run-store.ts src/adapters/filesystem/run-store.test.ts tests/integration/run-store-concurrency.test.ts
git commit -m "feat: persist runs atomically"
```

**Review gate:** Verify path confinement, crash safety, and concurrent start-claim behavior.

---

### Task 6: Implement and contract-test the CALL-E REST boundary

**Files:**
- Create: `src/adapters/calle/request.ts`
- Create: `src/adapters/calle/request.test.ts`
- Create: `src/adapters/calle/schemas.ts`
- Create: `src/adapters/calle/schemas.test.ts`
- Create: `src/adapters/calle/mapper.ts`
- Create: `src/adapters/calle/mapper.test.ts`
- Create: `src/adapters/calle/client.ts`
- Create: `src/adapters/calle/client.test.ts`
- Create: `tests/fixtures/calle/create-accepted.json`
- Create: `tests/fixtures/calle/in-progress.json`
- Create: `tests/fixtures/calle/completed-valid.json`
- Create: `tests/fixtures/calle/completed-missing-result.json`
- Create: `tests/fixtures/calle/failed.json`
- Create: `tests/fixtures/calle/events-page.json`
- Create: `tests/fixtures/calle/unknown-status.json`

**Interfaces:**
- Implements: `CalleGateway` from Task 4.
- Produces: `CalleClient implements CalleGateway`, `buildCreateCallRequest`, strict response schemas, and provider-to-domain mapping.

- [ ] **Step 1: Write failing request tests**

Assert one recipient only, `US`, `en-US`, E.164 validation, `additionalProperties: false`, all required supplier fields, no `webhook_url`, no batch fields, sanitized metadata, and a stable idempotency header.

- [ ] **Step 2: Write failing response and status-mapping tests**

Cover provider `queued`, `in_progress`, `completed`, `failed`, `canceled`, unknown status, null structured result, empty transcript, oversized transcript, malformed timestamps, unknown properties, and non-JSON errors.

- [ ] **Step 3: Run and observe expected failures**

Run: `pnpm vitest run src/adapters/calle/*.test.ts`

Expected: FAIL because adapter modules are missing.

- [ ] **Step 4: Implement the request builder and strict schemas**

The supplier schema requires `contact_outcome`, `confirmed_quantity`, `available_quantity`, `delayed_quantity`, `promised_delivery_date`, `delay_reason`, `follow_up_required`, and `unable_to_fulfill`. Use explicit `unknown` enum values instead of nullable unions. Bound call task text to 4,000 characters, evidence entries to 50, transcript turns to 500, and each external string to 4,000 characters before domain use.

```ts
export const recipientResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contact_outcome",
    "confirmed_quantity",
    "available_quantity",
    "delayed_quantity",
    "promised_delivery_date",
    "delay_reason",
    "follow_up_required",
    "unable_to_fulfill",
  ],
  properties: {
    contact_outcome: { type: "string", enum: ["reached", "declined", "no_answer", "unknown"], description: "Use reached only when the recipient answered and discussed the fictional order; never infer reached from a terminal status." },
    confirmed_quantity: { type: "integer", minimum: 0, maximum: 1_000_000, description: "Total quantity the recipient explicitly confirmed." },
    available_quantity: { type: "integer", minimum: 0, maximum: 1_000_000, description: "Quantity explicitly stated as ready now." },
    delayed_quantity: { type: "integer", minimum: 0, maximum: 1_000_000, description: "Quantity explicitly stated as delayed." },
    promised_delivery_date: { type: "string", maxLength: 32, description: "Use YYYY-MM-DD when stated clearly; otherwise use unknown." },
    delay_reason: { type: "string", maxLength: 1_000, description: "Brief reason stated by the recipient; use unknown when absent." },
    follow_up_required: { type: "string", enum: ["yes", "no", "unknown"], description: "Whether a human must follow up, based only on the conversation." },
    unable_to_fulfill: { type: "string", enum: ["yes", "no", "unknown"], description: "Whether the recipient explicitly said the order cannot be fulfilled." },
  },
} as const;

export function buildCreateCallRequest(input: CreateSupplierCall) {
  return {
    task: [
      "You are SupplySignal AI, an automated calling agent.",
      "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.",
      `Ask about fictional purchase order ${input.order.purchaseOrderRef} from ${input.order.supplierName}.`,
      `Confirm the quantity expected (${input.order.expectedQuantity}), quantity ready now, quantity delayed, and promised delivery date relative to ${input.order.requiredDeliveryDate}.`,
      "Ask for the delay reason, whether human follow-up is required, and whether the supplier is unable to fulfill the order.",
      "If the recipient declines, stop politely and do not invent answers. If nobody answers, do not infer supplier facts.",
    ].join("\n"),
    recipients: [{ phones: [input.recipient.phoneE164], region: "US", locale: "en-US" }],
    recipient_result_schema: recipientResultSchema,
    metadata: { workflow_run_id: input.runId },
  } as const;
}
```

- [ ] **Step 5: Implement the bounded HTTP client**

Use injected `fetch`, `AbortSignal.timeout(15_000)`, `Authorization: Bearer <server-only key>`, `Content-Type: application/json`, and `Idempotency-Key` on create. Do not retry `POST /v1/calls`. Permit at most two reads for transient GET failures with delays `500ms` and `1,000ms`; retries must reuse the same URL and cannot mutate external state.

```ts
const response = await fetch(`${baseUrl}/v1/calls`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "idempotency-key": input.idempotencyKey,
  },
  body: JSON.stringify(buildCreateCallRequest(input)),
  signal: AbortSignal.timeout(15_000),
});
```

- [ ] **Step 6: Run focused and integration-style mocked tests**

Run: `pnpm vitest run src/adapters/calle/*.test.ts`

Expected: PASS and snapshot assertions show no token or full phone in error output.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/calle tests/fixtures/calle
git commit -m "feat: add strict CALL-E REST adapter"
```

**Review gate:** Compare the request and fixtures with OpenAPI `0.6.0`; verify unknown status and malformed output fail closed.

---

### Task 7: Implement idempotent call start and reconciliation

**Files:**
- Create: `src/application/idempotency.ts`
- Create: `src/application/idempotency.test.ts`
- Create: `src/application/start-run.ts`
- Create: `src/application/start-run.test.ts`
- Create: `src/application/reconcile-run.ts`
- Create: `src/application/reconcile-run.test.ts`
- Test: `tests/integration/call-lifecycle.test.ts`

**Interfaces:**
- Consumes: `RunStore`, `CalleGateway`, run lifecycle, and authorization.
- Produces: `startRun(deps, runId)` and `reconcileRun(deps, runId)`.

- [ ] **Step 1: Write failing duplicate and ambiguous-create tests**

Cover missing authorization, two simultaneous starts, create timeout before call ID, process restart with `CALL_STARTING`, stable idempotency key reuse, byte-equivalent request digest, idempotency conflict without key replacement, existing call ID, unknown provider status, and terminal provider completion.

```ts
it("reuses the original key after an ambiguous create timeout", async () => {
  await expect(startRun(deps, runId)).rejects.toMatchObject({
    code: "CALL_OUTCOME_PENDING",
  });
  await startRun(deps, runId);
  expect(calle.createKeys).toEqual([expectedKey, expectedKey]);
});
```

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run src/application/idempotency.test.ts src/application/start-run.test.ts src/application/reconcile-run.test.ts tests/integration/call-lifecycle.test.ts`

Expected: FAIL because orchestration functions are missing.

- [ ] **Step 3: Implement the start claim and provider create flow**

Persist `CALL_STARTING` and the derived idempotency key before the provider request. If create returns a call ID, persist it. If create is ambiguous, persist `RECONCILING`, retain the same key, and return `CALL_OUTCOME_PENDING`. Never derive a second key for the run.

```ts
export async function startRun(deps: StartRunDeps, runId: string): Promise<RunRecord> {
  const claimed = await claimAuthorizedRun(deps.store, runId);
  try {
    const call = await deps.calle.createCall(toCreateSupplierCall(claimed));
    return persistCallIdentity(deps.store, claimed, call.callId);
  } catch (error) {
    if (isAmbiguousCreateFailure(error)) {
      await persistReconciliationState(deps.store, claimed);
      throw new AppError("CALL_OUTCOME_PENDING");
    }
    throw toBoundedCallError(error);
  }
}

export function deriveCallIdempotencyKey(input: {
  runId: string;
  authorizationDigest: string;
  requestDigest: string;
}): string {
  return `ssai-v1-${sha256(canonicalJson(input)).slice(0, 48)}`;
}
```

- [ ] **Step 4: Implement reconciliation**

Poll only the stored `call_id`; when the ID is not yet known, safely repeat create with the same request and idempotency key to recover the original provider resource. Map provider `completed` to `PROVIDER_REPORTED_TERMINAL`, not application completion.

```ts
const PROVIDER_STATUS: Readonly<Record<string, RunStatus>> = {
  queued: "CALL_STARTING",
  in_progress: "CALL_IN_PROGRESS",
  completed: "PROVIDER_REPORTED_TERMINAL",
  failed: "FAILED",
  canceled: "FAILED",
};
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/application/idempotency.test.ts src/application/start-run.test.ts src/application/reconcile-run.test.ts tests/integration/call-lifecycle.test.ts`

Expected: PASS; every scenario records at most one distinct idempotency key and call ID.

- [ ] **Step 6: Commit**

```bash
git add src/application/idempotency.ts src/application/idempotency.test.ts src/application/start-run.ts src/application/start-run.test.ts src/application/reconcile-run.ts src/application/reconcile-run.test.ts tests/integration/call-lifecycle.test.ts
git commit -m "feat: reconcile one CALL-E call safely"
```

**Review gate:** Independently reason through refresh, concurrency, timeout, and process-restart paths; reject any path capable of redialing.

---

### Task 8: Build and execute the three-call truthfulness preflight gate

**Files:**
- Create: `scripts/live-preflight.ts`
- Create: `scripts/live-preflight.test.ts`
- Create: `docs/operator-runbook.md`
- Create after successful preflight: `docs/verification/call-e-preflight.md`
- Private ignored output: `tmp/preflight-private/`

**Interfaces:**
- Consumes: CALL-E adapter and lifecycle from Tasks 6-7.
- Produces: a manual harness with scenarios `answered`, `declined`, and `no_answer`, plus a sanitized evidence report.

- [ ] **Step 1: Write failing preflight safety tests**

Test missing `CALLE_API_KEY`, missing `SUPPLIER_TEST_PHONE`, non-US number, non-interactive execution, absent exact confirmation phrase, invalid scenario, and any attempt to run more than one call per process.

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run scripts/live-preflight.test.ts`

Expected: FAIL because the harness is missing.

- [ ] **Step 3: Implement the guarded harness**

The script reads the phone from `SUPPLIER_TEST_PHONE`, never from a command argument. It displays the scenario and masked number, then requires the operator to type exactly `AUTHORIZE ONE CALL`. It writes raw results only under ignored `tmp/preflight-private/` and prints a sanitized summary.

```ts
const scenario = scenarioSchema.parse(readScenario(process.argv));
const phone = usPhoneSchema.parse(process.env.SUPPLIER_TEST_PHONE);
const confirmation = await prompt(
  `Scenario: ${scenario}\nRecipient: ${maskPhone(phone)}\nType AUTHORIZE ONE CALL: `,
);
if (confirmation !== "AUTHORIZE ONE CALL") {
  throw new AppError("AUTHORIZATION_REQUIRED");
}
await executeExactlyOnePreflightCall({ scenario, phone });
```

- [ ] **Step 4: Test the harness without placing a call**

Run: `pnpm vitest run scripts/live-preflight.test.ts`

Run: `pnpm tsx scripts/live-preflight.ts --scenario answered` with credentials absent.

Expected: tests PASS; the manual command exits before network access with `AUTHORIZATION_REQUIRED` or missing-configuration guidance.

- [ ] **Step 5: Commit the harness and runbook before live execution**

```bash
git add scripts/live-preflight.ts scripts/live-preflight.test.ts docs/operator-runbook.md
git commit -m "test: add guarded CALL-E preflight"
```

- [ ] **Step 6: Stop and obtain explicit owner authorization for the answered call**

Do not execute the call based only on plan approval. Ask the owner to authorize this specific external call, confirm the participant is ready, and confirm recording/publication consent.

- [ ] **Step 7: Run the answered scenario and reconcile the existing call**

Run: `pnpm tsx scripts/live-preflight.ts --scenario answered`

Expected: one call, one call ID, provider terminal result, non-empty human transcript turns, schema-valid supplier result, and timestamps consistent with the participant's observation.

- [ ] **Step 8: Repeat the explicit authorization gate for the declined scenario**

Run only after separate owner authorization: `pnpm tsx scripts/live-preflight.ts --scenario declined`

Expected: one call; the participant's explicit refusal is represented as declined or an equivalent non-success outcome, not a fabricated supplier response.

- [ ] **Step 9: Repeat the explicit authorization gate for the no-answer scenario**

Run only after separate owner authorization: `pnpm tsx scripts/live-preflight.ts --scenario no_answer`

Expected: one call; no fabricated conversation, no false supplier facts, and no delayed redial after the observation window documented in the runbook.

- [ ] **Step 10: Apply the stop decision**

Continue only if all three provider outcomes match physical observation and no delayed duplicate call occurs. If any outcome is fabricated or materially inconsistent, record the sanitized discrepancy, stop this plan, and return to an owner-approved design amendment.

- [ ] **Step 11: Write and commit the sanitized preflight evidence**

Record date, application commit, OpenAPI version, scenario outcomes, call-ID hashes, timings, observed-versus-reported comparison, and the explicit pass/fail decision. Exclude the phone, participant identity, raw transcript, and consent evidence.

```bash
git add docs/verification/call-e-preflight.md
git commit -m "docs: record CALL-E truthfulness preflight"
```

**Review gate:** An independent reviewer checks the private evidence locally and confirms that the public report is truthful and sanitized. This is a hard stop before Task 9.

---

### Task 9: Validate provider evidence and record human confirmation

**Files:**
- Create: `src/domain/consistency.ts`
- Create: `src/domain/consistency.test.ts`
- Create: `src/application/confirm-run.ts`
- Create: `src/application/confirm-run.test.ts`
- Test: `tests/integration/human-confirmation.test.ts`

**Interfaces:**
- Consumes: provider terminal snapshot, transcript evidence, purchase order, run and trust states.
- Produces: `ConsistencyReport`, `HumanReview`, `OperatorCorrection`, and `confirmRun(deps, input)`.

```ts
export type OperatorCorrection = {
  field: keyof SupplierResponse;
  providerValue: unknown;
  operatorValue: unknown;
  reason: string;
  evidenceIds: readonly string[];
  correctedAt: string;
};

export type HumanReview = {
  decision: "confirm" | "conflict";
  observedOutcome: "reached" | "declined" | "no_answer" | "unknown";
  corrections: readonly OperatorCorrection[];
  reviewedAt: string;
};
```

- [ ] **Step 1: Write failing consistency tests**

Cover missing transcript, unusable audio marker, unsupported evidence reference, quantity contradiction, date contradiction, a valid answer, refusal, no answer, and provider confidence that disagrees with grounded facts.

```ts
it("does not trust a completed provider result with contradictory quantities", () => {
  expect(validateProviderEvidence(order500, contradictorySnapshot)).toEqual({
    passed: false,
    code: "PROVIDER_RESULT_CONFLICT",
    conflicts: ["QUANTITY_TOTAL_MISMATCH"],
  });
});
```

- [ ] **Step 2: Write failing confirmation tests**

Test that confirmation requires a passed consistency report, conflict moves the run to `OUTCOME_UNKNOWN`, correction preserves the provider value, a supported correction cites exact evidence and can be confirmed, an unsupported correction fails closed, correction requires a bounded reason, confirmation is immutable, and neither `task_completed` nor `completion_confidence` bypasses review.

- [ ] **Step 3: Run and observe expected failures**

Run: `pnpm vitest run src/domain/consistency.test.ts src/application/confirm-run.test.ts tests/integration/human-confirmation.test.ts`

Expected: FAIL because consistency and confirmation modules are missing.

- [ ] **Step 4: Implement deterministic consistency validation**

Validate exact evidence IDs, compare transcript excerpts with structured fields, reject unmatched or ambiguous facts, and return stable conflict codes. Treat absence as unknown; never infer a successful conversation from provider status alone.

```ts
export function validateProviderEvidence(
  order: PurchaseOrder,
  snapshot: NormalizedCallSnapshot,
): ConsistencyReport {
  const parsed = supplierResponseSchema.safeParse(snapshot.structuredResult);
  if (!parsed.success) {
    return { passed: false, code: "PROVIDER_RESULT_INVALID", conflicts: [] };
  }
  const conflicts = findEvidenceConflicts(order, parsed.data, snapshot.evidence);
  return conflicts.length === 0
    ? { passed: true, code: null, conflicts: [] }
    : { passed: false, code: "PROVIDER_RESULT_CONFLICT", conflicts };
}
```

- [ ] **Step 5: Implement audited human review**

Store the immutable normalized provider response and a separate operator review. A correction records original value, replacement value, reason, exact supporting evidence IDs, and timestamp without mutating the provider record. Re-run consistency validation against the effective reviewed response and cited evidence. Only a `confirm` decision after that validation passes yields `HUMAN_CONFIRMED`; an unsupported correction or declared conflict yields `OUTCOME_UNKNOWN`.

```ts
export async function confirmRun(
  deps: { store: RunStore; clock: Clock },
  input: ConfirmRunInput,
): Promise<RunRecord> {
  const current = await deps.store.read(input.runId);
  const review = humanReviewSchema.parse({ ...input.review, reviewedAt: deps.clock.now() });
  const reviewed = applyReviewWithoutMutation(requireProviderSnapshot(current), review);
  const report = validateReviewedEvidence(current.order, reviewed, review.corrections);
  const next = review.decision === "confirm" && report.passed
    ? withHumanConfirmation(current, report, review)
    : withOutcomeUnknown(current, report, review);
  return deps.store.compareAndSwap(current.id, input.expectedVersion, next);
}
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run src/domain/consistency.test.ts src/application/confirm-run.test.ts tests/integration/human-confirmation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/consistency.ts src/domain/consistency.test.ts src/application/confirm-run.ts src/application/confirm-run.test.ts tests/integration/human-confirmation.test.ts
git commit -m "feat: require grounded human confirmation"
```

**Review gate:** Verify fail-closed behavior and prove that corrections append evidence instead of rewriting provider history.

---

### Task 10: Implement the constrained OpenAI briefing adapter

**Files:**
- Create: `src/adapters/openai/schema.ts`
- Create: `src/adapters/openai/schema.test.ts`
- Create: `src/adapters/openai/briefing.ts`
- Create: `src/adapters/openai/briefing.test.ts`
- Create: `tests/fixtures/openai/briefing-valid.json`
- Create: `tests/fixtures/openai/briefing-invented-fact.json`
- Create: `tests/fixtures/openai/briefing-malformed.json`

**Interfaces:**
- Implements: `BriefingPort` from Task 4.
- Consumes only sanitized `BriefingFacts` after deterministic risk computation.
- Produces a validated `BriefingExplanation` that cannot change authoritative facts.

- [ ] **Step 1: Write failing schema and grounding tests**

Test valid structured output, unknown keys, invented quantities or dates, changed risk status, overlong prose, unsafe control characters, raw prompt leakage, and malformed provider errors.

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run src/adapters/openai/*.test.ts`

Expected: FAIL because the OpenAI adapter does not exist.

- [ ] **Step 3: Implement strict input and output schemas**

Allow only a short title, a bounded explanation, and a bounded human recommendation whose critical values exactly equal the deterministic input facts. Reject any output that introduces a new quantity, date, supplier identity, phone number, or risk status.

```ts
export const briefingExplanationSchema = z.strictObject({
  title: z.string().min(1).max(120),
  explanation: z.string().min(1).max(1_200),
  recommendation: z.string().min(1).max(500),
  echoedFacts: z.strictObject({
    riskStatus: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED", "OUTCOME_UNKNOWN"]),
    expectedQuantity: z.number().int().nonnegative(),
    availableQuantity: z.number().int().nonnegative(),
    delayedQuantity: z.number().int().nonnegative(),
    requiredDeliveryDate: isoDateSchema,
    promisedDeliveryDate: z.union([isoDateSchema, z.literal("unknown")]),
  }),
});
```

- [ ] **Step 4: Implement the server-only Responses API adapter**

Use `gpt-5.6-luna`, injected OpenAI client, strict structured output, a 20-second timeout, and no automatic provider retry. Convert all provider failures to `OPENAI_BRIEFING_FAILED` before returning. Never expose raw request, response, system prompt, or trace data.

```ts
export async function generateBriefing(
  client: OpenAI,
  facts: BriefingFacts,
): Promise<BriefingExplanation> {
  const response = await client.responses.parse({
    model: "gpt-5.6-luna",
    input: JSON.stringify(briefingFactsSchema.parse(facts)),
    text: { format: zodTextFormat(briefingExplanationSchema, "supply_risk_briefing") },
  }, { timeout: 20_000, maxRetries: 0 });
  return assertBriefingMatchesFacts(facts, response.output_parsed);
}
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/adapters/openai/*.test.ts`

Expected: PASS using only fake clients and committed fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/openai tests/fixtures/openai
git commit -m "feat: add grounded OpenAI risk briefing"
```

**Review gate:** Verify the model is explanatory only and deterministic facts remain authoritative.

---

### Task 11: Publish exactly four artifacts atomically and complete the run

**Files:**
- Create: `src/adapters/filesystem/artifact-writer.ts`
- Create: `src/adapters/filesystem/artifact-writer.test.ts`
- Create: `src/application/complete-run.ts`
- Create: `src/application/complete-run.test.ts`
- Test: `tests/integration/artifact-publication.test.ts`

**Interfaces:**
- Consumes: human-confirmed run, deterministic risk, validated briefing.
- Produces exactly the four approved artifact names and a `COMPLETED` run only after atomic publication.

- [ ] **Step 1: Write failing artifact safety tests**

Cover invalid run IDs, unexpected artifact names, missing file, fifth file, partial write, existing final package, process interruption, full phone, bearer token, native absolute path, hidden prompt marker, raw provider envelope, and terminal escape sequences.

- [ ] **Step 2: Write failing completion tests**

Test non-confirmed trust state, conflict, unknown outcome, briefing failure, publication failure, successful package, and repeated completion. Assert a failed operation never changes the run to `COMPLETED`.

- [ ] **Step 3: Run and observe expected failures**

Run: `pnpm vitest run src/adapters/filesystem/artifact-writer.test.ts src/application/complete-run.test.ts tests/integration/artifact-publication.test.ts`

Expected: FAIL because the writer and completion use case are missing.

- [ ] **Step 4: Implement create-only atomic package publication**

Render all four files into a same-root staging directory, validate names and content, fsync them, then rename the complete directory to its final run location. Reject a pre-existing final package and remove failed staging directories.

```ts
export const ARTIFACT_NAMES = [
  "supplier-call-summary.md",
  "structured-result.json",
  "supply-risk-briefing.md",
  "audit-record.json",
] as const;

export interface ArtifactWriter {
  publish(runId: string, files: Readonly<Record<(typeof ARTIFACT_NAMES)[number], string>>): Promise<void>;
}
```

- [ ] **Step 5: Implement completion orchestration**

Recompute risk from reviewed facts, request the explanatory briefing, validate its grounding, publish the package, verify all four files, and only then compare-and-swap the run to `COMPLETED`.

```ts
export async function completeRun(deps: CompleteRunDeps, runId: string): Promise<RunRecord> {
  const run = await deps.store.read(runId);
  assertHumanConfirmed(run);
  const risk = assessSupplyRisk(run.order, reviewedSupplierResponse(run));
  const briefing = await deps.briefing.generate(toBriefingFacts(run, risk));
  await deps.artifacts.publish(run.id, renderArtifactPackage(run, risk, briefing));
  return deps.store.compareAndSwap(run.id, run.version, markCompleted(run, risk));
}
```

- [ ] **Step 6: Run focused and integration tests**

Run: `pnpm vitest run src/adapters/filesystem/artifact-writer.test.ts src/application/complete-run.test.ts tests/integration/artifact-publication.test.ts`

Expected: PASS and each successful package contains exactly four files.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/filesystem/artifact-writer.ts src/adapters/filesystem/artifact-writer.test.ts src/application/complete-run.ts src/application/complete-run.test.ts tests/integration/artifact-publication.test.ts
git commit -m "feat: publish auditable supply risk packages"
```

**Review gate:** Inspect generated fixture output and failure cleanup; confirm completion is impossible before publication succeeds.

---

### Task 12: Compose mode-aware server dependencies and bounded API routes

**Files:**
- Create: `src/server/env.ts`
- Create: `src/server/env.test.ts`
- Create: `src/server/container.ts`
- Create: `src/server/container.test.ts`
- Create: `src/server/http.ts`
- Create: `src/server/http.test.ts`
- Create: `app/api/runs/route.ts`
- Create: `app/api/runs/[runId]/authorize/route.ts`
- Create: `app/api/runs/[runId]/start/route.ts`
- Create: `app/api/runs/[runId]/reconcile/route.ts`
- Create: `app/api/runs/[runId]/confirm/route.ts`
- Create: `app/api/runs/[runId]/complete/route.ts`
- Create: `app/api/runs/[runId]/artifacts/[artifactName]/route.ts`
- Test: `tests/integration/api-routes.test.ts`

**Interfaces:**
- Produces: `APP_MODE=operator | replay`, a server-only dependency container, allowlisted routes, and bounded JSON errors.

- [ ] **Step 1: Write failing environment tests**

Test operator mode requiring `CALLE_API_KEY`, `OPENAI_API_KEY`, and a validated filesystem root; replay mode rejecting those keys; unknown mode; client-exposed variables; and malformed paths.

- [ ] **Step 2: Write failing route tests**

Cover malformed JSON, oversized bodies, invalid run IDs, unknown fields, duplicate start requests, replay-mode mutation attempts, artifact traversal, non-allowlisted artifact names, and raw dependency errors.

- [ ] **Step 3: Run and observe expected failures**

Run: `pnpm vitest run src/server/*.test.ts tests/integration/api-routes.test.ts`

Expected: FAIL because server composition and routes are missing.

- [ ] **Step 4: Implement mode-aware environment parsing**

Parse environment only on the server. In operator mode, construct real adapters; in tests, accept injected fakes. In replay mode, construct only the replay loader and omit all mutation-capable dependencies.

```ts
const baseEnvSchema = z.object({ APP_MODE: z.enum(["operator", "replay", "test"]) });

export function parseServerEnv(env: NodeJS.ProcessEnv): ServerConfig {
  const base = baseEnvSchema.parse(env);
  if (base.APP_MODE === "replay") return { mode: "replay" };
  if (base.APP_MODE === "test") return { mode: "test" };
  return operatorEnvSchema.parse({
    mode: "operator",
    calleApiKey: env.CALLE_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    runRoot: env.RUN_ROOT,
  });
}
```

- [ ] **Step 5: Implement route handlers and the bounded error envelope**

Set no-store responses for private run data. Accept only strict request schemas with a 32 KiB limit. Return `{ error: { code, message } }` with allowlisted codes and generic bounded messages. Never return stack traces, native paths, keys, full phone numbers, or raw provider data.

```ts
export function errorResponse(error: unknown): Response {
  const bounded = toPublicError(error);
  return Response.json(
    { error: { code: bounded.code, message: bounded.message } },
    { status: bounded.status, headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 6: Prove replay mode has no callable effect route**

Every mutation route must return `404` in replay mode before reading a body or composing CALL-E/OpenAI adapters. Artifact reads remain allowlisted and sanitized.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run src/server/*.test.ts tests/integration/api-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server app/api tests/integration/api-routes.test.ts
git commit -m "feat: expose mode-safe operator routes"
```

**Review gate:** Confirm replay composition cannot instantiate CALL-E or OpenAI and route errors disclose no sensitive data.

---

### Task 13: Build the five-stage operator workflow

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Create: `components/operator-workflow.tsx`
- Create: `components/operator-workflow.test.tsx`
- Create: `components/purchase-order-form.tsx`
- Create: `components/purchase-order-form.test.tsx`
- Create: `components/safety-approval.tsx`
- Create: `components/safety-approval.test.tsx`
- Create: `components/live-run-panel.tsx`
- Create: `components/live-run-panel.test.tsx`
- Create: `components/human-confirmation.tsx`
- Create: `components/human-confirmation.test.tsx`
- Create: `components/risk-briefing.tsx`
- Create: `components/risk-briefing.test.tsx`

**Interfaces:**
- Consumes: bounded API route view models.
- Produces: five explicit operator stages with no credential input or raw trace display.

- [ ] **Step 1: Write failing component tests for the approved workflow**

Test Northstar defaults, masked phone display, `US` and `English`, exact call questions, all consent confirmations, disabled authorization until all checks pass, one-call label, progress states, `Stop future processing`, conflict and correction forms, deterministic risk, trust status, and four artifact links.

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run components/*.test.tsx`

Expected: FAIL because operator components are missing.

- [ ] **Step 3: Implement Purchase Order and Call Plan & Safety Approval**

Use accessible labels and validation. Explain that the application places one AI-disclosed call, cannot guarantee cancellation of an active call, uses fictional data, and requires consent to call, record, and publish.

```tsx
<fieldset>
  <legend>Authorize one call</legend>
  <ConsentCheckbox name="consentToCall">The recipient consented to this call.</ConsentCheckbox>
  <ConsentCheckbox name="consentToRecord">The recipient consented to recording.</ConsentCheckbox>
  <ConsentCheckbox name="consentToPublish">The recipient consented to the approved demo excerpt.</ConsentCheckbox>
  <ConsentCheckbox name="supportedRegionConfirmed">The reviewed number is in the United States.</ConsentCheckbox>
  <button disabled={!allConfirmationsChecked}>Authorize one call</button>
</fieldset>
```

- [ ] **Step 4: Implement Live Run and Human Confirmation**

Poll reconciliation with one browser timer that never invokes call creation. Render bounded sanitized events, a masked call ID, provider-reported status as advisory, extracted answers with evidence, consistency warnings, correction fields, and explicit confirm/conflict actions.

```tsx
useEffect(() => {
  if (!RECONCILABLE_STATUSES.includes(run.status)) return;
  const timer = window.setInterval(() => void reconcileExistingCall(run.id), 2_000);
  return () => window.clearInterval(timer);
}, [run.id, run.status]);
```

- [ ] **Step 5: Implement Supply Risk Briefing**

Render authoritative status, expected versus confirmed quantities, required versus promised date, delay reason, recommended human action, trust status, audit events, and exactly four downloads.

```tsx
<section aria-labelledby="risk-heading">
  <h2 id="risk-heading">Supply risk briefing</h2>
  <RiskBadge status={run.risk.status} />
  <p>Trust status: {run.trustStatus}</p>
  {ARTIFACT_NAMES.map((name) => (
    <a key={name} href={`/api/runs/${run.id}/artifacts/${name}`}>{name}</a>
  ))}
</section>
```

- [ ] **Step 6: Run component, accessibility, type, and lint checks**

Run: `pnpm vitest run components/*.test.tsx`

Run: `pnpm typecheck && pnpm lint`

Expected: PASS with zero warnings.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/globals.css components
git commit -m "feat: add the operator call workflow"
```

**Review gate:** Manually inspect all five screens at desktop and mobile widths and confirm the UI never implies autonomous procurement or guaranteed cancellation.

---

### Task 14: Create the sanitized verified replay

**Files:**
- Create: `src/replay/sanitize.ts`
- Create: `src/replay/sanitize.test.ts`
- Create: `src/replay/load.ts`
- Create: `src/replay/load.test.ts`
- Create: `src/replay/schema.ts`
- Create: `components/replay-view.tsx`
- Create: `components/replay-view.test.tsx`
- Create: `app/replay/page.tsx`
- Create after verified run: `examples/northstar/supplier-call-summary.md`
- Create after verified run: `examples/northstar/structured-result.json`
- Create after verified run: `examples/northstar/supply-risk-briefing.md`
- Create after verified run: `examples/northstar/audit-record.json`
- Create after verified run: `examples/northstar/replay.json`

**Interfaces:**
- Consumes: one owner-reviewed, human-confirmed private run.
- Produces: a strict `PublicReplay` projection and read-only replay page.

- [ ] **Step 1: Write failing sanitizer tests**

Seed private fields containing a full phone, participant name, consent evidence, raw transcript, provider envelope, prompt, token-shaped value, native path, and internal error. Assert none survives serialization.

- [ ] **Step 2: Write failing replay UI tests**

Assert `Verified sanitized replay`, replay timestamp and source commit, the Northstar scenario, `AT_RISK`, human-confirmed trust, four artifact links, no form, no authorization button, no call route, no audio, and no claim of a live execution.

- [ ] **Step 3: Run and observe expected failures**

Run: `pnpm vitest run src/replay/*.test.ts components/replay-view.test.tsx`

Expected: FAIL because replay modules are missing.

- [ ] **Step 4: Implement strict private-to-public projection and loader**

Build the public object from an allowlist rather than deletion. Validate the committed replay against a versioned schema and reject unknown properties. Include only fictional order data, reviewed structured answers, evidence summaries, trust history, deterministic risk, artifact content, run date, and source commit.

```ts
export function sanitizeRunForReplay(run: CompletedRun): PublicReplay {
  return publicReplaySchema.parse({
    schemaVersion: 1,
    label: "Verified sanitized replay",
    sourceCommit: run.sourceCommit,
    recordedAt: run.completedAt,
    order: pickFictionalOrderFields(run.order),
    supplierResponse: pickReviewedResponseFields(run),
    evidence: summarizeEvidence(run),
    trustHistory: pickPublicTrustEvents(run),
    risk: run.risk,
    artifacts: pickFourArtifactContents(run),
  });
}
```

- [ ] **Step 5: Generate the reviewed example package only after the verified live run**

Run an explicit local export command that reads the owner-selected completed run, displays the sanitizer diff, and requires `PUBLISH SANITIZED REPLAY`. Inspect every generated file before staging.

- [ ] **Step 6: Run replay tests and secret scan**

Run: `pnpm vitest run src/replay/*.test.ts components/replay-view.test.tsx`

Run: `pnpm scan:secrets`

Expected: PASS; no full phone, identity, credential, raw transcript, or internal trace is present.

- [ ] **Step 7: Commit**

```bash
git add src/replay components/replay-view.tsx components/replay-view.test.tsx app/replay examples/northstar
git commit -m "feat: publish a verified sanitized replay"
```

**Review gate:** Owner reviews the exact public projection and all four example artifacts before publication.

---

### Task 15: Prove operator and replay flows in a real browser

**Files:**
- Create: `tests/e2e/fixtures/fake-operator-server.ts`
- Create: `tests/e2e/operator.spec.ts`
- Create: `tests/e2e/replay.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: application UI and deterministic fake ports.
- Produces: browser-level proof without live CALL-E or OpenAI.

- [ ] **Step 1: Write failing operator E2E**

Exercise all five stages: create `PO-2048`, review plan, check approval boxes, authorize once, start once, reconcile fake progress, inspect provider evidence, confirm, see `AT_RISK`, and download the four exact files.

- [ ] **Step 2: Write failing negative E2E**

Cover duplicate start clicks, refresh during `CALL_STARTING`, conflict declaration, invalid provider result, incomplete evidence, and failure to publish an incomplete package.

- [ ] **Step 3: Write failing replay E2E**

Verify direct `/replay` access, verified replay label, no mutation controls, `POST` to every mutation route returns `404`, four artifact links work, and source contains no credential-shaped strings or personal data.

- [ ] **Step 4: Run and observe expected failures**

Run: `pnpm playwright test tests/e2e/operator.spec.ts tests/e2e/replay.spec.ts`

Expected: FAIL until the fake-mode composition and browser contracts are complete.

- [ ] **Step 5: Implement only the deterministic test composition needed by the browser tests**

Inject fake CALL-E and OpenAI ports through the server container under `APP_MODE=test`; never add a browser-controlled switch or production route that selects fake providers.

```ts
export function createTestContainer(fixtures: TestFixtures): OperatorContainer {
  return createOperatorContainer({
    calle: new FakeCalleGateway(fixtures.calls),
    briefing: new FakeBriefingPort(fixtures.briefing),
    store: new FileRunStore({ root: fixtures.runRoot, clock: fixtures.clock }),
    clock: fixtures.clock,
    ids: fixtures.ids,
  });
}
```

- [ ] **Step 6: Run the browser suite**

Run: `pnpm playwright test tests/e2e/operator.spec.ts tests/e2e/replay.spec.ts`

Expected: PASS with trace capture only on failure.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e playwright.config.ts src/server
git commit -m "test: cover operator and replay journeys"
```

**Review gate:** Inspect the browser test selection and prove it runs both files; ensure tests cannot access live services.

---

### Task 16: Add least-privileged CI, secret scanning, and build-clean enforcement

**Files:**
- Create: `scripts/scan-secrets.mjs`
- Create: `scripts/scan-secrets.test.ts`
- Create: `scripts/assert-build-clean.mjs`
- Create: `scripts/assert-build-clean.test.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: one offline required `Offline gate` that fails on warnings, secrets, build mutations, or unignored output.

- [ ] **Step 1: Write failing enforcement tests**

For secret scanning, test safe documented example values and token/private-key/phone fixtures. For build cleanliness, test tracked modification, tracked deletion, untracked unignored file, ignored file, and clean tree.

- [ ] **Step 2: Run and observe expected failures**

Run: `pnpm vitest run scripts/scan-secrets.test.ts scripts/assert-build-clean.test.ts`

Expected: FAIL because enforcement scripts are missing.

- [ ] **Step 3: Implement deterministic repository scanners**

Scan tracked and unignored files without printing matched secret values. Snapshot `git status --porcelain=v1 --untracked-files=all` before and after build and fail on any new tracked change or unignored file. Ignore only repository-declared ignored output.

```js
const before = await gitStatus();
await run("pnpm", ["build"]);
const after = await gitStatus();
if (after !== before) {
  throw new Error("BUILD_MUTATED_WORKTREE");
}
```

- [ ] **Step 4: Configure zero-warning local verification**

Set lint to fail on any warning. Make `verify` run format check, typecheck, zero-warning lint, unit/integration tests with coverage, browser tests, build-clean check, and secret scan in that order.

```json
{
  "scripts": {
    "lint": "eslint . --max-warnings=0",
    "verify": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm test:e2e && pnpm check:build-clean && pnpm scan:secrets"
  }
}
```

- [ ] **Step 5: Add the required CI workflow**

Use `permissions: contents: read`, no secrets, `persist-credentials: false`, frozen lockfile, Node `22.23.1`, and pnpm `11.20.0`. Pin actions exactly:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
  with:
    persist-credentials: false
- uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa
  with:
    version: 11.20.0
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
  with:
    node-version: 22.23.1
    cache: pnpm
```

- [ ] **Step 6: Run positive and negative enforcement tests**

Run: `pnpm vitest run scripts/scan-secrets.test.ts scripts/assert-build-clean.test.ts`

Run: `pnpm verify`

Expected: PASS; no network access is required after dependency installation and no credential variables are set.

- [ ] **Step 7: Commit**

```bash
git add scripts package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "ci: enforce the offline quality gate"
```

**Review gate:** Audit action SHAs, permissions, warning policy, frozen lockfile use, test selection, and both scanners' negative tests.

---

### Task 17: Finish documentation and replay-only Render deployment

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/operator-runbook.md`
- Create: `docs/architecture.md`
- Create: `docs/security-and-trust.md`
- Create: `docs/demo-script.md`
- Create: `docs/verification/release-checklist.md`
- Create: `render.yaml`
- Create: `tests/integration/render-blueprint.test.ts`

**Interfaces:**
- Produces: reproducible local setup, truthful operating guidance, judge-first README, and a replay-only deployment blueprint.

- [ ] **Step 1: Write the failing Render blueprint test**

Assert one web service, `APP_MODE=replay`, build and start commands, health route, no disk, no CALL-E/OpenAI environment keys, and no deployment of private `runs/` or `tmp/` data.

- [ ] **Step 2: Run and observe expected failure**

Run: `pnpm vitest run tests/integration/render-blueprint.test.ts`

Expected: FAIL because `render.yaml` is missing.

- [ ] **Step 3: Write the judge-first README**

Lead with the real problem, a repository badge labeled `Public replay pending deployment` until a verified URL exists, one-call safety boundary, deterministic trust flow, Northstar outcome, four artifacts, architecture, local setup, test commands, Apache 2.0 license, and explicit replay-versus-live distinction. Do not claim a successful deployment, live test, or public URL before it exists.

- [ ] **Step 4: Complete the Windows operator runbook**

Use PowerShell syntax such as `$env:CALLE_API_KEY = "..."` only as non-secret local examples. Document consent, one-call authorization, supported `US` recipient, live preflight, ambiguous create recovery, `Stop future processing`, local secret storage, sanitized export, and credential cleanup. Keep CLI/MCP installation optional and outside the app runtime.

- [ ] **Step 5: Add architecture, trust, demo, and release documentation**

Document module boundaries, trust-state transitions, known CALL-E limitations, provider-status mapping, privacy review, the under-three-minute demo sequence, and manual release evidence. Link the approved specification, implementation plan, examples, and preflight report.

- [ ] **Step 6: Implement and test the replay-only blueprint**

Configure a free-compatible Render web service that installs with the frozen lockfile, builds once, and starts with `APP_MODE=replay`. Do not declare CALL-E or OpenAI secrets.

```yaml
services:
  - type: web
    name: supplysignal-ai-replay
    runtime: node
    plan: free
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build
    startCommand: pnpm start
    envVars:
      - key: APP_MODE
        value: replay
      - key: NODE_VERSION
        value: 22.23.1
```

Run: `pnpm vitest run tests/integration/render-blueprint.test.ts`

Expected: PASS.

- [ ] **Step 7: Run documentation and repository checks**

Run: `pnpm format:check && pnpm scan:secrets && git diff --check`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add README.md .env.example docs render.yaml tests/integration/render-blueprint.test.ts
git commit -m "docs: prepare the public replay release"
```

**Review gate:** Verify every claim against executable evidence and confirm no operator secret or personal data appears in docs or deployment configuration.

---

### Task 18: Perform final review, publish the release, and prepare the CALL-E contribution

**Files:**
- Create: `docs/verification/final-review.md`
- Create: `docs/submission/devpost.md`
- Create: `docs/submission/youtube.md`
- Create in a separate fork only after owner approval: `apps/typescript/supplysignal-ai/README.md`
- Modify in that fork only after owner approval: `README.md`

**Interfaces:**
- Produces: reviewed release evidence, replay deployment, public tag/release, submission copy, and a scoped upstream contribution.

- [ ] **Step 1: Run a whole-branch review against specification and plan**

Inspect every commit and `git diff main...HEAD`. Review for scope drift, copied LineageGuard code, secret or personal-data exposure, provider trust bypass, duplicate-call paths, replay mutation capability, misleading documentation, unused code, inconsistent naming, and untested behavior. Record findings and resolutions in `docs/verification/final-review.md`.

- [ ] **Step 2: Run the complete offline verification from a clean tree**

Run: `pnpm install --frozen-lockfile`

Run: `pnpm verify`

Run: `git diff --check`

Run: `git status --short`

Expected: all checks exit `0`; the final status contains only the intentional verification document change before it is committed.

- [ ] **Step 3: Commit final review evidence**

```bash
git add docs/verification/final-review.md
git commit -m "docs: record final release review"
```

- [ ] **Step 4: Obtain explicit owner approval before external publication**

Ask separately for authorization to push, open a pull request, deploy Render, publish a tag and GitHub Release, open the upstream CALL-E pull request, publish the video, or submit Devpost. Plan approval alone does not authorize these external changes.

- [ ] **Step 5: Push the feature branch, open a draft PR, and wait for green CI**

After authorization, push the reviewed branch, create a draft PR containing specification traceability, preflight evidence, test evidence, privacy statement, and replay limitation. Resolve review findings, rerun `pnpm verify`, mark ready, wait for `Offline gate`, and merge only after it is green.

- [ ] **Step 6: Synchronize `main` and deploy the exact release candidate in replay mode**

Deploy the merge commit through `render.yaml`. Verify the public URL in a clean browser session, mutation routes returning `404`, all four artifact downloads, replay label, mobile layout, no login requirement, and no secret-bearing environment configuration. Update README only with the verified public URL and commit through a normal PR.

- [ ] **Step 7: Tag and release the exact verified commit**

Create an annotated `v1.0.0` tag and GitHub Release only after the release candidate commit passes local verification, CI, deployment smoke, and privacy review. Release notes state that hosted mode is a sanitized replay and local operator mode requires explicit authorization and private credentials.

- [ ] **Step 8: Prepare and validate the upstream CALL-E app contribution**

Fork `CALLE-AI/awesome-phone-call-agents`, add a focused `apps/typescript/supplysignal-ai/README.md` that links to the public repository and replay, and add one factual README table entry. Document setup, real-call side effects, one-call authorization, inability to guarantee active-call cancellation, credential handling, preview/replay behavior, and no personal data. Run `python3 scripts/validate_repository.py`, follow the upstream naming guide, inspect the diff, then open the PR after owner approval.

- [ ] **Step 9: Prepare the public video and Devpost copy**

Write an under-three-minute script showing purchase order, exact call plan, manual authorization, consented split-screen call excerpt, provider evidence, human trust gate, deterministic `AT_RISK`, and four artifacts. Use only masked/sanitized data. Populate `docs/submission/youtube.md` and `docs/submission/devpost.md` with truthful claims, exact URLs, technologies, challenges, learning, and limitations.

- [ ] **Step 10: Complete final submission audit**

Verify the public repository, Apache 2.0 license at root, public replay, public video under three minutes, example artifacts, selected challenge category, contribution PR URL, tag/release, and Devpost fields. Submit only after the owner reviews the irreversible final form.

**Review gate:** Final handoff includes exact commit, CI run, deployment URL, release URL, upstream PR, video URL, Devpost URL, and any truthful remaining limitations.

---

## Plan Traceability

| Acceptance criterion | Primary tasks |
| --- | --- |
| 1. One-time authorization before a real call | 4, 7, 8, 12, 13, 15 |
| 2. At most one CALL-E call | 5, 6, 7, 8, 15 |
| 3. Persist and reconcile the authoritative call ID | 5, 7, 8 |
| 4. Bound, validate, and sanitize external output | 6, 9, 10, 11, 12, 14, 16 |
| 5. Consistency and human confirmation gate completion | 3, 9, 11, 13, 15 |
| 6. Deterministic, non-LLM risk | 2, 10, 11 |
| 7. Exactly four artifacts, atomically | 11, 14, 15 |
| 8. Incomplete or conflicting work is never completed | 3, 7, 9, 11, 15 |
| 9. Hosted replay has no call capability | 12, 14, 15, 17, 18 |
| 10. Required CI is offline and credential-free | 1, 6, 10, 15, 16 |
| 11. Three-call preflight is truthful and documented | 8, 17, 18 |
| 12. Public surfaces contain no unapproved personal data | 11, 14, 16, 17, 18 |
| 13. OpenAPI 0.6.0, US/en-US, fail-closed statuses | 6, 7, 8 |
| 14. CLI/MCP/OAuth cache excluded from runtime and deployment | 1, 8, 12, 16, 17 |

## Execution Gates

1. Implement tasks in order with the TDD loop and commit boundary shown in each task.
2. Run an independent specification-compliance review and code-quality review after every task before starting the next task.
3. Treat Task 8 as a hard external-reality gate; do not start Task 9 unless all three observed calls pass.
4. Require fresh owner authorization for every live call and every external publication action.
5. Keep private evidence outside Git and publish only an allowlisted sanitized projection.
6. Do not mark a skipped, replay-only, stale, unavailable, or unexecuted check as passing.

## Final Definition of Done

- Every acceptance criterion maps to passing executable evidence or a truthful manual record.
- The full offline verification succeeds from a clean checkout with a frozen lockfile and no credentials.
- The exact release commit passes local verification, GitHub CI, replay deployment smoke, secret scanning, and privacy review.
- The public replay contains no mutation capability, secrets, phone number, participant identity, raw transcript, or consent evidence.
- The local operator flow produces one authorized call, a human-confirmed deterministic result, and exactly four atomic artifacts.
- The public repository, replay URL, tag, GitHub Release, contribution PR, video, and Devpost submission all point to the same reviewed release candidate.
