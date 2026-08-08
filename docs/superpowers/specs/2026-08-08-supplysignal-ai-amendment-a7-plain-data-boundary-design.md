# SupplySignal AI Amendment A7: Plain-Data Boundary

**Status:** Approved

**Approved by:** Project owner

**Written specification approval date:** 2026-08-08

**Correction A7.1:** Approved on 2026-08-08. Standard objects may retain
`Object.prototype` at the input boundary, but inherited properties are never
read or copied. Every custom prototype and every own accessor remains rejected.

**Design approval date:** 2026-08-08

**Authority:** This amendment supplements the approved SupplySignal AI design
specification. It changes only the handling of untrusted in-memory object input
at public domain-schema boundaries. All existing product, safety, lifecycle,
risk, external-effect, and artifact requirements remain authoritative.

## 1. Problem statement

Independent Task 3 review showed that field-specific accessor preflights do not
close the complete untrusted-object boundary. A value can inherit a getter from
a custom prototype, and an object parser can invoke that getter while resolving
a field. Repeating field-specific checks would leave the same class of defect
available in other schemas and future nested fields.

The project therefore requires one reusable plain-data boundary that runs
before Zod traverses any public object or array schema input. The boundary must
remove inherited behavior, reject unsupported object shapes, enforce traversal
budgets, and preserve the existing validated domain contracts.

## 2. Architecture

Create `src/domain/plain-data.ts` as the single implementation of the
untrusted in-memory plain-data boundary. It provides a reusable
`withPlainDataBoundary(schema)` wrapper for public Zod object and array schemas.

The processing order is:

`unknown input -> plain-data canonicalization -> strict Zod validation and refinement -> typed domain value`

Zod must never receive the original untrusted object. Canonicalization inspects
the input only through prototypes, own keys, and own property descriptors. It
must not use ordinary property reads while traversing untrusted input.

After successful inspection, the boundary constructs a new canonical tree:

- objects use a null prototype;
- arrays are newly allocated and dense;
- only own enumerable data properties are copied; and
- inherited properties and behavior are never copied.

The existing field-specific root and provider preflight functions and the
duplicated bounded-tree traversal in `src/domain/run.ts` are removed after the
shared boundary covers their behavior.

## 3. Accepted and rejected values

The boundary accepts only JSON-compatible plain data:

- `null`;
- strings;
- booleans;
- finite numbers;
- dense arrays; and
- objects whose direct prototype is exactly `Object.prototype` or `null` and
  whose content consists only of own enumerable data properties.

The boundary rejects, at any depth:

- own getters and setters;
- custom prototypes and class instances, including any behavior inherited from
  those custom prototypes;
- `Date`, `Map`, `Set`, and other non-plain objects;
- symbols, functions, bigint, and `undefined`;
- non-finite numbers;
- cycles;
- sparse arrays;
- non-enumerable data fields;
- symbol keys;
- reflection or descriptor inspection failures;
- values that exceed a boundary budget; and
- the keys `__proto__`, `prototype`, and `constructor`.

Ordinary objects inherit standard non-enumerable properties, including the
legacy `Object.prototype.__proto__` accessor. Those standard inherited
properties are not input fields: canonicalization neither reads nor copies
them, and the null-prototype canonical result prevents Zod from resolving them.
This rule also prevents an enumerable property added to `Object.prototype`
from reaching Zod. It does not make every ordinary object invalid merely for
having `Object.prototype` as its direct prototype.

Rejecting the three reserved keys prevents later merge, serialization, or
artifact-writing code from accidentally reintroducing prototype-pollution
behavior.

## 4. Boundary budgets

The general boundary rejects input beyond any of these limits:

- maximum depth: `16`;
- maximum entries in one object or array: `512`;
- maximum nodes in the complete tree: `4096`;
- maximum combined characters across keys and string values: `1,048,576`; and
- maximum key length: `256` characters.

Existing schema limits remain authoritative and may be stricter. In particular,
the persisted unknown-value fields `ProviderEvidenceSnapshot.structuredResult`
and `RunRecord.humanReview` retain all existing limits:

- maximum depth: `8`;
- maximum entries in one object or array: `128`;
- maximum key length: `256` characters;
- maximum string length: `4,096` characters; and
- maximum serialized JSON length: `32,768` characters.

The shared module owns both the general boundary and the reusable stricter
bounded-JSON validation so `run.ts` does not maintain a second traversal
implementation.

## 5. Schema integration

Apply the shared boundary to every current public domain schema that accepts an
object or array:

- `purchaseOrderSchema`;
- `callRecipientSchema`;
- `supplierResponseFactsSchema`;
- `supplierResponseSchema`;
- `supplyRiskSchema`;
- `callAuthorizationSchema`;
- `providerEvidenceSnapshotSchema`; and
- `runRecordSchema`.

