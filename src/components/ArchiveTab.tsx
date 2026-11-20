import React, { useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Hash,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  Trophy,
  Zap,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { GroupRecord, PricingData, PublicUser } from '../types';

interface ArchiveTabProps {
  user: PublicUser;
  pricing: PricingData | null;
  groups: GroupRecord[];
  onOpenInHome: (groupId: string) => void;
  onRefresh: () => Promise<void>;
}

type ArchiveFilter = 'all' | 'ready' | 'in_groups' | 'deleted';

const CLAN_AVATAR_STYLES = [
  'bg-[#281629] border-[#5E2B61] text-[#E58FE8]',
  'bg-[#102924] border-[#1E594C] text-[#4CE2BE]',
  'bg-[#292012] border-[#624B22] text-[#DEC79B]',
  'bg-[#2A1718] border-[#612C31] text-[#F28B94]',
];

function isInMyGroups(g: GroupRecord): boolean {
  return !g.archived && g.status !== 'deleted' && g.status !== 'refunded';
}

function isReadyToExtend(g: GroupRecord): boolean {
  if (g.status === 'running' || g.status === 'refunded') return false;
  if (g.can_extend !== true) return false;
  return (g.extend_count ?? 0) < (g.max_extends ?? 1);
}

function formatLaunchDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTimeAgo(iso?: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs) || diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getClanInitials(name?: string): string | null {
  if (!name) return null;
  const clean = name.replace(/[^\p{L}\p{N}]/gu, '');
  if (!clean) return name.slice(0, 2).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export const ArchiveTab: React.FC<ArchiveTabProps> = ({
  user,
  pricing,
  groups,
  onOpenInHome,
  onRefresh,
}) => {
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [search, setSearch] = useState('');
  const [collapsedClans, setCollapsedClans] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const summary = useMemo(() => {
    const clanIds = new Set(groups.map((g) => g.clan_id));
    const readyCount = groups.filter(isReadyToExtend).length;
    const inGroupsCount = groups.filter(isInMyGroups).length;
    const deletedCount = groups.filter((g) => g.status === 'deleted').length;
    const totalGlory = groups.reduce((acc, g) => acc + (g.glory_farmed || 0), 0);
    return {
      totalSquads: groups.length,
      clanCount: clanIds.size,
      readyCount,
      inGroupsCount,
      deletedCount,
      totalGlory,
    };
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (filter === 'ready' && !isReadyToExtend(g)) return false;
      if (filter === 'in_groups' && !isInMyGroups(g)) return false;
      if (filter === 'deleted' && g.status !== 'deleted') return false;

      if (!q) return true;
      const clanName = g.clan_info?.decoded?.clan_name?.toLowerCase() || '';
      return (
        clanName.includes(q) ||
        g.clan_id.toLowerCase().includes(q) ||
        g.group_id.toLowerCase().includes(q) ||
        g.region_name.toLowerCase().includes(q)
      );
    });
  }, [groups, filter, search]);

  const clanClusters = useMemo(() => {
    const map = new Map<string, GroupRecord[]>();
    for (const g of filteredGroups) {
      const list = map.get(g.clan_id) || [];
      list.push(g);
      map.set(g.clan_id, list);
    }
    return Array.from(map.entries())
      .map(([clanId, items]) => {
        const sortedItems = [...items].sort(
          (a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || '')
        );
        const clanName = sortedItems.find((x) => x.clan_info?.decoded?.clan_name)?.clan_info?.decoded
          ?.clan_name;
        const totalGlory = sortedItems.reduce((s, x) => s + (x.glory_farmed || 0), 0);
        const hasActive = sortedItems.some((x) => isInMyGroups(x) || isReadyToExtend(x));
        const newestTs = Date.parse(sortedItems[0]?.created_at || '') || 0;
        return { clanId, clanName, items: sortedItems, totalGlory, hasActive, newestTs };
      })
      .sort((a, b) => Number(b.hasActive) - Number(a.hasActive) || b.newestTs - a.newestTs);
  }, [filteredGroups]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await apiRequest('/api/client/my-groups?refresh=1');
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleExtend = async (group: GroupRecord) => {
    setBusyId(group.group_id);
    setFeedback(null);
    try {
      await apiRequest('/api/client/group-action', {
        method: 'POST',
        body: { action: 'extend', group_id: group.group_id },
      });
      await onRefresh();
      setFeedback({
        ok: true,
        text: `#${group.group_id} ${t('action_extended')}.`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Extend failed.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleUnarchive = async (groupId: string) => {
    setBusyId(groupId);
    setFeedback(null);
    try {
      await apiRequest('/api/client/group-action', {
        method: 'POST',
        body: { action: 'unarchive', group_id: groupId },
      });
      await onRefresh();
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : 'Restore failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleClan = (clanId: string, defaultOpen: boolean) => {
    setCollapsedClans((prev) => {
      const currentlyOpen = prev[clanId] !== undefined ? !prev[clanId] : defaultOpen;
      return { ...prev, [clanId]: currentlyOpen };
    });
  };

  const basicPrice = pricing?.basic_credit_inr ?? 80;
  const premiumPrice = pricing?.premium_credit_inr ?? 160;

  return (
    <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 sm:p-5 space-y-4">
      {/* Header matching Screenshot 1 */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
              <Archive className="w-5 h-5" />
            </div>
            <h2 className="text-[19px] font-bold text-white">{t('squad_archive')}</h2>
          </div>
          <p className="text-xs text-[#8E8E95] leading-relaxed max-w-2xl">
            {t('squad_archive_desc')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="w-10 h-10 rounded-xl bg-[#1A1A1D] hover:bg-[#222226] border border-[#2C2C32] text-[#E4E4E7] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 3 Stat Cards matching Screenshot 1 */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-[#101012] border border-[#242429]">
          <div className="text-xl sm:text-2xl font-extrabold text-white font-mono tabular-nums">
            {summary.totalSquads}
          </div>
          <div className="text-[11px] text-[#8E8E95] mt-0.5 truncate">
            {t('stat_squads_in_clans', { clans: summary.clanCount })}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#101012] border border-[#242429]">
          <div className="text-xl sm:text-2xl font-extrabold text-white font-mono tabular-nums">
            {summary.readyCount}
          </div>
          <div className="text-[11px] text-[#8E8E95] mt-0.5 truncate">{t('stat_ready_to_extend')}</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#101012] border border-[#242429]">
          <div className="text-xl sm:text-2xl font-extrabold text-white font-mono tabular-nums">
            {summary.totalGlory.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#8E8E95] mt-0.5 truncate">{t('stat_glory_farmed')}</div>
        </div>
      </div>

      {/* 3-Step Guide Strip */}
      <div className="px-3.5 py-2.5 rounded-xl bg-[#101012] border border-[#242429] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#9A9AA2]">
        <div className="inline-flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#3A301F] text-[#DEC79B] text-[11px] font-bold inline-flex items-center justify-center">
            1
          </span>
          <span className="text-white font-medium">{t('guide_step_1_action')}</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#3A301F] text-[#DEC79B] text-[11px] font-bold inline-flex items-center justify-center">
            2
          </span>
          <span>
            {t('guide_step_2_title')}{' '}
            <span className="text-white font-semibold">{t('guide_step_2_action')}</span>
          </span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#3A301F] text-[#DEC79B] text-[11px] font-bold inline-flex items-center justify-center">
            3
          </span>
          <span>
            {t('guide_step_3_title')}{' '}
            <span className="text-white font-semibold">{t('guide_step_3_action')}</span>
          </span>
        </div>
      </div>

      {/* Search + Filter Pills */}
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center justify-between">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_archive_placeholder')}
            className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#101012] border border-[#242429] text-xs sm:text-sm text-white placeholder-[#686870] focus:outline-none focus:border-[#8E7C5B]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: t('filter_all'), count: summary.totalSquads },
              { id: 'ready', label: t('filter_ready_to_extend'), count: summary.readyCount },
              { id: 'in_groups', label: t('filter_in_my_groups'), count: summary.inGroupsCount },
              { id: 'deleted', label: t('filter_deleted'), count: summary.deletedCount },
            ] as const
          ).map((pill) => {
            const active = filter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setFilter(pill.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#DEC79B] text-[#141414] font-semibold'
                    : 'bg-[#101012] border border-[#242429] text-[#A1A1AA] hover:text-white'
                }`}
              >
                <span>{pill.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                    active ? 'bg-[#141414]/15 text-[#141414]' : 'bg-[#1C1C20] text-[#8E8E95]'
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs border ${
            feedback.ok
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-red-950/40 border-red-800/60 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Clan Accordions */}
      {clanClusters.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center text-center space-y-2.5">
          <Archive className="w-11 h-11 text-[#686872] stroke-[1.6]" />
          <p className="text-[15px] font-medium text-[#8E8E95]">
            {groups.length === 0 ? t('no_archived_groups') : t('no_matching_squads')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {clanClusters.map((cluster, idx) => {
            const defaultOpen = idx === 0 || cluster.hasActive;
            const isOpen =
              collapsedClans[cluster.clanId] !== undefined
                ? !collapsedClans[cluster.clanId]
                : defaultOpen;
            const avatarStyle = CLAN_AVATAR_STYLES[idx % CLAN_AVATAR_STYLES.length];
            const initials = getClanInitials(cluster.clanName);
            const displayClanName = cluster.clanName || `${t('clan')} ${cluster.clanId}`;

            return (
              <div
                key={cluster.clanId}
                className="rounded-2xl bg-[#101012] border border-[#242429] overflow-hidden"
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleClan(cluster.clanId, defaultOpen)}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#151518] transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center text-xs font-bold shrink-0 ${avatarStyle}`}
                    >
                      {initials ? initials : <Hash className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{displayClanName}</div>
                      <div className="text-[11px] text-[#8E8E95] flex flex-wrap items-center gap-1.5 font-mono">
                        <span>ID {cluster.clanId}</span>
                        <span>·</span>
                        <span>
                          {cluster.items.length}{' '}
                          {cluster.items.length === 1 ? t('squad_word') : t('squads_word')}
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-[#DEC79B]">
                          <Trophy className="w-3 h-3 text-amber-400" />
                          {cluster.totalGlory.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-[#8E8E95] shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8E8E95] shrink-0" />
                  )}
                </button>

                {/* Expanded Squad Rows */}
                {isOpen && (
                  <div className="divide-y divide-[#1D1D22] border-t border-[#1E1E24]">
                    {cluster.items.map((group) => {
                      const inHome = isInMyGroups(group);
                      const extendable = isReadyToExtend(group);
                      const isRunning = group.status === 'running';
                      const canRestoreLocal =
                        group.archived && group.status !== 'deleted' && group.status !== 'refunded';
                      const tierCost = group.tier === 'premium' ? premiumPrice : basicPrice;
                      const hasCredits =
                        group.tier === 'premium' ? user.premiumCredits >= 1 : user.basicCredits >= 1;

                      const statusBadge =
                        group.status === 'running'
                          ? {
                              label: t('running'),
                              cls: 'bg-[#0E281D] border-[#1A563C] text-[#10B981]',
                              dot: 'bg-[#10B981]',
                            }
                          : group.status === 'stopped'
                            ? {
                                label: t('stopped'),
                                cls: 'bg-amber-950/40 border-amber-800/60 text-amber-300',
                                dot: 'bg-amber-400',
                              }
                            : group.status === 'refunded'
                              ? {
                                  label: t('refunded'),
                                  cls: 'bg-blue-950/40 border-blue-800/60 text-blue-300',
                                  dot: 'bg-blue-400',
                                }
                              : {
                                  label: t('deleted'),
                                  cls: 'bg-[#1B1B1E] border-[#2C2C32] text-[#8E8E95]',
                                  dot: 'bg-[#6E6E76]',
                                };

                      return (
                        <div
                          key={group.group_id}
                          className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-white font-mono">
                                #{group.group_id}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadge.cls}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                                {statusBadge.label}
                              </span>
                            </div>

                            <div className="text-xs text-[#9A9AA2] flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>{group.region_name || group.region}</span>
                              <span>·</span>
                              <span>
                                {t('launched_word')} {formatLaunchDate(group.created_at)}
                              </span>
                              {group.uptime && (
                                <>
                                  <span>·</span>
                                  <span>
                                    {t('ran_word')} {group.uptime}
                                  </span>
                                </>
                              )}
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 text-[#D1D1D6] font-mono">
                                <Trophy className="w-3 h-3 text-amber-400" />
                                {group.glory_farmed.toLocaleString()} {t('glory')}
                              </span>
                            </div>

                            <div className="text-[11px] text-[#7A7A82] flex flex-wrap items-center gap-x-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#52525B]" />
                                {t('extends_used', {
                                  used: group.extend_count ?? 0,
                                  max: group.max_extends ?? 1,
                                })}
                              </span>
                              <span>·</span>
                              <span>
                                {isRunning
                                  ? t('playing_right_now')
                                  : `${statusBadge.label} ${formatTimeAgo(group.updated_at || group.created_at)}`}
                              </span>
                            </div>
                          </div>

                          {/* Right-side Action Button matching Screenshot 1 */}
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {inHome && (
                              <button
                                type="button"
                                onClick={() => onOpenInHome(group.group_id)}
                                className="px-3.5 h-9 rounded-xl bg-[#1A1A1E] hover:bg-[#232329] border border-[#2D2D34] text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                {t('open_in_my_groups')}
                              </button>
                            )}

                            {canRestoreLocal && (
                              <button
                                type="button"
                                disabled={busyId === group.group_id}
                                onClick={() => handleUnarchive(group.group_id)}
                                className="px-3 h-9 rounded-xl bg-[#1D1D21] hover:bg-[#25252B] border border-[#2E2E35] text-xs font-medium text-[#DEC79B] inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                {t('restore')}
                              </button>
                            )}

                            {extendable ? (
                              <button
                                type="button"
                                disabled={busyId === group.group_id || !hasCredits}
                                onClick={() => handleExtend(group)}
                                title={`1 ${group.tier} credit (₹${tierCost})`}
                                className="px-3.5 h-9 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:bg-[#242429] disabled:text-[#7E7E86] text-[#141414] text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                {busyId === group.group_id
                                  ? t('extending')
                                  : `${t('extend_plus_8h')} (₹${tierCost})`}
                              </button>
                            ) : (
                              !inHome && (
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#7A7A82]">
                                  <Lock className="w-3.5 h-3.5" />
                                  {t('extend_not_available')}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
