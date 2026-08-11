# SupplySignal AI Ukraine Recipient Profile Amendment

**Status:** Approved design

**Date:** 2026-08-11

**Scope:** Add guarded Ukraine English and Ukrainian recipient profiles beside
the existing United States and Kenya profiles.

**Correction A17:** The approved Ukraine mask is `+380 **-***-1234`. It
accounts for the exact nine national digits required by
`^\+380[1-9]\d{8}$` and supersedes the earlier eleven-position draft mask.

## 1. Product authority and scope

This amendment extends the approved SupplySignal AI vertical slice with two
canonical Ukraine recipient profiles. It does not change the purchase-order
scenario, provider lifecycle, persistence, authorization model, risk logic,
artifacts, public replay, or number of permitted CALL-E create attempts.

CALL-E currently lists Ukraine as a supported recipient region with English
and Ukrainian language support. The listed line is international and primarily
intended for testing. A production deployment that requires a local Ukrainian
line remains outside this amendment and requires coordination with CALL-E.

Sources reviewed on 2026-08-11:

- [CALL-E supported regions and languages](https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages)
- [CALL-E OpenAPI 0.6.0](https://docs.heycall-e.com/openapi/calle.openapi.yaml)

Implementation and automated verification must not place a real call. A live
Ukraine preflight remains a later, separately authorized external action.

## 2. Canonical recipient profiles

`src/domain/call-recipient.ts` remains the single source of truth for supported
recipient profiles. The exact allowlist becomes:

| Country | Strict E.164 pattern | Display mask | Region | Locale | Language |
| --- | --- | --- | --- | --- | --- |
| United States | `^\+1[2-9]\d{9}$` | `+1 ***-***-1234` | `US` | `en-US` | English |
| Kenya | `^\+254[1-9]\d{8}$` | `+254 ***-**-1234` | `KE` | `en-KE` | English |
| Ukraine | `^\+380[1-9]\d{8}$` | `+380 **-***-1234` | `UA` | `en-UA` | English |
| Ukraine | `^\+380[1-9]\d{8}$` | `+380 **-***-1234` | `UA` | `uk-UA` | Ukrainian |

The Ukraine pattern accepts only `+380` followed by exactly nine digits, with
a non-zero first national digit. It rejects whitespace, separators,
parentheses, extensions, local-format numbers, a leading national zero, and
incorrect lengths. It validates the approved structural E.164 boundary; it
does not attempt to maintain an allocation list of carrier prefixes.

The deterministic Ukraine mask reveals only the country code and final four
digits. The full number remains server-only and private.

The persisted recipient is a strict discriminated supported-profile value.
Every phone, region, locale, and mask combination must match one exact profile.
There is no fallback to another country or language.

## 3. Language selection boundary

The guarded preflight reads a new server-only environment variable named
`SUPPLIER_TEST_LANGUAGE`.

Its rules are fail-closed:

- a `+380` recipient requires exactly `English` or `Ukrainian`;
- `English` selects `UA/en-UA`;
- `Ukrainian` selects `UA/uk-UA`;
- a United States or Kenya recipient requires the variable to be absent; and
- missing, unknown, padded, differently cased, or otherwise extra language
  configuration is rejected.

Invalid language configuration produces the new bounded error code
`UNSUPPORTED_RECIPIENT_LANGUAGE` before permit consumption, run creation,
provider construction, or network access. Public output never copies the raw
environment value.

The environment variable selects an allowlisted language, not an arbitrary
region or locale. `region` and `locale` are still canonical domain outputs and
are never accepted as unrestricted command-line or environment inputs.

## 4. Localized CALL-E task

`src/adapters/calle/request.ts` continues to accept only a canonical plain-data
recipient and copies its exact `region` and `locale` into the one-recipient
CALL-E request. It must not infer a profile from unvalidated fields or add a
hardcoded country, language, fallback, retry, or alternate provider route.

The task builder owns two semantically equivalent, bounded templates:

- `en-US`, `en-KE`, and `en-UA` use the current English task text unchanged;
- `uk-UA` uses a fully Ukrainian disclosure, questions, and polite ending.

Both templates preserve the same requirements:

1. Begin with the complete disclosure that the caller is an AI-assisted agent,
   the supplier scenario is fictional, and the call may be recorded for an
   approved hackathon demonstration.
2. After disclosure, keep every spoken turn to one or two short, natural
   sentences.
3. Ask only one question at a time and wait for the recipient's answer.
4. Do not read the full purchase order at once or repeat confirmed facts.
5. Ask only for the approved order facts, delay reason, human-follow-up need,
   and inability-to-fulfill signal.
6. If the recipient declines, end politely and do not invent answers.
7. If nobody answers or a fact is absent, do not infer supplier facts.

The strict `recipient_result_schema`, metadata keys, domain values, risk logic,
and generated artifact field names remain in English. Localization changes the
spoken interaction only and must not create a second structured-data contract.

The following contracts remain unchanged:

- CALL-E OpenAPI `0.6.0` and the three approved REST endpoints;
- stable `Idempotency-Key` and the one-POST lifecycle;
- response validation and provider status mapping;
- deterministic application validation; and
- persistence, OpenAI, artifacts, and public replay behavior.

## 5. Guarded live preflight

The guarded CLI remains the only live entry point. Before the exact
`AUTHORIZE ONE CALL` phrase, it displays only:

- scenario;
- masked phone;
- canonical country;
- canonical language; and
- canonical region and locale.

The API key, full phone number, participant identity, consent evidence, raw
provider data, and private filesystem paths are never displayed.

The existing safety boundary remains unchanged:

- an attended interactive terminal is required;
- one atomic process-wide permit is reserved before any interactive wait;
- each process permits at most one CALL-E create attempt;
- there is no retry or redial;
- an ambiguous or timed-out create remains `CALL_OUTCOME_PENDING` and never
  authorizes another POST;
- private evidence remains below the repository-anchored ignored directory;
- bounded polling, event pagination, filesystem attestation, and create-only
  publication remain in force; and
- automated tests and required CI remain offline and credential-free.

Before every separately authorized Ukraine live preflight, the operator must:

1. Confirm on the same day that CALL-E still lists the intended `UA` language.
2. Confirm that the participant owns the reviewed `+380` number and is ready.
3. Obtain consent to the AI-assisted call and private recording.
4. Separately obtain consent for any reviewed public excerpt.
5. Review applicable disclosure and recording requirements in both locations.
6. Obtain fresh project-owner authorization for exactly one named scenario and
   one call with no retry or redial.

Kenya remains an approved backup profile. No prior ambiguous call may be
retried or treated as authorization for a Ukraine call.

## 6. Operator documentation

`docs/operator-runbook.md` will document:

- all four canonical country/language profiles;
- the strict Ukraine format and deterministic mask;
- `SUPPLIER_TEST_LANGUAGE` setup and fail-closed behavior;
- sanitized pre-authorization verification;
- Ukraine's international test-line limitation;
- the same-day CALL-E support check; and
- unchanged stop, recovery, evidence, credential-cleanup, and no-retry rules.

The runbook must not contain a participant number, identity, consent record,
credential, raw transcript, provider envelope, or unrestricted native path.

## 7. Error and privacy behavior

Domain and preflight validation remain strict and fail-closed:

- malformed or unsupported numbers produce
  `UNSUPPORTED_RECIPIENT_REGION` at the guarded preflight boundary;
- missing, extra, or unsupported language configuration produces
  `UNSUPPORTED_RECIPIENT_LANGUAGE`;
- inconsistent or unsafe CALL-E request input produces the existing bounded
  `CALL_CREATION_FAILED`; and
- ambiguous live outcomes continue to produce `CALL_OUTCOME_PENDING`.

Raw Zod errors, dependency errors, phone numbers, language input, credentials,
native paths, prompt internals, and provider traces are not copied into public
errors or output.

No new endpoint, dependency, credential, retry policy, mutable provider,
permit-reset mechanism, or alternate live execution path is introduced.

## 8. TDD and verification

Implementation follows separate focused RED/GREEN cycles.

### Domain tests

- preserve all current United States and Kenya cases;
- accept synthetic lower- and upper-boundary-shaped Ukraine values without
  committing a real participant number;
- reject wrong length, a zero first national digit, local format, whitespace,
  separators, extensions, and other country codes;
- verify the exact Ukraine mask and both `UA` locale profiles;
- reject every cross-profile phone, region, locale, and mask mismatch;
- require an explicit language selection for Ukraine; and
- preserve plain-data and accessor safety with zero getter reads.

Phone-shaped test values must be assembled from non-sensitive segments so no
participant or known real phone number is committed.

### CALL-E request tests

- prove exact `UA/en-UA` and `UA/uk-UA` request mappings;
- prove current English request text remains unchanged;
- prove the Ukrainian task has the complete localized disclosure, concise-turn
  rule, one-question rule, decline behavior, and no-invention behavior;
- prove an inconsistent recipient fails before `fetch`; and
- preserve idempotency, one-recipient, metadata, result-schema, timeout,
  redirect, and no-retry regressions.

### Guarded preflight tests

- accept both Ukraine languages through the guarded boundary;
- reject missing or unknown Ukraine language configuration with zero POSTs;
- reject any language override for United States or Kenya with zero POSTs;
- reject malformed Ukraine and unsupported-country numbers with zero POSTs;
- verify sanitized country, language, region, locale, and mask output;
- execute exactly one local fake POST for each Ukraine composition test; and
- preserve confirmation, process-wide permit, alternate-CWD confinement,
  private-evidence publication, cleanup, and post-commit protections.

Verification order is focused tests, an explicit affected-file selection, full
`pnpm verify`, available repository secret and build-clean checks, diff and
status inspection, and independent specification and quality reviews. A broad
test filter is trusted only after its selected files are printed or otherwise
proven. Live CALL-E execution is excluded from every implementation gate.

## 9. Expected implementation files

- `src/domain/call-recipient.ts`
- `src/domain/call-recipient.test.ts`
- `src/adapters/calle/request.ts`
- `src/adapters/calle/request.test.ts`
- `scripts/live-preflight.ts`
- `scripts/live-preflight.test.ts`
- `docs/operator-runbook.md`
- the implementation plan for this amendment

Persistence, state machines, OpenAI, risk logic, artifacts, UI, dependencies,
CI, external endpoints, live provider execution, and hosted deployment are out
of scope.

## 10. Acceptance criteria

1. Existing United States and Kenya behavior remains unchanged.
2. A strict Ukraine recipient maps only to `UA/en-UA` or `UA/uk-UA` according
   to the exact approved language selection.
3. Cross-profile, malformed, unsupported, missing-language, and extra-language
   inputs fail before network access.
4. The adapter maps only canonical recipients and never applies a fallback or
   hardcoded country override.
5. The Ukrainian spoken task preserves the complete disclosure and all English
   safety semantics while using concise Ukrainian turns and one question at a
   time.
6. Structured results, deterministic validation, risk logic, and artifact
   contracts remain English and unchanged.
7. The preflight displays only sanitized canonical values before authorization.
8. The preflight retains one create POST at most, no retry, and no redial.
9. Full offline verification and both independent reviews pass without
   weakening existing gates.
10. Repository content contains no participant phone number, identity, consent
    evidence, credential, raw transcript, or provider envelope.
11. Implementation and automated verification place no real call.
12. A Ukraine live preflight remains a later, separately authorized action
    after implementation review and merge.
