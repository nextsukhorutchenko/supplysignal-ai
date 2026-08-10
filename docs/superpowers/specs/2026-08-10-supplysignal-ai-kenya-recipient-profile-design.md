# SupplySignal AI Kenya Recipient Profile Amendment

**Status:** Approved

**Approved by:** Project owner

**Design approval date:** 2026-08-10

**Supersedes:** Only the United-States-only recipient, request-mapping,
preflight, operator-copy, and future UI clauses in the approved SupplySignal AI
design and implementation plan

## 1. Purpose and scope

SupplySignal AI adds Kenya as a second supported English-language recipient
profile while retaining the existing United States profile. The amendment is
limited to strict recipient validation, canonical region and locale mapping,
CALL-E request construction, the guarded live preflight, tests, and operator
documentation.

The supported profiles are:

| Profile | Strict E.164 pattern | Region | Locale |
| --- | --- | --- | --- |
| United States | `^\+1[2-9]\d{9}$` | `US` | `en-US` |
| Kenya | `^\+254[1-9]\d{8}$` | `KE` | `en-KE` |

The Kenya pattern requires the `+254` country code followed by exactly nine
digits. The first national-significant digit cannot be zero. Local `07...`
format, spaces, punctuation, extensions, missing digits, and excess digits are
invalid.

CALL-E currently lists Kenya (`KE`, `+254`) with English support and an
international line primarily intended for testing. The reviewed OpenAPI `0.6.0`
contract describes `locale` as a BCP 47 hint. This amendment therefore pins the
canonical Kenyan English profile to `KE` and `en-KE`. The operator must confirm
that `KE + English` remains supported before each separately authorized live
preflight.

Sources reviewed on 2026-08-10:

