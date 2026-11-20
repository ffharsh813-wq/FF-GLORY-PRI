import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { parseValidDepositAmount, verifyAndCreditDeposit } from './addFundsService.ts';
import { verifyFamwiseWebhookSignature } from './famwise.ts';
import type { DatabaseState, DepositOrderRecord } from './types.ts';

function buildMockState(initialBalance = 0): { state: DatabaseState; order: DepositOrderRecord } {
  const now = new Date().toISOString();
  const order: DepositOrderRecord = {
    id: 'dep_test_1',
    orderId: 'FW_ORDER_1001',
    userId: 'user_1',
    username: 'tester',
    amount: 150.5,
    currency: 'INR',
    status: 'active',
    credited: false,
    creditedAt: null,
    upiIntent: 'upi://pay?pa=merchant@fam&am=150.50&cu=INR',
    paymentUrl: 'https://famwise.co/pay/FW_ORDER_1001',
    qrImageUrl: '',
    merchantName: 'KAKAROT GLORY PRO',
    upiId: 'merchant@fam',
    expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };

  const state: DatabaseState = {
    settings: {
      websiteName: 'KAKAROT GLORY PRO',
      websiteLogo: '',
      websiteTitle: 'KAKAROT GLORY PRO',
      websiteDescription: 'Test',
      websiteAnnouncement: '',
      registrationEnabled: true,
      maintenanceMode: false,
      websiteNotificationsEnabled: true,
      updatedAt: now,
      updatedBy: 'admin_super_1',
    },
    apiConfig: {
      baseUrl: 'https://ffglory.pro',
      masterKey: '',
      apiKey: '',
      providerUsername: '',
      providerPassword: '',
    },
    famwiseConfig: {
      baseUrl: 'https://famwise.co',
      apiKey: 'fw_test_dummy',
      upiId: 'merchant@fam',
      webhookSecret: 'whsec_test_123',
      basicCreditInr: 80,
      premiumCreditInr: 160,
    },
    adminSetupRequired: false,
    users: [
      {
        id: 'user_1',
        username: 'tester',
        email: 'tester@example.com',
        passwordHash: '',
        role: 'user',
        basicCredits: 0,
        premiumCredits: 0,
        walletBalance: initialBalance,
        maxGroups: 5,
        blocked: false,
        language: 'en',
        authProvider: 'password',
        createdAt: now,
        updatedAt: now,
      },
    ],
    groups: [],
    transactions: [],
    deposits: [order],
    creditedDepositOrderIds: [],
    creditAudits: [],
    processedOperationIds: [],
    coupons: [],
    activityLogs: [],
    notifications: [],
    apiLogs: [],
    youtubeConfig: { apiKey: '' },
    youtubeVideos: [],
    sessionSecret: 'test_secret',
  };

  return { state, order };
}

test('parseValidDepositAmount validates INR bounds and 2-decimal precision', () => {
  assert.equal(parseValidDepositAmount(1), 1);
  assert.equal(parseValidDepositAmount('150.5'), 150.5);
  assert.equal(parseValidDepositAmount('150.55'), 150.55);
  assert.equal(parseValidDepositAmount(100000), 100000);

  assert.equal(parseValidDepositAmount(0), null);
  assert.equal(parseValidDepositAmount(-10), null);
  assert.equal(parseValidDepositAmount(0.99), null);
  assert.equal(parseValidDepositAmount(100000.01), null);
  assert.equal(parseValidDepositAmount('10.123'), null);
  assert.equal(parseValidDepositAmount('abc'), null);
  assert.equal(parseValidDepositAmount(''), null);
  assert.equal(parseValidDepositAmount(null), null);
});

test('verifyAndCreditDeposit credits wallet once and ignores sequential duplicates', async () => {
  const { state } = buildMockState(10);
  let persistCalls = 0;

  const first = await verifyAndCreditDeposit({
    state,
    orderId: 'FW_ORDER_1001',
    expectedUserId: 'user_1',
    persist: async () => {
      persistCalls += 1;
    },
    fetchGatewayStatus: async () => ({
      ok: true,
      status: 200,
      data: {
        order_id: 'FW_ORDER_1001',
        amount: 150.5,
        currency: 'INR',
        status: 'paid',
      },
    }),
  });

  assert.equal(first.ok, true);
  assert.equal(first.status, 'paid');
  assert.equal(first.walletCreditApplied, true);
  assert.equal(first.alreadyCredited, false);
  assert.equal(first.walletBalance, 160.5);
  assert.equal(state.transactions.length, 1);
  assert.equal(persistCalls, 1);

  const second = await verifyAndCreditDeposit({
    state,
    orderId: 'FW_ORDER_1001',
    expectedUserId: 'user_1',
    persist: async () => {
      persistCalls += 1;
    },
    fetchGatewayStatus: async () => {
      throw new Error('Gateway should not be called again after order is already credited');
    },
  });

  assert.equal(second.ok, true);
  assert.equal(second.alreadyCredited, true);
  assert.equal(second.walletCreditApplied, false);
  assert.equal(second.walletBalance, 160.5);
  assert.equal(state.transactions.length, 1);
  assert.equal(persistCalls, 1);
});

