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

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class AppError extends Error {
  constructor(readonly code: AppErrorCode) {
    super(code);
    this.name = "AppError";
  }
}
