import { z } from "zod";

import { withPlainDataBoundary } from "./plain-data.js";

const MAX_TIMESTAMP_LENGTH = 40;
const MAX_AUTHORIZATION_DIGEST_LENGTH = 256;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isValidIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (match === null) {
    return false;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute =
    offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    month === 2
      ? isLeapYear
        ? 29
        : 28
      : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

export const isoTimestampSchema = z
  .string()
  .max(MAX_TIMESTAMP_LENGTH)
  .refine(isValidIsoTimestamp, "Expected a valid ISO timestamp");

export type CallAuthorization = {
  consentToCall: true;
  consentToRecord: true;
  consentToPublish: true;
  supportedRegionConfirmed: true;
  phoneReviewed: true;
  fictionalDataConfirmed: true;
  authorizedAt: string;
  authorizationDigest: string;
};

const callAuthorizationObjectSchema: z.ZodType<CallAuthorization> =
  z.strictObject({
    consentToCall: z.literal(true),
    consentToRecord: z.literal(true),
    consentToPublish: z.literal(true),
    supportedRegionConfirmed: z.literal(true),
    phoneReviewed: z.literal(true),
    fictionalDataConfirmed: z.literal(true),
    authorizedAt: isoTimestampSchema,
    authorizationDigest: z
      .string()
      .trim()
      .min(1)
      .max(MAX_AUTHORIZATION_DIGEST_LENGTH),
  });

export const callAuthorizationSchema: z.ZodType<CallAuthorization> =
  withPlainDataBoundary(callAuthorizationObjectSchema);
