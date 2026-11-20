import crypto from 'node:crypto';
import type { FamwiseStatusResponse } from './famwise.ts';
import { addNotification, addTransaction, persistState } from './store.ts';
import type { DatabaseState, DepositOrderRecord } from './types.ts';

const orderLocks = new Map<string, Promise<unknown>>();

export function roundInr(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toPaise(value: number): number {
  return Math.round(value * 100);
}

/**
 * Validates INR deposit amount:
 * - Numeric, finite
 * - Minimum ₹1, maximum ₹100,000
 * - Maximum 2 decimal places
 */
export function parseValidDepositAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 1 || num > 100_000) return null;
  if (Math.abs(Math.round(num * 100) - num * 100) > 1e-6) return null;
  return roundInr(num);
}

async function withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  const prev = orderLocks.get(orderId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  orderLocks.set(orderId, prev.then(() => current));

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (orderLocks.get(orderId) === current) {
      orderLocks.delete(orderId);
    }
  }
}

export interface VerifyDepositResult {
  ok: boolean;
  httpStatus: number;
  orderId: string;
  status: 'active' | 'paid' | 'expired' | 'failed';
  amount: number;
  walletBalance: number;
  walletCreditApplied: boolean;
  alreadyCredited: boolean;
  deposit?: DepositOrderRecord;
  message: string;
}

