# SupplySignal AI Ambiguous Create Incident and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the approved no-retry recovery procedure for an ambiguous
CALL-E create without a Developer API `call_id`, record the sanitized Ukrainian
incident observation, and bind the future Task 13 UI to that safety contract.

**Architecture:** Keep the current runtime, three-endpoint CALL-E boundary,
state machine, persistence, timeout, and one-create-POST behavior unchanged.
Implement Amendment A20 only through the operator runbook, one sanitized
time-sensitive research record, and precise corrections to the existing main
implementation plan.

**Tech Stack:** Markdown, Git, Prettier `3.9.6`, PowerShell-compatible
repository checks.

## Global Constraints

- The approved authority is
  `docs/superpowers/specs/2026-08-11-supplysignal-ai-ambiguous-create-incident-recovery-design.md`.
- Keep the runtime, API routes, domain types, persistence schema, dependencies,
  provider configuration, 15-second create timeout, and CI unchanged.
- Preserve the absolute one-create-POST boundary from Correction A12.1.
- A later `CALL_STARTING` or `RECONCILING` invocation without a stored
  Developer API `call_id` performs no provider request and requires manual
  resolution.
- A Billing reference, local run ID, and optional MCP or CLI identifier are not
  interchangeable with a Developer API `call_id`.
- The Ukrainian call is sanitized incident evidence, not a formal Task 8 PASS.
- Task 9 remains blocked until a separately authorized preflight has one
  authoritative `call_id`, a terminal GET result, consistent human
  observation, and independently reviewed sanitized evidence.
- Do not add artificial behavior tests for documentation-only changes.
- Do not place a live call, access CALL-E, inspect private runtime evidence,
  use credentials, open a browser, push, deploy, or publish externally.
- Do not commit a full phone number, participant identity, consent evidence,
  API key, full Billing reference, raw transcript, raw provider envelope, or
  native private path.
- Keep all repository content and commit messages in English.

## File Structure

- `docs/operator-runbook.md` — authoritative attended-operator recovery
  procedure and private support-escalation checklist.
- `docs/research/2026-08-11-call-e-ambiguous-create-observation.md` — sanitized,
  time-sensitive record of the Ukrainian ambiguous-create incident.
- `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md` —
  corrected Task 7 recovery semantics and mandatory future Task 13 UI/tests.
- `docs/superpowers/specs/2026-08-11-supplysignal-ai-ambiguous-create-incident-recovery-design.md`
  — approved Amendment A20 authority; read-only during implementation.

---

### Task 1: Document the operator recovery workflow and sanitized incident

**Files:**
- Modify: `docs/operator-runbook.md:44-46`
- Modify: `docs/operator-runbook.md:213-254`
- Create: `docs/research/2026-08-11-call-e-ambiguous-create-observation.md`

**Interfaces:**
- Consumes: Amendment A20, current `CALL_OUTCOME_PENDING` behavior, Correction
  A12.1, and the sanitized project-owner observation.
- Produces: an exact manual recovery checklist and a non-private incident record
  that Task 8 reviewers and future Task 13 implementers can cite.

- [ ] **Step 1: Confirm the documentation-only baseline**

Run:

```powershell
git status --short --branch
git log -1 --oneline
rg -n "CALL_OUTCOME_PENDING|RECONCILING|call_id|Recovery and stop conditions" docs/operator-runbook.md src/application/start-run.ts src/application/reconcile-run.ts
```

Expected: only the plan/specification work for this branch is present;
`startRun` maps ambiguous create to `CALL_OUTCOME_PENDING`, and
`reconcileRun` performs no provider operation without `callId`.

- [ ] **Step 2: Add the exact ambiguous-create workflow to the runbook**

Replace the short timeout paragraph near the top with a concise pointer to the
recovery section. Under `## Recovery and stop conditions`, add this subsection:

