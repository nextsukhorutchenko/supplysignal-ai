# CALL-E dashboard and API-call visibility observation

**Recorded:** 2026-08-09

**Status:** Time-sensitive platform observation; reverify before the final demo

**Source:** CALL-E support response shared by the project owner

## Observed platform behavior

CALL-E support stated that the Dashboard `Recents` and `Search calls` views
currently display calls initiated through the Dashboard UI only. Calls created
through the Developer API or SDK may consume the API key and return a valid call
resource without appearing in those Dashboard views.

Support also stated that a broader Call Records feature was under development.
That planned feature is not treated as available until it is independently
verified against the account used for the final preflight.

The same report included a separate case where a recipient's phone rang but no
agent audio or response was heard. The support response did not diagnose or
resolve that audio behavior, so it remains a separate preflight risk.

## Project decisions

- The CALL-E Dashboard is not an authoritative runtime or reconciliation
  source for API-created calls.
- The application persists the `call_id` returned by the Developer API and
  reconciles only that resource through `GET /v1/calls/{call_id}`.
- `GET /v1/calls/{call_id}/events` remains informational and cannot establish
  application completion by itself.
- A `no_answer` provider outcome is a non-success contact outcome. It must not
  create a transcript, supplier facts, or a completed business result.
- An empty Dashboard does not prove that no API call occurred and must not
  trigger another call or a new idempotency key.
- The final video should use SupplySignal AI's sanitized run timeline, masked
  call identifier, and reconciled provider status as evidence. Dashboard call
  history may be shown only as optional context after its behavior is
  reverified.

## Preflight evidence requirements

For every explicitly authorized live preflight call, retain private evidence
for:

- the authoritative `call_id`;
- request and observation timestamps;
- reviewed OpenAPI or SDK version;
- recipient region and locale without the phone number;
- the sanitized provider status and contact outcome;
- the participant's physical observation of ringing, answer state, and audio;
- whether the call appeared in the Dashboard; and
- any delayed call or duplicate-call observation during the documented window.

The public report may include only a hash or masked form of the call identifier
and a sanitized observed-versus-reported comparison. It must exclude API keys,
key names or suffixes, full phone numbers, participant identity, raw
transcripts, consent evidence, and provider trace envelopes.

## Support escalation for audio or logging discrepancies

When a call rings without usable agent audio, or when provider state conflicts
with the participant's observation, stop the preflight expansion and report the
following privately to CALL-E support:

- `call_id`;
- approximate timestamp and timezone;
- recipient country, region, and requested language;
- API, SDK, or OpenAPI version;
- sanitized expected and actual behavior; and
- whether the issue reproduced through API/SDK, Dashboard, or both.

Never include an API key or full recipient number in repository content,
screenshots, public evidence, or Discord messages.