test('verifyAndCreditDeposit prevents double-credit under concurrent Promise.all checks', async () => {
  const { state } = buildMockState(0);
  let gatewayCalls = 0;

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      verifyAndCreditDeposit({
        state,
        orderId: 'FW_ORDER_1001',
        expectedUserId: 'user_1',
        persist: async () => {},
        fetchGatewayStatus: async () => {
          gatewayCalls += 1;
          await new Promise((r) => setTimeout(r, 15));
          return {
            ok: true,
            status: 200,
            data: {
              order_id: 'FW_ORDER_1001',
              amount: 150.5,
              currency: 'INR',
              status: 'paid',
            },
          };
        },
      })
    )
  );

  const appliedCount = results.filter((r) => r.walletCreditApplied).length;
  assert.equal(appliedCount, 1);
  assert.equal(gatewayCalls, 1);
  assert.equal(state.users[0].walletBalance, 150.5);
  assert.equal(state.transactions.length, 1);
});

test('verifyAndCreditDeposit rejects amount mismatch and currency mismatch without crediting', async () => {
  const case1 = buildMockState(25);
  const underpaid = await verifyAndCreditDeposit({
    state: case1.state,
    orderId: 'FW_ORDER_1001',
    expectedUserId: 'user_1',
    persist: async () => {},
    fetchGatewayStatus: async () => ({
      ok: true,
      status: 200,
      data: {
        order_id: 'FW_ORDER_1001',
        amount: 100,
        currency: 'INR',
        status: 'paid',
      },
    }),
  });
  assert.equal(underpaid.ok, false);
  assert.equal(underpaid.httpStatus, 422);
  assert.equal(underpaid.status, 'failed');
  assert.equal(case1.state.users[0].walletBalance, 25);

  const case2 = buildMockState(25);
  const wrongCurrency = await verifyAndCreditDeposit({
    state: case2.state,
    orderId: 'FW_ORDER_1001',
    expectedUserId: 'user_1',
    persist: async () => {},
    fetchGatewayStatus: async () => ({
      ok: true,
      status: 200,
      data: {
        order_id: 'FW_ORDER_1001',
        amount: 150.5,
        currency: 'USD',
        status: 'paid',
      },
    }),
  });
  assert.equal(wrongCurrency.ok, false);
  assert.equal(wrongCurrency.httpStatus, 422);
  assert.equal(case2.state.users[0].walletBalance, 25);
});

test('verifyAndCreditDeposit enforces user ownership and handles expired orders', async () => {
  const { state } = buildMockState(50);

  const unauthorized = await verifyAndCreditDeposit({
    state,
    orderId: 'FW_ORDER_1001',
    expectedUserId: 'different_user',
    persist: async () => {},
    fetchGatewayStatus: async () => ({ ok: true, status: 200, data: { status: 'paid' } }),
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.httpStatus, 403);
  assert.equal(state.users[0].walletBalance, 50);

  const expired = await verifyAndCreditDeposit({
    state,
    orderId: 'FW_ORDER_1001',
    expectedUserId: 'user_1',
    persist: async () => {},
    fetchGatewayStatus: async () => ({
      ok: true,
      status: 200,
      data: { order_id: 'FW_ORDER_1001', status: 'expired' },
    }),
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.walletCreditApplied, false);
  assert.equal(state.users[0].walletBalance, 50);
});

test('verifyFamwiseWebhookSignature validates HMAC-SHA256 signatures accurately', () => {
  const secret = 'whsec_test_999';
  const payload = JSON.stringify({ event: 'payment.paid', data: { order_id: 'FW_123' } });
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

  assert.equal(verifyFamwiseWebhookSignature(payload, sig, secret), true);
  assert.equal(verifyFamwiseWebhookSignature(payload, sig, 'wrong_secret'), false);
  assert.equal(verifyFamwiseWebhookSignature(`${payload} `, sig, secret), false);
  assert.equal(verifyFamwiseWebhookSignature(payload, undefined, secret), false);
});