```markdown
### Ambiguous create without a Developer API call ID

If the one authorized `POST /v1/calls` returns `CALL_OUTCOME_PENDING` and the
private run has no Developer API `call_id`, the call may still ring, connect,
complete, or be billed. Do not rerun the harness, reset the permit, generate a
new idempotency key, or place another call for that run.

1. Preserve the private run directory and immutable run history.
2. Start a 10-minute observation window from the timeout or ambiguous response.
3. Monitor the consenting recipient's phone for a ring, conversation, delayed
   call, or duplicate call.
4. Review Billing and Call Records as informational surfaces. An empty screen
   does not prove that no call occurred.
5. Record approximate UTC timestamps, canonical country/language/region/locale,
   masked phone, observed duration and cost, physical outcome, visibility, and
   whether a delayed or duplicate call occurred.
6. If an authoritative Developer API `call_id` becomes available, continue
   GET-only reconciliation for that identifier.
7. If a call or charge exists without a Developer API `call_id`, leave the run
   in `RECONCILING` and escalate privately to CALL-E support.
8. If nothing is observed after 10 minutes, keep the run unresolved and request
   a separate owner decision. Never reuse this run or authorization.

The 10-minute period is observation only. It is not a retry window and does not
authorize polling an unknown identifier or making another provider request.
```

Follow it with this identifier table:

```markdown
| Identifier | Use |
| --- | --- |
| Developer API `call_id` | Authoritative GET reconciliation and event retrieval |
| SupplySignal AI run ID | Local workflow and persistence only |
| MCP or CLI identifier | Informational unless explicitly confirmed as the Developer API `call_id` |
| Billing reference | Private support context only; never submit or guess it as `call_id` |
```

Update the support-escalation paragraph so that a no-`call_id` incident sends
the full Billing reference only in a private support channel. Public reports
may include no more than a masked suffix. Keep the existing API-key and
full-phone prohibitions.

- [ ] **Step 3: Write the sanitized Ukrainian incident observation**

Create
`docs/research/2026-08-11-call-e-ambiguous-create-observation.md` with this
structure and bounded facts:

```markdown
# CALL-E ambiguous create without Developer API call ID

**Recorded:** 2026-08-11

**Status:** Time-sensitive incident observation; not a formal preflight PASS

**Application commit:** `e17b6e3`

**Reviewed contract:** CALL-E OpenAPI `0.6.0`

## Sanitized observation

One separately authorized `UA/uk-UA` answered call was submitted through the
guarded preflight. The create request timed out after the configured 15-second
client boundary without returning a Developer API `call_id`. The application
reported `CALL_OUTCOME_PENDING`, preserved `RECONCILING`, and made no retry or
redial.

Approximately one minute later, the consenting participant received the call.
The agent spoke Ukrainian and responded interactively. Billing later showed a
Ukraine call lasting approximately 1 minute 41 seconds with a cost of $0.05.
Only the masked Billing-reference suffix `d04c` is retained here. A read-only
GET using that Billing reference returned `404`, so it was not treated as a
Developer API `call_id`.

## Trust classification

The observation supports only that the Ukraine route and Ukrainian-language
conversation worked. It does not prove the authoritative provider resource,
terminal status, transcript, evidence, or structured result. The incident is
therefore not a Task 8 PASS, and Task 9 remains blocked.

## Recovery decision

- The run remains unresolved and is never retried or redialed.
- Billing and Dashboard records are informational, not reconciliation
  authority.
- Support escalation must seek the authoritative Developer API `call_id` and
  terminal result without disclosing a credential or full phone publicly.
- A future formal preflight requires fresh owner authorization and must return
  an authoritative `call_id` plus a terminal GET result consistent with human
  observation.

## Privacy

This record excludes the full phone number, participant identity, consent
evidence, API key, full Billing reference, raw transcript, audio, provider
envelope, and private filesystem path.
```

Do not add exact participant details, the full Billing reference, or private
runtime files while expanding the prose.

- [ ] **Step 4: Run focused documentation checks**

Run:

```powershell
$files = @(
  'docs/operator-runbook.md',
  'docs/research/2026-08-11-call-e-ambiguous-create-observation.md'
)
corepack pnpm exec prettier --check $files
git diff --check
rg -n '10-minute|Developer API `call_id`|Billing reference|Task 9 remains blocked|no retry|no retry or redial' $files
```

Expected: Prettier and diff checks exit `0`; the required recovery terms are
present in both documents.

- [ ] **Step 5: Perform the privacy and contradiction review**

Run:

```powershell
$files = @(
  'docs/operator-runbook.md',
  'docs/research/2026-08-11-call-e-ambiguous-create-observation.md'
)
rg -n "(sk-[A-Za-z0-9_-]+|Bearer\s+\S+|\+380[0-9]{9}|\+254[0-9]{9}|\+1[0-9]{10}|\b[A-Fa-f0-9]{32}\b|[A-Za-z]:\\)" $files
rg -n "retry|redial|repeat create|new idempotency" $files
git diff -- $files
git status --short
```

