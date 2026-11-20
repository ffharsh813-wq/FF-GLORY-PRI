import React, { useState } from 'react';
import {
  Check,
  Copy,
  Gift,
  Minus,
  Plus,
  RotateCcw,
  Ticket,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { CouponRecord, PublicUser } from '../types';

interface CouponsTabProps {
  user: PublicUser;
  myCoupons: CouponRecord[];
  redeemedCoupons: CouponRecord[];
  onRefresh: () => Promise<void>;
}

export const CouponsTab: React.FC<CouponsTabProps> = ({
  user,
  myCoupons,
  redeemedCoupons,
  onRefresh,
}) => {
  const { t } = useI18n();
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemFeedback, setRedeemFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [creditType, setCreditType] = useState<'basic' | 'premium'>('basic');
  const [amount, setAmount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [cancellingCode, setCancellingCode] = useState<string | null>(null);

  const available = creditType === 'basic' ? user.basicCredits : user.premiumCredits;
  const maxAllowed = creditType === 'basic' ? Math.min(100, available) : Math.min(20, available);
  const balanceAfter = Math.max(0, available - amount);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    setRedeemFeedback(null);
    try {
      const res = await apiRequest<{
        code: string;
        basic_credits: number;
        premium_credits: number;
      }>('/api/client/redeem-coupon', {
        method: 'POST',
        body: { code: redeemCode.trim().toUpperCase() },
      });
      setRedeemCode('');
      setRedeemFeedback({
        ok: true,
        text: `Redeemed! +${res.basic_credits} ${t('basic')}, +${res.premium_credits} ${t('premium')} ${t('credits')}.`,
      });
      await onRefresh();
    } catch (err) {
      setRedeemFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to redeem coupon.',
      });
    } finally {
      setRedeeming(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount < 1) return;
    setCreating(true);
    setCreateFeedback(null);
    try {
      const res = await apiRequest<{ coupon: CouponRecord }>('/api/client/create-coupon', {
        method: 'POST',
        body: {
          basic_credits: creditType === 'basic' ? amount : 0,
          premium_credits: creditType === 'premium' ? amount : 0,
        },
      });
      setAmount(0);
      setCreateFeedback({
        ok: true,
        text: `${res.coupon.code}`,
      });
      await onRefresh();
    } catch (err) {
      setCreateFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to generate coupon.',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleCancelCoupon = async (code: string) => {
    setCancellingCode(code);
    setCreateFeedback(null);
    try {
      const res = await apiRequest<{ refunded_basic: number; refunded_premium: number }>(
        '/api/client/cancel-coupon',
        {
          method: 'POST',
          body: { code },
        }
      );
      setCreateFeedback({
        ok: true,
        text: `${code} · +${res.refunded_basic} ${t('basic')} / +${res.refunded_premium} ${t('premium')}`,
      });
      await onRefresh();
    } catch (err) {
      setCreateFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to cancel coupon.',
      });
    } finally {
      setCancellingCode(null);
    }
  };

  const handleCopy = (code: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Card 1: Redeem a Coupon */}
        <form
          onSubmit={handleRedeem}
          className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
        >
          <div className="flex items-center gap-2.5 text-[#10B981]">
            <Gift className="w-5 h-5" />
            <h2 className="text-[18px] font-bold">{t('redeem_coupon')}</h2>
          </div>
          <p className="text-[13px] text-[#8E8E95]">{t('redeem_coupon_desc')}</p>

          <input
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            className="w-full h-[50px] px-4 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-[15px] tracking-wider placeholder-[#5F5F66] focus:outline-none focus:border-[#10B981]"
          />

          {redeemFeedback && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                redeemFeedback.ok
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-red-950/40 border-red-800/60 text-red-300'
              }`}
            >
              {redeemFeedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={redeeming || !redeemCode.trim()}
            className="w-full h-[50px] rounded-xl bg-[#0FA968] hover:bg-[#12BA73] disabled:opacity-60 text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            {redeeming ? t('redeeming') : t('redeem')}
          </button>
        </form>

        {/* Card 2: Create a Coupon */}
        <form
          onSubmit={handleCreate}
          className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white">
              <Plus className="w-5 h-5 text-[#DEC79B]" />
              <h2 className="text-[18px] font-bold">{t('create_coupon')}</h2>
            </div>

            {user.premiumCredits > 0 && (
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#1C1C20] border border-[#2A2A2E]">
                <button
                  type="button"
                  onClick={() => {
                    setCreditType('basic');
                    setAmount(0);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    creditType === 'basic'
                      ? 'bg-[#DEC79B] text-[#141414]'
                      : 'text-[#8E8E95] hover:text-white'
                  }`}
                >
                  {t('basic')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreditType('premium');
                    setAmount(0);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    creditType === 'premium'
                      ? 'bg-[#DEC79B] text-[#141414]'
                      : 'text-[#8E8E95] hover:text-white'
                  }`}
                >
                  {t('premium')}
                </button>
              </div>
            )}
          </div>

          <p className="text-[13px] text-[#8E8E95]">{t('create_coupon_desc')}</p>

          <div className="flex items-center justify-between text-[14px]">
            <span className="font-semibold text-white capitalize">
              {creditType === 'basic' ? t('basic') : t('premium')} {t('credits')}
            </span>
            <span className="text-[#8E8E95] tabular-nums">
              {t('available_count', { count: available })}
            </span>
          </div>

          {/* Stepper Row */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAmount((v) => Math.max(0, v - 1))}
              aria-label="Decrease credits"
              className="w-[52px] h-[52px] rounded-xl bg-[#221F19] hover:bg-[#2C2820] border border-[#383226] text-[#DEC79B] flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <Minus className="w-5 h-5" />
            </button>
            <input
              type="number"
              min={0}
              max={maxAllowed}
              value={amount}
              onChange={(e) =>
                setAmount(Math.max(0, Math.min(maxAllowed, Math.floor(Number(e.target.value) || 0))))
              }
              className="flex-1 h-[52px] text-center rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-[18px] font-bold tabular-nums focus:outline-none focus:border-[#DEC79B]"
            />
            <button
              type="button"
              onClick={() => setAmount((v) => Math.min(maxAllowed, v + 1))}
              aria-label="Increase credits"
              className="w-[52px] h-[52px] rounded-xl bg-[#221F19] hover:bg-[#2C2820] border border-[#383226] text-[#DEC79B] flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          <p className="text-[12px] text-[#7E7E86]">
            {creditType === 'basic' ? 'Max 100' : 'Max 20'}
          </p>

          <div className="pt-3 border-t border-[#242428] space-y-1.5">
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-[#9A9AA2]">{t('balance_after_creation')}</span>
              <span className="font-semibold text-white tabular-nums">
                {balanceAfter} {creditType === 'basic' ? t('basic') : t('premium')}{' '}
                {balanceAfter === 1 ? t('credit') : t('credits')}
              </span>
            </div>
            <p className="text-[12px] text-[#7E7E86]">{t('deducted_to_create')}</p>
          </div>

          {createFeedback && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                createFeedback.ok
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-red-950/40 border-red-800/60 text-red-300'
              }`}
            >
              {createFeedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={creating || amount < 1}
            className={`w-full h-[52px] rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              amount >= 1
                ? 'bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414]'
                : 'bg-[#736853] text-[#1D1C19] cursor-not-allowed'
            }`}
          >
            <Ticket className="w-[18px] h-[18px]" />
            {creating ? t('generating') : t('generate_coupon')}
          </button>
        </form>
      </div>

      {/* My Created Coupons & Redeemed Coupons History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">{t('my_created_coupons')}</h3>
            <span className="text-xs text-[#8E8E95] tabular-nums">{myCoupons.length}</span>
          </div>
          {myCoupons.length === 0 ? (
            <p className="text-xs text-[#7E7E86] py-4 text-center">{t('no_coupons_created')}</p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {myCoupons.map((c) => (
                <div
                  key={c.code}
                  className="p-3 rounded-xl bg-[#101012] border border-[#242429] flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#DEC79B]">{c.code}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(c.code)}
                        className="text-[#8E8E95] hover:text-white cursor-pointer"
                        title="Copy coupon code"
                      >
                        {copiedCode === c.code ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[11px] text-[#8E8E95] mt-0.5 tabular-nums">
                      {c.basic_credits > 0 ? `${c.basic_credits} ${t('basic')}` : ''}
                      {c.basic_credits > 0 && c.premium_credits > 0 ? ' · ' : ''}
                      {c.premium_credits > 0 ? `${c.premium_credits} ${t('premium')}` : ''} ·{' '}
                      <span className="capitalize">{c.status}</span>
                    </div>
                  </div>
                  {c.status === 'active' && c.used_count === 0 && (
                    <button
                      type="button"
                      disabled={cancellingCode === c.code}
                      onClick={() => handleCancelCoupon(c.code)}
                      className="px-2.5 py-1 rounded-lg bg-[#1E1E22] hover:bg-[#2A2A2F] border border-[#303038] text-[11px] text-[#DEC79B] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {cancellingCode === c.code ? '...' : t('cancel_and_refund')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">{t('redeemed_coupons_history')}</h3>
            <span className="text-xs text-[#8E8E95] tabular-nums">{redeemedCoupons.length}</span>
          </div>
          {redeemedCoupons.length === 0 ? (
            <p className="text-xs text-[#7E7E86] py-4 text-center">{t('no_redeemed_coupons')}</p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {redeemedCoupons.map((c) => (
                <div
                  key={c.code}
                  className="p-3 rounded-xl bg-[#101012] border border-[#242429] flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-mono text-xs font-bold text-emerald-400">{c.code}</div>
                    <div className="text-[11px] text-[#8E8E95] mt-0.5">
                      {t('from_user')} {c.created_by}
                    </div>
                  </div>
                  <div className="text-xs font-mono text-white tabular-nums">
                    +{c.basic_credits}B / +{c.premium_credits}P
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
