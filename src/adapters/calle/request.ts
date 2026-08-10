import { z } from "zod";

import type { CreateSupplierCall } from "../../application/ports.js";
import { callRecipientSchema } from "../../domain/call-recipient.js";
import { AppError } from "../../domain/errors.js";
import { withPlainDataBoundary } from "../../domain/plain-data.js";
import { purchaseOrderSchema } from "../../domain/purchase-order.js";

export const CALLE_OPENAPI_VERSION = "0.6.0" as const;

const MAX_CALL_TASK_LENGTH = 4_000;
const SAFE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

function isEncodeSafe(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

const createSupplierCallSchema: z.ZodType<CreateSupplierCall> =
  withPlainDataBoundary(
    z.strictObject({
      runId: z.string().regex(SAFE_RUN_ID_PATTERN),
      idempotencyKey: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (value) =>
            !CONTROL_CHARACTER_PATTERN.test(value) && isEncodeSafe(value),
        ),
      order: purchaseOrderSchema,
      recipient: callRecipientSchema,
    }),
  );

export const recipientResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contact_outcome",
    "confirmed_quantity",
    "available_quantity",
    "delayed_quantity",
    "promised_delivery_date",
    "delay_reason",
    "follow_up_required",
    "unable_to_fulfill",
  ],
  properties: {
    contact_outcome: {
      type: "string",
      enum: ["reached", "declined", "no_answer", "unknown"],
      description:
        "Use reached only when the recipient answered and discussed the fictional order; never infer reached from a terminal status.",
    },
    confirmed_quantity: {
      type: "integer",
      minimum: 0,
      maximum: 1_000_000,
      description: "Total quantity the recipient explicitly confirmed.",
    },
    available_quantity: {
      type: "integer",
      minimum: 0,
      maximum: 1_000_000,
      description: "Quantity explicitly stated as ready now.",
    },
    delayed_quantity: {
      type: "integer",
      minimum: 0,
      maximum: 1_000_000,
      description: "Quantity explicitly stated as delayed.",
    },
    promised_delivery_date: {
      type: "string",
      maxLength: 32,
      description: "Use YYYY-MM-DD when stated clearly; otherwise use unknown.",
    },
    delay_reason: {
      type: "string",
      maxLength: 1_000,
      description:
        "Brief reason stated by the recipient; use unknown when absent.",
    },
    follow_up_required: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Whether a human must follow up, based only on the conversation.",
    },
    unable_to_fulfill: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Whether the recipient explicitly said the order cannot be fulfilled.",
    },
  },
} as const;

function creationFailure(): AppError {
  return new AppError("CALL_CREATION_FAILED");
}

function requireSafeInlineText(value: string): void {
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw creationFailure();
  }
}

function buildCanonicalCreateCallRequest(input: CreateSupplierCall) {
  requireSafeInlineText(input.order.supplierName);
  requireSafeInlineText(input.order.purchaseOrderRef);

  const task = [
    "You are SupplySignal AI, an automated calling agent.",
    "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.",
    "After the complete disclosure, keep each spoken turn concise and natural: one or two short sentences. Ask only one question at a time and wait for the recipient's answer. Do not read the entire purchase order at once or repeat facts the recipient has already confirmed.",
    `Ask about fictional purchase order ${input.order.purchaseOrderRef} from ${input.order.supplierName}.`,
    `Confirm the quantity expected (${input.order.expectedQuantity}), quantity ready now, quantity delayed, and promised delivery date relative to ${input.order.requiredDeliveryDate}.`,
    "Ask for the delay reason, whether human follow-up is required, and whether the supplier is unable to fulfill the order.",
    "If the recipient declines, stop politely and do not invent answers. If nobody answers, do not infer supplier facts.",
  ].join("\n");

  if (task.length > MAX_CALL_TASK_LENGTH) {
    throw creationFailure();
  }

  return {
    task,
    recipients: [
      {
        phones: [input.recipient.phoneE164],
        region: "US",
        locale: "en-US",
      },
    ],
    recipient_result_schema: recipientResultSchema,
    metadata: { workflow_run_id: input.runId },
  } as const;
}

export function prepareCreateCallRequest(input: unknown): {
  readonly canonicalInput: CreateSupplierCall;
  readonly request: ReturnType<typeof buildCanonicalCreateCallRequest>;
} {
  const canonical = createSupplierCallSchema.safeParse(input);
  if (!canonical.success) {
    throw creationFailure();
  }
  return {
    canonicalInput: canonical.data,
    request: buildCanonicalCreateCallRequest(canonical.data),
  };
}

export function buildCreateCallRequest(input: CreateSupplierCall) {
  return prepareCreateCallRequest(input).request;
}
