import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, getUserToken, setUserToken } from './lib/api';
import {
  fetchSiteSettingsFromFirestore,
  signOutFirebase,
  subscribeToSiteSettings,
  subscribeToYouTubeVideos,
} from './lib/firebase';
import { I18nProvider, useI18n } from './lib/i18n';
import type {
  ActivityLogRecord,
  CouponRecord,
  GroupRecord,
  NotificationItem,
  PricingData,
  PublicUser,
  SiteSettings,
  TransactionRecord,
  YouTubeVideoRecord,
} from './types';
import { AccountTab } from './components/AccountTab';
import { AdminPanel } from './components/AdminPanel';
import { ArchiveTab } from './components/ArchiveTab';
import { AuthPage } from './components/AuthPage';
import { BottomNav } from './components/BottomNav';
import { CouponsTab } from './components/CouponsTab';
import { DashboardHeader, type DashboardTab } from './components/DashboardHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HistoryTab } from './components/HistoryTab';
import { HomeTab } from './components/HomeTab';
import { TransactionsTab } from './components/TransactionsTab';

const DEFAULT_SETTINGS: SiteSettings = {
  websiteName: 'KAKAROT GLORY PRO',
  websiteLogo: '',
  websiteTitle: 'KAKAROT GLORY PRO',
  websiteDescription:
    'KAKAROT GLORY PRO — Automated Clan Glory Group Management, Credits, Coupons & Admin Control Panel.',
  websiteAnnouncement: '',
  registrationEnabled: true,
  maintenanceMode: false,
  websiteNotificationsEnabled: true,
  updatedAt: new Date().toISOString(),
};