Expected: the sensitive-pattern scan returns no matches; every retry-related
match is an explicit prohibition; the working diff contains only the two
authorized documentation files. The already committed specification and plan
remain separate documentation-only commits in branch history.

- [ ] **Step 6: Commit the operator documentation**

```powershell
git add -- docs/operator-runbook.md docs/research/2026-08-11-call-e-ambiguous-create-observation.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs: record ambiguous call recovery"
```

**Review gate:** Confirm the record is truthful but cannot identify the
participant or reconstruct the full phone or Billing reference. Confirm the
procedure contains no action capable of producing another call.

---

### Task 2: Correct the main plan and bind the future UI

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md:86`
- Modify: `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md:1050-1125`
- Modify: `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md:1129-1224`
- Modify: `docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md:1587-1655`

**Interfaces:**
- Consumes: Amendment A20, Correction A12.1, the current Task 7 runtime, and
  Task 13's existing five-stage UI boundary.
- Produces: an execution plan that cannot instruct a future worker to repeat
  create, and exact component/browser acceptance criteria for no-ID
  `RECONCILING`.

- [ ] **Step 1: Remove obsolete recovery-POST instructions from Task 7**

Change the route description from `start or safely resume call creation` to:

```markdown
- `app/api/runs/[runId]/start/route.ts` — atomically claim the only call-creation attempt; later no-ID states require manual recovery.
```

Replace the ambiguous-create regression example with:

```ts
it("never retries create after an ambiguous outcome", async () => {
  await expect(startRun(deps, runId)).rejects.toMatchObject({
    code: "CALL_OUTCOME_PENDING",
  });
  await expect(startRun(deps, runId)).rejects.toMatchObject({
    code: "CALL_OUTCOME_PENDING",
  });
  expect(calle.createKeys).toEqual([expectedKey]);
});
```

Replace Task 7 Step 4's obsolete no-ID recovery sentence with:

```markdown
Poll only a stored Developer API `call_id`. Without a stored ID,
`CALL_STARTING` and `RECONCILING` return bounded `CALL_OUTCOME_PENDING` for
manual resolution and perform no provider request. Never repeat create after
the claim-owning invocation ends. Map provider `completed` to
`PROVIDER_REPORTED_TERMINAL`, not application completion.
```

Preserve the stable key and request digest as evidence, but do not describe
their reuse as permission for another POST.

- [ ] **Step 2: Bind Task 8 and Task 9 to the incident classification**

In Task 8, add these requirements to the stop decision and evidence step:

```markdown
An ambiguous create without a Developer API `call_id` is incident evidence,
not a successful scenario. Apply the runbook's 10-minute observation window,
preserve the unresolved run, record only the sanitized observation, and stop
before Task 9. A ring, conversation, Billing charge, Dashboard record, or
support ticket cannot substitute for the authoritative `call_id` and terminal
GET resource.
```

Keep the existing hard gate before Task 9. Do not mark the Ukrainian
observation or any other no-ID call as passing.

- [ ] **Step 3: Add the no-ID `RECONCILING` contract to Task 13**

Expand Task 13 Step 1 so component tests require:

```tsx
expect(screen.getByText("Call response timed out")).toBeVisible();
expect(
  screen.getByText(/The call may still occur even though no Developer API call ID was received/),
).toBeVisible();
expect(screen.getByText("Developer API call ID: Not received")).toBeVisible();
expect(screen.queryByRole("button", { name: /retry|redial|start another call/i })).not.toBeInTheDocument();
expect(reconcileExistingCall).not.toHaveBeenCalled();
```

Require the recovery panel to display masked recipient, canonical profile,
approximate UTC attempt time, the 10-minute checklist, and the Billing-reference
explanation. Its only actions are **View recovery instructions**, **Record
observation**, **Copy sanitized support summary**, and **Stop future
processing**.

These labels establish the future UI contract but do not authorize a new write
route or persistence field. If Task 13 begins without an approved bounded port
for recording the observation, stop and obtain a narrow runtime amendment
instead of inventing storage or overloading human confirmation.

Expand Task 13 Step 4 with the exact bounded copy:

```tsx
<section aria-labelledby="call-recovery-heading" role="status">
  <h2 id="call-recovery-heading">Call response timed out</h2>
  <p>
    The call may still occur even though no Developer API call ID was received.
    Do not start another call. Monitor the recipient phone and CALL-E Billing
    for 10 minutes, then follow the recovery instructions.
  </p>
