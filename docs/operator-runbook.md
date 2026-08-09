# SupplySignal AI Operator Runbook

This runbook covers the private, local CALL-E truthfulness preflight. The
preflight can place a real phone call and must never be used as a routine test
or from CI. The public replay cannot place calls.

## Safety boundary

Every invocation permits at most one call creation attempt. The harness:

- accepts exactly one scenario: `answered`, `declined`, or `no_answer`;
- reads the recipient only from the server-side `SUPPLIER_TEST_PHONE`
  environment variable;
- accepts only a United States E.164 number with `US` and `en-US`;
- requires an interactive terminal and the exact phrase
  `AUTHORIZE ONE CALL`;
- uses the existing CALL-E adapter, stored call identifier, and reconciliation
  lifecycle;
- never retries or redials the create request; and
- stores private run evidence only below ignored `tmp/preflight-private/`.

Do not rerun a scenario to recover from a timeout or an empty CALL-E Dashboard.
An ambiguous response may still mean that the provider created the call. Keep
the private run directory intact and resolve the existing call manually.

## Before each scenario

Obtain fresh project-owner authorization for this specific call. Plan approval
or authorization for an earlier scenario is not sufficient.

Confirm all of the following with the participant:

1. The participant is ready at the agreed time and owns the reviewed US phone
   number.
2. The participant consents to the AI-assisted call.
3. The participant consents to recording for the private preflight.
4. The participant consents to the separately reviewed excerpt being used in
   the public demo video.
5. The participant understands that the supplier, order, quantities, dates,
   and operational situation are fictional.
6. The operator has checked the disclosure and recording requirements that
   apply in both locations.

Keep consent evidence and the participant's identity outside the repository.
Never paste either value into an issue, commit, screenshot, public report, or
Discord message.

## Local Windows setup

Use a clean PowerShell window in the repository root. Confirm that no previous
preflight process is running. Install the frozen dependencies without changing
the lockfile:

```powershell
corepack pnpm install --frozen-lockfile
```

Enter both private values directly into the current PowerShell process. Do not
put them in command arguments, PowerShell history, screenshots, committed
files, or chat messages:

```powershell
$env:CALLE_API_KEY = Read-Host "CALL-E API key"
$env:SUPPLIER_TEST_PHONE = Read-Host "Consenting US recipient in E.164 format"
```

The reviewed runtime contract is CALL-E OpenAPI `0.6.0`. The application uses
the Developer REST API, not CLI login, MCP execution, webhooks, batch calls, or
the Dashboard as an authoritative source.

Before any live authorization, prove the guard is active with credentials
absent in a separate PowerShell window:

```powershell
Remove-Item Env:CALLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_PHONE -ErrorAction SilentlyContinue
corepack pnpm tsx scripts/live-preflight.ts --scenario answered
```

The command must stop with `PREFLIGHT_CONFIGURATION_REQUIRED`. It must not ring
a phone or contact CALL-E.

## Execute one authorized scenario

Run only the scenario that the project owner authorized immediately before the
call:

```powershell
corepack pnpm tsx scripts/live-preflight.ts --scenario answered
```

or:

```powershell
corepack pnpm tsx scripts/live-preflight.ts --scenario declined
```

or:

```powershell
corepack pnpm tsx scripts/live-preflight.ts --scenario no_answer
```

Verify the displayed scenario and masked number. If either is wrong, do not
authorize. Otherwise type exactly:

```text
AUTHORIZE ONE CALL
```

The phrase authorizes one create attempt in that process only. A second
scenario requires a new process, fresh owner authorization, and another review
of the masked number.

## Physical observation record

Use a private note outside Git to record:

- local start and end timestamps with timezone;
- whether and when the phone rang;
- whether the participant answered, explicitly declined, or did not answer;
- whether both participants could hear usable audio;
- whether any unexpected second or delayed call occurred during the documented
  observation window;
- the private authoritative call identifier when available; and
- whether the API-created call appeared in Dashboard history.

For `answered`, the participant follows the Northstar Components scenario: 350
units ready, 150 delayed, a promised date after the required date, component
shortage as the reason, and human follow-up required.

For `declined`, the participant explicitly declines after the AI disclosure and
does not provide supplier facts.

For `no_answer`, the participant does not answer. The result must contain no
invented transcript or supplier facts. Continue observing the phone for at
least ten minutes after the provider reports a terminal result and record the
exact observation-window end time.

## Evidence handling

The harness prints only a sanitized result with the scenario, masked phone,
bounded statuses, and event count. Private records may contain a full phone,
call identifier, transcript, or structured provider result and therefore stay
under:

```text
tmp/preflight-private/
```

That directory is Git-ignored. Do not move its contents into `docs/`,
`examples/`, screenshots, the public replay, or the demo video. The later
public preflight report may contain only an allowlisted projection: scenario,
date, application commit, OpenAPI version, call-ID hash, sanitized timestamps,
observed-versus-reported comparison, Dashboard visibility as informational
context, and the final pass/fail decision.

## Recovery and stop conditions

- `PREFLIGHT_CONFIGURATION_REQUIRED`: set the missing values locally, then
  start only after the owner authorizes the intended call.
- `PREFLIGHT_INTERACTIVE_REQUIRED`: use an attended local terminal. Never pipe
  or automate the confirmation phrase.
- `AUTHORIZATION_REQUIRED`: the exact phrase was not entered. No call was
  attempted.
- `UNSUPPORTED_RECIPIENT_REGION`: review the number. This vertical slice does
  not call non-US numbers.
- `CALL_OUTCOME_PENDING`: do not rerun the harness. Preserve private state and
  reconcile or escalate the existing call.
- Ringing without usable audio, a physical/provider outcome conflict, invented
  transcript or supplier facts, or a delayed duplicate call: stop expansion.
  Preserve private evidence and request an owner-approved design amendment
  before Task 9.

Dashboard `Recents` and `Search calls` may omit API-created calls. An empty
Dashboard is not evidence that no call occurred and never authorizes a second
call. SupplySignal AI's stored `call_id` and `GET /v1/calls/{call_id}` are the
reconciliation authority; events and Dashboard visibility are informational.

When escalating privately to CALL-E support, provide the call identifier,
approximate timestamp and timezone, recipient country and language, OpenAPI
version, sanitized expected and actual behavior, and whether the issue occurred
through the API or Dashboard. Never include the API key or full phone number in
a public channel.

## Credential cleanup

After the authorized scenario finishes, remove both values from the current
PowerShell process:

```powershell
Remove-Item Env:CALLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_PHONE -ErrorAction SilentlyContinue
```

Close the terminal before recording screenshots or the public demo.
