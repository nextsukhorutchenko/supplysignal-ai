import { z } from "zod";

const GENERAL_LIMITS = Object.freeze({
  maxDepth: 16,
  maxContainerEntries: 512,
  maxNodes: 4096,
  maxCharacters: 1_048_576,
  maxKeyLength: 256,
  maxStringLength: 1_048_576,
  maxSerializedLength: undefined,
});

const PERSISTED_JSON_LIMITS = Object.freeze({
  maxDepth: 8,
  maxContainerEntries: 128,
  maxNodes: 4096,
  maxCharacters: 1_048_576,
  maxKeyLength: 256,
  maxStringLength: 4_096,
  maxSerializedLength: 32_768,
});

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SAFE_PLAIN_DATA_MESSAGE = "Expected safe plain JSON data";
const CANONICAL_ARRAY_INDEX = /^(0|[1-9]\d*)$/;

type PlainDataLimits = typeof GENERAL_LIMITS | typeof PERSISTED_JSON_LIMITS;

type TraversalState = {
  characters: number;
  nodes: number;
  readonly ancestors: Set<object>;
};

export type PlainDataResult =
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false };

function canonicalizeWithLimits(
  input: unknown,
  limits: PlainDataLimits,
): PlainDataResult {
  const state: TraversalState = {
    characters: 0,
    nodes: 0,
    ancestors: new Set<object>(),
  };

  try {
    const value = visitValue(input, 0, limits, state);
    if (
      limits.maxSerializedLength !== undefined &&
      JSON.stringify(value).length > limits.maxSerializedLength
    ) {
      return { success: false };
    }
    return { success: true, value };
  } catch {
    return { success: false };
  }
}

function visitValue(
  value: unknown,
  depth: number,
  limits: PlainDataLimits,
  state: TraversalState,
): unknown {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes || depth > limits.maxDepth) {
    throw new Error("Plain data limit exceeded");
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    state.characters += value.length;
    if (
      value.length > limits.maxStringLength ||
      state.characters > limits.maxCharacters
    ) {
      throw new Error("Plain data limit exceeded");
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Expected a finite number");
    }
    return value;
  }

  if (typeof value !== "object" || state.ancestors.has(value)) {
    throw new Error("Expected plain JSON data");
  }

  const prototype = Object.getPrototypeOf(value);
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) {
        throw new Error("Expected a plain array");
      }
      return visitArray(value, depth, limits, state);
    }

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Expected a plain object");
    }
    return visitObject(value, depth, limits, state);
  } finally {
    state.ancestors.delete(value);
  }
}

function visitArray(
  input: unknown[],
  depth: number,
  limits: PlainDataLimits,
  state: TraversalState,
): unknown[] {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    lengthDescriptor.value > limits.maxContainerEntries
  ) {
    throw new Error("Expected a bounded dense array");
  }

  const length = lengthDescriptor.value;
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== length + 1) {
    throw new Error("Expected a dense array");
  }

  for (const key of ownKeys) {
    if (
      typeof key !== "string" ||
      (key !== "length" &&
        (!CANONICAL_ARRAY_INDEX.test(key) || Number(key) >= length))
    ) {
      throw new Error("Expected canonical array indexes");
    }
  }

  const result = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error("Expected enumerable array data");
    }
    Object.defineProperty(result, String(index), {
      configurable: true,
      enumerable: true,
      value: visitValue(descriptor.value, depth + 1, limits, state),
      writable: true,
    });
  }
  return result;
}

function visitObject(
  input: object,
  depth: number,
  limits: PlainDataLimits,
  state: TraversalState,
): object {
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length > limits.maxContainerEntries) {
    throw new Error("Expected a bounded object");
  }

  const result = Object.create(null) as object;
  for (const key of ownKeys) {
    if (
      typeof key !== "string" ||
      RESERVED_KEYS.has(key) ||
      key.length > limits.maxKeyLength
    ) {
      throw new Error("Expected safe object keys");
    }

    state.characters += key.length;
    if (state.characters > limits.maxCharacters) {
      throw new Error("Plain data limit exceeded");
    }

    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error("Expected enumerable object data");
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: visitValue(descriptor.value, depth + 1, limits, state),
      writable: true,
    });
  }
  return result;
}

export function canonicalizePlainData(input: unknown): PlainDataResult {
  return canonicalizeWithLimits(input, GENERAL_LIMITS);
}

function createPlainDataTransform(limits: PlainDataLimits): z.ZodType<unknown> {
  return z.unknown().transform((input, context) => {
    const result = canonicalizeWithLimits(input, limits);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: SAFE_PLAIN_DATA_MESSAGE,
      });
      return z.NEVER;
    }
    return result.value;
  });
}

export function withPlainDataBoundary<TOutput>(
  schema: z.ZodType<TOutput>,
): z.ZodType<TOutput> {
  return createPlainDataTransform(GENERAL_LIMITS).pipe(schema);
}

export const persistedJsonValueSchema: z.ZodType<unknown> =
  createPlainDataTransform(PERSISTED_JSON_LIMITS);