</section>
```

State explicitly that refresh/restart preserves this unresolved presentation,
no-ID reconciliation starts no browser timer and performs no provider call,
and **Stop future processing** never claims to cancel an active call.

- [ ] **Step 4: Add future browser acceptance coverage**

Extend Task 15's negative E2E instructions with this exact scenario:

```ts
test("preserves an ambiguous call without offering another call", async ({ page }) => {
  const reconcileRequests: string[] = [];
  await page.route("**/api/runs/*/reconcile", async (route) => {
    reconcileRequests.push(route.request().url());
    await route.abort();
  });
  await seedRun({ status: "RECONCILING", callId: undefined });
  await page.goto("/");
  await expect(page.getByText("Call response timed out")).toBeVisible();
  await expect(page.getByText("Developer API call ID: Not received")).toBeVisible();
  await expect(page.getByRole("button", { name: /retry|redial|start another call/i })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Call response timed out")).toBeVisible();
  expect(reconcileRequests).toEqual([]);
});
```

Also require the copied support summary to exclude full phone, credential, full
Billing reference, native path, raw provider data, and participant identity.

- [ ] **Step 5: Prove the plan no longer contradicts the runtime**

Run:

```powershell
$plan = 'docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md'
rg -n "safely resume call creation|safely repeat create|reuses the original key after an ambiguous|createKeys.*expectedKey.*expectedKey" $plan
rg -n "no provider request|manual resolution|Call response timed out|Developer API call ID: Not received|10-minute|Task 9" $plan
corepack pnpm exec prettier --check $plan
git diff --check
```

Expected: the obsolete-instruction search returns no matches; the required
contract search finds Task 7, Task 8/9, Task 13, and Task 15 coverage; formatting
and diff checks exit `0`.

- [ ] **Step 6: Run the final documentation and privacy gates**

Run:

```powershell
$files = @(
  'docs/operator-runbook.md',
  'docs/research/2026-08-11-call-e-ambiguous-create-observation.md',
  'docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md',
  'docs/superpowers/plans/2026-08-12-supplysignal-ai-ambiguous-create-incident-recovery-implementation.md',
  'docs/superpowers/specs/2026-08-11-supplysignal-ai-ambiguous-create-incident-recovery-design.md'
)
corepack pnpm exec prettier --check $files
git diff --check
$markers = @('T' + 'BD', 'T' + 'ODO', 'FIX' + 'ME', 'implement' + ' later', 'fill in' + ' details')
Select-String -Path $files -Pattern $markers
rg -n "(sk-[A-Za-z0-9_-]+|Bearer\s+\S+|\+380[0-9]{9}|\+254[0-9]{9}|\+1[0-9]{10}|\b[A-Fa-f0-9]{32}\b|[A-Za-z]:\\)" $files
$base = git merge-base main HEAD
git diff --name-only "$base..HEAD"
git status --short
```

Expected: format and diff checks exit `0`; placeholder and sensitive-pattern
searches return no matches; the branch contains documentation only. The exact
diff may contain the specification, this plan, runbook, research observation,
and corrected main plan—no runtime, test, configuration, dependency, or secret
file.

- [ ] **Step 7: Commit the corrected main plan**

```powershell
git add -- docs/superpowers/plans/2026-08-08-supplysignal-ai-implementation.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs: require safe reconciling UI"
```

**Review gate:** A specification reviewer must confirm every Amendment A20
acceptance criterion is represented. A quality reviewer must confirm the main
plan contains no path to another provider create call, no privacy regression,
and no future UI action that implies retry, cancellation, success, or confirmed
failure. Do not resume Task 8 live execution or start Task 9 during this work.

---

## Completion Handoff

The documentation implementation is complete only when:

1. Task 1 and Task 2 each have a focused documentation commit.
2. The specification, runbook, research observation, and main plan agree on the
   10-minute observation window, identifier distinctions, no-retry boundary,
   and Task 9 hard stop.
3. The future Task 13 and Task 15 requirements contain the exact recovery copy,
   safe actions, forbidden actions, zero-provider-operation assertion, refresh
   behavior, and sanitized support-summary boundary.
4. All applicable formatting, diff, placeholder, contradiction, privacy, and
   status checks pass truthfully.
5. Both independent read-only reviews pass with no unresolved Critical or
   Important findings.
6. No live CALL-E, phone, credential, browser, provider lookup, push,
   deployment, or publication action occurred.

After completion, Task 9 remains blocked. A future live preflight requires
fresh project-owner authorization and is outside this plan.
