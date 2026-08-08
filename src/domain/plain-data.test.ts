import { describe, expect, it } from "vitest";
import { z } from "zod";

import { callAuthorizationSchema } from "./authorization.js";
import { callRecipientSchema, createCallRecipient } from "./call-recipient.js";
import { canonicalizePlainData, withPlainDataBoundary } from "./plain-data.js";
import { purchaseOrderSchema } from "./purchase-order.js";
import { supplyRiskSchema } from "./risk.js";
import { providerEvidenceSnapshotSchema, runRecordSchema } from "./run.js";
import {
  supplierResponseFactsSchema,
  supplierResponseSchema,
} from "./supplier-response.js";

function createOwnGetterValue() {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, "unsafe", {
    enumerable: true,
    get() {
      calls += 1;
      return "should-not-run";
    },
  });
  return { input, calls: () => calls };
}

function createInheritedGetterValue() {
  let calls = 0;
  const prototype = {};
  Object.defineProperty(prototype, "unsafe", {
    enumerable: true,
    get() {
      calls += 1;
      return "should-not-run";
    },
  });
  return { input: Object.create(prototype), calls: () => calls };
}

function createNestedObject(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) {
    value = { value };
  }
  return value;
}

function createExactNodeTree(): unknown[][] {
  const tree = Array.from({ length: 511 }, () =>
    Array.from({ length: 7 }, () => 0),
  );
  tree[0].push(0, 0, 0, 0, 0, 0, 0);
  return tree;
}

function putOnAccessorPrototype<T extends Record<string, unknown>>(value: T) {
  let calls = 0;
  const prototype = {};
  Object.defineProperty(prototype, "inheritedOnly", {
    enumerable: true,
    get() {
      calls += 1;
      return "should-not-run";
    },
  });
  const input = Object.assign(Object.create(prototype), value) as unknown;
  return { input, calls: () => calls };
}

const validOrder = {
  supplierName: "Northstar Components",
  purchaseOrderRef: "PO-2026-001",
  expectedQuantity: 500,
  requiredDeliveryDate: "2026-08-20",
};

const validRecipient = {
  recipientName: "Jordan Lee",
  phoneE164: "+14155551234",
  maskedPhone: "+1 ***-***-1234",
  region: "US",
  locale: "en-US",
};

const validResponse = {
  contactOutcome: "reached",
  confirmedQuantity: 500,
  availableQuantity: 350,
  delayedQuantity: 150,
  promisedDeliveryDate: "2026-08-25",
  delayReason: "Component shortage",
  followUpRequired: "yes",
  unableToFulfill: "no",
};

const validRisk = {
  status: "AT_RISK",
  reasonCodes: ["PARTIAL_AVAILABILITY", "LATE_PROMISE", "HUMAN_FOLLOW_UP"],
};

const validAuthorization = {
  consentToCall: true,
  consentToRecord: true,
  consentToPublish: true,
  supportedRegionConfirmed: true,
  phoneReviewed: true,
  fictionalDataConfirmed: true,
  authorizedAt: "2026-08-08T12:00:00.000Z",
  authorizationDigest: "authorization-digest-v1",
};

const validProviderSnapshot = {
  callId: "provider-call-001",
  status: "completed",
  observedAt: "2026-08-08T12:00:30.000Z",
  taskCompleted: true,
  completionConfidence: { score: 1, label: "certain" },
  transcript: [{ speaker: "user", text: "Complete" }],
  structuredResult: { confirmedQuantity: 500 },
  evidence: [{ id: "evidence-001", excerpt: "Complete", turnIndexes: [0] }],
};

const validRun = {
  id: "run-001",
  version: 3,
  status: "DRAFT",
  trustStatus: "UNVERIFIED_PROVIDER_RESULT",
  order: validOrder,
  recipient: validRecipient,
  schemaValidation: "not_run",
  consistencyValidation: "not_run",
  artifactState: "none",
  createdAt: "2026-08-08T12:00:00.000Z",
  updatedAt: "2026-08-08T12:01:00.000Z",
};