- [CALL-E supported regions and languages](https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages)
- [CALL-E OpenAPI 0.6.0](https://docs.heycall-e.com/openapi/calle.openapi.yaml)

## 2. Preserved safety boundary

The existing disclosure, consent, fictional-data, privacy, one-call
authorization, one-create-attempt, no-retry, and no-redial guarantees remain
unchanged.

The Kenyan participant's consent is a necessary precondition, but it does not
authorize a call by itself. Every real CALL-E call still requires fresh,
run-specific project-owner authorization and the exact attended preflight
confirmation phrase. This amendment neither places a call nor automatically
authorizes live execution.

The previous ambiguous United States hotline run remains non-repeatable. It is
not resumed, retried, or redialed as part of this work.

Unsupported countries, malformed numbers, and inconsistent profile data fail
before run creation or network access. There is no fallback to a United States
route or alternate locale.

## 3. Canonical recipient profiles

`src/domain/call-recipient.ts` is the single source of truth for supported
recipient profiles. It owns an immutable allowlist for United States and Kenya
and performs the following operations:

1. Validate a plain-data recipient input without invoking accessors or reading
   inherited values.
2. Match the exact E.164 number against one supported profile.
3. Produce the canonical `region`, `locale`, and masked phone representation.
4. Reject unsupported numbers and every cross-profile mismatch.

The deterministic display masks are:

- United States: `+1 ***-***-1234`
- Kenya: `+254 ***-**-1234`

Only the country code and final four digits are visible. The full number
remains server-only and private.

The persisted recipient remains a discriminated supported-profile value. A
Kenyan number cannot coexist with `US` or `en-US`, and a United States number
cannot coexist with `KE` or `en-KE`. Region and locale are not accepted from
environment variables or command-line arguments.

## 4. CALL-E request mapping

`src/adapters/calle/request.ts` removes the hardcoded United States request
mapping. After canonical plain-data validation, it copies only
`input.recipient.region` and `input.recipient.locale` into the one-recipient
CALL-E request.

The resulting mappings are exact:

- United States number -> `region: "US"`, `locale: "en-US"`
- Kenyan number -> `region: "KE"`, `locale: "en-KE"`

The adapter never infers a profile from unvalidated request fields and never
accepts a caller-supplied region/locale mismatch. Rejected inputs use the
existing bounded `CALL_CREATION_FAILED` boundary before `fetch`.

The following contracts remain unchanged:

- OpenAPI version `0.6.0` and the three approved REST endpoints;
- the stable `Idempotency-Key` and one-POST lifecycle;
- complete AI and recording disclosure;
- concise turns and one question at a time;
- the strict `recipient_result_schema`;
- response validation, status mapping, persistence, risk assessment, and
  artifact generation.

## 5. Guarded live preflight

The live preflight continues to read only `CALLE_API_KEY` and
`SUPPLIER_TEST_PHONE` from the server-side environment. It derives the
recipient profile from the validated phone number and displays only:

- the selected scenario;
- the masked number;
- the canonical country; and
- the canonical language.

The operator must verify those sanitized values before entering
`AUTHORIZE ONE CALL`.

An unsupported or malformed number produces
`UNSUPPORTED_RECIPIENT_REGION` before permit consumption, run creation,
provider construction, or network access. The guarded CLI remains the only
live entry point. Its atomic process-wide permit, attended terminal check,
private evidence boundary, bounded polling, event pagination limit, and
post-commit filesystem guarantees remain unchanged.

Before the first Kenyan live preflight, the operator must separately verify:

1. CALL-E still lists `KE + English` as supported.
2. The participant owns the reviewed Kenyan number and is ready.
3. The participant consents to the AI-assisted call, recording, and any
   separately reviewed public excerpt.
4. Applicable disclosure and recording rules in both locations were reviewed.
5. The project owner has authorized exactly one named scenario for that run.

No live CALL-E operation is part of automated tests, required CI, or amendment
implementation.

## 6. Operator documentation and future UI

The operator runbook documents both supported formats, their masks, canonical
region/locale pairs, and the Kenya international-test-line limitation. It does
not include a full phone number, participant identity, consent evidence, API
key, raw transcript, or provider envelope.

When the approved operator UI is implemented later, it must display the
canonical country and language stored on the run rather than a hardcoded
United States label. This amendment does not implement or broaden the future
UI task.

## 7. Error and privacy behavior

Domain validation remains strict and fail-closed. At application boundaries:

- malformed or unsupported preflight numbers produce
  `UNSUPPORTED_RECIPIENT_REGION`;
- inconsistent or unsafe CALL-E request input produces
  `CALL_CREATION_FAILED`;
- raw Zod errors, provider errors, full phone numbers, native paths, and
  untrusted values are never copied into public output.

No new error code, dependency, external endpoint, credential, retry policy, or
mutable configuration surface is introduced.

## 8. TDD and verification

Implementation follows separate RED/GREEN cycles.

### Domain tests

- preserve all current United States positive and negative cases;
- accept exact Kenyan lower/upper boundary-shaped numbers without committing
  a real participant number;
- reject wrong length, a zero first national digit, local format, separators,
  extensions, and other country codes;
- verify `KE/en-KE` and the deterministic Kenya mask;
- reject every United States/Kenya region-locale mismatch; and
- preserve plain-data and accessor-safety behavior with zero getter reads.

Test phone-shaped data is assembled from non-sensitive segments so no real or
participant number is committed.

### CALL-E request tests

- prove exact US and Kenya request mappings;
- prove inconsistent recipients fail before `fetch`;
- prove request construction contains no hardcoded profile override; and
- preserve disclosure, concise-turn, idempotency, metadata, and strict result
  schema regressions.

### Preflight tests

- accept both supported profiles through the guarded boundary;
- reject malformed Kenya and all unsupported-country numbers with zero POSTs;
- verify sanitized country, language, and masked-number output;
- preserve the exact confirmation phrase and atomic one-call permit;
- preserve alternate-working-directory confinement and private evidence
  publication protections; and
- verify all tests remain offline and credential-free.

Verification order is focused tests, explicit affected selection, full
`pnpm verify`, repository secret/hygiene checks when available, build-tree
cleanliness, diff inspection, and independent specification and quality
reviews. Live CALL-E execution is excluded from these gates.

## 9. Files expected to change during implementation

- `src/domain/call-recipient.ts`
- `src/domain/call-recipient.test.ts`
- `src/adapters/calle/request.ts`
- `src/adapters/calle/request.test.ts`
- `scripts/live-preflight.ts`
- `scripts/live-preflight.test.ts`
- `docs/operator-runbook.md`
- the approved implementation plan for this amendment

No persistence, lifecycle, provider-response, risk, OpenAI, artifact, hosted
replay, dependency, or CI implementation file is in scope.

## 10. Acceptance criteria

1. Existing United States behavior remains valid and maps only to
   `US/en-US`.
2. A strict Kenyan E.164 recipient maps only to `KE/en-KE`.
3. Cross-profile, malformed, and unsupported recipients fail before network
   access.
4. The CALL-E request uses the validated canonical recipient profile and no
   hardcoded United States override.
5. The preflight prints only sanitized scenario, country, language, mask, and
   bounded outcome fields.
6. The preflight retains explicit one-call authorization, one POST at most,
   no retries, and no redial.
7. Full offline verification and both independent reviews pass without
   weakening existing gates.
8. Repository content contains no participant phone number, identity, consent
   evidence, credential, or raw provider data.
9. Implementation and automated verification place no real call.
10. A Kenyan live preflight remains a later, separately authorized external
    action.
