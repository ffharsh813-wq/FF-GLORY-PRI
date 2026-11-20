import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  ClipboardList,
  Coins,
  Copy,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
  Ticket,
  Trash2,
  Upload,
  UserCheck,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import { apiRequest, getAdminToken, setAdminToken } from '../lib/api';
import {
  deleteYouTubeVideoFromFirestore,
  signInWithGooglePopup,
  syncSiteSettingsToFirestore,
  syncYouTubeVideoToFirestore,
} from '../lib/firebase';
import type {
  ActivityLogRecord,
  ApiLogRecord,
  CouponRecord,
  DepositOrderRecord,
  GroupRecord,
  PublicUser,
  SiteSettings,
  TransactionRecord,
  YouTubeVideoRecord,
} from '../types';
import { BrandMark } from './BrandMark';

type AdminSection =
  | 'overview'
  | 'users'
  | 'transactions'
  | 'groups'
  | 'coupons'
  | 'youtube'
  | 'api'
  | 'famwise'
  | 'logs'
  | 'backup'
  | 'settings';

interface YouTubeAdminView {
  configured: boolean;
  apiKeyMasked: string;
  lastCheckedAt: string | null;
  lastMessage: string;
  videos: YouTubeVideoRecord[];
}

interface AdminLogsView {
  apiLogs: ApiLogRecord[];
  activityLogs: ActivityLogRecord[];
}

interface ProviderAccountSummary {
  connected: boolean;
  username?: string;
  role?: string;
  basic_credits?: number;
  premium_credits?: number;
  max_groups?: number;
  error?: string;
}

interface CreditAuditRecord {
  id: string;
  operationId: string;
  adminId: string;
  adminUsername: string;
  targetUserId: string;
  targetUsername: string;
  operation: 'add' | 'deduct' | 'set';
  creditType: 'basic' | 'premium';
  amount: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  timestamp: string;
}

interface DeploymentStatusInfo {
  isServerless: boolean;
  platform: string;
  firestorePersistence: boolean;
  hasProviderEnv: boolean;
  hasProviderInStore: boolean;
  hasAdminEnv: boolean;
  hasFamwiseEnv: boolean;
  hasSessionSecretEnv: boolean;
  missingEnvVars: string[];
}

interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  totalCredits: number;
  basicCredits: number;
  premiumCredits: number;
  totalTransactions: number;
  activeGroups: number;
  totalGroups: number;
  providerAccount: ProviderAccountSummary;
  deploymentStatus?: DeploymentStatusInfo;
  apiStatus: {
    configured: boolean;
    status: string;
    lastTestedAt: string | null;
    lastMessage: string;
  };
}

interface ApiConfigView {
  baseUrl: string;
  configured: boolean;
  hasMasterKey: boolean;
  hasApiKey: boolean;
  masterKeyMasked: string;
  apiKeyMasked: string;
  providerUsername: string;
  hasProviderPassword: boolean;
  providerPasswordMasked: string;
  providerAccount: ProviderAccountSummary;
  deploymentStatus?: DeploymentStatusInfo;
  lastTestedAt: string | null;
  lastStatus: string;
  lastMessage: string;
  logs: ApiLogRecord[];
}

interface FamwiseAdminConfigView {
  baseUrl: string;
  upiId: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasWebhookSecret: boolean;
  webhookSecretMasked: string;
  basicCreditInr: number;
  premiumCreditInr: number;
  lastTestedAt: string | null;
  lastStatus: string;
  lastMessage: string;
  deposits: DepositOrderRecord[];
}

