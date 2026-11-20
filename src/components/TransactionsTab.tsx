import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Plus,
  QrCode,
  RefreshCw,
  Wallet,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { DepositOrderRecord, PricingData, PublicUser, TransactionRecord } from '../types';
import { AddFundsModal } from './AddFundsModal';
import type { DashboardTab } from './DashboardHeader';

interface TransactionsTabProps {
  user: PublicUser;
  pricing: PricingData | null;
  transactions: TransactionRecord[];
  onSelectTab: (tab: DashboardTab) => void;
  onRefresh: () => Promise<void>;
}

interface DepositHistoryResponse {
  ok: boolean;
  deposits: DepositOrderRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  walletBalance: number;
}

export const TransactionsTab: React.FC<TransactionsTabProps> = ({
  user,
  pricing,
  transactions,
  onSelectTab,
  onRefresh,
}) => {
  const { t } = useI18n();
  const [view, setView] = useState<'all' | 'deposits'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Paginated Deposit History
  const [depositPage, setDepositPage] = useState(1);
  const [depositsData, setDepositsData] = useState<DepositHistoryResponse | null>(null);
  const [loadingDeposits, setLoadingDeposits] = useState(false);

  // Add Funds Modal state
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [selectedDeposit, setSelectedDeposit] = useState<DepositOrderRecord | null>(null);

  const loadDeposits = useCallback(async (page: number) => {
    setLoadingDeposits(true);
    try {
      const res = await apiRequest<DepositHistoryResponse>(
        `/api/add-funds/history?page=${page}&limit=5`
      );
      setDepositsData(res);
      setDepositPage(res.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deposit history.');
    } finally {
      setLoadingDeposits(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'deposits') {
      void loadDeposits(depositPage);
    }
  }, [view, depositPage, loadDeposits]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    setFeedback('');
    try {
      await Promise.all([
        onRefresh(),
        view === 'deposits' ? loadDeposits(depositPage) : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleCancelPending = async (txnId: string) => {
    setBusyId(txnId);
    setError('');
    try {
      await apiRequest('/api/client/cancel-transaction', {
        method: 'POST',
        body: { transaction_id: txnId },
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel transaction.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCheckDepositStatus = async (orderId: string) => {
    setBusyId(orderId);
    setError('');
    setFeedback('');
    try {
      const res = await apiRequest<{
        ok: boolean;
        status: string;
        message: string;
        walletCreditApplied?: boolean;
      }>(`/api/add-funds/status/${encodeURIComponent(orderId)}`);
      setFeedback(res.message);
      await Promise.all([onRefresh(), loadDeposits(depositPage)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check deposit status.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[19px] font-bold text-white leading-tight">
                {t('transaction_history')}
              </h2>
              <p className="text-xs text-[#8E8E95] tabular-nums mt-0.5">
                {t('wallet_label')}{' '}
                <span className="text-[#DEC79B] font-semibold">
                  ₹{(depositsData?.walletBalance ?? user.walletBalance ?? 0).toFixed(2)}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedDeposit(null);
                setAddFundsOpen(true);
              }}
              className="px-3.5 h-10 rounded-full bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414] text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              {t('add_funds')}
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 h-10 rounded-full bg-[#1A1A1D] hover:bg-[#222226] border border-[#2C2C32] text-sm font-medium text-[#E4E4E7] inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </button>
          </div>
        </div>

        {/* View Toggle: All Transactions vs Paginated Deposit History */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setView('all');
              setError('');
              setFeedback('');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              view === 'all'
                ? 'bg-[#DEC79B] text-[#141414]'
                : 'bg-[#101012] border border-[#242429] text-[#9A9AA2] hover:text-white'
            }`}
          >
            {t('all_transactions')}
          </button>
          <button
            type="button"
            onClick={() => {
              setView('deposits');
              setError('');
              setFeedback('');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              view === 'deposits'
                ? 'bg-[#DEC79B] text-[#141414]'
                : 'bg-[#101012] border border-[#242429] text-[#9A9AA2] hover:text-white'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            {t('deposit_history')}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-300">
            {error}
          </div>
        )}
        {feedback && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
            {feedback}
          </div>
        )}

        {/* VIEW 1: ALL TRANSACTIONS */}
        {view === 'all' &&
          (transactions.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <ClipboardList className="w-12 h-12 text-[#71717A] stroke-[1.6]" />
              <p className="text-[15px] text-[#8E8E95] font-medium">{t('no_transactions_yet')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((txn) => (
                <div
                  key={txn.id}
                  className="p-4 rounded-2xl bg-[#101012] border border-[#242429] space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-[#DEC79B] font-semibold">
                        {txn.id}
                      </span>
                      <span className="text-[11px] text-[#7A7A82] capitalize">
                        · {txn.type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <span
                      className={`text-[11px] font-semibold capitalize px-2.5 py-0.5 rounded-lg border ${
                        txn.status === 'approved' || txn.status === 'completed'
                          ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                          : txn.status === 'pending'
                            ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                            : 'bg-[#1D1D21] border-[#2E2E34] text-[#8E8E95]'
                      }`}
                    >
                      {txn.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="font-mono font-semibold text-white tabular-nums flex flex-wrap items-center gap-2">
                      {typeof txn.amount_inr === 'number' && txn.amount_inr !== 0 && (
                        <span
                          className={txn.amount_inr > 0 ? 'text-emerald-400' : 'text-amber-300'}
                        >
                          {txn.amount_inr > 0
                            ? `+₹${txn.amount_inr.toFixed(2)}`
                            : `-₹${Math.abs(txn.amount_inr).toFixed(2)}`}
                        </span>
                      )}
                      {txn.basic_credits !== 0 && (
                        <span
                          className={txn.basic_credits > 0 ? 'text-emerald-400' : 'text-amber-300'}
                        >
                          {txn.basic_credits > 0 ? `+${txn.basic_credits}` : txn.basic_credits}{' '}
                          {t('basic')}
                        </span>
                      )}
                      {txn.premium_credits !== 0 && (
                        <span
                          className={
                            txn.premium_credits > 0 ? 'text-emerald-400' : 'text-amber-300'
                          }
                        >
                          {txn.premium_credits > 0
                            ? `+${txn.premium_credits}`
                            : txn.premium_credits}{' '}
                          {t('premium')}
                        </span>
                      )}
                    </div>
                    <span className="text-[#7E7E86] tabular-nums">
                      {new Date(txn.created_at).toLocaleString()}
                    </span>
                  </div>

                  {txn.details && <p className="text-xs text-[#9A9AA2]">{txn.details}</p>}

                  {txn.status === 'pending' && (
                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={busyId === txn.id}
                        onClick={() => handleCancelPending(txn.id)}
                        className="px-3 py-1.5 rounded-lg bg-red-950/30 hover:bg-red-950/60 border border-red-900/50 text-xs text-red-400 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {busyId === txn.id ? t('cancelling') : t('cancel_pending')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

        {/* VIEW 2: PAGINATED FAMWISE DEPOSIT HISTORY */}
        {view === 'deposits' && (
          <div className="space-y-3">
            {loadingDeposits && !depositsData ? (
              <div className="py-10 text-center text-xs text-[#8E8E95]">{t('loading')}</div>
            ) : !depositsData || depositsData.deposits.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                <Wallet className="w-11 h-11 text-[#71717A] stroke-[1.6]" />
                <p className="text-[15px] text-[#8E8E95] font-medium">{t('no_upi_deposits')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDeposit(null);
                    setAddFundsOpen(true);
                  }}
                  className="px-4 h-9 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-bold cursor-pointer"
                >
                  {t('create_first_deposit')}
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {depositsData.deposits.map((dep) => (
                    <div
                      key={dep.id}
                      className="p-4 rounded-2xl bg-[#101012] border border-[#242429] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-mono text-[#DEC79B] font-semibold truncate">
                            {dep.orderId}
                          </span>
                          {dep.upiId && (
                            <span className="text-[11px] text-[#7A7A82] hidden sm:inline">
                              · {dep.upiId}
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[11px] font-semibold capitalize px-2.5 py-0.5 rounded-lg border ${
                            dep.status === 'paid'
                              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                              : dep.status === 'active'
                                ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                                : 'bg-red-950/35 border-red-900/50 text-red-400'
                          }`}
                        >
                          {dep.status}
                          {dep.credited ? ' · Credited' : ''}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-bold text-white text-sm tabular-nums">
                          ₹{dep.amount.toFixed(2)} INR
                        </span>
                        <span className="text-[#7E7E86] tabular-nums">
                          {new Date(dep.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {dep.creditedAt && (
                        <div className="text-[11px] text-emerald-400/90 tabular-nums">
                          Credited at {new Date(dep.creditedAt).toLocaleString()}
                        </div>
                      )}

                      {dep.status === 'active' && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {dep.upiIntent && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDeposit(dep);
                                setAddFundsOpen(true);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-[#1A1A1E] hover:bg-[#232329] border border-[#2D2D35] text-xs text-[#DEC79B] inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              {t('view_qr')}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === dep.orderId}
                            onClick={() => void handleCheckDepositStatus(dep.orderId)}
                            className="px-3 py-1.5 rounded-lg bg-[#0FA968] hover:bg-[#12BA73] disabled:opacity-60 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${busyId === dep.orderId ? 'animate-spin' : ''}`}
                            />
                            {busyId === dep.orderId ? t('checking') : t('check_status')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#202024]">
                  <span className="text-xs text-[#8E8E95] tabular-nums">
                    {depositsData.page} / {depositsData.totalPages} ({depositsData.total})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!depositsData.hasPrev || loadingDeposits}
                      onClick={() => setDepositPage((p) => Math.max(1, p - 1))}
                      className="h-9 px-3 rounded-xl bg-[#1A1A1D] border border-[#2C2C32] disabled:opacity-40 text-xs font-medium text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      {t('previous')}
                    </button>
                    <button
                      type="button"
                      disabled={!depositsData.hasNext || loadingDeposits}
                      onClick={() => setDepositPage((p) => p + 1)}
                      className="h-9 px-3 rounded-xl bg-[#1A1A1D] border border-[#2C2C32] disabled:opacity-40 text-xs font-medium text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      {t('next')}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <AddFundsModal
        isOpen={addFundsOpen}
        onClose={() => {
          setAddFundsOpen(false);
          setSelectedDeposit(null);
          if (view === 'deposits') {
            void loadDeposits(depositPage);
          }
        }}
        user={user}
        pricing={pricing}
        onSelectTab={onSelectTab}
        onRefreshData={async () => {
          await onRefresh();
          if (view === 'deposits') {
            await loadDeposits(depositPage);
          }
        }}
        initialDeposit={selectedDeposit}
      />
    </>
  );
};