Primitive schemas such as `runStatusSchema`, `trustStatusSchema`, and
`isoTimestampSchema` do not require the wrapper because they do not traverse
object properties.

The wrapper must preserve existing output types, transforms, strict-key
behavior, refinements, deterministic risk rules, lifecycle transitions, and
completion semantics. Reprocessing an already canonical value is permitted and
must remain deterministic.

Internal domain functions operate on validated typed values. New external
adapters must not treat arbitrary JavaScript objects as a transport format.

## 6. Error handling

Any unsupported shape, failed reflection operation, or budget violation fails
closed. The validation result uses the stable bounded message:

`Expected safe plain JSON data`

The error must not include the original value, getter output, provider payload,
native path, stack trace, or another raw external envelope. There is no fallback
from descriptor inspection to ordinary property access.

## 7. Proxy and transport boundary

JavaScript cannot inspect an arbitrary `Proxy` with an absolute guarantee of no
side effects because reflection itself can invoke proxy traps. Arbitrary proxies
are therefore not a supported external input format.

HTTP, CALL-E, OpenAI, and filesystem adapters must enforce a raw byte or string
size limit, parse JSON, and only then invoke the applicable domain schema. This
ensures ordinary runtime external data arrives as JSON-created data rather than
as behavior-bearing application objects. The adapter requirements are enforced
when their corresponding approved implementation tasks are executed; A7 does
not implement those adapters early.

## 8. Implementation scope

Implement A7 as a separate corrective subtask, Task 3A. Preserve the existing
Task 3 commits for traceability.

Task 3A may:

- create `src/domain/plain-data.ts`;
- create `src/domain/plain-data.test.ts`;
- update the Task 2 and Task 3 domain schemas and their focused tests;
- remove superseded plain-data traversal and preflight code from `run.ts`; and
- update the Task 3 execution report and SDD progress ledger.

Task 3A must not change dependencies, public product behavior, APIs, UI,
persistence, CALL-E integration, OpenAI integration, artifact publication, or
external effects.

## 9. Test-driven acceptance criteria

Implementation begins with failing regression tests against the current code.
The final tests must prove all of the following:

1. Root and nested values with custom prototypes are rejected without invoking
   getters inherited from those prototypes.
2. Own getters and setters are rejected without invocation at every tested
   depth, while properties inherited from `Object.prototype` are neither read
   nor copied.
3. Custom prototypes and class instances are rejected.
4. Sparse arrays, symbol keys, unsupported primitive values, cycles, and
   reserved prototype-pollution keys are rejected.
5. Each general budget accepts its exact permitted boundary and rejects the
   first value beyond it.
6. The stricter `structuredResult` and `humanReview` budgets remain enforced.
7. Ordinary valid JSON input produces semantically unchanged values.
8. Every listed public object or array schema uses the shared boundary.
9. Existing risk, authorization, lifecycle, persisted-completion, and trust
   tests remain green without weakened assertions.
10. Rejected values do not expose or execute their behavior through validation
    or error construction.

## 10. Verification and review gate

Task 3A verification requires:

1. captured RED evidence from the new regression tests;
2. passing focused plain-data and affected domain suites;
3. a full domain test selection with evidence of the files selected;
4. coverage for every changed source module;
5. passing TypeScript typecheck, zero-warning lint, formatting, and
   `git diff --check`;
6. focused diff inspection and clean repository status;
7. repository secret scanning when the repository-provided scanner becomes
   available, with an unavailable scanner reported truthfully; and
8. a separate corrective commit followed by an independent full-range review
   for both specification compliance and code quality.

Task 4 must not begin until Task 3A receives both `Spec PASS` and
`Quality Approved`.

## 11. Definition of done

Amendment A7 is complete only when all listed schemas route untrusted
object/array input through the shared boundary, no tested own or custom-
prototype accessor executes, no `Object.prototype` property reaches Zod,
existing domain behavior remains unchanged, required checks pass, and the
independent review gate approves the complete Task 3 range.

## Correction A7.2 (Approved)

**Approval date:** 2026-08-08

Public domain schema failures must expose only the stable bounded message
`Expected safe plain JSON data`. This includes failures from the downstream
strict object schemas and refinements after successful canonicalization. Raw
unknown key names, values, provider content, and Zod issue details must not be
included in the exposed or serialized error, while strict rejection remains
required for all eight public object/array schemas.

`canCompleteRun` and `transitionRun` must require `artifactState: "published"`
for completion, in addition to the existing provider-terminal,
schema-validation, consistency-validation, and human-confirmation conditions.
Every successful `transitionRun` result must pass `runRecordSchema`.

The persisted JSON boundary must retain exact depth `8`/`9` and container-entry
`128`/`129` acceptance/rejection regressions, isolated so general boundary
limits cannot decide those cases. Dense accessor-backed array regressions must
assert that their getter counter remains zero.
