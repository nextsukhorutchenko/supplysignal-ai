# SupplySignal AI Operator Runbook

This runbook covers the private, local CALL-E truthfulness preflight. The
preflight can place a real phone call and must never be used as a routine test
or from CI. The public replay cannot place calls.

## Safety boundary

Every process permits at most one call creation attempt. The only live entry
point is the attended CLI command documented below. It has no injectable
provider, prompt, terminal, or HTTP options. One atomic permit is reserved
before any interactive wait. The harness:

- accepts exactly one scenario: `answered`, `declined`, or `no_answer`;
- reads the recipient only from the server-side `SUPPLIER_TEST_PHONE`
  environment variable;
- accepts only the approved United States, Kenya, and Ukraine profiles listed below;
- requires an interactive terminal and the exact phrase
  `AUTHORIZE ONE CALL`;
- uses the existing CALL-E adapter, stored call identifier, and reconciliation
  lifecycle;
- never retries or redials the create request; and
- stores private run evidence only below the repository-anchored, ignored
  `tmp/preflight-private/<run-id>/` directory.

- The single create POST waits up to 30 seconds for its response. Call and event
  reads remain bounded to 15 seconds. The longer create wait is not a retry or
  redial permission.
- `PROVIDER_RESULT_INVALID` means a terminal provider snapshot failed the
  mechanical Task 8 integrity boundary. Preserve the private run, do not publish
  a success artifact, do not retry or redial, record the scenario as failed, and
  escalate only sanitized facts.

| Country       | Strict E.164 pattern | Display mask       | Region | Locale  | Language  |
| ------------- | -------------------- | ------------------ | ------ | ------- | --------- |
| United States | `^\+1[2-9]\d{9}$`    | `+1 ***-***-1234`  | `US`   | `en-US` | English   |
| Kenya         | `^\+254[1-9]\d{8}$`  | `+254 ***-**-1234` | `KE`   | `en-KE` | English   |
| Ukraine       | `^\+380[1-9]\d{8}$`  | `+380 **-***-1234` | `UA`   | `en-UA` | English   |
| Ukraine       | `^\+380[1-9]\d{8}$`  | `+380 **-***-1234` | `UA`   | `uk-UA` | Ukrainian |

The harness derives `region` and `locale` from the validated canonical
recipient profile; they are not free-form operator inputs. For Ukraine, the
canonical locale depends on both the validated `+380` phone and the exact
allowlisted `SUPPLIER_TEST_LANGUAGE`. That variable is required only for
Ukraine and must be absent for United States and Kenya. Kenya and Ukraine
currently use international lines primarily intended for testing. Before every
Kenyan or Ukrainian live preflight, perform a same-day check that the
[official CALL-E supported-regions table](https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages)
still lists `KE + English` or `UA + selected language`, respectively, as
supported.

