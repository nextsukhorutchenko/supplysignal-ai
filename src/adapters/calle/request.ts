import type { CreateSupplierCall } from "../../application/ports.js";
import { callRecipientSchema } from "../../domain/call-recipient.js";
import { AppError } from "../../domain/errors.js";
import { purchaseOrderSchema } from "../../domain/purchase-order.js";

export const CALLE_OPENAPI_VERSION = "0.6.0" as const;

const MAX_CALL_TASK_LENGTH = 4_000;
const SAFE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

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

export function buildCreateCallRequest(input: CreateSupplierCall) {
  const order = purchaseOrderSchema.safeParse(input.order);
  const recipient = callRecipientSchema.safeParse(input.recipient);

  if (
    !order.success ||
    !recipient.success ||
    !SAFE_RUN_ID_PATTERN.test(input.runId)
  ) {
    throw creationFailure();
  }

  requireSafeInlineText(order.data.supplierName);
  requireSafeInlineText(order.data.purchaseOrderRef);

  const task = [
    "You are SupplySignal AI, an automated calling agent.",
    "Immediately disclose that this is an AI-assisted fictional supplier demo and that the call may be recorded for an approved hackathon demonstration.",
    `Ask about fictional purchase order ${order.data.purchaseOrderRef} from ${order.data.supplierName}.`,
    `Confirm the quantity expected (${order.data.expectedQuantity}), quantity ready now, quantity delayed, and promised delivery date relative to ${order.data.requiredDeliveryDate}.`,
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
        phones: [recipient.data.phoneE164],
        region: "US",
        locale: "en-US",
      },
    ],
    recipient_result_schema: recipientResultSchema,
    metadata: { workflow_run_id: input.runId },
  } as const;
}