describe("canonicalizePlainData", () => {
  it("returns a detached null-prototype copy of ordinary nested JSON", () => {
    const input = {
      supplier: "Northstar Components",
      values: [{ quantity: 500 }, null, true],
    };

    const result = canonicalizePlainData(input);

    expect(result).toMatchObject({ success: true, value: input });
    if (result.success) {
      expect(Object.getPrototypeOf(result.value)).toBeNull();
      expect(result.value).not.toBe(input);
      const value = result.value as { values: unknown[] };
      expect(value.values).not.toBe(input.values);
      expect(Object.getPrototypeOf(value.values[0])).toBeNull();
    }
  });

  it("rejects own and custom-prototype getters without invoking them", () => {
    const own = createOwnGetterValue();
    const inherited = createInheritedGetterValue();

    expect(canonicalizePlainData(own.input)).toEqual({ success: false });
    expect(own.calls()).toBe(0);
    expect(canonicalizePlainData(inherited.input)).toEqual({ success: false });
    expect(inherited.calls()).toBe(0);
  });

  it("ignores enumerable probes inherited from Object.prototype", () => {
    const probe = "a7PlainDataProbe";
    let calls = 0;
    let success = false;
    let copiedProbe = true;
    Object.defineProperty(Object.prototype, probe, {
      configurable: true,
      enumerable: true,
      get() {
        calls += 1;
        return "should-not-run";
      },
    });

    try {
      const result = canonicalizePlainData({ value: "safe" });
      success = result.success;
      if (result.success) {
        copiedProbe = Object.hasOwn(result.value as object, probe);
      }
    } finally {
      delete (Object.prototype as Record<string, unknown>)[probe];
    }

    expect(success).toBe(true);
    expect(calls).toBe(0);
    expect(copiedProbe).toBe(false);
  });

  it.each<[string, () => unknown]>([
    [
      "an own setter",
      () => {
        const input = {};
        Object.defineProperty(input, "unsafe", {
          enumerable: true,
          set(_value: unknown) {
            void _value;
          },
        });
        return input;
      },
    ],
    [
      "a non-enumerable data property",
      () => {
        const input = {};
        Object.defineProperty(input, "unsafe", { value: "hidden" });
        return input;
      },
    ],
    ["a class instance", () => new (class Value {})()],
    ["a Date", () => new Date("2026-08-08T00:00:00.000Z")],
    ["a Map", () => new Map([["value", 1]])],
    ["a Set", () => new Set([1])],
    ["symbol keys", () => ({ [Symbol("unsafe")]: true })],
    ["a function", () => () => undefined],
    ["a symbol", () => Symbol("unsafe")],
    ["a bigint", () => BigInt(1)],
    ["undefined", () => undefined],
    ["NaN", () => Number.NaN],
    ["positive infinity", () => Number.POSITIVE_INFINITY],
    ["negative infinity", () => Number.NEGATIVE_INFINITY],
    [
      "a cycle",
      () => {
        const input: { self?: unknown } = {};
        input.self = input;
        return input;
      },
    ],
    ["a sparse array", () => new Array(2)],
    [
      "an accessor-backed array index",
      () => {
        const input = ["safe"];
        Object.defineProperty(input, "0", {
          enumerable: true,
          get() {
            return "should-not-run";
          },
        });
        return input;
      },
    ],
  ] as const)("rejects %s", (_reason, createValue) => {
    expect(canonicalizePlainData(createValue())).toEqual({ success: false });
  });

  it("rejects reserved prototype-pollution keys", () => {
    const polluted = Object.create(null);
    Object.defineProperty(polluted, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "rejected",
      writable: true,
    });

    expect(canonicalizePlainData(polluted)).toEqual({ success: false });
  });

  it("enforces the exact general depth, entry, node, character, and key limits", () => {
    expect(canonicalizePlainData(createNestedObject(16)).success).toBe(true);
    expect(canonicalizePlainData(createNestedObject(17)).success).toBe(false);
    expect(
      canonicalizePlainData(Array.from({ length: 512 }, () => 0)).success,
    ).toBe(true);
    expect(
      canonicalizePlainData(Array.from({ length: 513 }, () => 0)).success,
    ).toBe(false);

    const exactNodeTree = createExactNodeTree();
    expect(canonicalizePlainData(exactNodeTree).success).toBe(true);
    exactNodeTree[1].push(0);
    expect(canonicalizePlainData(exactNodeTree).success).toBe(false);

    expect(canonicalizePlainData("x".repeat(1_048_576)).success).toBe(true);
    expect(canonicalizePlainData("x".repeat(1_048_577)).success).toBe(false);
    expect(canonicalizePlainData({ ["k".repeat(256)]: "safe" }).success).toBe(
      true,
    );
    expect(canonicalizePlainData({ ["k".repeat(257)]: "safe" }).success).toBe(
      false,
    );
  });

  it("returns a bounded issue without serializing rejected input", () => {
    const schema = withPlainDataBoundary(z.strictObject({ value: z.string() }));
    const result = schema.safeParse(
      Object.create({ value: "RAW_SECRET_MARKER" }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "Expected safe plain JSON data" }),
        ]),
      );
      expect(JSON.stringify(result.error.issues)).not.toContain(
        "RAW_SECRET_MARKER",
      );
    }
  });

  it("fails closed when proxy reflection throws", () => {
    const input = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("reflection failed");
        },
      },
    );
    const schema = withPlainDataBoundary(z.strictObject({ value: z.string() }));
    const result = schema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "Expected safe plain JSON data" }),
        ]),
      );
    }
  });

  it.each([
    ["purchaseOrderSchema", purchaseOrderSchema, validOrder],
    ["callRecipientSchema", callRecipientSchema, validRecipient],
    ["supplierResponseFactsSchema", supplierResponseFactsSchema, validResponse],
    ["supplierResponseSchema", supplierResponseSchema, validResponse],
    ["supplyRiskSchema", supplyRiskSchema, validRisk],
    ["callAuthorizationSchema", callAuthorizationSchema, validAuthorization],
    [
      "providerEvidenceSnapshotSchema",
      providerEvidenceSnapshotSchema,
      validProviderSnapshot,
    ],
    ["runRecordSchema", runRecordSchema, validRun],
  ] as const)(
    "rejects custom-prototype input through %s",
    (_name, schema, value) => {
      const input = putOnAccessorPrototype(value);

      expect(schema.safeParse(input.input).success).toBe(false);
      expect(input.calls()).toBe(0);
    },
  );

  it("rejects custom-prototype input before creating a call recipient", () => {
    const input = putOnAccessorPrototype({
      recipientName: "Jordan Lee",
      phoneE164: "+14155551234",
      region: "US",
      locale: "en-US",
    });

    expect(() => createCallRecipient(input.input)).toThrow();
    expect(input.calls()).toBe(0);
  });
});