For a timeout or an ambiguous CALL-E response, follow
[Ambiguous create without a Developer API call ID](#ambiguous-create-without-a-developer-api-call-id).

## Before each scenario

Obtain fresh project-owner authorization for this specific call. Plan approval
or authorization for an earlier scenario is not sufficient.

Confirm all of the following with the participant:

1. The participant is ready at the agreed time and owns the reviewed supported
   phone number.
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
$env:SUPPLIER_TEST_PHONE = Read-Host "Consenting US, Kenya, or Ukraine recipient in strict E.164 format"
```

Set the recipient-language policy in the same PowerShell process:

```powershell
# United States or Kenya
Remove-Item Env:SUPPLIER_TEST_LANGUAGE -ErrorAction SilentlyContinue

# Ukraine English
$env:SUPPLIER_TEST_LANGUAGE = "English"

# Ukraine Ukrainian
$env:SUPPLIER_TEST_LANGUAGE = "Ukrainian"
```

The reviewed runtime contract is CALL-E OpenAPI `0.6.0`. The application uses
the Developer REST API, not CLI login, MCP execution, webhooks, batch calls, or
the Dashboard as an authoritative source.

Before any live authorization, prove the guard is active with credentials
absent in a separate PowerShell window:

```powershell
Remove-Item Env:CALLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_PHONE -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_LANGUAGE -ErrorAction SilentlyContinue
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

Verify the displayed scenario, country, language, region, locale, and masked
number. If any value is wrong, do not authorize. Otherwise type exactly:

```text
AUTHORIZE ONE CALL
```

The phrase authorizes one create attempt in that process only. A second
scenario requires a new process, fresh owner authorization, and another review
of the displayed country, language, and masked number.

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

The harness prints only a sanitized result with the scenario, country,
language, region, locale, masked phone, bounded statuses, and event count. Private records may
contain a full phone, call identifier, transcript, or structured provider
result and therefore stay under:

```text
tmp/preflight-private/<run-id>/
```

The root is derived from the script location, not the terminal's current
directory. The harness pins the canonical repository, private-root, session,
and run-store directory identities and re-attests them around private file
publication. Redirected, symbolic-link, junction, reparse, or replaced path
components fail bounded. The temporary and final names must resolve to the
same synchronized regular file before temporary-link removal commits the
result. Immediately before that commit, the harness re-reads the exact bytes
through the retained file handle and re-attests both path identities, metadata,
and link counts. Successful temporary-link removal is the final filesystem
operation; no later validation can turn an authoritative publication into a
reported failure. The final private result is bounded and create-only.

This protection assumes the repository and ignored private root are controlled
by this local application account. It detects identity changes observable
through Node's filesystem APIs; it does not claim protection from an arbitrary
hostile process with equivalent account and filesystem privileges. Keep the
repository private during the preflight and do not grant another process write
access to these directories.

## Provider result integrity checklist

Before accepting a terminal result as Task 8 evidence, verify all of the
following against the private run:

1. Confirm that `availableQuantity + delayedQuantity` exactly equals
   `confirmedQuantity`.
2. For `answered` and `declined`, confirm that the transcript contains at least
   one bounded, non-empty user turn.
3. For `no_answer`, require the exact sentinel: `contactOutcome` is
   `no_answer`; all three quantities are zero; `promisedDeliveryDate`,
   `delayReason`, `followUpRequired`, and `unableToFulfill` are `unknown`;
   `taskCompleted` is `false`; `completionConfidence` is `null`; and the
   transcript and evidence are empty.
4. Compare the private transcript with the structured `followUpRequired` value.
   An explicit request for human contact requires `yes`, an explicit refusal
   requires `no`, and an unstated answer requires `unknown`.

Any arithmetic, transcript, scenario, or follow-up conflict fails the scenario.
Preserve the private run, publish no success artifact, and keep Task 9 blocked.

The directory is Git-ignored. Do not move its contents into `docs/`,
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
- `UNSUPPORTED_RECIPIENT_REGION`: review the number. This vertical slice calls
  only the approved US, Kenya, and Ukraine profiles.
- `UNSUPPORTED_RECIPIENT_LANGUAGE`: remove `SUPPLIER_TEST_LANGUAGE` for US or
  Kenya, or set it to exactly `English` or `Ukrainian` for Ukraine. Do not
  authorize until the displayed country, language, region, and locale are
  correct.

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

| Identifier              | Use                                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| Developer API `call_id` | Authoritative GET reconciliation and event retrieval                     |
| SupplySignal AI run ID  | Local workflow and persistence only                                      |
| MCP or CLI identifier   | Informational unless explicitly confirmed as the Developer API `call_id` |
| Billing reference       | Private support context only; never submit or guess it as `call_id`      |

- `CALL_OUTCOME_PENDING` with a stored Developer API `call_id`: preserve
  private state and continue GET-only reconciliation. This includes bounded
  polling that ended while the call was still active and event pagination that
  remained incomplete after its safety limit; neither case prints a successful
  result.
- If `CALL_OUTCOME_PENDING` leaves both `result.json` and a
  `.result-*.tmp` file, treat both links as incomplete private state. Do not
  delete only the temporary name: that could make an uncommitted result appear
  complete. After the process is stopped and the owner confirms the evidence
  may be discarded, verify the exact repository-anchored run directory and
  remove that whole run directory manually. Never use cleanup as authorization
  to rerun the call. Automatic rollback removes a path only after a fresh
  directory and pathname check proves it still references the writer-owned
  inode; substituted or unverifiable paths are deliberately left for this
  manual review.
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
through the API or Dashboard. For a no-`call_id` incident, provide the full
Billing reference only in the private support channel; public reports may
include no more than a masked suffix. Never include the API key or full phone
number in a public channel.

## Credential cleanup

After the authorized scenario finishes, remove all three values from the current
PowerShell process:

```powershell
Remove-Item Env:CALLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_PHONE -ErrorAction SilentlyContinue
Remove-Item Env:SUPPLIER_TEST_LANGUAGE -ErrorAction SilentlyContinue
```

Close the terminal before recording screenshots or the public demo.
