import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AddFundsConfigView,
  DepositOrderRecord,
  PricingData,
  PublicUser,
} from '../types';
import type { DashboardTab } from './DashboardHeader';

interface AddFundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: PublicUser;
  pricing: PricingData | null;
  onSelectTab: (tab: DashboardTab) => void;
  onRefreshData: () => Promise<void> | void;
  initialMode?: 'upi' | 'buy' | 'manual';
  initialDeposit?: DepositOrderRecord | null;
}

const PRESET_AMOUNTS = [80, 160, 240, 400];
const MAX_AUTO_POLLS = 24; // 24 * 5s = 2 minutes bounded polling

export const AddFundsModal: React.FC<AddFundsModalProps> = ({
  isOpen,
  onClose,
  user,
  pricing,
  onSelectTab,
  onRefreshData,
  initialMode = 'upi',
  initialDeposit = null,
}) => {
  const [mode, setMode] = useState<'upi' | 'buy' | 'manual'>(initialMode);
  const [config, setConfig] = useState<AddFundsConfigView | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // UPI Deposit State
  const [amountInput, setAmountInput] = useState('80');
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [deposit, setDeposit] = useState<DepositOrderRecord | null>(initialDeposit);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [upiFeedback, setUpiFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState(false);
  const pollCountRef = useRef(0);

  // Buy Credits from Wallet State
  const [buyTier, setBuyTier] = useState<'basic' | 'premium'>('basic');
  const [buyQty, setBuyQty] = useState(1);
  const [buyingCredits, setBuyingCredits] = useState(false);
  const [buyFeedback, setBuyFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Manual Credit Request State (existing flow preserved)
  const [reqBasic, setReqBasic] = useState(1);
  const [reqPremium, setReqPremium] = useState(0);
  const [reqNote, setReqNote] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);
  const [reqFeedback, setReqFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const cfg = await apiRequest<AddFundsConfigView>('/api/add-funds/config');
      setConfig(cfg);
    } catch (err) {
      setUpiFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Could not load Add Funds configuration.',
      });
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setDeposit(initialDeposit);
    setUpiFeedback(null);
    setBuyFeedback(null);
    setReqFeedback(null);
    pollCountRef.current = 0;
    void loadConfig();
  }, [isOpen, initialMode, initialDeposit, loadConfig]);

  // Render crisp local QR code from upiIntent without external QR proxy dependencies
  useEffect(() => {
    let active = true;
    if (!deposit?.upiIntent) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(deposit.upiIntent, {
      width: 220,
      margin: 2,
      color: { dark: '#111113', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [deposit?.upiIntent]);

  const checkOrderStatus = useCallback(
    async (orderId: string, silent = false) => {
      if (!silent) setCheckingStatus(true);
      try {
        const res = await apiRequest<{
          ok: boolean;
          orderId: string;
          status: 'active' | 'paid' | 'expired' | 'failed';
          amount: number;
          walletBalance: number;
          walletCreditApplied: boolean;
          alreadyCredited: boolean;
          deposit?: DepositOrderRecord;
          message: string;
        }>(`/api/add-funds/status/${encodeURIComponent(orderId)}`);

        if (res.deposit) {
          setDeposit(res.deposit);
        }
        if (res.status === 'paid') {
          setUpiFeedback({ ok: true, text: res.message });
          setConfig((prev) => (prev ? { ...prev, walletBalance: res.walletBalance } : prev));
          await onRefreshData();
        } else if (res.status === 'expired' || res.status === 'failed') {
          setUpiFeedback({ ok: false, text: res.message });
        } else if (!silent) {
          setUpiFeedback({ ok: true, text: res.message });
        }
      } catch (err) {
        if (!silent) {
          setUpiFeedback({
            ok: false,
            text: err instanceof Error ? err.message : 'Failed to verify payment status.',
          });
        }
      } finally {
        if (!silent) setCheckingStatus(false);
      }
    },
    [onRefreshData]
  );

  // Bounded polling every 5 seconds while an active order is displayed
  useEffect(() => {
    if (!isOpen || !deposit || deposit.status !== 'active') return;
    pollCountRef.current = 0;

    const timer = setInterval(() => {
      if (pollCountRef.current >= MAX_AUTO_POLLS) {
        clearInterval(timer);
        return;
      }
      pollCountRef.current += 1;
      void checkOrderStatus(deposit.orderId, true);
    }, 5000);

    return () => clearInterval(timer);
  }, [isOpen, deposit, checkOrderStatus]);

  if (!isOpen) return null;

  const walletBalance = config?.walletBalance ?? user.walletBalance ?? 0;
  const basicCreditInr = config?.basicCreditInr ?? 80;
  const premiumCreditInr = config?.premiumCreditInr ?? 160;

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpiFeedback(null);
    const trimmed = amountInput.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > 100000) {
      setUpiFeedback({
        ok: false,
        text: 'Enter a valid amount between ₹1 and ₹100,000 (up to 2 decimal places).',
      });
      return;
    }

    setCreatingOrder(true);
    try {
      const res = await apiRequest<{ ok: boolean; deposit: DepositOrderRecord }>(
        '/api/add-funds/create',
        {
          method: 'POST',
          body: { amount: Number(trimmed) },
        }
      );
      setDeposit(res.deposit);
      pollCountRef.current = 0;
    } catch (err) {
      setUpiFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Could not create Famwise UPI order.',
      });
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleCopyOrderId = async () => {
    if (!deposit?.orderId) return;
    try {
      await navigator.clipboard.writeText(deposit.orderId);
      setCopiedOrderId(true);
      setTimeout(() => setCopiedOrderId(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleBuyCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyingCredits(true);
    setBuyFeedback(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        walletBalance: number;
        message: string;
      }>('/api/add-funds/buy-credits', {
        method: 'POST',
        body: { creditType: buyTier, quantity: buyQty },
      });
      setConfig((prev) => (prev ? { ...prev, walletBalance: res.walletBalance } : prev));
      setBuyFeedback({ ok: true, text: res.message });
      await onRefreshData();
    } catch (err) {
      setBuyFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to purchase credits from wallet.',
      });
    } finally {
      setBuyingCredits(false);
    }
  };

  const handleSubmitCreditsRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingReq(true);
    setReqFeedback(null);
    try {
      await apiRequest('/api/client/add-credits-request', {
        method: 'POST',
        body: {
          basic_credits: reqBasic,
          premium_credits: reqPremium,
          note: reqNote,
        },
      });
      setReqFeedback({
        ok: true,
        text: 'Credit order submitted! Pending approval in Transactions.',
      });
      setReqNote('');
      await onRefreshData();
    } catch (err) {
      setReqFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to create credit request.',
      });
    } finally {
      setSubmittingReq(false);
    }
  };

  const unitCostInr = buyTier === 'basic' ? basicCreditInr : premiumCreditInr;
  const totalBuyCost = Math.round(buyQty * unitCostInr * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-[#141416] border border-[#28282C] rounded-[20px] p-5 sm:p-6 space-y-4 my-auto max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white">Add Funds & Credits</h3>
            <p className="text-xs text-[#8E8E95] tabular-nums">
              Wallet: <span className="text-[#DEC79B] font-semibold">₹{walletBalance.toFixed(2)}</span>
              {' · '}
              {user.basicCredits} Basic · {user.premiumCredits} Premium
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-lg bg-[#1E1E22] text-[#A1A1AA] hover:text-white flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-3 gap-1.5 bg-[#101012] p-1 rounded-xl border border-[#242429]">
          <button
            type="button"
            onClick={() => setMode('upi')}
            className={`h-9 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'upi' ? 'bg-[#DEC79B] text-[#141414]' : 'text-[#9A9AA2] hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            Add Funds
          </button>
          <button
            type="button"
            onClick={() => setMode('buy')}
            className={`h-9 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'buy' ? 'bg-[#DEC79B] text-[#141414]' : 'text-[#9A9AA2] hover:text-white'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            Buy Credits
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`h-9 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'manual'
                ? 'bg-[#DEC79B] text-[#141414]'
                : 'text-[#9A9AA2] hover:text-white'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            Manual
          </button>
        </div>

        {/* MODE 1: AUTOMATIC FAMWISE UPI ADD FUNDS */}
        {mode === 'upi' && (
          <div className="space-y-4">
            {!loadingConfig && config && !config.configured && (
              <div className="p-3 rounded-xl bg-amber-950/35 border border-amber-800/50 text-xs text-amber-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Automatic UPI gateway is not configured yet. Please contact admin or use the Manual
                  tab.
                </span>
              </div>
            )}

            {!deposit ? (
              <form onSubmit={handleCreateOrder} className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429] flex items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-[#8E8E95] block">Available Wallet Balance</span>
                    <span className="text-lg font-bold font-mono text-[#DEC79B] tabular-nums">
                      ₹{walletBalance.toFixed(2)}
                    </span>
                  </div>
                  {config?.upiId && (
                    <div className="text-right">
                      <span className="text-[#8E8E95] block">Merchant UPI</span>
                      <span className="font-mono text-[#D1D1D6]">{config.upiId}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[#A1A1AA] mb-1.5">
                    Deposit Amount (₹ INR · Min ₹1)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#DEC79B]">
                      ₹
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      step="0.01"
                      required
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder="Enter amount in INR"
                      className="w-full h-11 pl-8 pr-4 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-sm focus:outline-none focus:border-[#DEC79B]"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-2 mt-2.5">
                    {PRESET_AMOUNTS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmountInput(String(preset))}
                        className={`h-8 rounded-lg text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                          Number(amountInput) === preset
                            ? 'bg-[#282218] border-[#DEC79B] text-[#DEC79B]'
                            : 'bg-[#101012] border-[#26262B] text-[#A1A1AA] hover:text-white'
                        }`}
                      >
                        ₹{preset}
                      </button>
                    ))}
                  </div>
                </div>

                {upiFeedback && (
                  <div
                    className={`p-3 rounded-xl text-xs border ${
                      upiFeedback.ok
                        ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                        : 'bg-red-950/40 border-red-800/60 text-red-300'
                    }`}
                  >
                    {upiFeedback.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={creatingOrder || (config !== null && !config.configured)}
                  className="w-full h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-50 text-[#141414] text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  {creatingOrder ? 'Generating UPI QR...' : 'Generate Payment QR'}
                </button>
              </form>
            ) : (
              <div className="space-y-3.5">
                {/* Order Summary Bar */}
                <div className="p-3 rounded-xl bg-[#101012] border border-[#242429] space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8E8E95]">Order ID</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold text-[#DEC79B]">
                        {deposit.orderId}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyOrderId}
                        title="Copy Order ID"
                        className="text-[#8E8E95] hover:text-white cursor-pointer"
                      >
                        {copiedOrderId ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8E8E95]">Payable Amount</span>
                    <span className="font-mono font-bold text-white text-sm">
                      ₹{deposit.amount.toFixed(2)} INR
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8E8E95]">Status</span>
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold capitalize border ${
                        deposit.status === 'paid'
                          ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-400'
                          : deposit.status === 'active'
                            ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                            : 'bg-red-950/40 border-red-800/60 text-red-400'
                      }`}
                    >
                      {deposit.status}
                    </span>
                  </div>
                  {deposit.upiId && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#8E8E95]">UPI ID</span>
                      <span className="font-mono text-[#D1D1D6]">{deposit.upiId}</span>
                    </div>
                  )}
                  {deposit.expiresAt && deposit.status === 'active' && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#8E8E95]">Expires</span>
                      <span className="text-[#A1A1AA] tabular-nums">
                        {new Date(deposit.expiresAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* UPI QR Display while Active */}
                {deposit.status === 'active' && (
                  <div className="flex flex-col items-center p-4 rounded-2xl bg-[#101012] border border-[#242429] space-y-3">
                    {qrDataUrl || deposit.qrImageUrl ? (
                      <div className="p-2.5 bg-white rounded-xl shadow-inner">
                        <img
                          src={qrDataUrl || deposit.qrImageUrl}
                          alt={`UPI QR for Order ${deposit.orderId}`}
                          className="w-[196px] h-[196px] block"
                        />
                      </div>
                    ) : (
                      <div className="w-[196px] h-[196px] rounded-xl bg-[#18181B] flex items-center justify-center text-xs text-[#7E7E86]">
                        Rendering QR...
                      </div>
                    )}
                    <p className="text-[11px] text-center text-[#9A9AA2]">
                      Scan with PhonePe, GPay, Paytm, FamApp or any UPI app. Wallet credits
                      automatically once verified.
                    </p>
                  </div>
                )}

                {deposit.status === 'paid' && (
                  <div className="p-4 rounded-2xl bg-emerald-950/35 border border-emerald-800/60 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs">
                      <div className="font-bold text-emerald-300">
                        Payment Verified · ₹{deposit.amount.toFixed(2)} Credited
                      </div>
                      <p className="text-emerald-200/80">
                        Your wallet balance is now ₹{walletBalance.toFixed(2)}. You can immediately
                        buy Basic or Premium credits.
                      </p>
                    </div>
                  </div>
                )}

                {upiFeedback && deposit.status !== 'paid' && (
                  <div
                    className={`p-3 rounded-xl text-xs border ${
                      upiFeedback.ok
                        ? 'bg-[#19191D] border-[#2C2C34] text-[#D1D1D6]'
                        : 'bg-red-950/40 border-red-800/60 text-red-300'
                    }`}
                  >
                    {upiFeedback.text}
                  </div>
                )}

                {/* Action Buttons */}
                {deposit.status === 'active' ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <a
                        href={deposit.upiIntent}
                        className="h-10 rounded-xl bg-[#1C1C20] hover:bg-[#242429] border border-[#2E2E35] text-xs font-semibold text-[#DEC79B] inline-flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open UPI App
                      </a>
                      <button
                        type="button"
                        disabled={checkingStatus}
                        onClick={() => void checkOrderStatus(deposit.orderId, false)}
                        className="h-10 rounded-xl bg-[#0FA968] hover:bg-[#12BA73] disabled:opacity-60 text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${checkingStatus ? 'animate-spin' : ''}`}
                        />
                        {checkingStatus ? 'Checking...' : 'Check Status'}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDeposit(null);
                        setUpiFeedback(null);
                      }}
                      className="w-full h-9 rounded-xl text-[11px] text-[#8E8E95] hover:text-white cursor-pointer"
                    >
                      Generate Different Amount
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDeposit(null);
                        setUpiFeedback(null);
                      }}
                      className="h-10 rounded-xl bg-[#1C1C20] border border-[#2D2D33] text-xs font-semibold text-white cursor-pointer"
                    >
                      New Deposit
                    </button>
                    {deposit.status === 'paid' && (
                      <button
                        type="button"
                        onClick={() => setMode('buy')}
                        className="h-10 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-bold cursor-pointer"
                      >
                        Buy Credits Now
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* MODE 2: BUY CREDITS USING ₹ WALLET BALANCE */}
        {mode === 'buy' && (
          <form onSubmit={handleBuyCredits} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429] flex items-center justify-between text-xs">
              <span className="text-[#8E8E95]">Wallet Balance</span>
              <span className="text-lg font-bold font-mono text-[#DEC79B] tabular-nums">
                ₹{walletBalance.toFixed(2)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setBuyTier('basic')}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  buyTier === 'basic'
                    ? 'bg-[#282218] border-[#DEC79B]'
                    : 'bg-[#101012] border-[#26262B]'
                }`}
              >
                <div className="text-xs font-bold text-white">Basic Credit</div>
                <div className="text-[11px] font-mono text-[#DEC79B] mt-0.5">
                  ₹{basicCreditInr} / credit
                </div>
              </button>
              <button
                type="button"
                onClick={() => setBuyTier('premium')}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  buyTier === 'premium'
                    ? 'bg-[#282218] border-[#DEC79B]'
                    : 'bg-[#101012] border-[#26262B]'
                }`}
              >
                <div className="text-xs font-bold text-white">Premium Credit</div>
                <div className="text-[11px] font-mono text-[#DEC79B] mt-0.5">
                  ₹{premiumCreditInr} / credit
                </div>
              </button>
            </div>

            <div>
              <label className="block text-xs text-[#A1A1AA] mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={buyQty}
                onChange={(e) => setBuyQty(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-sm focus:outline-none focus:border-[#DEC79B]"
              />
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[1, 2, 3, 5].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setBuyQty(qty)}
                    className={`h-8 rounded-lg text-[11px] font-mono font-semibold border transition-colors cursor-pointer ${
                      buyQty === qty
                        ? 'bg-[#282218] border-[#DEC79B] text-[#DEC79B]'
                        : 'bg-[#101012] border-[#26262B] text-[#A1A1AA] hover:text-white'
                    }`}
                  >
                    {qty} Cr (₹{qty * unitCostInr})
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs bg-[#19191C] border border-[#26262B] rounded-xl px-3.5 py-2.5">
              <span className="text-[#9A9AA0]">Total Deduction from Wallet</span>
              <span className="font-mono font-bold text-[#DEC79B]">₹{totalBuyCost.toFixed(2)}</span>
            </div>

            {buyFeedback && (
              <div
                className={`p-3 rounded-xl text-xs border ${
                  buyFeedback.ok
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}
              >
                {buyFeedback.text}
              </div>
            )}

            <div className="flex gap-2.5">
              {walletBalance < totalBuyCost && (
                <button
                  type="button"
                  onClick={() => setMode('upi')}
                  className="flex-1 h-11 rounded-xl bg-[#1C1C20] border border-[#2D2D33] text-xs font-semibold text-[#DEC79B] cursor-pointer"
                >
                  Top Up Wallet
                </button>
              )}
              <button
                type="submit"
                disabled={buyingCredits || walletBalance < totalBuyCost}
                className="flex-1 h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-50 text-[#141414] text-xs font-bold cursor-pointer"
              >
                {buyingCredits ? 'Processing...' : `Buy ${buyQty} ${buyTier} Credit(s)`}
              </button>
            </div>
          </form>
        )}

        {/* MODE 3: MANUAL REQUEST / COUPON (EXISTING FLOW PRESERVED) */}
        {mode === 'manual' && (
          <form onSubmit={handleSubmitCreditsRequest} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#A1A1AA] mb-1">
                  Basic Credits (${pricing?.basic_credit_usd ?? 1.5}/ea)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={reqBasic}
                  onChange={(e) => setReqBasic(Math.max(0, Number(e.target.value)))}
                  className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-sm focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#A1A1AA] mb-1">
                  Premium Credits (${pricing?.premium_credit_usd ?? 3.0}/ea)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={reqPremium}
                  onChange={(e) => setReqPremium(Math.max(0, Number(e.target.value)))}
                  className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-sm focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs bg-[#19191C] border border-[#26262B] rounded-xl px-3.5 py-2.5">
              <span className="text-[#9A9AA0]">Estimated Total</span>
              <span className="font-mono font-bold text-[#DEC79B]">
                $
                {(
                  reqBasic * (pricing?.basic_credit_usd ?? 1.5) +
                  reqPremium * (pricing?.premium_credit_usd ?? 3.0)
                ).toFixed(2)}{' '}
                USD
              </span>
            </div>

            <div>
              <label className="block text-xs text-[#A1A1AA] mb-1">
                Payment Reference / Note (optional)
              </label>
              <input
                type="text"
                value={reqNote}
                onChange={(e) => setReqNote(e.target.value)}
                placeholder="Order / payment reference for admin verification"
                className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-sm placeholder-[#5F5F66] focus:outline-none focus:border-[#DEC79B]"
              />
            </div>

            {reqFeedback && (
              <div
                className={`p-3 rounded-xl text-xs border ${
                  reqFeedback.ok
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}
              >
                {reqFeedback.text}
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSelectTab('coupons');
                }}
                className="flex-1 h-11 rounded-xl bg-[#1C1C20] border border-[#2D2D33] text-xs font-semibold text-[#D1D1D6] hover:text-white cursor-pointer"
              >
                Redeem Coupon Instead
              </button>
              <button
                type="submit"
                disabled={submittingReq || reqBasic + reqPremium <= 0}
                className="flex-1 h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-50 text-[#141414] text-xs font-bold cursor-pointer"
              >
                {submittingReq ? 'Submitting...' : 'Submit Credit Order'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
