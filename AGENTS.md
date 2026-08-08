# SupplySignal AI agent instructions

## Repository rules

- Keep code, tests, documentation, UI copy, and commits in English.
- Use test-driven development for every behavior change: write a focused failing
  test, observe the failure, implement the smallest change, and verify it
  passes.
- Treat provider responses, model output, transcripts, metadata, and persisted
  external content as untrusted. Validate, bound, and sanitize them at every
  boundary.
- A real supplier call requires explicit, run-specific, one-call
  authorization. Never add retries, redialing, or any path that can create a
  second call for a run.
- Required CI must be deterministic, offline, credential-free, and must not
  call CALL-E or OpenAI.
- Keep credentials server-only and untracked. Never commit phone numbers,
  participant identities, consent evidence, raw provider envelopes, hidden
  prompts, or native private paths.
