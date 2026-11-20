import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  Download,
  ExternalLink,
  GitBranch,
  Heart,
  Info,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Shield,
  Sparkles,
  Square,
  Star,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  Video,
  Zap,
} from 'lucide-react';
import { apiRequest, extractCleanErrorMessage, getUserToken } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type {
  GroupBotDetail,
  GroupRecord,
  PricingData,
  PublicUser,
  RegionInfo,
  YouTubeVideoRecord,
} from '../types';
import { RegionFlag } from './RegionFlag';

interface HomeTabProps {
  user: PublicUser;
  pricing: PricingData | null;
  groups: GroupRecord[];
  youtubeVideos?: YouTubeVideoRecord[];
  scrollTargetGroupId?: string | null;
  onClearScrollTarget?: () => void;
  onRefresh: () => Promise<void>;
}

interface LaunchProgress {
  stage: string;
  generated: number;
  requested: number;
  etaSeconds: number | null;
}

interface GloryProgressionData {
  clan_id: string;
  clan_name?: string;
  glory_farmed: number;
  games_played: number;
  snapshots: Array<{ captured_at: string; total_glory: number; uptime_hours?: number }>;
  glory_details?: GroupBotDetail[];
  run_segments?: GroupRecord['run_segments'];
}

function parseUptimeSeconds(uptime?: string): number {
  if (!uptime) return 0;
  let total = 0;
  const h = uptime.match(/(\d+)\s*h/i);
  const m = uptime.match(/(\d+)\s*m/i);
  const s = uptime.match(/(\d+)\s*s/i);
  if (h) total += Number(h[1]) * 3600;
  if (m) total += Number(m[1]) * 60;
  if (s) total += Number(s[1]);
  return total;
}

function calculateGloryPerHour(glory: number, uptime?: string): number | null {
  const secs = parseUptimeSeconds(uptime);
  if (secs < 60 || glory <= 0) return null;
  return Math.round((glory / secs) * 3600);
}

