import React, { useMemo, useState } from 'react';
import {
  Clock,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  Square,
  Trash2,
  Trophy,
  Zap,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { ActivityLogRecord, GroupRecord } from '../types';
import { RegionFlag } from './RegionFlag';

interface HistoryTabProps {
  logs: ActivityLogRecord[];
  groups: GroupRecord[];
  onRefresh: () => Promise<void>;
}

const GROUP_PALETTE = ['#C8B07B', '#4ADE80', '#60A5FA', '#F472B6', '#FBBF24', '#A78BFA'];

function getGroupColor(groupId?: string): string {
  if (!groupId) return '#71717A';
  let sum = 0;
  for (let i = 0; i < groupId.length; i += 1) {
    sum += groupId.charCodeAt(i);
  }
  return GROUP_PALETTE[sum % GROUP_PALETTE.length];
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ logs, groups, onRefresh }) => {
  const { t } = useI18n();
  const groupById = useMemo(() => {
    const map = new Map<string, GroupRecord>();
    for (const g of groups) map.set(g.group_id, g);
    return map;
  }, [groups]);

  const [refreshing, setRefreshing] = useState(false);
  const [gloryModal, setGloryModal] = useState<{
    clan_id: string;
    clan_name?: string;
    glory_farmed: number;
    snapshots: Array<{ captured_at: string; total_glory: number }>;
  } | null>(null);

  const stats = useMemo(() => {
    const launches = logs.filter((l) => l.action === 'start').length;
    const stops = logs.filter((l) => l.action === 'stop').length;
    const deletes = logs.filter((l) => l.action === 'delete').length;
    const refunds = logs.filter((l) => l.action === 'refund').length;
    return { launches, stops, deletes, refunds, totalGroups: groups.length };
  }, [logs, groups]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenGloryTimeline = async (groupId: string) => {
    try {
      const data = await apiRequest<{
        clan_id: string;
        clan_name?: string;
        glory_farmed: number;
        snapshots: Array<{ captured_at: string; total_glory: number }>;
      }>(`/api/client/glory-progression?group_id=${encodeURIComponent(groupId)}`);
      setGloryModal(data);
    } catch {
      // ignore if group no longer exists
    }
  };

  return (
    <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 sm:p-5 space-y-4">
      {/* Header matching Screenshot 3 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <h2 className="text-[19px] font-bold text-white leading-tight">{t('group_history')}</h2>
          <span className="px-2.5 py-0.5 rounded-full bg-[#1E1E22] border border-[#2D2D33] text-xs font-semibold text-[#D1D1D6] tabular-nums">
            {logs.length}
          </span>
        </div>

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

      {/* 5 Summary Counters matching Screenshot 3 */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-semibold tabular-nums">
        <span className="text-[#10B981]">
          {t('launches')}: {stats.launches}
        </span>
        <span className="text-[#F59E0B]">
          {t('stops')}: {stats.stops}
        </span>
        <span className="text-[#EF4444]">
          {t('deletes')}: {stats.deletes}
        </span>
        <span className="text-[#3B82F6]">
          {t('refunds')}: {stats.refunds}
        </span>
        <span className="text-white">
          {t('groups_label')}: {stats.totalGroups}
        </span>
      </div>

      <p className="text-xs text-[#8E8E95] leading-relaxed">{t('history_legend')}</p>

      {/* Compact Color-Coded Git-Graph Timeline Feed matching Screenshot 3 */}
      {logs.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <Clock className="w-10 h-10 text-[#686872] mx-auto" />
          <p className="text-sm text-[#8E8E95]">{t('no_activity_yet')}</p>
        </div>
      ) : (
        <div className="space-y-0">
          {logs.map((entry, idx) => {
            const lineColor = getGroupColor(entry.group_id);
            const isLast = idx === logs.length - 1;
            const matchedGroup = entry.group_id ? groupById.get(entry.group_id) : undefined;
            const clanName = entry.clan_name || matchedGroup?.clan_info?.decoded?.clan_name;
            const gloryVal = entry.glory_farmed ?? matchedGroup?.glory_farmed;

            const actionMeta =
              entry.action === 'start'
                ? { label: t('action_launched'), color: 'text-[#4ADE80]', icon: Play }
                : entry.action === 'stop'
                  ? { label: t('action_stopped'), color: 'text-[#F59E0B]', icon: Square }
                  : entry.action === 'delete'
                    ? { label: t('action_deleted'), color: 'text-[#F87171]', icon: Trash2 }
                    : entry.action === 'refund'
                      ? { label: t('action_refunded'), color: 'text-[#60A5FA]', icon: RotateCcw }
                      : entry.action === 'restart'
                        ? { label: t('action_restarted'), color: 'text-[#DEC79B]', icon: RefreshCw }
                        : entry.action === 'extend'
                          ? { label: t('action_extended'), color: 'text-[#10B981]', icon: Zap }
                          : { label: t('action_replaced'), color: 'text-[#D4D4D8]', icon: Clock };
            const ActionIcon = actionMeta.icon;

            return (
              <div key={entry.id} className="flex gap-2.5 sm:gap-3.5 relative">
                {/* Vertical Timeline Track & Dot */}
                <div className="flex flex-col items-center w-5 shrink-0 pt-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-[#141416]"
                    style={{ backgroundColor: lineColor }}
                  />
                  {!isLast && (
                    <span
                      className="w-[2px] flex-1 mt-1"
                      style={{ backgroundColor: lineColor, opacity: 0.65 }}
                    />
                  )}
                </div>

                {/* Inline Event Header Row + Metadata */}
                <div className="flex-1 pb-5 space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span
                        className="hidden sm:inline-block w-4 h-[1px] shrink-0"
                        style={{ backgroundColor: lineColor, opacity: 0.7 }}
                      />
                      <span
                        className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${actionMeta.color}`}
                      >
                        <ActionIcon className="w-3.5 h-3.5 shrink-0" />
                        {actionMeta.label}
                      </span>

                      {entry.group_id && (
                        <button
                          type="button"
                          onClick={() => handleOpenGloryTimeline(entry.group_id!)}
                          className="px-2.5 py-0.5 rounded-md bg-[#1D1B17] border border-[#3B3325] hover:border-[#DEC79B]/60 text-[12px] font-mono font-semibold text-[#DEC79B] transition-colors cursor-pointer truncate max-w-full"
                        >
                          {t('group')} #{entry.group_id}
                        </button>
                      )}

                      {typeof gloryVal === 'number' && gloryVal > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#1B1813] border border-[#3F3523] text-[10px] font-mono font-semibold text-[#DEC79B] tabular-nums">
                          <Trophy className="w-3 h-3" />
                          {gloryVal.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-[#7E7E86] tabular-nums shrink-0">
                      {formatEventDate(entry.timestamp)}
                    </span>
                  </div>

                  {(entry.clan_id || clanName) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#D4D4D8] pl-0 sm:pl-6">
                      <Shield className="w-3.5 h-3.5 text-[#DEC79B]/75 shrink-0" />
                      {clanName && <span className="font-semibold text-white">{clanName}</span>}
                      {entry.clan_id && (
                        <span className="font-mono text-[#9A9AA2]">
                          {clanName ? `(${entry.clan_id})` : `${t('clan')} ${entry.clan_id}`}
                        </span>
                      )}
                      {entry.action === 'delete' && entry.region && (
                        <>
                          <span className="text-[#6E6E76]">·</span>
                          <RegionFlag codeOrId={entry.region} className="w-4 h-2.5" />
                        </>
                      )}
                    </div>
                  )}

                  {entry.details && (
                    <div className="flex items-start gap-2 text-[12px] text-[#9A9AA2] leading-relaxed pl-0 sm:pl-6">
                      {entry.region && entry.action !== 'delete' && (
                        <RegionFlag codeOrId={entry.region} className="w-4 h-2.5 mt-1" />
                      )}
                      <span>{entry.details}</span>
                    </div>
                  )}

                  {entry.runtime_label && (
                    <div className="pl-0 sm:pl-6 pt-0.5">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#16231C] border border-[#274033] text-[11px] text-[#8CD3AA] font-mono">
                        <Clock className="w-3 h-3" />
                        <span>{entry.runtime_label}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Glory Progression Modal */}
      {gloryModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4">
            <div className="flex items-center gap-2 text-[#DEC79B]">
              <Trophy className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">
                {t('glory_progression')} · {gloryModal.clan_name || `${t('clan')} ${gloryModal.clan_id}`}
              </h3>
            </div>
            <div className="p-3 rounded-xl bg-[#101012] border border-[#242429] flex items-center justify-between text-xs">
              <span className="text-[#8E8E95]">{t('total_glory_farmed')}</span>
              <span className="font-mono font-bold text-[#DEC79B] tabular-nums">
                {gloryModal.glory_farmed.toLocaleString()}
              </span>
            </div>
            {gloryModal.snapshots.length === 0 ? (
              <p className="text-xs text-[#7E7E86] text-center py-4">{t('no_snapshots_yet')}</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {gloryModal.snapshots.map((snap, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-lg bg-[#101012] border border-[#222227] flex items-center justify-between text-xs"
                  >
                    <span className="text-[#8E8E95]">
                      {new Date(snap.captured_at).toLocaleString()}
                    </span>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {snap.total_glory.toLocaleString()} {t('glory')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setGloryModal(null)}
              className="w-full h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm cursor-pointer"
            >
              {t('close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