export async function verifyAndCreditDeposit(params: {
  state: DatabaseState;
  orderId: string;
  expectedUserId?: string;
  fetchGatewayStatus: (orderId: string) => Promise<{
    ok: boolean;
    status: number;
    data?: FamwiseStatusResponse;
    error?: string;
  }>;
  persist?: (state: DatabaseState) => Promise<void>;
}): Promise<VerifyDepositResult> {
  const { state, orderId, expectedUserId, fetchGatewayStatus } = params;
  const save = params.persist || persistState;

  return withOrderLock(orderId, async () => {
    const deposit = state.deposits.find((d) => d.orderId === orderId);
    if (!deposit) {
      return {
        ok: false,
        httpStatus: 404,
        orderId,
        status: 'failed',
        amount: 0,
        walletBalance: 0,
        walletCreditApplied: false,
        alreadyCredited: false,
        message: 'Deposit order not found.',
      };
    }

    if (expectedUserId && deposit.userId !== expectedUserId) {
      return {
        ok: false,
        httpStatus: 403,
        orderId,
        status: deposit.status,
        amount: deposit.amount,
        walletBalance: 0,
        walletCreditApplied: false,
        alreadyCredited: false,
        message: 'You do not have permission to access this deposit order.',
      };
    }

    const owner = state.users.find((u) => u.id === deposit.userId);
    if (!owner) {
      return {
        ok: false,
        httpStatus: 404,
        orderId,
        status: 'failed',
        amount: deposit.amount,
        walletBalance: 0,
        walletCreditApplied: false,
        alreadyCredited: false,
        message: 'Order owner account not found.',
      };
    }

    // Already credited -> idempotent response without re-crediting
    if (deposit.credited || state.creditedDepositOrderIds.includes(orderId)) {
      deposit.credited = true;
      deposit.status = 'paid';
      return {
        ok: true,
        httpStatus: 200,
        orderId,
        status: 'paid',
        amount: deposit.amount,
        walletBalance: roundInr(owner.walletBalance ?? 0),
        walletCreditApplied: false,
        alreadyCredited: true,
        deposit,
        message: `₹${deposit.amount.toFixed(2)} already credited to your wallet.`,
      };
    }

    const gw = await fetchGatewayStatus(orderId);
    if (!gw.ok || !gw.data) {
      return {
        ok: false,
        httpStatus: gw.status >= 400 ? gw.status : 502,
        orderId,
        status: deposit.status,
        amount: deposit.amount,
        walletBalance: roundInr(owner.walletBalance ?? 0),
        walletCreditApplied: false,
        alreadyCredited: false,
        deposit,
        message: gw.error || 'Could not verify payment status with Famwise.',
      };
    }

    const rawStatus = String(gw.data.status || 'active').trim().toLowerCase();
    const now = new Date().toISOString();

    if (rawStatus === 'paid') {
      // Confirm currency (if supplied by gateway)
      if (gw.data.currency && String(gw.data.currency).toUpperCase() !== 'INR') {
        deposit.status = 'failed';
        deposit.updatedAt = now;
        await save(state);
        return {
          ok: false,
          httpStatus: 422,
          orderId,
          status: 'failed',
          amount: deposit.amount,
          walletBalance: roundInr(owner.walletBalance ?? 0),
          walletCreditApplied: false,
          alreadyCredited: false,
          deposit,
          message: `Currency mismatch: expected INR, received ${String(gw.data.currency)}.`,
        };
      }

      // Confirm gateway order_id if present
      if (gw.data.order_id && String(gw.data.order_id) !== deposit.orderId) {
        return {
          ok: false,
          httpStatus: 422,
          orderId,
          status: 'failed',
          amount: deposit.amount,
          walletBalance: roundInr(owner.walletBalance ?? 0),
          walletCreditApplied: false,
          alreadyCredited: false,
          deposit,
          message: 'Order ID mismatch from payment gateway.',
        };
      }

      // Confirm paid amount matches/covers expected deposit amount
      const paidAmount = Number(gw.data.amount);
      if (!Number.isFinite(paidAmount) || toPaise(paidAmount) < toPaise(deposit.amount)) {
        deposit.status = 'failed';
        deposit.updatedAt = now;
        await save(state);
        return {
          ok: false,
          httpStatus: 422,
          orderId,
          status: 'failed',
          amount: deposit.amount,
          walletBalance: roundInr(owner.walletBalance ?? 0),
          walletCreditApplied: false,
          alreadyCredited: false,
          deposit,
          message: `Amount mismatch: expected ₹${deposit.amount.toFixed(2)}, gateway reported ₹${Number.isFinite(paidAmount) ? paidAmount.toFixed(2) : '0.00'}.`,
        };
      }

      // Atomic single-credit guard
      if (deposit.credited || state.creditedDepositOrderIds.includes(orderId)) {
        return {
          ok: true,
          httpStatus: 200,
          orderId,
          status: 'paid',
          amount: deposit.amount,
          walletBalance: roundInr(owner.walletBalance ?? 0),
          walletCreditApplied: false,
          alreadyCredited: true,
          deposit,
          message: `₹${deposit.amount.toFixed(2)} already credited to your wallet.`,
        };
      }

      deposit.credited = true;
      deposit.creditedAt = now;
      deposit.status = 'paid';
      deposit.updatedAt = now;
      if (gw.data.reference) deposit.gatewayReference = String(gw.data.reference);
      state.creditedDepositOrderIds.push(orderId);
      if (state.creditedDepositOrderIds.length > 10_000) {
        state.creditedDepositOrderIds = state.creditedDepositOrderIds.slice(-10_000);
      }

      owner.walletBalance = roundInr((owner.walletBalance ?? 0) + deposit.amount);
      owner.updatedAt = now;

      addTransaction(state, {
        id: `dep_${crypto.randomBytes(6).toString('hex')}`,
        order_id: deposit.orderId,
        userId: owner.id,
        username: owner.username,
        type: 'deposit',
        basic_credits: 0,
        premium_credits: 0,
        amount_inr: deposit.amount,
        status: 'completed',
        details: `UPI Add Funds verified via Famwise (Order #${deposit.orderId}) · +₹${deposit.amount.toFixed(2)}`,
      });

      addNotification(state, {
        userId: owner.id,
        type: 'success',
        title: 'Wallet Credited',
        message: `₹${deposit.amount.toFixed(2)} added to your wallet (Order #${deposit.orderId}). New balance: ₹${owner.walletBalance.toFixed(2)}.`,
      });

      await save(state);

      return {
        ok: true,
        httpStatus: 200,
        orderId,
        status: 'paid',
        amount: deposit.amount,
        walletBalance: owner.walletBalance,
        walletCreditApplied: true,
        alreadyCredited: false,
        deposit,
        message: `Payment verified! ₹${deposit.amount.toFixed(2)} credited to your wallet.`,
      };
    }

    if (rawStatus === 'expired') {
      deposit.status = 'expired';
      deposit.updatedAt = now;
      await save(state);
      return {
        ok: true,
        httpStatus: 200,
        orderId,
        status: 'expired',
        amount: deposit.amount,
        walletBalance: roundInr(owner.walletBalance ?? 0),
        walletCreditApplied: false,
        alreadyCredited: false,
        deposit,
        message: 'This payment order has expired. Please create a new order.',
      };
    }

    if (rawStatus === 'failed' || rawStatus === 'cancelled') {
      deposit.status = 'failed';
      deposit.updatedAt = now;
      await save(state);
      return {
        ok: true,
        httpStatus: 200,
        orderId,
        status: 'failed',
        amount: deposit.amount,
        walletBalance: roundInr(owner.walletBalance ?? 0),
        walletCreditApplied: false,
        alreadyCredited: false,
        deposit,
        message: 'Payment failed or was cancelled.',
      };
    }

    deposit.status = 'active';
    deposit.updatedAt = now;
    await save(state);

    return {
      ok: true,
      httpStatus: 200,
      orderId,
      status: 'active',
      amount: deposit.amount,
      walletBalance: roundInr(owner.walletBalance ?? 0),
      walletCreditApplied: false,
      alreadyCredited: false,
      deposit,
      message: 'Payment is still pending. Complete UPI payment and check again.',
    };
  });
}