function formatCompactUptime(uptime?: string): string {
  const secs = parseUptimeSeconds(uptime);
  if (secs <= 0) return uptime || '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

function formatWeekCountdown(endsAt?: string): string | null {
  if (!endsAt) return null;
  const diffMs = Date.parse(endsAt) - Date.now();
  if (Number.isNaN(diffMs) || diffMs <= 0) return null;
  const totalMins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `Week ends in ${hours}h ${mins}m`;
}

function formatClockTime(iso?: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatShortTime(iso?: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

const FALLBACK_REGIONS: RegionInfo[] = [
  { id: 'bd', region_name: 'Bangladesh', region_code: 'BD', tier: 'basic', enabled: true },
  { id: 'eu', region_name: 'Europe', region_code: 'EU', tier: 'basic', enabled: true },
  { id: 'in', region_name: 'India', region_code: 'IND', tier: 'basic', enabled: true },
  { id: 'id', region_name: 'Indonesia', region_code: 'ID', tier: 'basic', enabled: true },
  { id: 'me', region_name: 'Middle East', region_code: 'ME', tier: 'premium', enabled: true },
  { id: 'na', region_name: 'North America', region_code: 'NA', tier: 'basic', enabled: true },
  { id: 'pk', region_name: 'Pakistan', region_code: 'PK', tier: 'basic', enabled: true },
  { id: 'sg', region_name: 'Singapore', region_code: 'SG', tier: 'basic', enabled: true },
  { id: 'us', region_name: 'United States (US)', region_code: 'US', tier: 'basic', enabled: true },
  { id: 'vn', region_name: 'Vietnam', region_code: 'VN', tier: 'basic', enabled: true },
];

export const HomeTab: React.FC<HomeTabProps> = ({
  user,
  pricing,
  groups,
  youtubeVideos = [],
  scrollTargetGroupId,
  onClearScrollTarget,
  onRefresh,
}) => {
  const { t } = useI18n();

  const allRegions: RegionInfo[] = useMemo(() => {
    return pricing?.regions?.length ? pricing.regions : FALLBACK_REGIONS;
  }, [pricing]);

  const regions: RegionInfo[] = useMemo(() => {
    const enabled = allRegions.filter((r) => r.enabled);
    return enabled.length > 0 ? enabled : FALLBACK_REGIONS;
  }, [allRegions]);

  const hasMaintenanceRegions = useMemo(
    () => allRegions.some((r) => !r.enabled),
    [allRegions]
  );

  const [selectedRegionId, setSelectedRegionId] = useState<string>('bd');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [regionQuery, setRegionQuery] = useState('');
  const [clanId, setClanId] = useState('');

  const [launching, setLaunching] = useState(false);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [detailsModalGroup, setDetailsModalGroup] = useState<GroupRecord | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<GroupRecord | null>(null);
  const [progressionModal, setProgressionModal] = useState<{
    group: GroupRecord;
    data: GloryProgressionData | null;
    loading: boolean;
  } | null>(null);
  const [activeVideo, setActiveVideo] = useState<YouTubeVideoRecord | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState('');
  const [regionAlertsEnabled, setRegionAlertsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kakarot_region_alerts') === '1';
    } catch {
      return false;
    }
  });

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (regions.length > 0 && !regions.some((r) => r.id === selectedRegionId)) {
      setSelectedRegionId(regions[0].id);
    }
  }, [regions, selectedRegionId]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.id === selectedRegionId) || regions[0] || null,
    [regions, selectedRegionId]
  );

  const filteredRegions = useMemo(() => {
    const q = regionQuery.trim().toLowerCase();
    if (!q) return allRegions;
    return allRegions.filter(
      (r) =>
        r.region_name.toLowerCase().includes(q) ||
        r.region_code.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [allRegions, regionQuery]);

  const activeGroups = useMemo(
    () => groups.filter((g) => !g.archived && g.status !== 'deleted' && g.status !== 'refunded'),
    [groups]
  );

  useEffect(() => {
    if (!scrollTargetGroupId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`group-card-${scrollTargetGroupId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-[#DEC79B]');
        setTimeout(() => el.classList.remove('ring-2', 'ring-[#DEC79B]'), 2200);
      }
      onClearScrollTarget?.();
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollTargetGroupId, onClearScrollTarget, activeGroups.length]);

  const runningGroupsCount = useMemo(
    () => activeGroups.filter((g) => g.status === 'running').length,
    [activeGroups]
  );

  const liveTotals = useMemo(() => {
    const totalGlory = activeGroups.reduce((sum, g) => sum + (g.glory_farmed || 0), 0);
    const totalBots = activeGroups.reduce((sum, g) => sum + (g.running_count || 0), 0);
    const maxBots = activeGroups.reduce((sum, g) => sum + (g.container_count || 0), 0);
    const combinedRatePerHour = activeGroups.reduce((sum, g) => {
      const rate = g.status === 'running' ? calculateGloryPerHour(g.glory_farmed, g.uptime) : null;
      return sum + (rate || 0);
    }, 0);
    return { totalGlory, totalBots, maxBots, combinedRatePerHour };
  }, [activeGroups]);

  // Auto-refresh live glory and uptime every 25s while running groups are active
  useEffect(() => {
    if (runningGroupsCount === 0) return;
    const timer = setInterval(async () => {
      try {
        await apiRequest('/api/client/my-groups?refresh=1');
        await onRefresh();
        setLastUpdatedText(`Groups updated at ${new Date().toLocaleTimeString([], { hour12: false })}`);
      } catch {
        // ignore transient background refresh failure
      }
    }, 25_000);
    return () => clearInterval(timer);
  }, [runningGroupsCount, onRefresh]);

  // Group active groups by Clan ID for the CLAN · GROUP MAP board
  const clanBuckets = useMemo(() => {
    const map = new Map<string, GroupRecord[]>();
    for (const g of activeGroups) {
      const list = map.get(g.clan_id) || [];
      list.push(g);
      map.set(g.clan_id, list);
    }
    return Array.from(map.entries()).map(([cId, clanGroups]) => ({
      clanId: cId,
      groups: clanGroups,
      runningCount: clanGroups.filter((g) => g.status === 'running').length,
      totalGroupGlory: clanGroups.reduce((sum, g) => sum + (g.glory_farmed || 0), 0),
      clanInfo: clanGroups.find((g) => g.clan_info?.decoded)?.clan_info || clanGroups[0]?.clan_info,
      regionCode:
        clanGroups.find((g) => g.clan_info?.decoded?.region)?.clan_info?.decoded?.region ||
        clanGroups[0]?.region ||
        'IND',
    }));
  }, [activeGroups]);

  const handleStartGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRegion) return;
    setFeedback(null);
    setLaunching(true);
    setLaunchProgress({
      stage: `Connecting squad nodes in ${selectedRegion.region_name}...`,
      generated: 0,
      requested: 4,
      etaSeconds: null,
    });

    try {
      const token = getUserToken();
      const headers: Record<string, string> = {
        Accept: 'text/event-stream, application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch('/api/client/auto-clan-group?stream=1', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          region: selectedRegion.id,
          clan_id: clanId.trim(),
        }),
      });

      const contentType = res.headers.get('content-type') || '';

      if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
        const text = await res.text();
        let data: { error?: string; group_id?: string; bot_count?: number } = {};
        try {
          data = text ? (JSON.parse(text) as typeof data) : {};
        } catch {
          data = { error: extractCleanErrorMessage(text, res.status) };
        }
        if (!res.ok || data.error) {
          throw new Error(data.error || `Failed to start group (${res.status})`);
        }
        setClanId('');
        setFeedback({
          ok: true,
          text: `Group #${data.group_id} launched with ${data.bot_count || 4} bots.`,
        });
        await onRefresh();
        return;
      }

      // Stream live SSE joining progress events
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let donePayload: { group_id?: string; bot_count?: number } | null = null;
      let streamError: string | null = null;

      const processSseBlock = (block: string) => {
        let evtName = 'message';
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) evtName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) return;
        try {
          const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
          if (evtName === 'start') {
            setLaunchProgress({
              stage: `Deploying bots in ${String(payload.region || selectedRegion.region_name)}...`,
              generated: 0,
              requested: Number(payload.requested || 4),
              etaSeconds: null,
            });
          } else if (evtName === 'progress') {
            const gen = Number(payload.generated ?? 0);
            const reqCount = Number(payload.requested ?? 4);
            const eta = payload.eta_seconds !== undefined ? Number(payload.eta_seconds) : null;
            setLaunchProgress({
              stage:
                gen >= reqCount
                  ? `Bots ready (${gen}/${reqCount}) — joining Clan #${clanId.trim()} & loading Clan Board...`
                  : `Generating & joining squad bots (${gen}/${reqCount})...`,
              generated: gen,
              requested: reqCount,
              etaSeconds: eta,
            });
          } else if (evtName === 'error') {
            streamError = String(payload.error || 'Provider rejected group launch.');
          } else if (evtName === 'done') {
            donePayload = payload as { group_id?: string; bot_count?: number };
          }
        } catch {
          // ignore partial frame parse
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || '';
          for (const block of blocks) {
            processSseBlock(block);
          }
        }
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            const tail = buffer.trim();
            if (!donePayload && !streamError && tail.startsWith('{')) {
              try {
                const parsedJson = JSON.parse(tail) as {
                  group_id?: string;
                  bot_count?: number;
                  error?: string;
                };
                if (parsedJson.error) streamError = parsedJson.error;
                else if (parsedJson.group_id) donePayload = parsedJson;
              } catch {
                for (const block of tail.split(/\r?\n\r?\n/)) {
                  processSseBlock(block);
                }
              }
            } else {
              for (const block of tail.split(/\r?\n\r?\n/)) {
                processSseBlock(block);
              }
            }
          }
          break;
        }
      }

      if (streamError) {
        throw new Error(streamError);
      }
      if (!donePayload?.group_id) {
        throw new Error('Launch stream ended without a group confirmation.');
      }

      setClanId('');
      setFeedback({
        ok: true,
        text: `Group #${donePayload.group_id} launched with ${donePayload.bot_count || 4} bots & synced with Clan Board.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to start group.',
      });
      void onRefresh().catch(() => undefined);
    } finally {
      setLaunching(false);
      setLaunchProgress(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await apiRequest('/api/client/my-groups?refresh=1');
      await onRefresh();
      setLastUpdatedText(`Groups updated at ${new Date().toLocaleTimeString([], { hour12: false })}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleGroupAction = async (
    group: GroupRecord,
    action: 'stop' | 'restart' | 'delete' | 'get-glory' | 'get-clan-info' | 'archive'
  ) => {
    setActionBusyId(group.group_id);
    setFeedback(null);
    try {
      if (action === 'get-clan-info') {
        const [gloryRes, clanRes] = await Promise.all([
          apiRequest<{ group: GroupRecord }>('/api/client/group-action', {
            method: 'POST',
            body: { action: 'get-glory', group_id: group.group_id },
          }).catch(() => null),
          apiRequest<{ group: GroupRecord }>('/api/client/group-action', {
            method: 'POST',
            body: { action: 'get-clan-info', group_id: group.group_id },
          }),
        ]);
        const enriched = clanRes.group || gloryRes?.group || group;
        setDetailsModalGroup(enriched);
        await onRefresh();
        return;
      }

      const res = await apiRequest<{
        success: boolean;
        group?: GroupRecord;
        upstream?: Record<string, unknown>;
      }>('/api/client/group-action', {
        method: 'POST',
        body: { action, group_id: group.group_id },
      });

      if (action === 'get-glory' && res.group) {
        setFeedback({
          ok: true,
          text: `Live Glory synced for Group #${group.group_id}: ${res.group.glory_farmed.toLocaleString()} glory.`,
        });
      } else {
        setFeedback({
          ok: true,
          text: `Action '${action}' completed for Group #${group.group_id}.`,
        });
      }
      await onRefresh();
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : `Failed to execute '${action}'.`,
      });
    } finally {
      setActionBusyId(null);
      setDeleteConfirmGroup(null);
    }
  };

  const handleOpenProgression = async (group: GroupRecord) => {
    setProgressionModal({ group, data: null, loading: true });
    try {
      const data = await apiRequest<GloryProgressionData>(
        `/api/client/glory-progression?group_id=${encodeURIComponent(group.group_id)}`
      );
      setProgressionModal({ group, data, loading: false });
    } catch (err) {
      setProgressionModal(null);
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Could not load glory progression.',
      });
    }
  };

  const scrollToGroupCard = (groupId: string) => {
    const el = document.getElementById(`group-card-${groupId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleEnableRegionNotifications = async () => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {
      // ignore permission denial inside iframe
    }
    setRegionAlertsEnabled(true);
    try {
      localStorage.setItem('kakarot_region_alerts', '1');
    } catch {
      // ignore
    }
  };

  const basicPriceInr = pricing?.basic_credit_inr ?? 80;
  const premiumPriceInr = pricing?.premium_credit_inr ?? 160;
  const selectedTierPriceInr =
    selectedRegion?.tier === 'premium' ? premiumPriceInr : basicPriceInr;
  const creditLabel =
    selectedRegion?.tier === 'premium'
      ? `1 ${t('premium')} ${t('credit')}`
      : `1 ${t('basic')} ${t('credit')}`;
  const capacityPct = Math.min(100, (activeGroups.length / Math.max(1, user.maxGroups)) * 100);
  const insufficientForTier =
    selectedRegion?.tier === 'premium' ? user.premiumCredits < 1 : user.basicCredits < 1;

  return (
    <div className="space-y-4">
      {/* Launch New Group Card (Screenshot 2 Style) */}
      <form
        onSubmit={handleStartGroup}
        className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 sm:p-5 space-y-4"
      >
        {/* Top Heading */}
        <div className="flex items-center justify-between gap-2 pb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <h2 className="text-[17px] font-bold text-white tracking-tight">
              {t('launch_new_group')}
            </h2>
          </div>
          {selectedRegion && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#1C1A15] border border-[#383020] text-[#DEC79B]">
              {selectedRegion.tier === 'premium' ? t('premium_tier') : t('basic_tier')}
            </span>
          )}
        </div>

        {/* Side-by-Side Region + Clan ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          {/* ACCOUNTS REGION Column */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#9A9AA2] uppercase">
              <GitBranch className="w-3.5 h-3.5 text-[#DEC79B]" />
              <span>{t('accounts_region')}</span>
            </div>

            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className={`w-full h-[50px] px-3.5 rounded-xl bg-[#101012] border flex items-center justify-between transition-colors cursor-pointer ${
                  dropdownOpen ? 'border-[#8E7C5B]' : 'border-[#8E7C5B]/80 hover:border-[#DEC79B]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {selectedRegion && <RegionFlag codeOrId={selectedRegion.id} className="w-6 h-4" />}
                  <span className="text-[14px] font-medium text-white truncate">
                    {selectedRegion ? selectedRegion.region_name : t('select_region')}
                  </span>
                </div>
                {dropdownOpen ? (
                  <ChevronUp className="w-4 h-4 text-[#A1A1AA] shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#A1A1AA] shrink-0" />
                )}
              </button>

              {dropdownOpen && (
                <div className="mt-2 bg-[#141416] border border-[#2A2A2E] rounded-2xl shadow-2xl overflow-hidden z-40">
                  <div className="p-2.5 border-b border-[#222226]">
                    <div className="relative">
                      <Search className="w-4 h-4 text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={regionQuery}
                        onChange={(e) => setRegionQuery(e.target.value)}
                        placeholder={t('find_region')}
                        autoFocus
                        className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#0F0F11] border border-[#26262B] text-sm text-white placeholder-[#686870] focus:outline-none focus:border-[#8E7C5B]"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1.5 space-y-1">
                    {filteredRegions.length === 0 ? (
                      <div className="py-4 text-center text-xs text-[#7A7A82]">
                        {t('no_matching_regions')}
                      </div>
                    ) : (
                      filteredRegions.map((region) => {
                        const isSelected = selectedRegion?.id === region.id;
                        const isMaint = !region.enabled;
                        return (
                          <button
                            key={region.id}
                            type="button"
                            disabled={isMaint}
                            onClick={() => {
                              if (isMaint) return;
                              setSelectedRegionId(region.id);
                              setDropdownOpen(false);
                              setRegionQuery('');
                            }}
                            className={`w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between text-left transition-colors ${
                              isMaint
                                ? 'opacity-50 cursor-not-allowed text-[#8E8E95]'
                                : isSelected
                                  ? 'bg-[#282218] border border-[#6E5F44] text-[#DEC79B] cursor-pointer'
                                  : 'text-[#E4E4E7] hover:bg-[#1C1C20] border border-transparent cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <RegionFlag codeOrId={region.id} className="w-6 h-4" />
                              <span className="text-[13px] font-medium truncate">
                                {region.region_name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isMaint ? (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/50 text-amber-300 font-semibold">
                                  {t('maintenance')}
                                </span>
                              ) : (
                                <span className="text-[11px] text-[#8E8E95] capitalize">
                                  {region.tier === 'premium' ? t('premium') : t('basic')}
                                </span>
                              )}
                              {isSelected && !isMaint && <Check className="w-4 h-4 text-[#DEC79B]" />}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Region Description, Cost & Extend Available Metadata matching Screenshot 2 */}
            <div className="space-y-1.5 text-xs">
              <p className="text-[#8E8E95]">{t('choose_region_hint')}</p>
              <div className="text-[#9A9AA2]">
                {t('cost_label')}{' '}
                <span className="font-semibold text-white">
                  {creditLabel} · ₹{selectedTierPriceInr}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/50 border border-emerald-700/50 text-[11px] font-semibold text-emerald-400">
                  {t('extend_available')}
                </span>
                <span className="text-[11px] text-[#9A9AA2]">
                  {t('extend_available_desc', { price: selectedTierPriceInr })}
                </span>
              </div>
            </div>

            {/* Amber Maintenance Notice Box matching Screenshot 2 */}
            {hasMaintenanceRegions && (
              <div className="p-3 rounded-xl bg-[#20180B] border border-[#5C4418] flex items-start gap-2.5 text-xs text-amber-200/90">
                <Bell className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  {regionAlertsEnabled ? (
                    <span className="text-emerald-300 font-medium">
                      {t('notifications_enabled_msg')}
                    </span>
                  ) : (
                    <>
                      <span>{t('maintenance_banner')} </span>
                      <button
                        type="button"
                        onClick={handleEnableRegionNotifications}
                        className="underline font-semibold text-amber-300 hover:text-amber-200 cursor-pointer"
                      >
                        {t('enable_notifications')}
                      </button>{' '}
                      <span>{t('maintenance_banner_tail')}</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* CLAN ID Column */}
          <div className="space-y-2.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#9A9AA2] uppercase">
              <Users className="w-3.5 h-3.5 text-[#DEC79B]" />
              <span>{t('clan_id')}</span>
            </label>
            <div className="relative">
              <Shield className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={clanId}
                onChange={(e) => setClanId(e.target.value)}
                placeholder="e.g. 123456789"
                className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-[14px] placeholder-[#5F5F66] focus:outline-none focus:border-[#DEC79B]"
              />
            </div>
          </div>
        </div>

        {/* Live Joining / Bot Deployment Progress Animation */}
        {launching && launchProgress && (
          <div className="p-3.5 rounded-2xl bg-[#17140E] border border-[#5B4D31] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#DEC79B]">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{launchProgress.stage}</span>
              </div>
              {launchProgress.etaSeconds !== null && launchProgress.etaSeconds > 0 && (
                <span className="text-[11px] font-mono text-[#A89A7C] tabular-nums">
                  ETA {launchProgress.etaSeconds}s
                </span>
              )}
            </div>
            <div className="h-2 w-full rounded-full bg-[#242018] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#C8B07B] via-[#DEC79B] to-[#10B981] transition-all duration-500 rounded-full"
                style={{
                  width: `${Math.max(15, Math.min(100, (launchProgress.generated / Math.max(1, launchProgress.requested)) * 100))}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#9A9AA2]">
              <div className="flex items-center gap-1.5">
                {Array.from({ length: launchProgress.requested }).map((_, idx) => (
                  <span
                    key={idx}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      idx < launchProgress.generated
                        ? 'bg-[#10B981] shadow-[0_0_6px_#10B981]'
                        : 'bg-[#35353B] animate-pulse'
                    }`}
                  />
                ))}
                <span className="ml-1">
                  Bots: {launchProgress.generated}/{launchProgress.requested}
                </span>
              </div>
              <span className="font-mono text-[#DEC79B]">{t('syncing')}</span>
            </div>
          </div>
        )}

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

        {/* Start Group Button */}
        <button
          type="submit"
          disabled={launching || !clanId.trim() || insufficientForTier}
          className="w-full h-[52px] rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:bg-[#232327] disabled:text-[#7E7E86] text-[#141414] font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          {launching ? (
            <>
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
              {t('launching_group')}
            </>
          ) : insufficientForTier ? (
            <>
              <Zap className="w-[18px] h-[18px]" />
              {selectedRegion?.tier === 'premium'
                ? t('insufficient_premium', { have: user.premiumCredits })
                : t('insufficient_basic', { have: user.basicCredits })}
            </>
          ) : (
            <>
              <Zap className="w-[18px] h-[18px]" />
              {`${t('start_group')} (${creditLabel})`}
            </>
          )}
        </button>
      </form>

      {/* My Active Groups Card */}
      <section className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <h2 className="text-[19px] font-bold text-white tracking-tight">
              {t('my_active_groups')}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-[#1E1E22] border border-[#2D2D33] text-xs font-semibold text-[#D1D1D6] tabular-nums">
              {activeGroups.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 h-8 rounded-full bg-[#101012] border border-[#26262C] text-[11px] font-mono text-[#9A9AA2] inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-[#7E7E86]" />
              {formatClockTime(new Date().toISOString())}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3.5 h-8 rounded-full bg-[#1A1A1D] hover:bg-[#222226] border border-[#2C2C32] text-xs font-medium text-[#E4E4E7] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </button>
          </div>
        </div>

        <p className="text-xs text-[#7E7E86]">{lastUpdatedText || t('updated_just_now')}</p>

        {/* Capacity Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#8E8E95]">{t('active_groups_capacity')}</span>
            <span className="text-[#D1D1D6] font-mono tabular-nums">
              {activeGroups.length} / {user.maxGroups}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#222226] overflow-hidden">
            <div
              className="h-full bg-[#DEC79B] rounded-full transition-all"
              style={{ width: `${capacityPct}%` }}
            />
          </div>
        </div>

        {/* Live Glory Overview Strip */}
        {activeGroups.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl bg-[#101012] border border-[#242429]">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8E8E95] block">
                {t('live_group_glory')}
              </span>
              <span className="text-base sm:text-lg font-extrabold font-mono text-[#DEC79B] tabular-nums">
                {liveTotals.totalGlory.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8E8E95] block">
                {t('farm_speed')}
              </span>
              <span className="text-base sm:text-lg font-extrabold font-mono text-[#10B981] tabular-nums">
                {liveTotals.combinedRatePerHour > 0
                  ? `${liveTotals.combinedRatePerHour.toLocaleString()}/hr`
                  : t('syncing')}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8E8E95] block">
                {t('active_bots')}
              </span>
              <span className="text-base sm:text-lg font-extrabold font-mono text-white tabular-nums">
                {liveTotals.totalBots} / {liveTotals.maxBots}
              </span>
            </div>
          </div>
        )}

        {/* Empty State or CLAN · GROUP MAP Board */}
        {activeGroups.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-center space-y-2.5">
            <div className="w-16 h-16 rounded-full bg-[#1C1C20] border border-[#28282E] flex items-center justify-center text-[#787882] mb-1">
              <Layers className="w-7 h-7" />
            </div>
            <p className="text-[15px] font-semibold text-[#D4D4D8]">{t('no_active_groups')}</p>
            <p className="text-xs text-[#7E7E86]">{t('launch_to_start')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {clanBuckets.map((bucket) => {
              const decoded = bucket.clanInfo?.decoded;
              const clanGlory = bucket.clanInfo?.clan_glory;
              const weekCountdown = formatWeekCountdown(bucket.clanInfo?.week?.ends_at);
              const clanName = decoded?.clan_name || `${t('clan')} ${bucket.clanId}`;
              const totalClanGlory = Number(clanGlory?.total_glory ?? bucket.totalGroupGlory ?? 0);
              const weeklyGlory = Number(clanGlory?.weekly_glory ?? bucket.totalGroupGlory ?? 0);

              return (
                <div
                  key={bucket.clanId}
                  className="rounded-2xl bg-[#101012] border border-[#242429] p-3.5 sm:p-4 space-y-3.5"
                >
                  {/* CLAN · GROUP MAP Header */}
                  <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-[#8E8E95] uppercase">
                    <span>{t('clan_group_map')}</span>
                    <span className="normal-case font-medium text-[#A1A1AA] tabular-nums">
                      {bucket.runningCount} {t('running').toLowerCase()} / {bucket.groups.length}{' '}
                      {t('groups_label').toLowerCase()}
                    </span>
                  </div>

                  {/* Golden-Bordered Clan Board Card */}
                  <div className="relative rounded-2xl bg-gradient-to-br from-[#1C1810] via-[#161411] to-[#12110F] border border-[#685736] p-4 space-y-3 overflow-hidden">
                    {bucket.runningCount > 0 && (
                      <div className="absolute top-0 right-0 px-3 py-1 rounded-bl-xl bg-[#DEC79B] text-[#141414] text-[10px] font-extrabold tracking-wider uppercase flex items-center gap-1">
                        <Star className="w-3 h-3 fill-[#141414]" />
                        {t('super_squad')}
                      </div>
                    )}

                    <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-[#3B2E17] to-[#1D1810] border border-[#8E7342] flex items-center justify-center shrink-0">
                          <Shield className="w-6 h-6 text-[#DEC79B]" />
                          <span className="absolute -bottom-1.5 -right-1.5 px-1.5 py-0.5 rounded bg-[#0E0E10] border border-[#6E5B38] text-[9px] font-mono font-bold text-[#DEC79B]">
                            LV.{decoded?.clan_level ?? 1}
                          </span>
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <h3 className="text-[16px] font-bold text-white truncate pr-20">
                            {clanName}
                          </h3>
                          {decoded?.slogan && (
                            <p className="text-[11px] italic text-[#9A9AA2] truncate">
                              &ldquo;{decoded.slogan}&rdquo;
                            </p>
                          )}
                          <p className="text-[11px] font-mono text-[#A1A1AA] truncate">
                            ID: {bucket.clanId} · {bucket.regionCode} · {bucket.groups.length}{' '}
                            {t('group').toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 items-end">
                      <div>
                        <span className="block text-[11px] text-[#9A9AA2]">
                          {t('clan_total_glory')}
                        </span>
                        <span className="text-[22px] font-extrabold text-white font-mono tabular-nums leading-tight">
                          {totalClanGlory.toLocaleString()}
                        </span>
                        {weekCountdown && (
                          <span className="block text-[11px] text-[#8E8E95] mt-0.5">
                            {weekCountdown}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#B4B4BC]">
                        {decoded?.member_num !== undefined && (
                          <div>
                            <span className="flex items-center gap-1 text-[#7E7E86] uppercase text-[10px]">
                              <Users className="w-3 h-3" /> {t('members')}
                            </span>
                            <span className="font-mono font-semibold text-white tabular-nums">
                              {decoded.member_num}/{decoded.capacity ?? 20}
                            </span>
                          </div>
                        )}
                        {decoded?.captain_id && (
                          <div>
                            <span className="flex items-center gap-1 text-[#7E7E86] uppercase text-[10px]">
                              <Sparkles className="w-3 h-3" /> {t('captain')}
                            </span>
                            <span className="font-mono font-semibold text-white tabular-nums">
                              {decoded.captain_id}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="sm:text-right">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider text-[#C6B186] uppercase">
                          <Crown className="w-3 h-3 text-[#DEC79B]" /> {t('group_glory')}
                        </span>
                        <div className="text-[22px] font-extrabold text-[#DEC79B] font-mono tabular-nums leading-tight">
                          {bucket.totalGroupGlory.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {(bucket.clanInfo?.leaderboard || clanGlory?.season) && (
                      <div className="pt-2.5 border-t border-[#3A301D]/60 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="text-[#9A9AA2] font-mono">
                            Season {bucket.clanInfo?.leaderboard?.season ?? clanGlory?.season ?? '-'}
                            {bucket.clanInfo?.week?.week ? ` · Week ${bucket.clanInfo.week.week}` : ''}
                          </span>
                          {bucket.clanInfo?.leaderboard?.cutoff_weekly_glory !== undefined && (
                            <span className="font-mono text-[#D4D4D8]">
                              Top {bucket.clanInfo.leaderboard.size ?? 100} Cutoff:{' '}
                              <span className="text-[#DEC79B] font-bold">
                                {Number(
                                  bucket.clanInfo.leaderboard.cutoff_weekly_glory
                                ).toLocaleString()}
                              </span>{' '}
                              {bucket.clanInfo.leaderboard.in_top ? (
                                <span className="text-[#10B981] font-semibold">· IN TOP</span>
                              ) : (
                                <span className="text-[#8E8E95]">
                                  (
                                  {Math.min(
                                    100,
                                    Math.round(
                                      (weeklyGlory /
                                        Math.max(
                                          1,
                                          Number(bucket.clanInfo.leaderboard.cutoff_weekly_glory)
                                        )) *
                                        100
                                    )
                                  )}
                                  %)
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {bucket.clanInfo?.leaderboard?.cutoff_weekly_glory ? (
                          <div className="h-1.5 w-full rounded-full bg-[#241E14] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                bucket.clanInfo.leaderboard.in_top
                                  ? 'bg-[#10B981]'
                                  : 'bg-[#DEC79B]'
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(
                                    3,
                                    Math.round(
                                      (weeklyGlory /
                                        Math.max(
                                          1,
                                          Number(bucket.clanInfo.leaderboard.cutoff_weekly_glory)
                                        )) *
                                        100
                                    )
                                  )
                                )}%`,
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* Connected Split Nodes */}
                  {bucket.groups.map((grp) => {
                    const isRunning = grp.status === 'running';
                    return (
                      <div key={`map-${grp.group_id}`} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0 rounded-xl bg-[#131416] border border-[#26282E] p-3 space-y-1">
                          <span className="block text-[10px] font-semibold tracking-wider text-[#8E8E95] uppercase">
                            {t('clan').toUpperCase()}
                          </span>
                          <div className="text-xs font-bold text-white truncate">{clanName}</div>
                          <span className="block text-[11px] text-[#7E7E86]">
                            {t('weekly_glory')}
                          </span>
                          <div className="text-[17px] font-extrabold text-white font-mono tabular-nums">
                            {weeklyGlory.toLocaleString()}
                          </div>
                        </div>

                        <div className="w-9 sm:w-12 shrink-0 flex flex-col items-center justify-center relative h-6 overflow-hidden">
                          <div className="w-full border-t border-dashed border-[#444852]" />
                          {isRunning && (
                            <span className="kakarot-dot-flow absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#10B981] shadow-[0_0_8px_#10B981]" />
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => scrollToGroupCard(grp.group_id)}
                          className="flex-1 min-w-0 text-left rounded-xl bg-[#121614] border border-[#26382E] hover:border-[#39604A] p-3 space-y-1 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-[#10B981]">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isRunning ? 'bg-[#10B981] animate-pulse' : 'bg-amber-400'
                              }`}
                            />
                            <span>
                              {isRunning
                                ? t('running_group')
                                : `${grp.status.toUpperCase()} ${t('group').toUpperCase()}`}
                            </span>
                          </div>
                          <div className="text-xs font-mono font-bold text-white truncate">
                            #{grp.group_id}
                          </div>
                          <div className="text-[15px] font-extrabold text-[#DEC79B] font-mono tabular-nums">
                            {grp.glory_farmed.toLocaleString()} {t('glory')}
                          </div>
                          <span className="block text-[11px] text-[#7E8C84]">{t('view_group')}</span>
                        </button>
                      </div>
                    );
                  })}

                  <p className="text-[11px] text-[#7E7E86]">
                    {bucket.runningCount} {t('running').toLowerCase()} → {t('clan')} {bucket.clanId}
                  </p>

                  {/* Group details & controls — 2-column side-by-side layout matching Screenshot 2 */}
                  <div className="space-y-3 pt-1">
                    <div className="text-xs font-semibold text-[#A1A1AA]">
                      {t('group_details_controls')}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {bucket.groups.map((group) => {
                        const busy = actionBusyId === group.group_id;
                        const isRunning = group.status === 'running';
                        const uptimeSecs = parseUptimeSeconds(group.uptime);
                        const goalPct = Math.min(
                          100,
                          Math.round((uptimeSecs / (8 * 3600)) * 100)
                        );
                        const isJoiningMatch =
                          isRunning && (group.games_played ?? 0) === 0 && group.glory_farmed === 0;

                        return (
                          <div
                            key={group.group_id}
                            id={`group-card-${group.group_id}`}
                            className="rounded-2xl bg-[#151412] border border-[#2C2922] p-4 space-y-3.5 transition-shadow"
                          >
                            {/* Header row: Group ID + ★ GLORY */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-bold text-white font-mono">
                                  {t('group')} {group.group_id}
                                </div>
                                <div className="mt-1 flex items-center gap-2 flex-wrap">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                      isRunning
                                        ? 'bg-[#0E281D] border-[#1A563C] text-[#10B981]'
                                        : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        isRunning ? 'bg-[#10B981] animate-pulse' : 'bg-amber-400'
                                      }`}
                                    />
                                    {isRunning ? t('running') : group.status}
                                  </span>
                                  <span className="text-[11px] text-[#7E7E86] font-mono tabular-nums">
                                    {formatClockTime(group.glory_synced_at || group.updated_at)}
                                  </span>
                                </div>
                              </div>

                              <div className="text-right">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#9A9AA2] uppercase">
                                  <Star className="w-3 h-3 text-[#DEC79B]" /> {t('glory_upper')}
                                </span>
                                <div className="text-[20px] font-extrabold text-white font-mono tabular-nums leading-tight">
                                  {group.glory_farmed.toLocaleString()}
                                </div>
                                {(() => {
                                  const rate = isRunning
                                    ? calculateGloryPerHour(group.glory_farmed, group.uptime)
                                    : null;
                                  return rate ? (
                                    <span className="text-[10px] font-mono font-semibold text-[#10B981] tabular-nums">
                                      ~{rate.toLocaleString()} / hr
                                    </span>
                                  ) : null;
                                })()}
                              </div>
                            </div>

                            {isJoiningMatch && (
                              <div className="px-3 py-2 rounded-xl bg-[#191610] border border-[#453A23] flex items-center justify-between text-xs text-[#DEC79B]">
                                <span className="flex items-center gap-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  {t('waiting_first_sync')}
                                </span>
                                <span className="font-mono text-[11px] text-[#9A9AA2]">
                                  {t('live')}
                                </span>
                              </div>
                            )}

                            {/* 2x2 Metrics Grid */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs pt-1">
                              <div>
                                <span className="text-[#7E7E86] block text-[11px]">{t('region')}</span>
                                <span className="font-semibold text-white flex items-center gap-1.5 mt-0.5">
                                  <RegionFlag codeOrId={group.region} className="w-4 h-3" />
                                  {group.region || group.region_name}
                                </span>
                              </div>
                              <div>
                                <span className="text-[#7E7E86] block text-[11px]">
                                  {t('accounts')}
                                </span>
                                <span className="font-mono font-semibold text-white tabular-nums mt-0.5 block">
                                  {group.running_count} / {group.container_count}
                                </span>
                              </div>
                              <div>
                                <span className="text-[#7E7E86] block text-[11px]">{t('uptime')}</span>
                                <span className="font-mono font-semibold text-white tabular-nums mt-0.5 block">
                                  {formatCompactUptime(group.uptime)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[#7E7E86] block text-[11px]">
                                  {t('last_match')}
                                </span>
                                <span className="font-semibold text-white tabular-nums mt-0.5 block">
                                  {group.games_played ?? 0} {t('games')} ·{' '}
                                  <span className="text-[#9A9AA2] font-mono">
                                    {t('since')}{' '}
                                    {formatShortTime(group.last_match_at || group.created_at)}
                                  </span>
                                </span>
                              </div>
                            </div>

                            {/* Live Per-Bot Glory Squad Breakdown */}
                            {Array.isArray(group.glory_details) && group.glory_details.length > 0 && (
                              <div className="rounded-xl bg-[#101012] border border-[#242429] p-2.5 space-y-1.5">
                                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#8E8E95]">
                                  <span>
                                    {t('bot_squad_live_glory')} ({group.glory_details.length})
                                  </span>
                                  {(group.max_extends !== undefined ||
                                    group.max_replaces !== undefined) && (
                                    <span className="font-mono text-[#7E7E86]">
                                      Ext {group.extend_count ?? 0}/{group.max_extends ?? 1} · Rep{' '}
                                      {group.replace_count ?? 0}/{group.max_replaces ?? 1}
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {group.glory_details.map((bot) => (
                                    <div
                                      key={bot.account_id}
                                      className="px-2.5 py-1.5 rounded-lg bg-[#161619] border border-[#232329] flex items-center justify-between text-[11px]"
                                    >
                                      <div className="min-w-0 pr-2">
                                        <div className="font-semibold text-white truncate">
                                          {bot.nickname}
                                        </div>
                                        <div className="text-[10px] font-mono text-[#7E7E86] truncate">
                                          LV.{bot.level ?? 1} · {bot.credit_score ?? 100}
                                        </div>
                                      </div>
                                      <span className="font-mono font-bold text-[#DEC79B] tabular-nums shrink-0">
                                        +{bot.glory.toLocaleString()}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 8H GOAL progress bar */}
                            <div className="space-y-1.5 pt-1">
                              <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase">
                                <span className="text-[#7E7E86]">{t('goal_8h')}</span>
                                <span className="text-[#DEC79B] font-mono tabular-nums">
                                  {goalPct}%
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-[#24211B] overflow-hidden">
                                <div
                                  className="h-full bg-[#DEC79B] rounded-full transition-all"
                                  style={{ width: `${Math.max(2, goalPct)}%` }}
                                />
                              </div>
                            </div>

                            {/* Control Action Grid matching Screenshot 2 + features (NO Refund button) */}
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleGroupAction(group, 'restart')}
                                className="h-10 rounded-full bg-[#1B1A18] hover:bg-[#242320] border border-[#32302B] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                                {t('restart')}
                              </button>

                              {isRunning ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleGroupAction(group, 'stop')}
                                  className="h-10 rounded-full bg-[#1B1A18] hover:bg-[#242320] border border-[#32302B] text-xs font-semibold text-amber-300 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Square className="w-3.5 h-3.5" />
                                  {t('stop')}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleGroupAction(group, 'archive')}
                                  className="h-10 rounded-full bg-[#1B1A18] hover:bg-[#242320] border border-[#32302B] text-xs font-semibold text-[#D4D4D8] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                  {t('archive')}
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleGroupAction(group, 'get-clan-info')}
                                className="h-10 rounded-full bg-[#F4F4F5] hover:bg-white text-xs font-bold text-[#141414] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Info className="w-3.5 h-3.5" />
                                {t('clan_info')}
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setDeleteConfirmGroup(group)}
                                className="h-10 rounded-full bg-[#1A1415] hover:bg-red-950/60 border border-[#3D2225] text-xs font-semibold text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t('delete')}
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleOpenProgression(group)}
                                className="h-10 rounded-full bg-[#1B1A18] hover:bg-[#242320] border border-[#32302B] text-xs font-semibold text-[#DEC79B] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <TrendingUp className="w-3.5 h-3.5" />
                                {t('glory_chart')}
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleGroupAction(group, 'get-glory')}
                                className="h-10 rounded-full bg-[#181713] hover:bg-[#221F18] border border-[#3A3222] text-xs font-semibold text-[#DEC79B] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Trophy className="w-3.5 h-3.5" />
                                {t('sync_glory')}
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleGroupAction(group, 'get-clan-info')}
                                className="col-span-2 h-10 rounded-full bg-[#1B1A18] hover:bg-[#242320] border border-[#32302B] text-xs font-semibold text-[#E4E4E7] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                {t('squad_info')}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <p className="text-[11px] text-[#6E6E76]">
                    {t('clan_total_glory')} · {t('live')}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Rich Clan Info & Bot Glory Details Modal */}
      {detailsModalGroup && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#DEC79B]" />
                <h3 className="text-base font-bold text-white">
                  {detailsModalGroup.clan_info?.decoded?.clan_name ||
                    `Clan #${detailsModalGroup.clan_id}`}
                </h3>
              </div>
              <span className="text-xs font-mono text-[#DEC79B]">
                Group #{detailsModalGroup.group_id}
              </span>
            </div>

            {detailsModalGroup.clan_info?.decoded && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-[#101012] border border-[#242429] text-xs">
                <div>
                  <span className="text-[#7E7E86] block">Clan ID</span>
                  <span className="font-mono font-semibold text-white">
                    {detailsModalGroup.clan_info.decoded.clan_id}
                  </span>
                </div>
                <div>
                  <span className="text-[#7E7E86] block">Level / Members</span>
                  <span className="font-mono font-semibold text-white">
                    LV.{detailsModalGroup.clan_info.decoded.clan_level ?? 1} ·{' '}
                    {detailsModalGroup.clan_info.decoded.member_num ?? '-'}/
                    {detailsModalGroup.clan_info.decoded.capacity ?? '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#7E7E86] block">Captain ID</span>
                  <span className="font-mono font-semibold text-white">
                    {detailsModalGroup.clan_info.decoded.captain_id ?? '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#7E7E86] block">Weekly Glory</span>
                  <span className="font-mono font-semibold text-[#DEC79B]">
                    {Number(
                      detailsModalGroup.clan_info.clan_glory?.weekly_glory ?? 0
                    ).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[#7E7E86] block">Clan Total Glory</span>
                  <span className="font-mono font-semibold text-white">
                    {Number(
                      detailsModalGroup.clan_info.clan_glory?.total_glory ?? 0
                    ).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[#7E7E86] block">Group Glory</span>
                  <span className="font-mono font-semibold text-[#10B981]">
                    {detailsModalGroup.glory_farmed.toLocaleString()}
                  </span>
                </div>
                {detailsModalGroup.clan_info.leaderboard?.cutoff_weekly_glory !== undefined && (
                  <div className="col-span-2 sm:col-span-3 pt-2 border-t border-[#202026] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[#9A9AA2]">
                      Leaderboard Top {detailsModalGroup.clan_info.leaderboard.size ?? 100} (Season{' '}
                      {detailsModalGroup.clan_info.leaderboard.season ?? '-'})
                    </span>
                    <span className="font-mono font-semibold text-[#DEC79B]">
                      Cutoff:{' '}
                      {Number(detailsModalGroup.clan_info.leaderboard.cutoff_weekly_glory).toLocaleString()}{' '}
                      ·{' '}
                      {detailsModalGroup.clan_info.leaderboard.in_top ? (
                        <span className="text-[#10B981]">IN TOP 100</span>
                      ) : (
                        <span className="text-[#8E8E95]">Outside Top 100</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {Array.isArray(detailsModalGroup.glory_details) &&
              detailsModalGroup.glory_details.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#9A9AA2]">
                    Bot Accounts ({detailsModalGroup.glory_details.length})
                  </h4>
                  <div className="space-y-1.5">
                    {detailsModalGroup.glory_details.map((bot) => (
                      <div
                        key={bot.account_id}
                        className="p-2.5 rounded-xl bg-[#101012] border border-[#222227] flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-white">{bot.nickname}</div>
                          <div className="text-[11px] font-mono text-[#7E7E86]">
                            ID: {bot.account_id} · LV.{bot.level ?? 1} · Score:{' '}
                            {bot.credit_score ?? 100} · EXP: {bot.exp ?? 0}
                          </div>
                        </div>
                        <div className="text-right space-y-0.5">
                          <span className="font-mono font-bold text-[#DEC79B] tabular-nums block">
                            {bot.glory.toLocaleString()} glory
                          </span>
                          {typeof bot.liked === 'number' && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-[#8E8E95]">
                              <Heart className="w-2.5 h-2.5 text-rose-400" /> {bot.liked}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            <button
              type="button"
              onClick={() => setDetailsModalGroup(null)}
              className="w-full h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm cursor-pointer"
            >
              {t('close')}
            </button>
          </div>
        </div>
      )}

      {/* Glory Progression & Snapshot Timeline Modal */}
      {progressionModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#DEC79B]" />
                <h3 className="text-base font-bold text-white">{t('glory_progression')}</h3>
              </div>
              <span className="text-xs font-mono text-[#DEC79B]">
                {t('group')} #{progressionModal.group.group_id}
              </span>
            </div>

            {progressionModal.loading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-xs text-[#9A9AA2]">
                <Loader2 className="w-4 h-4 animate-spin text-[#DEC79B]" />
                {t('loading')}
              </div>
            ) : progressionModal.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2.5 p-3 rounded-xl bg-[#101012] border border-[#242429] text-xs">
                  <div>
                    <span className="text-[#7E7E86] block">{t('total_farmed')}</span>
                    <span className="font-mono font-bold text-[#DEC79B] text-base">
                      {progressionModal.data.glory_farmed.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#7E7E86] block">{t('matches')}</span>
                    <span className="font-mono font-bold text-white text-base">
                      {progressionModal.data.games_played}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#7E7E86] block">{t('clan_id')}</span>
                    <span className="font-mono font-semibold text-white">
                      {progressionModal.data.clan_id}
                    </span>
                  </div>
                </div>

                {progressionModal.data.snapshots.length === 0 ? (
                  <p className="text-xs text-[#8E8E95] text-center py-4">{t('no_snapshots_yet')}</p>
                ) : (
                  <div className="space-y-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#9A9AA2]">
                      Snapshots ({progressionModal.data.snapshots.length})
                    </h4>
                    <div className="space-y-1.5">
                      {progressionModal.data.snapshots.map((snap, idx) => {
                        const maxSnap = Math.max(
                          1,
                          ...progressionModal.data!.snapshots.map((s) => s.total_glory || 0)
                        );
                        const pct = Math.min(100, Math.round(((snap.total_glory || 0) / maxSnap) * 100));
                        return (
                          <div
                            key={`${snap.captured_at}-${idx}`}
                            className="p-2.5 rounded-xl bg-[#101012] border border-[#222227] space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between font-mono">
                              <span className="text-[#9A9AA2]">{formatClockTime(snap.captured_at)}</span>
                              <span className="text-[#DEC79B] font-bold">
                                {Number(snap.total_glory || 0).toLocaleString()} {t('glory')}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-[#1F1F24] overflow-hidden">
                              <div
                                className="h-full bg-[#10B981] rounded-full"
                                style={{ width: `${Math.max(4, pct)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {Array.isArray(progressionModal.data.run_segments) &&
                  progressionModal.data.run_segments.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#9A9AA2]">
                        Run Segments
                      </h4>
                      {progressionModal.data.run_segments.map((seg, idx) => (
                        <div
                          key={`${seg.started_at}-${idx}`}
                          className="px-3 py-2 rounded-xl bg-[#101012] border border-[#222227] flex items-center justify-between text-xs font-mono"
                        >
                          <span className="text-[#9A9AA2]">{formatClockTime(seg.started_at)}</span>
                          <span className="text-white">
                            {seg.start_glory.toLocaleString()} → {seg.end_glory.toLocaleString()} (
                            <span className="text-[#10B981]">+{seg.glory_farmed.toLocaleString()}</span>)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setProgressionModal(null)}
              className="w-full h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm cursor-pointer"
            >
              {t('close')}
            </button>
          </div>
        </div>
      )}

      {/* Confirm Permanent Delete Modal */}
      {deleteConfirmGroup && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4">
            <h3 className="text-base font-bold text-white">{t('delete_group_q')}</h3>
            <p className="text-xs text-[#9A9AA2] leading-relaxed">
              {t('delete_group_warn', { id: deleteConfirmGroup.group_id })}
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirmGroup(null)}
                className="flex-1 h-10 rounded-xl bg-[#1E1E22] text-xs font-semibold text-white cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={actionBusyId === deleteConfirmGroup.group_id}
                onClick={() => handleGroupAction(deleteConfirmGroup, 'delete')}
                className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white cursor-pointer"
              >
                {t('confirm_delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Featured YouTube Videos (rendered only when Admin publishes videos) */}
      {youtubeVideos.length > 0 && (
        <section className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-[17px] font-bold text-white tracking-tight">
                  {t('featured_videos')}
                </h2>
                <p className="text-[11px] text-[#7E7E86]">{t('featured_videos_sub')}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {youtubeVideos.map((vid) => (
              <div
                key={vid.id}
                className="rounded-2xl bg-[#101012] border border-[#242429] overflow-hidden flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => setActiveVideo(vid)}
                  className="relative aspect-video w-full bg-[#09090B] group cursor-pointer overflow-hidden"
                >
                  <img
                    src={vid.thumbnailUrl}
                    alt={vid.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/35 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                    <span className="w-12 h-12 rounded-full bg-[#DEC79B] text-[#141414] flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 fill-[#141414] ml-0.5" />
                    </span>
                  </div>
                </button>
                <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white line-clamp-2">{vid.title}</h3>
                    {vid.channelTitle && (
                      <p className="text-[11px] text-[#DEC79B] font-medium">{vid.channelTitle}</p>
                    )}
                    {vid.description && (
                      <p className="text-xs text-[#8E8E95] line-clamp-2">{vid.description}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveVideo(vid)}
                      className="text-xs font-semibold text-[#DEC79B] hover:underline cursor-pointer"
                    >
                      {t('watch_player')}
                    </button>
                    <a
                      href={vid.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#9A9AA2] hover:text-white inline-flex items-center gap-1"
                    >
                      YouTube
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Embedded YouTube Player Modal */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-white truncate">
                {activeVideo.title}
              </h3>
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="px-3 py-1 rounded-lg bg-[#1E1E22] text-xs text-[#D4D4D8] cursor-pointer"
              >
                {t('close')}
              </button>
            </div>
            <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-[#242429]">
              <iframe
                src={`https://www.youtube.com/embed/${activeVideo.videoId}?autoplay=1`}
                title={activeVideo.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
            {activeVideo.description && (
              <p className="text-xs text-[#9A9AA2] whitespace-pre-line max-h-28 overflow-y-auto">
                {activeVideo.description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
