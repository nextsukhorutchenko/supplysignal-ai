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

## Support recovery

CALL-E support later recovered the authoritative Developer API record. The
provider reported a completed Ukrainian call and indicated that call planning
took approximately 20 seconds, longer than the application's former 15-second
create-response wait. Audio was unavailable.

The normalized structured result was not mechanically trustworthy: confirmed
quantity was 500, while available and delayed quantities were 17 and 5. The
private transcript also contained an explicit refusal of manager contact while
the structured result marked human follow-up as required. The full call ID,
transcript, account identity, participant phone, and support trace remain
private.

This recovery confirms the ambiguous-create diagnosis and motivates Correction
A21. It does not convert the incident into a Task 8 PASS. The recovered result
fails deterministic quantity reconciliation and requires human review that is
outside Task 8.

## Privacy

This record excludes the full phone number, participant identity, consent
evidence, API key, full Billing reference, raw transcript, audio, provider
envelope, and private filesystem path.