interface AdminPanelProps {
  settings: SiteSettings;
  onSettingsUpdated: (settings: SiteSettings) => void;
  onExitAdmin: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  settings,
  onSettingsUpdated,
  onExitAdmin,
}) => {
  const [adminUser, setAdminUser] = useState<PublicUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginKey, setShowLoginKey] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [section, setSection] = useState<AdminSection>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserDetail, setSelectedUserDetail] = useState<{
    user: PublicUser;
    transactions: TransactionRecord[];
    groups: GroupRecord[];
    audits: CreditAuditRecord[];
  } | null>(null);

  // Credit management modal for selected user (unlimited custom amounts + set balance)
  const [creditModalUser, setCreditModalUser] = useState<PublicUser | null>(null);
  const [creditOp, setCreditOp] = useState<'add' | 'deduct' | 'set'>('add');
  const [creditType, setCreditType] = useState<'basic' | 'premium'>('basic');
  const [creditAmount, setCreditAmount] = useState(100);
  const [creditReason, setCreditReason] = useState('');

  // Transactions & Credit Audits
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [creditAudits, setCreditAudits] = useState<CreditAuditRecord[]>([]);
  const [txnSearch, setTxnSearch] = useState('');
  const [txnStatusFilter, setTxnStatusFilter] = useState('');
  const [txnTypeFilter, setTxnTypeFilter] = useState('');
  const [txnSubTab, setTxnSubTab] = useState<'transactions' | 'audits'>('transactions');
  const [selectedTxn, setSelectedTxn] = useState<TransactionRecord | null>(null);

  // Groups
  const [groups, setGroups] = useState<GroupRecord[]>([]);

  // Coupons
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponBasic, setNewCouponBasic] = useState(1);
  const [newCouponPremium, setNewCouponPremium] = useState(0);
  const [newCouponLimit, setNewCouponLimit] = useState(1);
  const [newCouponExpiry, setNewCouponExpiry] = useState('');

  // Provider / API Management
  const [apiConfig, setApiConfig] = useState<ApiConfigView | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState('https://ffglory.pro');
  const [apiMasterKey, setApiMasterKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [providerUsernameInput, setProviderUsernameInput] = useState('');
  const [providerPasswordInput, setProviderPasswordInput] = useState('');
  const [testingApi, setTestingApi] = useState(false);

  // Famwise UPI Gateway Configuration
  const [famwiseConfig, setFamwiseConfig] = useState<FamwiseAdminConfigView | null>(null);
  const [famwiseBaseUrl, setFamwiseBaseUrl] = useState('https://famwise.co');
  const [famwiseApiKeyInput, setFamwiseApiKeyInput] = useState('');
  const [famwiseUpiIdInput, setFamwiseUpiIdInput] = useState('');
  const [famwiseWebhookSecretInput, setFamwiseWebhookSecretInput] = useState('');
  const [famwiseBasicInr, setFamwiseBasicInr] = useState(80);
  const [famwisePremiumInr, setFamwisePremiumInr] = useState(160);
  const [testingFamwise, setTestingFamwise] = useState(false);

  // Website Settings form
  const [siteForm, setSiteForm] = useState<SiteSettings>(settings);

  // Admin Password change
  const [currAdminPw, setCurrAdminPw] = useState('');
  const [newAdminPw, setNewAdminPw] = useState('');
  const [confirmAdminPw, setConfirmAdminPw] = useState('');

  // YouTube Data API v3 Management
  const [youtubeView, setYoutubeView] = useState<YouTubeAdminView | null>(null);
  const [ytApiKeyInput, setYtApiKeyInput] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [ytDescription, setYtDescription] = useState('');
  const [ytThumbnailUrl, setYtThumbnailUrl] = useState('');
  const [ytChannelTitle, setYtChannelTitle] = useState('');
  const [ytPublished, setYtPublished] = useState(true);
  const [ytFetching, setYtFetching] = useState(false);
  const [ytEditingVideo, setYtEditingVideo] = useState<YouTubeVideoRecord | null>(null);

  // Unified Logs Panel
  const [adminLogs, setAdminLogs] = useState<AdminLogsView | null>(null);
  const [logsSubTab, setLogsSubTab] = useState<'activity' | 'api'>('activity');
  const [logSearch, setLogSearch] = useState('');

  const [bannerMsg, setBannerMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Source Code ZIP Download state
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    percent: number | null;
    loadedBytes: number;
    totalBytes: number;
  } | null>(null);

  // Permanent JSON Backup, Device Upload Restore & .env Export state
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFileName, setBackupFileName] = useState('');
  const [backupJsonText, setBackupJsonText] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupNeedsPassphrase, setBackupNeedsPassphrase] = useState(false);
  const [backupPreview, setBackupPreview] = useState<{
    kind: string;
    users?: number;
    groups?: number;
    hasProviderKeys?: boolean;
    hasFamwiseKey?: boolean;
  } | null>(null);
  const [encryptPassphrase, setEncryptPassphrase] = useState('');
  const [envExport, setEnvExport] = useState<{
    envText: string;
    configuredKeys: string[];
    missingKeys: string[];
  } | null>(null);
  const [copiedEnv, setCopiedEnv] = useState(false);

  useEffect(() => {
    setSiteForm(settings);
  }, [settings]);

  const formatAdminAuthError = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : '';
    const lower = raw.toLowerCase();
    if (lower.includes('auth/unauthorized-domain')) {
      return 'This domain is not yet allowlisted in Firebase Auth Authorized Domains. Sign in using your Admin Access Key above, or add this domain in Firebase Console -> Authentication -> Settings -> Authorized domains.';
    }
    if (lower.includes('auth/popup-blocked')) {
      return 'Google Sign-In popup was blocked by your browser. Allow popups or sign in using your Admin Access Key above.';
    }
    if (lower.includes('auth/popup-closed-by-user') || lower.includes('auth/cancelled-popup-request')) {
      return 'Google Sign-In popup was closed before completing authentication.';
    }
    return raw || fallback;
  };

  const loadAllAdminData = useCallback(async () => {
    const results = await Promise.allSettled([
      apiRequest<AdminOverview>('/api/admin/overview', { scope: 'admin' }),
      apiRequest<PublicUser[]>('/api/admin/users', { scope: 'admin' }),
      apiRequest<TransactionRecord[]>('/api/admin/transactions', { scope: 'admin' }),
      apiRequest<CreditAuditRecord[]>('/api/admin/credit-audits', { scope: 'admin' }),
      apiRequest<GroupRecord[]>('/api/admin/groups', { scope: 'admin' }),
      apiRequest<CouponRecord[]>('/api/admin/coupons', { scope: 'admin' }),
      apiRequest<ApiConfigView>('/api/admin/api-config', { scope: 'admin' }),
      apiRequest<FamwiseAdminConfigView>('/api/admin/famwise-config', { scope: 'admin' }),
      apiRequest<SiteSettings>('/api/admin/settings', { scope: 'admin' }),
      apiRequest<YouTubeAdminView>('/api/admin/youtube', { scope: 'admin' }),
      apiRequest<AdminLogsView>('/api/admin/logs', { scope: 'admin' }),
    ]);

    const [
      ovRes,
      usrRes,
      txnRes,
      auditRes,
      grpRes,
      cpnRes,
      apiCfgRes,
      fwCfgRes,
      liveSettingsRes,
      ytRes,
      logsRes,
    ] = results;

    if (ovRes.status === 'fulfilled') setOverview(ovRes.value);
    if (usrRes.status === 'fulfilled') setUsers(Array.isArray(usrRes.value) ? usrRes.value : []);
    if (txnRes.status === 'fulfilled') setTransactions(Array.isArray(txnRes.value) ? txnRes.value : []);
    if (auditRes.status === 'fulfilled') setCreditAudits(Array.isArray(auditRes.value) ? auditRes.value : []);
    if (grpRes.status === 'fulfilled') setGroups(Array.isArray(grpRes.value) ? grpRes.value : []);
    if (cpnRes.status === 'fulfilled') setCoupons(Array.isArray(cpnRes.value) ? cpnRes.value : []);
    if (apiCfgRes.status === 'fulfilled') {
      const apiCfg = apiCfgRes.value;
      setApiConfig(apiCfg);
      setApiBaseUrl(apiCfg.baseUrl || 'https://ffglory.pro');
      setProviderUsernameInput(apiCfg.providerUsername || '');
    }
    if (fwCfgRes.status === 'fulfilled') {
      const fwCfg = fwCfgRes.value;
      setFamwiseConfig(fwCfg);
      setFamwiseBaseUrl(fwCfg.baseUrl || 'https://famwise.co');
      setFamwiseUpiIdInput(fwCfg.upiId || '');
      setFamwiseBasicInr(fwCfg.basicCreditInr || 80);
      setFamwisePremiumInr(fwCfg.premiumCreditInr || 160);
    }
    if (liveSettingsRes.status === 'fulfilled') {
      setSiteForm(liveSettingsRes.value);
      onSettingsUpdated(liveSettingsRes.value);
    }
    if (ytRes.status === 'fulfilled') {
      setYoutubeView(ytRes.value);
    }
    if (logsRes.status === 'fulfilled') {
      const logsData = logsRes.value;
      setAdminLogs({
        apiLogs: Array.isArray(logsData?.apiLogs) ? logsData.apiLogs : [],
        activityLogs: Array.isArray(logsData?.activityLogs) ? logsData.activityLogs : [],
      });
    }

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length === results.length) {
      throw failed[0].reason;
    }
    if (failed.length > 0) {
      const firstErr = failed[0].reason instanceof Error ? failed[0].reason.message : 'Partial sync error';
      setBannerMsg({
        ok: false,
        text: `Some admin panels could not refresh (${failed.length} request(s)): ${firstErr}`,
      });
    }
  }, [onSettingsUpdated]);

  useEffect(() => {
    const check = async () => {
      try {
        const status = await apiRequest<{ setupRequired: boolean }>(
          '/api/admin/setup-status',
          { scope: 'public' }
        );
        setSetupRequired(Boolean(status.setupRequired));

        try {
          const res = await apiRequest<{ admin: PublicUser }>('/api/admin/me', { scope: 'admin' });
          setAdminUser(res.admin);
          await loadAllAdminData().catch(() => undefined);
        } catch {
          setAdminToken(null);
          setAdminUser(null);
        }
      } catch {
        setAdminToken(null);
        setAdminUser(null);
      } finally {
        setCheckingSession(false);
      }
    };
    void check();
  }, [loadAllAdminData]);

  const handleInitialSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (setupPassword !== setupConfirm) {
      setLoginError('Passwords do not match.');
      return;
    }
    setLoggingIn(true);
    try {
      const res = await apiRequest<{ token: string; admin: PublicUser }>('/api/admin/setup', {
        method: 'POST',
        scope: 'public',
        body: { password: setupPassword, confirmPassword: setupConfirm },
      });
      setAdminToken(res.token);
      setAdminUser(res.admin);
      setSetupRequired(false);
      await loadAllAdminData().catch(() => undefined);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Admin setup failed.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await apiRequest<{ token: string; admin: PublicUser }>('/api/admin/login', {
        method: 'POST',
        scope: 'public',
        body: { accessKey: loginPassword },
      });
      setAdminToken(res.token);
      setAdminUser(res.admin);
      setLoginPassword('');
      await loadAllAdminData().catch(() => undefined);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Admin login failed.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdminGoogleLogin = async () => {
    setLoginError('');
    setLoggingIn(true);
    try {
      const { idToken } = await signInWithGooglePopup();
      const res = await apiRequest<{ token: string; admin: PublicUser }>(
        '/api/admin/google-login',
        {
          method: 'POST',
          scope: 'public',
          body: { idToken },
        }
      );
      setAdminToken(res.token);
      setAdminUser(res.admin);
      await loadAllAdminData().catch(() => undefined);
    } catch (err) {
      setLoginError(formatAdminAuthError(err, 'Google Super Admin authentication failed.'));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await apiRequest('/api/admin/logout', { method: 'POST', scope: 'admin' });
    } finally {
      setAdminToken(null);
      setAdminUser(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const list = Array.isArray(users) ? users : [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        String(u.username || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.id || '').toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const filteredTransactions = useMemo(() => {
    const list = Array.isArray(transactions) ? transactions : [];
    const q = txnSearch.trim().toLowerCase();
    return list.filter((t) => {
      if (txnStatusFilter && t.status !== txnStatusFilter) return false;
      if (txnTypeFilter && t.type !== txnTypeFilter) return false;
      if (
        q &&
        !String(t.id || '').toLowerCase().includes(q) &&
        !String(t.order_id || '').toLowerCase().includes(q) &&
        !String(t.username || '').toLowerCase().includes(q) &&
        !String(t.details || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [transactions, txnSearch, txnStatusFilter, txnTypeFilter]);

  const handleOpenUserDetail = async (id: string) => {
    try {
      const detail = await apiRequest<{
        user: PublicUser;
        transactions: TransactionRecord[];
        groups: GroupRecord[];
        audits: CreditAuditRecord[];
      }>(`/api/admin/users/${id}`, { scope: 'admin' });
      setSelectedUserDetail(detail);
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to load user.' });
    }
  };

  const handleBlockToggle = async (u: PublicUser) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admin/users/${u.id}/${u.blocked ? 'unblock' : 'block'}`, {
        method: 'POST',
        scope: 'admin',
      });
      await loadAllAdminData();
      setBannerMsg({
        ok: true,
        text: `User '${u.username}' ${u.blocked ? 'unblocked' : 'blocked'}.`,
      });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Operation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAdjustCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditModalUser || busy) return;
    setBusy(true);
    const operationId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      await apiRequest(`/api/admin/users/${creditModalUser.id}/credits`, {
        method: 'POST',
        scope: 'admin',
        body: {
          operation: creditOp,
          creditType,
          amount: creditAmount,
          reason: creditReason,
          operationId,
        },
      });
      setCreditModalUser(null);
      setCreditReason('');
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: 'User credit balance updated and recorded in audit log.' });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Credit update failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveRejectTxn = async (txnId: string, action: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await apiRequest(`/api/admin/transactions/${txnId}/${action}`, {
        method: 'POST',
        scope: 'admin',
      });
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `Transaction ${txnId} ${action}d.` });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Action failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAdminGroupAction = async (
    groupId: string,
    action: 'stop' | 'restart' | 'delete' | 'get-glory' | 'get-clan-info'
  ) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admin/groups/${groupId}/action`, {
        method: 'POST',
        scope: 'admin',
        body: { action },
      });
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `Group #${groupId} action '${action}' succeeded.` });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Group action failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAdminGroupRefund = async (groupId: string) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admin/groups/${groupId}/refund`, {
        method: 'POST',
        scope: 'admin',
      });
      await loadAllAdminData();
      setBannerMsg({
        ok: true,
        text: `Group #${groupId} stopped (if active) and +1 credit refunded to owner.`,
      });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Group refund failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAdminCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ coupon: CouponRecord }>('/api/admin/coupons', {
        method: 'POST',
        scope: 'admin',
        body: {
          code: newCouponCode.trim() || undefined,
          basic_credits: newCouponBasic,
          premium_credits: newCouponPremium,
          usage_limit: newCouponLimit,
          expires_at: newCouponExpiry || undefined,
        },
      });
      setNewCouponCode('');
      setNewCouponExpiry('');
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `Coupon ${res.coupon.code} created.` });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Coupon creation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCoupon = async (coupon: CouponRecord) => {
    setBusy(true);
    try {
      const endpoint = coupon.status === 'disabled' ? 'enable' : 'disable';
      await apiRequest(`/api/admin/coupons/${coupon.code}/${endpoint}`, {
        method: 'POST',
        scope: 'admin',
      });
      await loadAllAdminData();
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to update coupon.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveApiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/admin/api-config', {
        method: 'POST',
        scope: 'admin',
        body: {
          baseUrl: apiBaseUrl,
          masterKey: apiMasterKey || undefined,
          apiKey: apiKeyInput || undefined,
          providerUsername: providerUsernameInput,
          providerPassword: providerPasswordInput || undefined,
        },
      });
      setApiMasterKey('');
      setApiKeyInput('');
      setProviderPasswordInput('');
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: 'Provider configuration saved securely on backend.' });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleTestApiConnection = async () => {
    setTestingApi(true);
    try {
      const res = await apiRequest<{
        pricing: { source: string; regionsCount: number; error: string | null };
        authenticated: ProviderAccountSummary;
      }>('/api/admin/api-test', { method: 'POST', scope: 'admin' });
      await loadAllAdminData();
      setBannerMsg({
        ok: res.authenticated.connected,
        text: res.authenticated.connected
          ? `Connected to provider account (${res.authenticated.username || 'verified'})! Basic: ${res.authenticated.basic_credits ?? 0}, Premium: ${res.authenticated.premium_credits ?? 0}.`
          : `Pricing: ${res.pricing.source}. Provider check: ${res.authenticated.error || 'Failed'}`,
      });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'API test failed.' });
    } finally {
      setTestingApi(false);
    }
  };

  const handleSaveFamwiseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/admin/famwise-config', {
        method: 'POST',
        scope: 'admin',
        body: {
          baseUrl: famwiseBaseUrl,
          apiKey: famwiseApiKeyInput || undefined,
          upiId: famwiseUpiIdInput,
          webhookSecret: famwiseWebhookSecretInput || undefined,
          basicCreditInr: famwiseBasicInr,
          premiumCreditInr: famwisePremiumInr,
        },
      });
      setFamwiseApiKeyInput('');
      setFamwiseWebhookSecretInput('');
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: 'Famwise UPI configuration saved securely on backend.' });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleTestFamwiseConnection = async () => {
    setTestingFamwise(true);
    try {
      const res = await apiRequest<{ connected: boolean; message: string; httpStatus: number }>(
        '/api/admin/famwise-test',
        { method: 'POST', scope: 'admin' }
      );
      await loadAllAdminData();
      setBannerMsg({
        ok: res.connected,
        text: `${res.message} (HTTP ${res.httpStatus})`,
      });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Famwise API test failed.',
      });
    } finally {
      setTestingFamwise(false);
    }
  };

  const handleDownloadSourceZip = async () => {
    if (downloadingZip) return;
    setDownloadingZip(true);
    setBannerMsg(null);
    setZipProgress({ percent: 0, loadedBytes: 0, totalBytes: 0 });

    try {
      const headers: Record<string, string> = {};
      const token = getAdminToken();
      if (token) headers['x-admin-token'] = token;

      const res = await fetch('/api/admin/download-source-zip', {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg =
          errData && typeof errData === 'object' && 'error' in errData
            ? String((errData as { error: unknown }).error)
            : `Download failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      const fileCount = Number(res.headers.get('x-source-file-count') || 0);

      let blob: Blob;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let loadedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loadedBytes += value.byteLength;
            const percent =
              contentLength > 0
                ? Math.min(100, Math.round((loadedBytes / contentLength) * 100))
                : null;
            setZipProgress({ percent, loadedBytes, totalBytes: contentLength });
          }
        }
        blob = new Blob(chunks, { type: 'application/zip' });
      } else {
        blob = await res.blob();
        setZipProgress({
          percent: 100,
          loadedBytes: blob.size,
          totalBytes: blob.size,
        });
      }

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'kakarot-glory-pro-source-code.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10_000);

      const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
      setBannerMsg({
        ok: true,
        text: `Source code ZIP downloaded (${fileCount > 0 ? `${fileCount} files · ` : ''}${sizeMb} MB). Private keys & runtime DBs excluded.`,
      });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to download source code ZIP.',
      });
    } finally {
      setDownloadingZip(false);
      setZipProgress(null);
    }
  };

  const handleSaveWebsiteSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ success: boolean; settings: SiteSettings }>(
        '/api/admin/settings',
        {
          method: 'PUT',
          scope: 'admin',
          body: siteForm,
        }
      );
      onSettingsUpdated(res.settings);
      await syncSiteSettingsToFirestore(res.settings);
      setBannerMsg({
        ok: true,
        text: 'Website settings saved permanently and propagated across the platform.',
      });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Settings save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 350 * 1024) {
      setBannerMsg({ ok: false, text: 'Logo image must be under 350KB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSiteForm((prev) => ({ ...prev, websiteLogo: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAdminPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/change-password', {
        method: 'POST',
        scope: 'admin',
        body: {
          currentPassword: currAdminPw,
          newPassword: newAdminPw,
          confirmNewPassword: confirmAdminPw,
        },
      });
      setCurrAdminPw('');
      setNewAdminPw('');
      setConfirmAdminPw('');
      setBannerMsg({ ok: true, text: res.message });
    } catch (err) {
      setBannerMsg({ ok: false, text: err instanceof Error ? err.message : 'Access key update failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveYouTubeConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytApiKeyInput.trim()) return;
    setBusy(true);
    try {
      await apiRequest('/api/admin/youtube/config', {
        method: 'POST',
        scope: 'admin',
        body: { apiKey: ytApiKeyInput.trim() },
      });
      setYtApiKeyInput('');
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: 'YouTube Data API v3 key saved securely on backend.' });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save YouTube API key.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFetchYouTubeMetadata = async () => {
    if (!ytUrl.trim()) {
      setBannerMsg({ ok: false, text: 'Enter a YouTube video URL or video ID first.' });
      return;
    }
    setYtFetching(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        video: {
          videoId: string;
          url: string;
          title: string;
          description: string;
          thumbnailUrl: string;
          channelTitle: string;
        };
      }>('/api/admin/youtube/fetch', {
        method: 'POST',
        scope: 'admin',
        body: { url: ytUrl.trim() },
      });
      setYtUrl(res.video.url);
      setYtTitle(res.video.title);
      setYtDescription(res.video.description);
      setYtThumbnailUrl(res.video.thumbnailUrl);
      setYtChannelTitle(res.video.channelTitle);
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `Fetched metadata from YouTube Data API v3: ${res.video.title}` });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Could not fetch video metadata from YouTube API.',
      });
    } finally {
      setYtFetching(false);
    }
  };

  const handleAddYouTubeVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ success: boolean; video: YouTubeVideoRecord }>(
        '/api/admin/youtube/videos',
        {
          method: 'POST',
          scope: 'admin',
          body: {
            url: ytUrl.trim(),
            title: ytTitle.trim(),
            description: ytDescription.trim(),
            thumbnailUrl: ytThumbnailUrl.trim(),
            channelTitle: ytChannelTitle.trim(),
            published: ytPublished,
          },
        }
      );
      await syncYouTubeVideoToFirestore(res.video);
      setYtUrl('');
      setYtTitle('');
      setYtDescription('');
      setYtThumbnailUrl('');
      setYtChannelTitle('');
      setYtPublished(true);
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `YouTube video "${res.video.title}" added and synced live.` });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to add YouTube video.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEditYouTubeVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytEditingVideo) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ success: boolean; video: YouTubeVideoRecord }>(
        `/api/admin/youtube/videos/${ytEditingVideo.id}`,
        {
          method: 'PUT',
          scope: 'admin',
          body: {
            url: ytEditingVideo.url,
            title: ytEditingVideo.title,
            description: ytEditingVideo.description,
            thumbnailUrl: ytEditingVideo.thumbnailUrl,
            channelTitle: ytEditingVideo.channelTitle,
            published: ytEditingVideo.published,
            order: ytEditingVideo.order,
          },
        }
      );
      await syncYouTubeVideoToFirestore(res.video);
      setYtEditingVideo(null);
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `Updated video "${res.video.title}" and synced live.` });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to update YouTube video.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePublishYouTubeVideo = async (video: YouTubeVideoRecord) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ success: boolean; video: YouTubeVideoRecord }>(
        `/api/admin/youtube/videos/${video.id}`,
        {
          method: 'PUT',
          scope: 'admin',
          body: { published: !video.published },
        }
      );
      await syncYouTubeVideoToFirestore(res.video);
      await loadAllAdminData();
      setBannerMsg({
        ok: true,
        text: `"${res.video.title}" is now ${res.video.published ? 'Published' : 'Hidden'}.`,
      });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to toggle publish state.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteYouTubeVideo = async (video: YouTubeVideoRecord) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admin/youtube/videos/${video.id}`, {
        method: 'DELETE',
        scope: 'admin',
      });
      await deleteYouTubeVideoFromFirestore(video.id);
      await loadAllAdminData();
      setBannerMsg({ ok: true, text: `Removed video "${video.title}".` });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to delete video.',
      });
    } finally {
      setBusy(false);
    }
  };

  const inspectBackupText = (rawText: string) => {
    setBackupJsonText(rawText);
    setBackupNeedsPassphrase(false);
    setBackupPreview(null);
    const trimmed = rawText.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.format === 'kakarot-glory-pro-backup-v1') {
        const stats = parsed.stats as Record<string, unknown> | undefined;
        setBackupNeedsPassphrase(true);
        setBackupPreview({
          kind: 'Encrypted Backup (.json)',
          users: typeof stats?.users === 'number' ? stats.users : undefined,
          groups: typeof stats?.groups === 'number' ? stats.groups : undefined,
          hasProviderKeys: Boolean(stats?.hasProviderKeys),
          hasFamwiseKey: Boolean(stats?.hasFamwiseKey),
        });
      } else if (
        parsed.format === 'kakarot-glory-pro-plain-backup-v1' &&
        parsed.state &&
        typeof parsed.state === 'object'
      ) {
        const st = parsed.state as Record<string, unknown>;
        const stUsers = Array.isArray(st.users) ? st.users : [];
        const stGroups = Array.isArray(st.groups) ? st.groups : [];
        const stApi = (st.apiConfig || {}) as Record<string, unknown>;
        const stFw = (st.famwiseConfig || {}) as Record<string, unknown>;
        setBackupPreview({
          kind: 'Full Website Backup (.json)',
          users: stUsers.length,
          groups: stGroups.length,
          hasProviderKeys: Boolean(stApi.apiKey && stApi.masterKey),
          hasFamwiseKey: Boolean(stFw.apiKey),
        });
      } else if (parsed.settings && Array.isArray(parsed.users)) {
        const stApi = (parsed.apiConfig || {}) as Record<string, unknown>;
        const stFw = (parsed.famwiseConfig || {}) as Record<string, unknown>;
        setBackupPreview({
          kind: 'Raw Database JSON',
          users: parsed.users.length,
          groups: Array.isArray(parsed.groups) ? parsed.groups.length : 0,
          hasProviderKeys: Boolean(stApi.apiKey && stApi.masterKey),
          hasFamwiseKey: Boolean(stFw.apiKey),
        });
      }
    } catch {
      // ignore invalid partial edits until submit
    }
  };

  const handleSelectBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        inspectBackupText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadPlainJsonBackup = async () => {
    setBackupBusy(true);
    setBannerMsg(null);
    try {
      const headers: Record<string, string> = {};
      const token = getAdminToken();
      if (token) headers['x-admin-token'] = token;

      const res = await fetch('/api/admin/backup/export-json', {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || `Download failed (HTTP ${res.status})`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kakarot-glory-pro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setBannerMsg({
        ok: true,
        text: 'Full JSON Backup downloaded! Upload this .json file on any host to restore all providers, users, groups & settings.',
      });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to download backup JSON.',
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDownloadEncryptedBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBackupBusy(true);
    setBannerMsg(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAdminToken();
      if (token) headers['x-admin-token'] = token;

      const res = await fetch('/api/admin/backup/export-encrypted', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ passphrase: encryptPassphrase }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || `Download failed (HTTP ${res.status})`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kakarot-glory-pro-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setEncryptPassphrase('');
      setBannerMsg({
        ok: true,
        text: 'Encrypted Backup (.json) downloaded safely.',
      });
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to create encrypted backup.',
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackupJson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupJsonText.trim()) return;
    setBackupBusy(true);
    setBannerMsg(null);
    try {
      const res = await apiRequest<{
        success: boolean;
        message: string;
        settings: SiteSettings;
        restored: {
          users: number;
          groups: number;
          transactions: number;
          coupons: number;
          youtubeVideos: number;
          hasProviderKeys: boolean;
          hasFamwiseKey: boolean;
        };
      }>('/api/admin/backup/import', {
        method: 'POST',
        scope: 'admin',
        body: {
          payload: backupJsonText,
          passphrase: backupPassphrase,
        },
      });
      onSettingsUpdated(res.settings);
      await syncSiteSettingsToFirestore(res.settings);
      await loadAllAdminData();
      setBackupPassphrase('');
      setBackupNeedsPassphrase(false);
      setBannerMsg({
        ok: true,
        text: `Restored & Saved! Providers: ${res.restored.hasProviderKeys ? 'Active' : 'Empty'} · Famwise: ${res.restored.hasFamwiseKey ? 'Active' : 'Empty'} · Users: ${res.restored.users} · Groups: ${res.restored.groups} · Coupons: ${res.restored.coupons}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to restore backup JSON.';
      if (msg.toLowerCase().includes('passphrase')) {
        setBackupNeedsPassphrase(true);
      }
      setBannerMsg({ ok: false, text: msg });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleLoadEnvExport = async () => {
    setBackupBusy(true);
    try {
      const data = await apiRequest<{
        envText: string;
        configuredKeys: string[];
        missingKeys: string[];
      }>('/api/admin/backup/export-env', { scope: 'admin' });
      setEnvExport(data);
    } catch (err) {
      setBannerMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to generate .env export.',
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleCopyEnvText = () => {
    if (!envExport?.envText) return;
    void navigator.clipboard?.writeText(envExport.envText);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 1800);
  };

  const handleDownloadEnvFile = () => {
    if (!envExport?.envText) return;
    const blob = new Blob([envExport.envText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kakarot-host.env.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#0D0D0E] flex items-center justify-center text-sm text-[#8E8E95]">
        Verifying Super Admin session...
      </div>
    );
  }

  // SEPARATE ADMIN LOGIN OR INITIAL SECURE SETUP
  if (!adminUser) {
    return (
      <div className="min-h-screen bg-[#0D0D0E] flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-[430px] bg-[#141416] border border-[#242428] rounded-[24px] p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-[#1D1B16] border border-[#5B4F37] flex items-center justify-center">
              <BrandMark logoUrl={settings.websiteLogo} name={settings.websiteName} size={42} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {setupRequired ? 'Initialize Super Admin' : 'Super Admin Portal'}
              </h1>
              <p className="text-xs text-[#8E8E95] mt-1">
                {settings.websiteName} · Restricted Administrative Access
              </p>
            </div>
          </div>

          {loginError && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {setupRequired ? (
            <form onSubmit={handleInitialSetup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                  Create Admin Access Key (min 8 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  placeholder="Enter admin access key"
                  autoComplete="new-password"
                  className="w-full h-12 px-4 rounded-xl bg-[#101012] border border-[#28282C] text-white text-sm placeholder-[#5F5F66] focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                  Confirm Admin Access Key
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                  placeholder="Re-enter admin access key"
                  autoComplete="new-password"
                  className="w-full h-12 px-4 rounded-xl bg-[#101012] border border-[#28282C] text-white text-sm placeholder-[#5F5F66] focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
              <button
                type="submit"
                disabled={loggingIn}
                className="w-full h-12 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414] font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                {loggingIn ? 'Saving...' : 'Complete Admin Setup'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                  Admin Access Key
                </label>
                <div className="relative">
                  <input
                    type={showLoginKey ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter admin access key"
                    autoComplete="current-password"
                    className="w-full h-12 pl-4 pr-11 rounded-xl bg-[#101012] border border-[#28282C] text-white text-sm placeholder-[#5F5F66] focus:outline-none focus:border-[#DEC79B]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginKey((v) => !v)}
                    aria-label={showLoginKey ? 'Hide access key' : 'Show access key'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E95] hover:text-white cursor-pointer"
                  >
                    {showLoginKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loggingIn}
                className="w-full h-12 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414] font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                {loggingIn ? 'Authenticating...' : 'Unlock Admin Panel'}
              </button>
            </form>
          )}

          <div className="pt-4 border-t border-[#242428] space-y-3">
            <button
              type="button"
              disabled={loggingIn}
              onClick={handleAdminGoogleLogin}
              className="w-full h-11 rounded-xl bg-[#19191C] hover:bg-[#222226] border border-[#2A2A2E] text-[#E4E4E7] text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              <Shield className="w-4 h-4 text-[#DEC79B]" />
              Sign In with Google (Authorized Super Admin)
            </button>

            <button
              type="button"
              onClick={onExitAdmin}
              className="w-full text-center text-xs text-[#8E8E95] hover:text-white cursor-pointer"
            >
              ← Return to {settings.websiteName} User Panel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const NAV_TABS: Array<{
    id: AdminSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'users', label: 'Users & Credits', icon: Users },
    { id: 'transactions', label: 'Transactions & Audits', icon: ClipboardList },
    { id: 'groups', label: 'Groups', icon: Layers },
    { id: 'coupons', label: 'Coupons', icon: Ticket },
    { id: 'youtube', label: 'YouTube Videos', icon: Video },
    { id: 'api', label: 'Provider API', icon: Server },
    { id: 'famwise', label: 'Famwise UPI', icon: Wallet },
    { id: 'backup', label: 'Backup & JSON', icon: Database },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'settings', label: 'Website Settings', icon: Globe },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0E] text-white">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-30 bg-[#0D0D0E]/95 backdrop-blur-md border-b border-[#1E1E22]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark logoUrl={settings.websiteLogo} name={settings.websiteName} size={34} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">
                {settings.websiteName} · Admin Panel
              </div>
              <div className="text-[11px] text-[#8E8E95] truncate">
                Signed in as {adminUser.username} ({adminUser.email})
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadAllAdminData()}
              className="h-9 px-3 rounded-xl bg-[#1A1A1D] border border-[#2C2C32] text-xs font-medium text-[#D4D4D8] hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={onExitAdmin}
              className="h-9 px-3 rounded-xl bg-[#1A1A1D] border border-[#2C2C32] text-xs font-medium text-[#DEC79B] hover:border-[#DEC79B] cursor-pointer"
            >
              User Site
            </button>
            <button
              type="button"
              onClick={handleAdminLogout}
              className="h-9 px-3 rounded-xl bg-red-950/40 border border-red-900/50 text-xs font-medium text-red-300 hover:bg-red-950/70 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Admin Section Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-2.5 flex gap-1.5 overflow-x-auto">
          {NAV_TABS.map((t) => {
            const Icon = t.icon;
            const active = section === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSection(t.id);
                  setBannerMsg(null);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#DEC79B] text-[#141414]'
                    : 'bg-[#151518] border border-[#242429] text-[#A1A1AA] hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-bold text-white">Complete Project Source Archive</div>
            <div className="text-[11px] text-[#8E8E95]">
              Includes frontend, backend, assets, config & README.txt (private keys and DBs excluded)
            </div>
            {downloadingZip && zipProgress && (
              <div className="pt-2 space-y-1 max-w-md">
                <div className="flex items-center justify-between text-[11px] text-[#DEC79B] tabular-nums">
                  <span>
                    {zipProgress.loadedBytes === 0
                      ? 'Building ZIP archive on server...'
                      : zipProgress.percent !== null
                        ? `Downloading... ${zipProgress.percent}%`
                        : `Downloading... ${(zipProgress.loadedBytes / 1024).toFixed(0)} KB`}
                  </span>
                  {zipProgress.totalBytes > 0 && (
                    <span>
                      {(zipProgress.loadedBytes / (1024 * 1024)).toFixed(2)} /{' '}
                      {(zipProgress.totalBytes / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  )}
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#1E1E22] overflow-hidden">
                  <div
                    className={`h-full bg-[#DEC79B] transition-all duration-150 ${
                      zipProgress.percent === null || zipProgress.loadedBytes === 0
                        ? 'w-1/2 animate-pulse'
                        : ''
                    }`}
                    style={
                      zipProgress.percent !== null && zipProgress.loadedBytes > 0
                        ? { width: `${zipProgress.percent}%` }
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSection('backup');
                setBannerMsg(null);
              }}
              className="h-10 px-3.5 rounded-xl bg-[#1A1A1E] hover:bg-[#242429] border border-[#323238] text-[#DEC79B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Backup / Upload .JSON</span>
            </button>
            <button
              type="button"
              disabled={downloadingZip}
              onClick={() => void handleDownloadSourceZip()}
              className="h-10 px-4 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-60 text-[#141414] text-xs font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              {downloadingZip && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {downloadingZip
                  ? 'Preparing & Downloading ZIP...'
                  : '📦 Download All Source Code (.ZIP)'}
              </span>
            </button>
          </div>
        </div>

        {bannerMsg && (
          <div
            className={`p-3.5 rounded-xl text-xs border flex items-center justify-between gap-2 ${
              bannerMsg.ok
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-red-950/40 border-red-800/60 text-red-300'
            }`}
          >
            <span>{bannerMsg.text}</span>
            <button
              type="button"
              onClick={() => setBannerMsg(null)}
              className="text-xs underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. OVERVIEW */}
        {section === 'overview' && !overview && (
          <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-6 flex items-center justify-between gap-3">
            <div className="text-xs text-[#A1A1AA]">
              Loading admin overview telemetry...
            </div>
            <button
              type="button"
              onClick={() => void loadAllAdminData()}
              className="h-9 px-3.5 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-semibold cursor-pointer"
            >
              Retry Load
            </button>
          </div>
        )}
        {section === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                { label: 'Total Users', value: overview.totalUsers, sub: `${overview.activeUsers} active` },
                {
                  label: 'User Website Credits',
                  value: overview.totalCredits,
                  sub: `${overview.basicCredits} Basic · ${overview.premiumCredits} Premium`,
                },
                {
                  label: 'Active Groups',
                  value: overview.activeGroups,
                  sub: `${overview.totalGroups} total groups`,
                },
                {
                  label: 'Total Transactions',
                  value: overview.totalTransactions,
                  sub: `Provider: ${overview.providerAccount.connected ? 'Connected' : 'Disconnected'}`,
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[#141416] border border-[#242428] rounded-[20px] p-4 sm:p-5 space-y-1.5"
                >
                  <span className="text-xs text-[#8E8E95]">{stat.label}</span>
                  <div className="text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums">
                    {stat.value}
                  </div>
                  <span className="text-[11px] text-[#DEC79B] block">{stat.sub}</span>
                </div>
              ))}
            </div>

            {/* Connected Main Provider Balance & Connection Card */}
            <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <Server className="w-4 h-4 text-[#DEC79B]" />
                    Main Provider Account Balance & Status
                  </div>
                  <p className="text-xs text-[#8E8E95]">
                    {overview.providerAccount.connected
                      ? `Connected as ${overview.providerAccount.username || 'provider account'} · Max Groups: ${overview.providerAccount.max_groups ?? '—'}`
                      : overview.providerAccount.error || 'Provider account not connected'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                      overview.providerAccount.connected
                        ? 'bg-emerald-950/50 border border-emerald-800/60 text-emerald-400'
                        : 'bg-red-950/50 border border-red-800/60 text-red-400'
                    }`}
                  >
                    {overview.providerAccount.connected ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {overview.providerAccount.connected ? 'Connected' : 'Error / Disconnected'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSection('api')}
                    className="px-4 h-9 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-semibold cursor-pointer"
                  >
                    Provider Settings
                  </button>
                </div>
              </div>

              {overview.providerAccount.connected && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
                    <span className="text-[11px] text-[#8E8E95] block">Provider Username</span>
                    <span className="text-sm font-bold font-mono text-white">
                      {overview.providerAccount.username || '—'}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
                    <span className="text-[11px] text-[#8E8E95] block">Provider Basic Credits</span>
                    <span className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
                      {overview.providerAccount.basic_credits ?? 0}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
                    <span className="text-[11px] text-[#8E8E95] block">Provider Premium Credits</span>
                    <span className="text-lg font-bold font-mono text-[#DEC79B] tabular-nums">
                      {overview.providerAccount.premium_credits ?? 0}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
                    <span className="text-[11px] text-[#8E8E95] block">Provider Max Groups</span>
                    <span className="text-lg font-bold font-mono text-white tabular-nums">
                      {overview.providerAccount.max_groups ?? 0}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. USER MANAGEMENT & UNLIMITED CREDIT CONTROL */}
        {section === 'users' && (
          <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-white">
                User & Credit Management ({filteredUsers.length})
              </h2>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search username, email, ID..."
                  className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-xs text-white focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#242428] text-[#8E8E95]">
                    <th className="py-3 pr-4">User</th>
                    <th className="py-3 pr-4">Email</th>
                    <th className="py-3 pr-4">Basic</th>
                    <th className="py-3 pr-4">Premium</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E22]">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[#7E7E86]">
                        No users found
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#19191C]">
                        <td className="py-3 pr-4 font-semibold text-white">{u.username}</td>
                        <td className="py-3 pr-4 text-[#A1A1AA]">{u.email}</td>
                        <td className="py-3 pr-4 font-mono tabular-nums text-white">{u.basicCredits}</td>
                        <td className="py-3 pr-4 font-mono tabular-nums text-[#DEC79B]">
                          {u.premiumCredits}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                              u.blocked
                                ? 'bg-red-950/50 text-red-400'
                                : 'bg-emerald-950/50 text-emerald-400'
                            }`}
                          >
                            {u.blocked ? 'Blocked' : 'Active'}
                          </span>
                        </td>
                        <td className="py-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenUserDetail(u.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#1E1E22] hover:bg-[#27272C] text-xs text-white inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCreditModalUser(u);
                              setCreditAmount(100);
                              setCreditOp('add');
                              setCreditType('basic');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[#282218] border border-[#6E5F44] text-xs text-[#DEC79B] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Coins className="w-3.5 h-3.5" />
                            Manage Credits
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleBlockToggle(u)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs inline-flex items-center gap-1 cursor-pointer ${
                              u.blocked
                                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/50'
                                : 'bg-red-950/40 text-red-400 border border-red-800/50'
                            }`}
                          >
                            {u.blocked ? (
                              <>
                                <UserCheck className="w-3.5 h-3.5" />
                                Unblock
                              </>
                            ) : (
                              <>
                                <Ban className="w-3.5 h-3.5" />
                                Block
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. TRANSACTIONS & CREDIT AUDIT HISTORY */}
        {section === 'transactions' && (
          <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTxnSubTab('transactions')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    txnSubTab === 'transactions'
                      ? 'bg-[#DEC79B] text-[#141414]'
                      : 'bg-[#1A1A1E] text-[#9A9AA2]'
                  }`}
                >
                  Transactions ({filteredTransactions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTxnSubTab('audits')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    txnSubTab === 'audits'
                      ? 'bg-[#DEC79B] text-[#141414]'
                      : 'bg-[#1A1A1E] text-[#9A9AA2]'
                  }`}
                >
                  Credit Audit History ({creditAudits.length})
                </button>
              </div>

              {txnSubTab === 'transactions' && (
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={txnSearch}
                    onChange={(e) => setTxnSearch(e.target.value)}
                    placeholder="Search ID, order, username..."
                    className="h-9 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-xs text-white focus:outline-none focus:border-[#DEC79B]"
                  />
                  <select
                    value={txnStatusFilter}
                    onChange={(e) => setTxnStatusFilter(e.target.value)}
                    className="h-9 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-xs text-white"
                  >
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <select
                    value={txnTypeFilter}
                    onChange={(e) => setTxnTypeFilter(e.target.value)}
                    className="h-9 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-xs text-white"
                  >
                    <option value="">All Types</option>
                    <option value="purchase">Purchase</option>
                    <option value="admin_add">Admin Add</option>
                    <option value="admin_deduct">Admin Deduct</option>
                    <option value="admin_set">Admin Set</option>
                    <option value="deduction">Group Deduction</option>
                    <option value="refund">Refund</option>
                    <option value="deposit">UPI Deposit (₹)</option>
                    <option value="wallet_spend">Wallet Spend (₹)</option>
                    <option value="coupon_redeem">Coupon Redeem</option>
                    <option value="coupon_create">Coupon Create</option>
                  </select>
                </div>
              )}
            </div>

            {txnSubTab === 'transactions' ? (
              <div className="space-y-2.5">
                {filteredTransactions.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[#7E7E86]">No matching transactions</p>
                ) : (
                  filteredTransactions.map((t) => (
                    <div
                      key={t.id}
                      className="p-3.5 rounded-xl bg-[#101012] border border-[#242429] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-[#DEC79B]">{t.id}</span>
                          <span className="text-white font-semibold">{t.username}</span>
                          <span className="text-[#7E7E86] capitalize">· {t.type.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="text-xs text-[#A1A1AA]">
                          {typeof t.amount_inr === 'number' && t.amount_inr !== 0 && (
                            <>
                              INR:{' '}
                              <span className="font-mono text-emerald-400">
                                {t.amount_inr > 0
                                  ? `+₹${t.amount_inr.toFixed(2)}`
                                  : `-₹${Math.abs(t.amount_inr).toFixed(2)}`}
                              </span>{' '}
                              ·{' '}
                            </>
                          )}
                          Basic: <span className="font-mono text-white">{t.basic_credits}</span> · Premium:{' '}
                          <span className="font-mono text-[#DEC79B]">{t.premium_credits}</span> ·{' '}
                          {t.details}
                        </div>
                        <div className="text-[11px] text-[#6E6E76] tabular-nums">
                          {new Date(t.created_at).toLocaleString()}
                          {t.performed_by ? ` · By Admin: ${t.performed_by}` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-[#1A1A1E] border border-[#2C2C33] text-xs capitalize text-white">
                          {t.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedTxn(t)}
                          className="px-2.5 py-1 rounded-lg bg-[#1E1E22] text-xs text-[#D4D4D8] cursor-pointer"
                        >
                          View
                        </button>
                        {t.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApproveRejectTxn(t.id, 'approve')}
                              className="px-2.5 py-1 rounded-lg bg-[#0FA968] text-xs font-semibold text-white cursor-pointer"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApproveRejectTxn(t.id, 'reject')}
                              className="px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-800 text-xs text-red-300 cursor-pointer"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#242428] text-[#8E8E95]">
                      <th className="py-2.5 pr-3">Date & Time</th>
                      <th className="py-2.5 pr-3">Admin</th>
                      <th className="py-2.5 pr-3">User</th>
                      <th className="py-2.5 pr-3">Operation</th>
                      <th className="py-2.5 pr-3">Balance Change</th>
                      <th className="py-2.5">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E1E22]">
                    {creditAudits.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[#7E7E86]">
                          No admin credit adjustments recorded yet
                        </td>
                      </tr>
                    ) : (
                      creditAudits.map((a) => (
                        <tr key={a.id}>
                          <td className="py-2.5 pr-3 text-[#8E8E95] tabular-nums whitespace-nowrap">
                            {new Date(a.timestamp).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-3 font-mono text-[#DEC79B]">{a.adminUsername}</td>
                          <td className="py-2.5 pr-3 font-semibold text-white">{a.targetUsername}</td>
                          <td className="py-2.5 pr-3 capitalize">
                            {a.operation} {a.amount} ({a.creditType})
                          </td>
                          <td className="py-2.5 pr-3 font-mono tabular-nums text-white">
                            {a.previousBalance} → {a.newBalance}
                          </td>
                          <td className="py-2.5 text-[#A1A1AA]">{a.reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 4. GROUP MANAGEMENT */}
        {section === 'groups' && (
          <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4">
            <h2 className="text-lg font-bold text-white">All Platform & Provider Groups ({groups.length})</h2>
            {groups.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#7E7E86]">No groups launched yet</p>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div
                    key={g.group_id}
                    className="p-4 rounded-xl bg-[#101012] border border-[#242429] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-white font-mono">
                        <span>Group #{g.group_id}</span>
                        <span className="text-xs font-sans font-normal text-[#8E8E95]">
                          by {g.username}
                        </span>
                        {g.refunded || g.status === 'refunded' ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-[10px] font-sans font-semibold text-emerald-300">
                            Refunded
                          </span>
                        ) : g.refund_requested ? (
                          <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-[10px] font-sans font-semibold text-amber-300">
                            Refund Requested
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-[#A1A1AA]">
                        {g.clan_info?.decoded?.clan_name
                          ? `${g.clan_info.decoded.clan_name} (${g.clan_id})`
                          : `Clan ${g.clan_id}`}{' '}
                        · {g.region_name} ({g.tier}) · Bots:{' '}
                        <span className="font-mono text-white">
                          {g.running_count}/{g.container_count}
                        </span>{' '}
                        · Matches:{' '}
                        <span className="font-mono text-white">{g.games_played ?? 0}</span> · Uptime:{' '}
                        <span className="font-mono text-white">{g.uptime || '0s'}</span> · Status:{' '}
                        <span className="text-[#DEC79B] capitalize">{g.status}</span> · Glory:{' '}
                        <span className="font-mono font-bold text-[#DEC79B]">
                          {g.glory_farmed.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAdminGroupAction(g.group_id, 'get-glory')}
                        className="px-3 py-1.5 rounded-lg bg-[#1C1C20] border border-[#2E2E35] text-xs text-[#DEC79B] cursor-pointer"
                      >
                        Sync Glory
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAdminGroupAction(g.group_id, 'restart')}
                        className="px-3 py-1.5 rounded-lg bg-[#1C1C20] border border-[#2E2E35] text-xs text-emerald-400 cursor-pointer"
                      >
                        Restart
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAdminGroupAction(g.group_id, 'stop')}
                        className="px-3 py-1.5 rounded-lg bg-[#1C1C20] border border-[#2E2E35] text-xs text-amber-400 cursor-pointer"
                      >
                        Stop
                      </button>
                      {!g.refunded && g.status !== 'refunded' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleAdminGroupRefund(g.group_id)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-300 cursor-pointer"
                        >
                          Refund (+1 Credit)
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAdminGroupAction(g.group_id, 'delete')}
                        className="px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-900/50 text-xs text-red-400 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5. COUPON MANAGEMENT */}
        {section === 'coupons' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <form
              onSubmit={handleAdminCreateCoupon}
              className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
            >
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#DEC79B]" />
                Create / Generate Coupon
              </h2>
              <div>
                <label className="block text-xs text-[#9A9AA2] mb-1">
                  Custom Code (leave empty to auto-generate)
                </label>
                <input
                  type="text"
                  value={newCouponCode}
                  onChange={(e) => setNewCouponCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Basic Credits</label>
                  <input
                    type="number"
                    min={0}
                    value={newCouponBasic}
                    onChange={(e) => setNewCouponBasic(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Premium Credits</label>
                  <input
                    type="number"
                    min={0}
                    value={newCouponPremium}
                    onChange={(e) => setNewCouponPremium(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Usage Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={newCouponLimit}
                    onChange={(e) => setNewCouponLimit(Math.max(1, Number(e.target.value)))}
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Expiry Date (optional)</label>
                  <input
                    type="date"
                    value={newCouponExpiry}
                    onChange={(e) => setNewCouponExpiry(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm cursor-pointer"
              >
                Generate Coupon
              </button>
            </form>

            <div className="lg:col-span-2 bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
              <h2 className="text-base font-bold text-white">All Coupons ({coupons.length})</h2>
              {coupons.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#7E7E86]">No coupons created yet</p>
              ) : (
                <div className="space-y-2.5">
                  {coupons.map((c) => (
                    <div
                      key={c.code}
                      className="p-3.5 rounded-xl bg-[#101012] border border-[#242429] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-mono text-sm font-bold text-[#DEC79B]">{c.code}</div>
                        <div className="text-xs text-[#8E8E95] mt-0.5 tabular-nums">
                          {c.basic_credits} Basic · {c.premium_credits} Premium · Uses: {c.used_count}/
                          {c.usage_limit}
                          {c.expires_at ? ` · Exp: ${c.expires_at}` : ''} · By {c.created_by}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-[#1A1A1E] text-xs capitalize text-white">
                          {c.status}
                        </span>
                        {(c.status === 'active' || c.status === 'disabled') && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleCoupon(c)}
                            className="px-3 py-1 rounded-lg bg-[#1E1E22] hover:bg-[#27272C] border border-[#2F2F37] text-xs text-white cursor-pointer"
                          >
                            {c.status === 'disabled' ? 'Enable' : 'Disable'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 6. PROVIDER CONFIGURATION & API LOGS */}
        {section === 'api' && apiConfig && (
          <div className="space-y-4">
            <form
              onSubmit={handleSaveApiConfig}
              className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Provider Configuration</h2>
                  <p className="text-xs text-[#8E8E95]">
                    Secrets are stored strictly on the backend and masked here for security.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                      apiConfig.providerAccount?.connected
                        ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60'
                        : 'bg-red-950/50 text-red-400 border border-red-800/60'
                    }`}
                  >
                    {apiConfig.providerAccount?.connected
                      ? `Connected (${apiConfig.providerAccount.basic_credits ?? 0}B / ${apiConfig.providerAccount.premium_credits ?? 0}P)`
                      : 'Disconnected'}
                  </span>
                  <button
                    type="button"
                    disabled={testingApi}
                    onClick={handleTestApiConnection}
                    className="px-4 h-10 rounded-xl bg-[#0FA968] hover:bg-[#12BA73] text-xs font-semibold text-white inline-flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingApi ? 'animate-spin' : ''}`} />
                    {testingApi ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Provider API URL</label>
                  <input
                    type="url"
                    required
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Provider API Key (?api_key=){' '}
                    {apiConfig.hasApiKey && (
                      <span className="text-emerald-400 font-mono">({apiConfig.apiKeyMasked})</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={apiConfig.hasApiKey ? 'Saved (enter to replace)' : 'Paste PROVIDER_API_KEY'}
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Provider Master Key (x-api-key){' '}
                    {apiConfig.hasMasterKey && (
                      <span className="text-emerald-400 font-mono">({apiConfig.masterKeyMasked})</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={apiMasterKey}
                    onChange={(e) => setApiMasterKey(e.target.value)}
                    placeholder={apiConfig.hasMasterKey ? 'Saved (enter to replace)' : 'Paste PROVIDER_MASTER_KEY'}
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Provider Username
                  </label>
                  <input
                    type="text"
                    value={providerUsernameInput}
                    onChange={(e) => setProviderUsernameInput(e.target.value)}
                    placeholder="Provider account username"
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Provider Password{' '}
                    {apiConfig.hasProviderPassword && (
                      <span className="text-emerald-400 font-mono">
                        ({apiConfig.providerPasswordMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={providerPasswordInput}
                    onChange={(e) => setProviderPasswordInput(e.target.value)}
                    placeholder={
                      apiConfig.hasProviderPassword ? 'Saved (enter to replace)' : 'Provider password'
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="px-5 h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-xs inline-flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                Save Provider Configuration
              </button>
            </form>

            {apiConfig.deploymentStatus && (
              <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Backend &amp; Persistence Status ({apiConfig.deploymentStatus.platform.toUpperCase()})
                    </h3>
                    <p className="text-xs text-[#8E8E95]">
                      {apiConfig.deploymentStatus.firestorePersistence
                        ? 'Cloud Firestore Admin persistence is active — Provider keys, users, credits, and groups survive every server restart or migration.'
                        : 'Local persistent JSON database (data/kakarot_db.json) is active. Optionally configure FIREBASE_SERVICE_ACCOUNT_JSON to sync state with Cloud Firestore across hosts.'}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-xl text-xs font-semibold ${
                      apiConfig.deploymentStatus.firestorePersistence &&
                      apiConfig.deploymentStatus.hasProviderEnv
                        ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60'
                        : 'bg-amber-950/50 text-amber-300 border border-amber-800/60'
                    }`}
                  >
                    {apiConfig.deploymentStatus.firestorePersistence
                      ? 'Firestore Persistence ON'
                      : 'Env Persistence Recommended'}
                  </span>
                </div>
                {apiConfig.deploymentStatus.missingEnvVars.length > 0 && (
                  <div className="p-3 rounded-xl bg-[#101012] border border-[#242429] text-[11px] text-[#A1A1AA]">
                    <span className="text-[#DEC79B] font-semibold">Recommended Host Env Vars not set: </span>
                    <span className="font-mono">
                      {apiConfig.deploymentStatus.missingEnvVars.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
              <h3 className="text-base font-bold text-white">API Response & Error Logs</h3>
              {apiConfig.logs.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#7E7E86]">No API logs recorded yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {apiConfig.logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl bg-[#101012] border border-[#242429] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-white">
                          {log.method} {log.endpoint}
                        </span>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="text-[#8E8E95]">{log.latencyMs}ms</span>
                          <span
                            className={`px-2 py-0.5 rounded font-mono ${
                              log.success
                                ? 'bg-emerald-950/50 text-emerald-400'
                                : 'bg-red-950/50 text-red-400'
                            }`}
                          >
                            HTTP {log.statusCode}
                          </span>
                        </div>
                      </div>
                      <div className="text-[#A1A1AA] break-words">{log.message}</div>
                      {log.responsePreview && (
                        <pre className="text-[11px] font-mono text-[#7E7E86] overflow-x-auto">
                          {log.responsePreview}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 6B. FAMWISE UPI ADD FUNDS CONFIGURATION & DEPOSITS */}
        {section === 'famwise' && famwiseConfig && (
          <div className="space-y-4">
            <form
              onSubmit={handleSaveFamwiseConfig}
              className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Famwise UPI Gateway Settings</h2>
                  <p className="text-xs text-[#8E8E95]">
                    API key and webhook secret are stored strictly on the backend and masked here.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                      famwiseConfig.hasApiKey && famwiseConfig.lastStatus !== 'error'
                        ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60'
                        : 'bg-red-950/50 text-red-400 border border-red-800/60'
                    }`}
                  >
                    {famwiseConfig.hasApiKey
                      ? famwiseConfig.lastStatus === 'connected'
                        ? 'Connected'
                        : 'Key Configured'
                      : 'Unconfigured'}
                  </span>
                  <button
                    type="button"
                    disabled={testingFamwise}
                    onClick={handleTestFamwiseConnection}
                    className="px-4 h-10 rounded-xl bg-[#0FA968] hover:bg-[#12BA73] text-xs font-semibold text-white inline-flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingFamwise ? 'animate-spin' : ''}`} />
                    {testingFamwise ? 'Testing...' : 'Test Famwise API'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Famwise API Base URL</label>
                  <input
                    type="url"
                    required
                    value={famwiseBaseUrl}
                    onChange={(e) => setFamwiseBaseUrl(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Famwise API Key{' '}
                    {famwiseConfig.hasApiKey && (
                      <span className="text-emerald-400 font-mono">
                        ({famwiseConfig.apiKeyMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={famwiseApiKeyInput}
                    onChange={(e) => setFamwiseApiKeyInput(e.target.value)}
                    placeholder={
                      famwiseConfig.hasApiKey ? 'Saved (enter to replace)' : 'Paste fw_live_... key'
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Merchant UPI ID</label>
                  <input
                    type="text"
                    value={famwiseUpiIdInput}
                    onChange={(e) => setFamwiseUpiIdInput(e.target.value)}
                    placeholder="merchant@fam"
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Webhook Secret (Optional){' '}
                    {famwiseConfig.hasWebhookSecret && (
                      <span className="text-emerald-400 font-mono">
                        ({famwiseConfig.webhookSecretMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={famwiseWebhookSecretInput}
                    onChange={(e) => setFamwiseWebhookSecretInput(e.target.value)}
                    placeholder={
                      famwiseConfig.hasWebhookSecret
                        ? 'Saved (enter to replace)'
                        : 'Optional Famwise webhook secret'
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Basic Credit Rate (₹ INR)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    step="0.01"
                    value={famwiseBasicInr}
                    onChange={(e) => setFamwiseBasicInr(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">
                    Premium Credit Rate (₹ INR)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    step="0.01"
                    value={famwisePremiumInr}
                    onChange={(e) => setFamwisePremiumInr(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full h-11 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-[#7E7E86]">
                  Webhook endpoint: <code className="text-[#DEC79B]">POST /api/add-funds/webhook</code>
                </span>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-xs inline-flex items-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  Save Famwise Configuration
                </button>
              </div>
            </form>

            {/* Recent UPI Deposits Table */}
            <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
              <h3 className="text-base font-bold text-white">
                Recent UPI Deposit Orders ({famwiseConfig.deposits.length})
              </h3>
              {famwiseConfig.deposits.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#7E7E86]">
                  No UPI deposit orders recorded yet
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#242428] text-[#8E8E95]">
                        <th className="py-2.5 pr-3">Order ID</th>
                        <th className="py-2.5 pr-3">User</th>
                        <th className="py-2.5 pr-3">Amount</th>
                        <th className="py-2.5 pr-3">Status</th>
                        <th className="py-2.5 pr-3">Credited</th>
                        <th className="py-2.5">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E1E22]">
                      {famwiseConfig.deposits.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2.5 pr-3 font-mono text-[#DEC79B]">{d.orderId}</td>
                          <td className="py-2.5 pr-3 font-semibold text-white">{d.username}</td>
                          <td className="py-2.5 pr-3 font-mono tabular-nums text-white">
                            ₹{d.amount.toFixed(2)}
                          </td>
                          <td className="py-2.5 pr-3 capitalize">{d.status}</td>
                          <td className="py-2.5 pr-3">
                            {d.credited ? (
                              <span className="text-emerald-400 font-semibold">Yes</span>
                            ) : (
                              <span className="text-[#8E8E95]">No</span>
                            )}
                          </td>
                          <td className="py-2.5 text-[#8E8E95] tabular-nums whitespace-nowrap">
                            {new Date(d.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 7. DYNAMIC WEBSITE SETTINGS */}
        {section === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <form
              onSubmit={handleSaveWebsiteSettings}
              className="lg:col-span-2 bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Dynamic Website Settings</h2>
                  <p className="text-xs text-[#8E8E95]">
                    Changes apply automatically across header, login, signup, dashboard, and metadata.
                  </p>
                </div>
                <BrandMark logoUrl={siteForm.websiteLogo} name={siteForm.websiteName} size={40} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                    1. Website Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={siteForm.websiteName}
                    onChange={(e) => setSiteForm({ ...siteForm, websiteName: e.target.value })}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                    3. Website Title (Browser Tab)
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={siteForm.websiteTitle}
                    onChange={(e) => setSiteForm({ ...siteForm, websiteTitle: e.target.value })}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                  2. Website Logo (URL or Upload Image)
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={siteForm.websiteLogo}
                    onChange={(e) => setSiteForm({ ...siteForm, websiteLogo: e.target.value })}
                    placeholder="Leave empty for default golden emblem, or paste logo URL"
                    className="flex-1 min-w-[200px] h-11 px-3.5 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                  />
                  <label className="h-11 px-3.5 rounded-xl bg-[#1C1C20] border border-[#2E2E35] text-xs font-medium text-[#DEC79B] inline-flex items-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                  {siteForm.websiteLogo && (
                    <button
                      type="button"
                      onClick={() => setSiteForm({ ...siteForm, websiteLogo: '' })}
                      className="h-11 px-3 rounded-xl bg-[#1C1C20] border border-[#2E2E35] text-xs text-red-400 cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                  4. Website Description
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={siteForm.websiteDescription}
                  onChange={(e) =>
                    setSiteForm({ ...siteForm, websiteDescription: e.target.value })
                  }
                  className="w-full p-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D1D1D6] mb-1.5">
                  5. Website Announcement Banner
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={siteForm.websiteAnnouncement}
                  onChange={(e) =>
                    setSiteForm({ ...siteForm, websiteAnnouncement: e.target.value })
                  }
                  placeholder="Optional top banner message shown to all users"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    key: 'registrationEnabled' as const,
                    label: '6. Registration ON/OFF',
                    desc: 'Allow new users to sign up',
                  },
                  {
                    key: 'maintenanceMode' as const,
                    label: '7. Maintenance Mode',
                    desc: 'Pause non-admin dashboard access',
                  },
                  {
                    key: 'websiteNotificationsEnabled' as const,
                    label: '8. Website Notifications',
                    desc: 'Enable user notification polling',
                  },
                ].map((toggle) => (
                  <label
                    key={toggle.key}
                    className="p-3.5 rounded-xl bg-[#101012] border border-[#242429] flex items-start justify-between gap-2 cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">{toggle.label}</div>
                      <div className="text-[11px] text-[#7E7E86]">{toggle.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={siteForm[toggle.key]}
                      onChange={(e) =>
                        setSiteForm({ ...siteForm, [toggle.key]: e.target.checked })
                      }
                      className="w-4 h-4 mt-0.5 accent-[#DEC79B]"
                    />
                  </label>
                ))}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="px-6 h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414] font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {busy ? 'Saving...' : 'Save Website Settings'}
              </button>
            </form>

            {/* Super Admin Access Key Update */}
            <form
              onSubmit={handleAdminPasswordChange}
              className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
            >
              <div className="flex items-center gap-2 text-white">
                <KeyRound className="w-4 h-4 text-[#DEC79B]" />
                <h3 className="text-base font-bold">Admin Access Key</h3>
              </div>
              <div>
                <label className="block text-xs text-[#9A9AA2] mb-1">Current Access Key</label>
                <input
                  type="password"
                  required
                  value={currAdminPw}
                  onChange={(e) => setCurrAdminPw(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[#9A9AA2] mb-1">New Access Key (min 8 chars)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newAdminPw}
                  onChange={(e) => setNewAdminPw(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[#9A9AA2] mb-1">Confirm New Access Key</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmAdminPw}
                  onChange={(e) => setConfirmAdminPw(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-10 rounded-xl bg-[#1D1D22] hover:bg-[#27272D] border border-[#303038] text-xs font-semibold text-[#DEC79B] inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                Update Access Key
              </button>
            </form>
          </div>
        )}

        {/* 8. YOUTUBE DATA API V3 MANAGEMENT */}
        {section === 'youtube' && youtubeView && (
          <div className="space-y-4">
            {/* API Key Config */}
            <form
              onSubmit={handleSaveYouTubeConfig}
              className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Video className="w-5 h-5 text-[#DEC79B]" />
                    YouTube Data API v3 Configuration
                  </h2>
                  <p className="text-xs text-[#8E8E95]">
                    Configure your YouTube Data API v3 key on the backend to auto-fetch video titles, thumbnails, descriptions, and channels.
                  </p>
                </div>
                <span
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                    youtubeView.configured
                      ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60'
                      : 'bg-amber-950/50 text-amber-300 border border-amber-800/60'
                  }`}
                >
                  {youtubeView.configured
                    ? `API Key Configured (${youtubeView.apiKeyMasked})`
                    : 'YOUTUBE_API_KEY Not Set'}
                </span>
              </div>

              {!youtubeView.configured && (
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    Supply your <span className="font-mono font-semibold">YOUTUBE_API_KEY</span> below (or in server environment secrets) to enable automatic YouTube Data API v3 metadata fetching. You can still add videos manually with a title and YouTube URL.
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <input
                  type="password"
                  value={ytApiKeyInput}
                  onChange={(e) => setYtApiKeyInput(e.target.value)}
                  placeholder={
                    youtubeView.configured
                      ? 'API key saved (enter new key to replace)'
                      : 'Paste YOUTUBE_API_KEY (AIza...)'
                  }
                  className="flex-1 min-w-[240px] h-11 px-3.5 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                />
                <button
                  type="submit"
                  disabled={busy || !ytApiKeyInput.trim()}
                  className="px-5 h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-50 text-[#141414] font-semibold text-xs inline-flex items-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  Save YouTube API Key
                </button>
              </div>
            </form>

            {/* Add / Fetch Video Form */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <form
                onSubmit={handleAddYouTubeVideo}
                className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
              >
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#DEC79B]" />
                  Add YouTube Video
                </h3>

                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">YouTube URL or Video ID</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      className="flex-1 h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                    />
                    <button
                      type="button"
                      disabled={ytFetching || !ytUrl.trim()}
                      onClick={handleFetchYouTubeMetadata}
                      className="px-3 h-10 rounded-xl bg-[#1E1E24] hover:bg-[#282830] border border-[#34343D] text-xs font-semibold text-[#DEC79B] whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      {ytFetching ? 'Fetching...' : 'Fetch API v3'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Video Title</label>
                  <input
                    type="text"
                    value={ytTitle}
                    onChange={(e) => setYtTitle(e.target.value)}
                    placeholder="Auto-filled via Fetch API v3 or enter title"
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Channel Title</label>
                  <input
                    type="text"
                    value={ytChannelTitle}
                    onChange={(e) => setYtChannelTitle(e.target.value)}
                    placeholder="Channel name (optional)"
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Thumbnail URL</label>
                  <input
                    type="url"
                    value={ytThumbnailUrl}
                    onChange={(e) => setYtThumbnailUrl(e.target.value)}
                    placeholder="https://i.ytimg.com/vi/.../hqdefault.jpg"
                    className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                  />
                  {ytThumbnailUrl && (
                    <img
                      src={ytThumbnailUrl}
                      alt="Video thumbnail preview"
                      className="mt-2 w-full aspect-video object-cover rounded-xl border border-[#242429]"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[#9A9AA2] mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={ytDescription}
                    onChange={(e) => setYtDescription(e.target.value)}
                    placeholder="Video summary displayed on website"
                    className="w-full p-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                  />
                </div>

                <label className="flex items-center justify-between p-3 rounded-xl bg-[#101012] border border-[#242429] cursor-pointer">
                  <span className="text-xs font-medium text-white">Publish live on website</span>
                  <input
                    type="checkbox"
                    checked={ytPublished}
                    onChange={(e) => setYtPublished(e.target.checked)}
                    className="w-4 h-4 accent-[#DEC79B]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414] font-semibold text-sm cursor-pointer"
                >
                  {busy ? 'Saving...' : 'Save & Sync Video'}
                </button>
              </form>

              {/* Published & Draft Videos List */}
              <div className="lg:col-span-2 bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
                <h3 className="text-base font-bold text-white">
                  Managed Videos ({youtubeView.videos.length})
                </h3>
                {youtubeView.videos.length === 0 ? (
                  <p className="py-10 text-center text-xs text-[#7E7E86]">
                    No YouTube videos added yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {youtubeView.videos.map((v) => (
                      <div
                        key={v.id}
                        className="p-3.5 rounded-xl bg-[#101012] border border-[#242429] flex flex-col sm:flex-row gap-3 justify-between"
                      >
                        <div className="flex gap-3 min-w-0">
                          <img
                            src={v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`}
                            alt={v.title}
                            className="w-28 h-16 object-cover rounded-lg border border-[#26262C] shrink-0"
                          />
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-white truncate">
                                {v.title}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  v.published
                                    ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/50'
                                    : 'bg-[#1C1C22] text-[#8E8E95] border border-[#2A2A30]'
                                }`}
                              >
                                {v.published ? 'Published' : 'Hidden'}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#8E8E95] truncate">
                              {v.channelTitle ? `${v.channelTitle} · ` : ''}
                              <span className="font-mono">{v.videoId}</span>
                            </div>
                            {v.description && (
                              <p className="text-xs text-[#A1A1AA] line-clamp-2">{v.description}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-lg bg-[#1A1A1E] hover:bg-[#242429] text-[#DEC79B]"
                            title="Open on YouTube"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleTogglePublishYouTubeVideo(v)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#1A1A1E] hover:bg-[#242429] text-xs text-white cursor-pointer"
                          >
                            {v.published ? 'Hide' : 'Publish'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setYtEditingVideo(v)}
                            className="p-2 rounded-lg bg-[#1A1A1E] hover:bg-[#242429] text-[#DEC79B] cursor-pointer"
                            title="Edit Video"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteYouTubeVideo(v)}
                            className="p-2 rounded-lg bg-red-950/40 hover:bg-red-950/70 text-red-400 cursor-pointer"
                            title="Delete Video"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 8B. PERMANENT JSON BACKUP, DEVICE UPLOAD RESTORE & .ENV EXPORT */}
        {section === 'backup' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {/* Upload .JSON Backup from Device & Save */}
              <form
                onSubmit={handleRestoreBackupJson}
                className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      Upload Backup JSON &amp; Save All Data
                    </h2>
                    <p className="text-xs text-[#8E8E95] mt-0.5">
                      If anything gets cleared on a new host, select your saved .json file from your
                      device and save to restore all Providers, Famwise UPI, Users, Credits, Groups &amp;
                      Settings immediately.
                    </p>
                  </div>
                </div>

                <label className="block p-5 rounded-2xl bg-[#101012] border border-dashed border-[#38342A] hover:border-[#DEC79B]/70 transition-colors text-center cursor-pointer space-y-2">
                  <Upload className="w-7 h-7 text-[#DEC79B] mx-auto" />
                  <div className="text-sm font-semibold text-white">
                    {backupFileName ? `Selected: ${backupFileName}` : 'Choose .json File from Device'}
                  </div>
                  <div className="text-[11px] text-[#8E8E95]">
                    Supports Full Backup .json, Encrypted Backup .json, or kakarot_db.json
                  </div>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleSelectBackupFile}
                    className="hidden"
                  />
                </label>

                {backupPreview && (
                  <div className="p-3.5 rounded-xl bg-[#101012] border border-[#27382D] text-xs space-y-1.5">
                    <div className="font-semibold text-emerald-400">
                      Detected: {backupPreview.kind}
                    </div>
                    <div className="flex flex-wrap gap-3 text-[#D1D1D6] tabular-nums">
                      {typeof backupPreview.users === 'number' && (
                        <span>Users: {backupPreview.users}</span>
                      )}
                      {typeof backupPreview.groups === 'number' && (
                        <span>Groups: {backupPreview.groups}</span>
                      )}
                      <span>
                        Provider API: {backupPreview.hasProviderKeys ? 'Included' : 'Not present'}
                      </span>
                      <span>
                        Famwise UPI: {backupPreview.hasFamwiseKey ? 'Included' : 'Not present'}
                      </span>
                    </div>
                  </div>
                )}

                {backupNeedsPassphrase && (
                  <div>
                    <label className="block text-xs text-[#DEC79B] font-semibold mb-1.5">
                      Encrypted Backup Passphrase Required
                    </label>
                    <input
                      type="password"
                      required
                      value={backupPassphrase}
                      onChange={(e) => setBackupPassphrase(e.target.value)}
                      placeholder="Enter backup passphrase"
                      className="w-full h-11 px-3.5 rounded-xl bg-[#101012] border border-[#3A3222] text-white text-xs"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] text-[#8E8E95] mb-1">
                    Or Paste JSON Content Directly
                  </label>
                  <textarea
                    rows={4}
                    value={backupJsonText}
                    onChange={(e) => inspectBackupText(e.target.value)}
                    placeholder='{"format":"kakarot-glory-pro-plain-backup-v1", ...}'
                    className="w-full p-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-[11px]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={backupBusy || !backupJsonText.trim()}
                  className="w-full h-11 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-50 text-[#141414] font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  {backupBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {backupBusy ? 'Restoring & Saving...' : 'Upload & Save Everything Permanently'}
                </button>
              </form>

              {/* Download Backup JSON Card */}
              <div className="space-y-4">
                <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#11241B] border border-[#1E4A36] flex items-center justify-center text-[#10B981] shrink-0">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        Download Complete Backup (.JSON)
                      </h2>
                      <p className="text-xs text-[#8E8E95] mt-0.5">
                        Keep a single .json file safe on your phone or PC with all providers, Famwise
                        UPI keys, users, balances, coupons &amp; settings.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-[#101012] border border-[#242429]">
                      <span className="text-[#8E8E95] block text-[11px]">Provider API</span>
                      <span
                        className={`font-semibold ${
                          apiConfig?.configured ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {apiConfig?.configured ? 'Saved' : 'Missing'}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#101012] border border-[#242429]">
                      <span className="text-[#8E8E95] block text-[11px]">Famwise UPI</span>
                      <span
                        className={`font-semibold ${
                          famwiseConfig?.hasApiKey ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {famwiseConfig?.hasApiKey ? 'Saved' : 'Missing'}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#101012] border border-[#242429]">
                      <span className="text-[#8E8E95] block text-[11px]">Users &amp; Groups</span>
                      <span className="font-mono font-bold text-white">
                        {users.length} / {groups.length}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={backupBusy}
                    onClick={() => void handleDownloadPlainJsonBackup()}
                    className="w-full h-11 rounded-xl bg-[#0FA968] hover:bg-[#12BA73] disabled:opacity-50 text-white font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Download Full Backup (.JSON)
                  </button>
                </div>

                {/* Optional Encrypted JSON Download */}
                <form
                  onSubmit={handleDownloadEncryptedBackup}
                  className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <Lock className="w-4 h-4 text-[#DEC79B]" />
                    <span>Optional: Download Password-Encrypted Backup (.JSON)</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={encryptPassphrase}
                      onChange={(e) => setEncryptPassphrase(e.target.value)}
                      placeholder="Set passphrase (min 6 chars)"
                      className="flex-1 h-10 px-3.5 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                    />
                    <button
                      type="submit"
                      disabled={backupBusy || encryptPassphrase.trim().length < 6}
                      className="h-10 px-4 rounded-xl bg-[#1D1D22] hover:bg-[#26262D] border border-[#303038] text-[#DEC79B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Download Encrypted .JSON
                    </button>
                  </div>
                </form>

                {/* Host .env Export */}
                <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-white">Host .env Variables Export</h3>
                      <p className="text-[11px] text-[#8E8E95]">
                        Paste these into Render, Koyeb, Railway or VPS .env so keys survive every
                        restart.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={backupBusy}
                      onClick={() => void handleLoadEnvExport()}
                      className="px-3.5 h-9 rounded-xl bg-[#1D1D22] hover:bg-[#26262C] border border-[#2E2E35] text-xs font-semibold text-[#DEC79B] cursor-pointer"
                    >
                      {envExport ? 'Refresh .env' : 'Generate .env'}
                    </button>
                  </div>

                  {envExport && (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="text-emerald-400">
                          Ready: {envExport.configuredKeys.length} keys
                        </span>
                        {envExport.missingKeys.length > 0 && (
                          <span className="text-amber-300">
                            Optional missing: {envExport.missingKeys.join(', ')}
                          </span>
                        )}
                      </div>
                      <textarea
                        readOnly
                        rows={6}
                        value={envExport.envText}
                        className="w-full p-3 rounded-xl bg-[#0D0D0F] border border-[#25252A] text-[#D4D4D8] font-mono text-[11px]"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleCopyEnvText}
                          className="px-3.5 h-9 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedEnv ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedEnv ? 'Copied!' : 'Copy .env'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadEnvFile}
                          className="px-3.5 h-9 rounded-xl bg-[#1D1D22] border border-[#2E2E35] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download .env.txt
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 9. UNIFIED LOGS PANEL */}
        {section === 'logs' && adminLogs && (
          <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLogsSubTab('activity')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    logsSubTab === 'activity'
                      ? 'bg-[#DEC79B] text-[#141414]'
                      : 'bg-[#101012] border border-[#242429] text-[#A1A1AA]'
                  }`}
                >
                  Activity Logs ({adminLogs.activityLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLogsSubTab('api')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    logsSubTab === 'api'
                      ? 'bg-[#DEC79B] text-[#141414]'
                      : 'bg-[#101012] border border-[#242429] text-[#A1A1AA]'
                  }`}
                >
                  API Logs ({adminLogs.apiLogs.length})
                </button>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-[#7E7E86] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Filter logs..."
                  className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                />
              </div>
            </div>

            {logsSubTab === 'activity' ? (
              <div className="space-y-2 max-h-[540px] overflow-y-auto">
                {adminLogs.activityLogs
                  .filter((l) => {
                    const q = logSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      String(l.username || '').toLowerCase().includes(q) ||
                      String(l.action || '').toLowerCase().includes(q) ||
                      String(l.details || '').toLowerCase().includes(q) ||
                      String(l.clan_id || '').toLowerCase().includes(q)
                    );
                  })
                  .map((l) => (
                    <div
                      key={l.id}
                      className="p-3 rounded-xl bg-[#101012] border border-[#242429] text-xs flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">{l.username || 'system'}</span>
                          <span className="px-2 py-0.5 rounded bg-[#1C1C22] text-[#DEC79B] font-mono text-[11px]">
                            {l.action || 'event'}
                          </span>
                          {l.clan_id && (
                            <span className="text-[#8E8E95] font-mono">Clan {l.clan_id}</span>
                          )}
                        </div>
                        <div className="text-[#A1A1AA] break-words">{l.details || ''}</div>
                      </div>
                      <span className="text-[11px] text-[#7E7E86] tabular-nums shrink-0">
                        {l.timestamp && !Number.isNaN(Date.parse(l.timestamp))
                          ? new Date(l.timestamp).toLocaleString()
                          : '—'}
                      </span>
                    </div>
                  ))}
                {adminLogs.activityLogs.length === 0 && (
                  <p className="py-8 text-center text-xs text-[#7E7E86]">
                    No platform activity logs recorded yet.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-[540px] overflow-y-auto">
                {adminLogs.apiLogs
                  .filter((l) => {
                    const q = logSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      String(l.endpoint || '').toLowerCase().includes(q) ||
                      String(l.method || '').toLowerCase().includes(q) ||
                      String(l.message || '').toLowerCase().includes(q)
                    );
                  })
                  .map((l) => (
                    <div
                      key={l.id}
                      className="p-3 rounded-xl bg-[#101012] border border-[#242429] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-white">
                          {l.method || 'GET'} {l.endpoint || ''}
                        </span>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="text-[#8E8E95]">{l.latencyMs ?? 0}ms</span>
                          <span
                            className={`px-2 py-0.5 rounded font-mono ${
                              l.success
                                ? 'bg-emerald-950/50 text-emerald-400'
                                : 'bg-red-950/50 text-red-400'
                            }`}
                          >
                            HTTP {l.statusCode ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="text-[#A1A1AA] break-words">{l.message || ''}</div>
                      {l.responsePreview && (
                        <pre className="text-[11px] font-mono text-[#7E7E86] overflow-x-auto">
                          {l.responsePreview}
                        </pre>
                      )}
                    </div>
                  ))}
                {adminLogs.apiLogs.length === 0 && (
                  <p className="py-8 text-center text-xs text-[#7E7E86]">
                    No API request logs recorded yet.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Edit YouTube Video Modal */}
      {ytEditingVideo && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditYouTubeVideo}
            className="w-full max-w-md bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-base font-bold text-white">Edit YouTube Video</h3>
            <div>
              <label className="block text-xs text-[#9A9AA2] mb-1">YouTube URL</label>
              <input
                type="text"
                required
                value={ytEditingVideo.url}
                onChange={(e) => setYtEditingVideo({ ...ytEditingVideo, url: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9A9AA2] mb-1">Title</label>
              <input
                type="text"
                required
                value={ytEditingVideo.title}
                onChange={(e) => setYtEditingVideo({ ...ytEditingVideo, title: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9A9AA2] mb-1">Channel Title</label>
              <input
                type="text"
                value={ytEditingVideo.channelTitle}
                onChange={(e) =>
                  setYtEditingVideo({ ...ytEditingVideo, channelTitle: e.target.value })
                }
                className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9A9AA2] mb-1">Thumbnail URL</label>
              <input
                type="url"
                value={ytEditingVideo.thumbnailUrl}
                onChange={(e) =>
                  setYtEditingVideo({ ...ytEditingVideo, thumbnailUrl: e.target.value })
                }
                className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9A9AA2] mb-1">Description</label>
              <textarea
                rows={3}
                value={ytEditingVideo.description}
                onChange={(e) =>
                  setYtEditingVideo({ ...ytEditingVideo, description: e.target.value })
                }
                className="w-full p-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
              />
            </div>
            <label className="flex items-center justify-between p-3 rounded-xl bg-[#101012] border border-[#242429] cursor-pointer">
              <span className="text-xs font-medium text-white">Published on Website</span>
              <input
                type="checkbox"
                checked={ytEditingVideo.published}
                onChange={(e) =>
                  setYtEditingVideo({ ...ytEditingVideo, published: e.target.checked })
                }
                className="w-4 h-4 accent-[#DEC79B]"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setYtEditingVideo(null)}
                className="flex-1 h-10 rounded-xl bg-[#1E1E22] text-xs font-semibold text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 h-10 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-semibold cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User Details Modal */}
      {selectedUserDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-bold text-white">
              User Account · {selectedUserDetail.user.username}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs bg-[#101012] border border-[#242429] rounded-xl p-3">
              <div>Email: {selectedUserDetail.user.email}</div>
              <div>Status: {selectedUserDetail.user.blocked ? 'Blocked' : 'Active'}</div>
              <div>Basic Credits: {selectedUserDetail.user.basicCredits}</div>
              <div>Premium Credits: {selectedUserDetail.user.premiumCredits}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[#DEC79B] mb-2">
                Credit Audit History ({selectedUserDetail.audits.length})
              </h4>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {selectedUserDetail.audits.map((a) => (
                  <div
                    key={a.id}
                    className="p-2 rounded-lg bg-[#101012] border border-[#222227] text-xs flex justify-between gap-2"
                  >
                    <span>
                      {a.adminUsername}: {a.operation} {a.amount} {a.creditType} ({a.previousBalance} →{' '}
                      {a.newBalance})
                    </span>
                    <span className="text-[#8E8E95] shrink-0">
                      {new Date(a.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[#DEC79B] mb-2">
                Transactions ({selectedUserDetail.transactions.length})
              </h4>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {selectedUserDetail.transactions.map((t) => (
                  <div
                    key={t.id}
                    className="p-2 rounded-lg bg-[#101012] border border-[#222227] text-xs flex justify-between"
                  >
                    <span>
                      {t.type} ({t.basic_credits}B / {t.premium_credits}P)
                    </span>
                    <span className="text-[#8E8E95]">{t.status}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedUserDetail(null)}
              className="w-full h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Unlimited Admin Credit Management Modal (Add / Deduct / Set Exact Balance) */}
      {creditModalUser && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAdjustCredits}
            className="w-full max-w-md bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4"
          >
            <div>
              <h3 className="text-base font-bold text-white">
                Manage Credits · {creditModalUser.username}
              </h3>
              <p className="text-xs text-[#8E8E95] mt-0.5 tabular-nums">
                Current: {creditModalUser.basicCredits} Basic · {creditModalUser.premiumCredits}{' '}
                Premium
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCreditOp('add')}
                className={`h-10 rounded-xl text-xs font-semibold cursor-pointer ${
                  creditOp === 'add' ? 'bg-[#0FA968] text-white' : 'bg-[#1C1C20] text-[#8E8E95]'
                }`}
              >
                Add Credits
              </button>
              <button
                type="button"
                onClick={() => setCreditOp('deduct')}
                className={`h-10 rounded-xl text-xs font-semibold cursor-pointer ${
                  creditOp === 'deduct' ? 'bg-red-600 text-white' : 'bg-[#1C1C20] text-[#8E8E95]'
                }`}
              >
                Deduct Credits
              </button>
              <button
                type="button"
                onClick={() => setCreditOp('set')}
                className={`h-10 rounded-xl text-xs font-semibold cursor-pointer ${
                  creditOp === 'set'
                    ? 'bg-[#DEC79B] text-[#141414]'
                    : 'bg-[#1C1C20] text-[#8E8E95]'
                }`}
              >
                Set Exact
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#9A9AA2] mb-1">Credit Tier</label>
                <select
                  value={creditType}
                  onChange={(e) => setCreditType(e.target.value as 'basic' | 'premium')}
                  className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
                >
                  <option value="basic">Basic Credits</option>
                  <option value="premium">Premium Credits</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#9A9AA2] mb-1">
                  {creditOp === 'set' ? 'Target Balance' : 'Custom Amount'}
                </label>
                <input
                  type="number"
                  min={creditOp === 'set' ? 0 : 1}
                  value={creditAmount}
                  onChange={(e) =>
                    setCreditAmount(Math.max(creditOp === 'set' ? 0 : 1, Number(e.target.value) || 0))
                  }
                  className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white font-mono text-xs"
                />
              </div>
            </div>

            {/* Quick preset buttons matching prompt examples (100, 500, 1000, 5000) without restricting custom input */}
            <div className="flex flex-wrap gap-1.5">
              {[100, 500, 1000, 5000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCreditAmount(preset)}
                  className="px-2.5 py-1 rounded-lg bg-[#1A1A1E] hover:bg-[#25252B] border border-[#2C2C34] text-xs font-mono text-[#DEC79B] cursor-pointer"
                >
                  {preset.toLocaleString()}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs text-[#9A9AA2] mb-1">Reason / Audit Note</label>
              <input
                type="text"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="Reason for audit history"
                className="w-full h-10 px-3 rounded-xl bg-[#101012] border border-[#2A2A2E] text-white text-xs"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreditModalUser(null)}
                className="flex-1 h-10 rounded-xl bg-[#1E1E22] text-xs font-semibold text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 h-10 rounded-xl bg-[#DEC79B] text-[#141414] text-xs font-semibold cursor-pointer"
              >
                {busy ? 'Applying...' : 'Confirm Adjustment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Transaction Details Modal */}
      {selectedTxn && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#141416] border border-[#2A2A2E] rounded-[20px] p-5 space-y-4">
            <h3 className="text-base font-bold text-white">Transaction Details</h3>
            <pre className="p-3 rounded-xl bg-[#0D0D0E] border border-[#242428] text-xs font-mono text-[#DEC79B] overflow-x-auto">
              {JSON.stringify(selectedTxn, null, 2)}
            </pre>
            <button
              type="button"
              onClick={() => setSelectedTxn(null)}
              className="w-full h-10 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
