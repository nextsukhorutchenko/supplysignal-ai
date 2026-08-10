import type { CallRecipient } from "../domain/call-recipient.js";
import type { PurchaseOrder } from "../domain/purchase-order.js";
import type { SupplyRisk } from "../domain/risk.js";
import type { ProviderEvidenceSnapshot, RunRecord } from "../domain/run.js";

export interface RunStore {
  create(run: RunRecord): Promise<void>;
  read(runId: string): Promise<RunRecord>;
  compareAndSwap(
    runId: string,
    expectedVersion: number,
    next: RunRecord,
  ): Promise<RunRecord>;
}

export interface Clock {
  now(): string;
  sleep(milliseconds: number): Promise<void>;
}

export interface IdGenerator {
  next(): string;
}

export type CreateSupplierCall = {
  runId: string;
  idempotencyKey: string;
  order: PurchaseOrder;
  recipient: CallRecipient;
};

export type CalleCallSnapshot = ProviderEvidenceSnapshot;

export type CalleEventPage = {
  events: readonly {
    id: string;
    type: string;
    occurredAt: string;
    summary: string;
  }[];
  nextCursor: string | null;
};

export interface CalleGateway {
  createCall(input: CreateSupplierCall): Promise<CalleCallSnapshot>;
  getCall(callId: string): Promise<CalleCallSnapshot>;
  listEvents(callId: string, cursor?: string): Promise<CalleEventPage>;
}

export type BriefingFacts = {
  risk: SupplyRisk;
  expectedQuantity: number;
  availableQuantity: number;
  delayedQuantity: number;
  requiredDeliveryDate: string;
  promisedDeliveryDate: string | "unknown";
  delayReason: string;
  humanAction: "ACCEPT_PARTIAL" | "CONTACT_ALTERNATIVE" | "FOLLOW_UP";
};

export type BriefingExplanation = {
  title: string;
  explanation: string;
  recommendation: string;
  echoedFacts: Omit<BriefingFacts, "risk" | "delayReason" | "humanAction"> & {
    riskStatus: SupplyRisk["status"];
  };
};

export interface BriefingPort {
  generate(facts: BriefingFacts): Promise<BriefingExplanation>;
}