function AppContent() {
  const { setLang, t } = useI18n();
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [booting, setBooting] = useState(true);

  const [activeTab, setActiveTab] = useState<DashboardTab>('home');
  const [scrollTargetGroupId, setScrollTargetGroupId] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [myCoupons, setMyCoupons] = useState<CouponRecord[]>([]);
  const [redeemedCoupons, setRedeemedCoupons] = useState<CouponRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideoRecord[]>([]);
  const backendSettingsLoadedRef = useRef(false);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Synchronize document title and meta tags dynamically with Admin Website Settings
  useEffect(() => {
    const title = settings.websiteTitle || settings.websiteName || 'KAKAROT GLORY PRO';
    document.title = title;
    const desc = settings.websiteDescription || DEFAULT_SETTINGS.websiteDescription;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', desc);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', desc);
  }, [settings]);

  const loadDashboardData = useCallback(async () => {
    const [me, pricingRes, grpRes, txnRes, myCpnRes, redCpnRes, histRes, notifRes] =
      await Promise.all([
        apiRequest<PublicUser>('/api/auth/me'),
        apiRequest<PricingData>('/api/pricing', { scope: 'public' }),
        apiRequest<GroupRecord[]>('/api/client/my-groups'),
        apiRequest<TransactionRecord[]>('/api/client/transactions'),
        apiRequest<CouponRecord[]>('/api/client/my-coupons'),
        apiRequest<CouponRecord[]>('/api/client/redeemed-coupons'),
        apiRequest<{ logs: ActivityLogRecord[]; groups: GroupRecord[] }>(
          '/api/client/group-history'
        ),
        apiRequest<NotificationItem[]>('/api/client/notifications'),
      ]);

    setUser(me);
    if (me?.language) {
      setLang(me.language);
    }
    setPricing(pricingRes);
    setGroups(Array.isArray(grpRes) ? grpRes : []);
    setTransactions(Array.isArray(txnRes) ? txnRes : []);
    setMyCoupons(Array.isArray(myCpnRes) ? myCpnRes : []);
    setRedeemedCoupons(Array.isArray(redCpnRes) ? redCpnRes : []);
    setActivityLogs(Array.isArray(histRes?.logs) ? histRes.logs : []);
    setNotifications(Array.isArray(notifRes) ? notifRes : []);
  }, [setLang]);

  useEffect(() => {
    const init = async () => {
      try {
        const [backendSettings, fsSettings, ytRes] = await Promise.all([
          apiRequest<SiteSettings>('/api/public/settings', { scope: 'public' }).catch(() => null),
          fetchSiteSettingsFromFirestore().catch(() => null),
          apiRequest<{ configured: boolean; videos: YouTubeVideoRecord[] }>('/api/youtube/videos', {
            scope: 'public',
          }).catch(() => null),
        ]);

        if (backendSettings) {
          backendSettingsLoadedRef.current = true;
          setSettings(backendSettings);
        } else if (fsSettings) {
          setSettings(fsSettings);
        }

        if (ytRes && Array.isArray(ytRes.videos)) {
          setYoutubeVideos(ytRes.videos);
        }

        if (!window.location.pathname.startsWith('/admin')) {
          try {
            if (getUserToken()) {
              await loadDashboardData();
            }
          } catch {
            setUserToken(null);
            setUser(null);
          }
        }
      } finally {
        setBooting(false);
      }
    };
    void init();
  }, [loadDashboardData]);

  // Real-time synchronization via Firestore onSnapshot + Backend SSE events
  useEffect(() => {
    let unsubFsSettings: (() => void) | null = null;
    let unsubFsVideos: (() => void) | null = null;
    try {
      unsubFsSettings = subscribeToSiteSettings(
        (next) => {
          setSettings((prev) => {
            const nextTs = Date.parse(next.updatedAt || '');
            const prevTs = Date.parse(prev.updatedAt || '');
            if (backendSettingsLoadedRef.current && (Number.isNaN(nextTs) || nextTs <= prevTs + 2000)) {
              return prev;
            }
            return { ...prev, ...next };
          });
        },
        () => {}
      );
      unsubFsVideos = subscribeToYouTubeVideos(
        (videos) => {
          if (videos.length > 0) setYoutubeVideos(videos);
        },
        () => {}
      );
    } catch {
      // Ignore if Firestore rules restrict unauthenticated reads
    }

    let evtSource: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      evtSource = new EventSource('/api/public/events');
      evtSource.addEventListener('settings', (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent<string>).data) as SiteSettings;
          if (parsed && parsed.websiteName) setSettings(parsed);
        } catch {
          // ignore malformed SSE frame
        }
      });
      evtSource.addEventListener('youtube', (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent<string>).data) as YouTubeVideoRecord[];
          if (Array.isArray(parsed)) setYoutubeVideos(parsed);
        } catch {
          // ignore malformed SSE frame
        }
      });
    }

    return () => {
      if (unsubFsSettings) unsubFsSettings();
      if (unsubFsVideos) unsubFsVideos();
      if (evtSource) evtSource.close();
    };
  }, []);

  // Poll notifications periodically while logged in (if enabled in settings)
  useEffect(() => {
    if (!user || !settings.websiteNotificationsEnabled || pathname.startsWith('/admin')) return;
    const timer = setInterval(async () => {
      try {
        const notifs = await apiRequest<NotificationItem[]>('/api/client/notifications');
        setNotifications(notifs);
      } catch {
        // ignore transient polling error
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [user, settings.websiteNotificationsEnabled, pathname]);

  const handleAuthenticated = async (authedUser: PublicUser) => {
    setUser(authedUser);
    if (authedUser.language) {
      setLang(authedUser.language);
    }
    try {
      await loadDashboardData();
    } catch {
      // ignore initial sub-fetch error
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setUserToken(null);
      await signOutFirebase();
      setUser(null);
      setActiveTab('home');
    }
  };

  const handleLanguageChange = async (nextLang: string) => {
    setLang(nextLang);
    if (!user) return;
    setUser((prev) => (prev ? { ...prev, language: nextLang } : prev));
    try {
      const res = await apiRequest<{ user: PublicUser }>('/api/account/settings', {
        method: 'PATCH',
        body: { language: nextLang },
      });
      setUser(res.user);
    } catch {
      // keep client language selection active even if offline
    }
  };

  const handleNotificationsRead = async () => {
    try {
      await apiRequest('/api/client/notifications/read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // ignore
    }
  };

  const handleOpenGroupInHome = (groupId: string) => {
    setScrollTargetGroupId(groupId);
    setActiveTab('home');
  };

  // Protected /admin Route
  if (pathname.startsWith('/admin')) {
    return (
      <AdminPanel
        settings={settings}
        onSettingsUpdated={(next) => setSettings(next)}
        onExitAdmin={() => {
          window.history.pushState({}, '', '/');
          setPathname('/');
          void apiRequest<SiteSettings>('/api/public/settings', { scope: 'public' })
            .then(setSettings)
            .catch(() => {});
        }}
      />
    );
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-[#0D0D0E] flex items-center justify-center text-sm text-[#8E8E95]">
        {t('loading')} {settings.websiteName}
      </div>
    );
  }

  if (!user) {
    return <AuthPage settings={settings} onAuthenticated={handleAuthenticated} />;
  }

  const activeCouponCount = myCoupons.filter((c) => c.status === 'active').length;

  return (
    <div className="min-h-screen bg-[#0D0D0E] text-white pb-24">
      <DashboardHeader
        settings={settings}
        user={user}
        pricing={pricing}
        notifications={notifications}
        inboxCount={activeCouponCount}
        onSelectTab={setActiveTab}
        onLanguageChange={handleLanguageChange}
        onNotificationsRead={handleNotificationsRead}
        onRefreshData={loadDashboardData}
      />

      <main className="max-w-5xl mx-auto px-3 sm:px-6 pt-4 pb-6">
        {activeTab === 'home' && (
          <HomeTab
            user={user}
            pricing={pricing}
            groups={groups}
            youtubeVideos={youtubeVideos}
            scrollTargetGroupId={scrollTargetGroupId}
            onClearScrollTarget={() => setScrollTargetGroupId(null)}
            onRefresh={loadDashboardData}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsTab
            user={user}
            pricing={pricing}
            transactions={transactions}
            onSelectTab={setActiveTab}
            onRefresh={loadDashboardData}
          />
        )}
        {activeTab === 'coupons' && (
          <CouponsTab
            user={user}
            myCoupons={myCoupons}
            redeemedCoupons={redeemedCoupons}
            onRefresh={loadDashboardData}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTab logs={activityLogs} groups={groups} onRefresh={loadDashboardData} />
        )}
        {activeTab === 'archive' && (
          <ArchiveTab
            user={user}
            pricing={pricing}
            groups={groups}
            onOpenInHome={handleOpenGroupInHome}
            onRefresh={loadDashboardData}
          />
        )}
        {activeTab === 'account' && (
          <AccountTab user={user} onUserUpdated={setUser} onLogout={handleLogout} />
        )}
      </main>

      <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </ErrorBoundary>
  );
}
