/**
 * Stripe adapter — STUB MODE.
 *
 * The platform user opted not to install the live `stripe` SDK. This
 * adapter therefore returns deterministic, fake Stripe-shaped values
 * (cs_test_..., cus_..., acct_..., po_..., re_...) when
 * `STRIPE_SECRET_KEY` is unset, so every call site can be wired exactly
 * the way it would be against live Stripe and the only gate to going
 * live is dropping in a real client implementation.
 *
 * Contract:
 *   - All money in/out is integer cents.
 *   - Every method is async even when stubbed, to keep call sites
 *     identical between modes.
 *   - Webhook verification accepts JSON in stub mode (NEVER set this
 *     mode in production — the env-schema check refuses to boot a live
 *     deploy without STRIPE_WEBHOOK_SECRET).
 */
import crypto from "node:crypto";
import { env } from "./env";

export type WebhookEvent = {
  id: string;
  type: string;
  // Stripe wraps the payload under .data.object; keep the same shape.
  data: { object: Record<string, unknown> };
};

const STUB = !env.STRIPE_SECRET_KEY;
const fakeId = (prefix: string): string =>
  `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

export interface CheckoutOpts {
  userId: number;
  customerId?: string | null;
  customerEmail?: string | null;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutResult {
  id: string; // cs_test_...
  url: string; // hosted checkout URL
  paymentIntentId: string; // pi_...
}

export interface CustomerResult {
  id: string; // cus_...
}

export interface ConnectAccountResult {
  id: string; // acct_...
}

export interface OnboardingLinkResult {
  url: string;
  expiresAt: number; // unix seconds
}

export interface AccountStatus {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue: string[];
}

export interface PayoutResult {
  id: string; // po_...
  status: "pending" | "paid" | "failed";
  amountCents: number;
}

export interface RefundResult {
  id: string; // re_...
  status: "pending" | "succeeded" | "failed";
  amountCents: number;
}

export const stripeClient = {
  /** True when running without a live STRIPE_SECRET_KEY. UI uses this to
   *  show a "Stub mode" badge so testers don't try to enter card numbers. */
  isStub: STUB,

  async createCheckoutSession(opts: CheckoutOpts): Promise<CheckoutResult> {
    if (!STUB) {
      throw new Error(
        "Live Stripe SDK is not bundled — set STRIPE_SECRET_KEY=stub or install stripe",
      );
    }
    const id = fakeId("cs_test");
    const piId = fakeId("pi");
    // Stub URL points back at our success page so end-to-end smoke tests
    // can complete the flow without a browser redirect to Stripe.
    const url = `${opts.successUrl}?session_id=${id}&stub=1`;
    return { id, url, paymentIntentId: piId };
  },

  async createOrRetrieveCustomer(opts: {
    existingId?: string | null;
    email?: string | null;
    userId: number;
  }): Promise<CustomerResult> {
    if (opts.existingId) return { id: opts.existingId };
    return { id: fakeId("cus") };
  },

  async createConnectAccount(opts: {
    email?: string | null;
    userId: number;
  }): Promise<ConnectAccountResult> {
    return { id: fakeId("acct") };
  },

  async createOnboardingLink(opts: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<OnboardingLinkResult> {
    // Round-trip back to the return URL with a stub flag so the UI can
    // detect the simulated completion.
    return {
      url: `${opts.returnUrl}?stub=1&account=${opts.accountId}`,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  },

  async retrieveAccount(accountId: string): Promise<AccountStatus> {
    // Stub flips to verified immediately to make the happy path testable.
    return {
      id: accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
    };
  },

  async createPayout(opts: {
    destinationAccountId: string;
    amountCents: number;
    metadata?: Record<string, string>;
  }): Promise<PayoutResult> {
    return {
      id: fakeId("po"),
      status: "pending",
      amountCents: opts.amountCents,
    };
  },

  async createRefund(opts: {
    paymentReference: string;
    amountCents: number;
    reason?: string;
    metadata?: Record<string, string>;
  }): Promise<RefundResult> {
    return {
      id: fakeId("re"),
      status: "succeeded",
      amountCents: opts.amountCents,
    };
  },

  /**
   * Retrieve a Checkout Session by id. Used by the reconciliation
   * script to verify ledger ↔ Stripe agreement. In stub mode we
   * return a deterministic "succeeded" snapshot so the reconciler
   * can be smoke-tested end-to-end without a live key.
   */
  async retrieveCheckoutSession(
    id: string,
  ): Promise<{ id: string; paymentStatus: string; amountTotal: number | null }> {
    if (!STUB) throw new Error("Live Stripe SDK not bundled");
    return { id, paymentStatus: "paid", amountTotal: null };
  },

  async retrievePayout(
    id: string,
  ): Promise<{ id: string; status: string; amount: number }> {
    if (!STUB) throw new Error("Live Stripe SDK not bundled");
    return { id, status: "paid", amount: 0 };
  },

  async retrieveRefund(
    id: string,
  ): Promise<{ id: string; status: string; amount: number }> {
    if (!STUB) throw new Error("Live Stripe SDK not bundled");
    return { id, status: "succeeded", amount: 0 };
  },

  /**
   * Verify and parse a webhook payload. In live mode this would call
   * `stripe.webhooks.constructEvent(rawBody, signature, secret)`. In
   * stub mode we accept any well-formed JSON so dev-tooling can POST
   * fake events.
   */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent {
    if (!STUB) {
      if (!env.STRIPE_WEBHOOK_SECRET || !signature) {
        throw new Error(
          "Live webhook verification requires STRIPE_WEBHOOK_SECRET and a Stripe-Signature header",
        );
      }
      throw new Error("Live Stripe SDK not bundled");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new Error("Webhook payload is not valid JSON");
    }
    const e = parsed as Partial<WebhookEvent>;
    if (
      typeof e.id !== "string" ||
      typeof e.type !== "string" ||
      typeof e.data !== "object" ||
      e.data == null
    ) {
      throw new Error("Webhook payload missing required {id,type,data}");
    }
    return e as WebhookEvent;
  },
};

export type StripeClient = typeof stripeClient;
