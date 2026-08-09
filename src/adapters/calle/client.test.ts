import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { CreateSupplierCall } from "../../application/ports.js";
import { CalleClient, CalleError } from "./client.js";

const apiKey = "server-only-test-token";
const fullPhone = ["+1", "202", "555", "0123"].join("");
const baseUrl = "https://api.call-e.example";
const input: CreateSupplierCall = {
  runId: "run_001",
  idempotencyKey: "ssai-v1-stable-key",
  order: {
    supplierName: "Northstar Components",
    purchaseOrderRef: "PO-2048",
    expectedQuantity: 500,
    requiredDeliveryDate: "2026-08-15",
  },
  recipient: {
    recipientName: "Consenting participant",
    phoneE164: fullPhone,
    maskedPhone: "+1 ***-***-0123",
    region: "US",
    locale: "en-US",
  },
};

async function fixture(name: string): Promise<string> {
  return readFile(
    new URL(`../../../tests/fixtures/calle/${name}`, import.meta.url),
    "utf8",
  );
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createClient(
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void> = async () => undefined,
): CalleClient {
  return new CalleClient({ apiKey, baseUrl, fetch: fetchImpl, sleep });
}

describe("CalleClient createCall", () => {
  it("posts one reviewed request with the stable idempotency key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(await fixture("create-accepted.json"), 201),
    );

    const snapshot = await createClient(fetchMock).createCall(input);

    expect(snapshot).toMatchObject({
      callId: "call_demo_001",
      status: "queued",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${baseUrl}/v1/calls`);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      recipients: [{ phones: [fullPhone], region: "US", locale: "en-US" }],
      metadata: { workflow_run_id: "run_001" },
    });
  });

  it("calls AbortSignal.timeout with exactly 15 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(await fixture("create-accepted.json"), 201),
    );

    await createClient(fetchMock).createCall(input);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });

  it.each([200, 202, 204])(
    "treats unexpected create success status %i as ambiguous without retry",
    async (status) => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        status === 204
          ? new Response(null, {
              status,
              headers: { "content-type": "application/json" },
            })
          : jsonResponse(await fixture("create-accepted.json"), status),
      );

      await expect(
        createClient(fetchMock).createCall(input),
      ).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
        kind: "ambiguous_create",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["network rejection", async () => Promise.reject(new Error("raw network"))],
    ["transient response", async () => jsonResponse("{}", 503)],
  ] as const)(
    "never retries POST after a %s",
    async (_name, implementation) => {
      const fetchMock = vi.fn<typeof fetch>(implementation);

      await expect(
        createClient(fetchMock).createCall(input),
      ).rejects.toMatchObject({
        code: "CALL_OUTCOME_PENDING",
        kind: "ambiguous_create",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not replace an idempotency conflict with a new key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse('{"message":"conflict"}', 409),
    );

    await expect(
      createClient(fetchMock).createCall(input),
    ).rejects.toMatchObject({
      code: "CALL_CREATION_FAILED",
      kind: "idempotency_conflict",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "idempotency-key": "ssai-v1-stable-key",
    });
  });

  it("rejects invalid local request data before any ambiguous create boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      createClient(fetchMock).createCall({
        ...input,
        recipient: { ...input.recipient, phoneE164: "invalid" },
      }),
    ).rejects.toMatchObject({
      code: "CALL_CREATION_FAILED",
      kind: "creation_rejected",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the 255-character idempotency bound before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(await fixture("create-accepted.json"), 201),
    );
    const client = createClient(fetchMock);

    await expect(
      client.createCall({ ...input, idempotencyKey: "k".repeat(255) }),
    ).resolves.toMatchObject({ callId: "call_demo_001" });
    await expect(
      client.createCall({ ...input, idempotencyKey: "k".repeat(256) }),
    ).rejects.toMatchObject({
      code: "CALL_CREATION_FAILED",
      kind: "creation_rejected",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects accessors before field reads or external effects", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    let changingReads = 0;
    let throwingReads = 0;
    const changing = { ...input } as CreateSupplierCall;
    Object.defineProperty(changing, "idempotencyKey", {
      enumerable: true,
      get() {
        changingReads += 1;
        return changingReads === 1 ? "first-key" : "second-key";
      },
    });
    const throwingOrder = { ...input.order };
    Object.defineProperty(throwingOrder, "supplierName", {
      enumerable: true,
      get() {
        throwingReads += 1;
        throw new Error("C:\\private\\raw getter failure");
      },
    });

    for (const unsafe of [changing, { ...input, order: throwingOrder }]) {
      await expect(
        createClient(fetchMock).createCall(unsafe),
      ).rejects.toMatchObject({
        code: "CALL_CREATION_FAILED",
        kind: "creation_rejected",
      });
    }
    expect(changingReads).toBe(0);
    expect(throwingReads).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on proxy reflection errors without leaking their cause", async () => {
    const sensitive = `${apiKey} ${fullPhone} C:\\private\\proxy raw`;
    const proxied = new Proxy(input, {
      ownKeys() {
        throw new Error(sensitive);
      },
    });
    const fetchMock = vi.fn<typeof fetch>();

    try {
      await createClient(fetchMock).createCall(proxied);
      throw new Error("Expected createCall to reject");
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: "CALL_CREATION_FAILED",
        kind: "creation_rejected",
      });
      const exposed = `${String(error)} ${JSON.stringify(error)}`;
      expect(exposed).not.toContain(apiKey);
      expect(exposed).not.toContain(fullPhone);
      expect(exposed).not.toContain("C:\\private\\proxy");
      expect(exposed).not.toContain("raw");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses one canonical snapshot for the idempotency header and metadata", async () => {
    const source: CreateSupplierCall = structuredClone(input);
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      source.idempotencyKey = "mutated-key";
      source.runId = "mutated-run";
      expect(init?.headers).toMatchObject({
        "idempotency-key": "ssai-v1-stable-key",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        metadata: { workflow_run_id: "run_001" },
      });
      return jsonResponse(await fixture("create-accepted.json"), 201);
    });

    await createClient(fetchMock).createCall(source);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds non-JSON and sensitive dependency errors", async () => {
    const sensitive = `${apiKey} ${fullPhone} C:\\private\\provider raw transcript`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(`<html>${sensitive}</html>`, {
          status: 201,
          headers: { "content-type": "text/html" },
        }),
      )
      .mockRejectedValueOnce(new Error(sensitive))
      .mockRejectedValueOnce(
        Object.assign(
          new CalleError("CALL_CREATION_FAILED", "creation_rejected"),
          { providerMessage: sensitive },
        ),
      );
    const client = createClient(fetchMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await client.createCall(input);
        throw new Error("Expected createCall to reject");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CalleError);
        const exposed = `${String(error)} ${JSON.stringify(error)}`;
        expect(exposed).not.toContain(apiKey);
        expect(exposed).not.toContain(fullPhone);
        expect(exposed).not.toContain("C:\\private\\provider");
        expect(exposed).not.toContain("raw transcript");
      }
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("CalleClient bounded GET behavior", () => {
  it("retries a transient call read only twice with the approved delays", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse("{}", 503))
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(jsonResponse(await fixture("in-progress.json")));
    const sleep = vi.fn(async () => undefined);
    const snapshot = await createClient(fetchMock, sleep).getCall(
      "call_demo_001",
    );

    expect(snapshot.status).toBe("in_progress");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${baseUrl}/v1/calls/call_demo_001`,
      `${baseUrl}/v1/calls/call_demo_001`,
      `${baseUrl}/v1/calls/call_demo_001`,
    ]);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method === "GET"),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true);
    expect(sleep.mock.calls).toEqual([[500], [1_000]]);
  });

  it("stops after the two approved transient retries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse("{}", 503));
    const sleep = vi.fn(async () => undefined);

    await expect(
      createClient(fetchMock, sleep).getCall("call_demo_001"),
    ).rejects.toMatchObject({
      code: "CALL_OUTCOME_PENDING",
      kind: "read_failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1_000]]);
  });

  it("does not retry non-transient or malformed successful responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"message":"bad request"}', 400))
      .mockResolvedValueOnce(jsonResponse("not-json"));
    const client = createClient(fetchMock);

    await expect(client.getCall("call_demo_001")).rejects.toMatchObject({
      code: "CALL_NOT_READY",
    });
    await expect(client.getCall("call_demo_001")).rejects.toMatchObject({
      code: "PROVIDER_RESULT_INVALID",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([201, 202, 204])(
    "rejects unexpected GET success status %i without retry",
    async (status) => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        status === 204
          ? new Response(null, {
              status,
              headers: { "content-type": "application/json" },
            })
          : jsonResponse(await fixture("in-progress.json"), status),
      );

      await expect(
        createClient(fetchMock).getCall("call_demo_001"),
      ).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["missing prefix", "demo_001", undefined],
    ["path separator", "call_demo/001", undefined],
    ["unpaired call-id surrogate", "call_demo_\ud800", undefined],
    ["unpaired cursor surrogate", "call_demo_001", "cursor_\ud800"],
  ])("rejects a %s before URI construction", async (_name, callId, cursor) => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createClient(fetchMock);

    const operation =
      cursor === undefined
        ? client.getCall(callId)
        : client.listEvents(callId, cursor);
    await expect(operation).rejects.toMatchObject({ code: "CALL_NOT_READY" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before JSON parsing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(`{"value":"${"x".repeat(1_048_577)}"}`),
    );

    await expect(
      createClient(fetchMock).getCall("call_demo_001"),
    ).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects JSON-like media types outside the reviewed contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(await fixture("in-progress.json"), {
          status: 200,
          headers: { "content-type": "text/application/json" },
        }),
    );

    await expect(
      createClient(fetchMock).getCall("call_demo_001"),
    ).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  });

  it("rejects malformed declared response lengths", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(await fixture("in-progress.json"), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "1e3",
          },
        }),
    );

    await expect(
      createClient(fetchMock).getCall("call_demo_001"),
    ).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  });

  it("reads only the authoritative call and informational events endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/events")) {
        return jsonResponse(await fixture("events-page.json"));
      }
      return jsonResponse(await fixture("unknown-status.json"));
    });
    const client = createClient(fetchMock);

    await expect(client.getCall("call_demo_004")).resolves.toMatchObject({
      status: "unknown",
    });
    await expect(
      client.listEvents("call_demo_001", "cursor_001"),
    ).resolves.toMatchObject({
      nextCursor: null,
      events: [{ id: "event_001" }, { id: "event_002" }],
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${baseUrl}/v1/calls/call_demo_004`,
      `${baseUrl}/v1/calls/call_demo_001/events?cursor=cursor_001`,
    ]);
  });
});
