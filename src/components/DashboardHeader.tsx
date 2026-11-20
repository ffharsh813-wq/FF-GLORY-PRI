import React, { useEffect, useRef, useState } from 'react';
import { Bell, MailCheck, Plus } from 'lucide-react';
import { LANGUAGES, useI18n } from '../lib/i18n';
import type { NotificationItem, PricingData, PublicUser, SiteSettings } from '../types';
import { AddFundsModal } from './AddFundsModal';
import { BrandMark } from './BrandMark';
import { RegionFlag } from './RegionFlag';

export type DashboardTab = 'home' | 'transactions' | 'coupons' | 'history' | 'archive' | 'account';

interface DashboardHeaderProps {
  settings: SiteSettings;
  user: PublicUser;
  pricing: PricingData | null;
  notifications: NotificationItem[];
  inboxCount: number;
  onSelectTab: (tab: DashboardTab) => void;
  onLanguageChange: (lang: string) => void;
  onNotificationsRead: () => void;
  onRefreshData: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  settings,
  user,
  pricing,
  notifications,
  inboxCount,
  onSelectTab,
  onLanguageChange,
  onNotificationsRead,
  onRefreshData,
}) => {
  const { lang: currentLang, t } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [addCreditsOpen, setAddCreditsOpen] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const activeLang = LANGUAGES.find((l) => l.code === currentLang) || LANGUAGES[0];

  const handleOpenNotifs = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next && unreadCount > 0) {
      onNotificationsRead();
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#0D0D0E]/95 backdrop-blur-md border-b border-[#1D1D20]">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-[62px] flex items-center justify-between gap-2">
          {/* Left: Brand Mark + Website Name + LIVE Pill + Basic Credits Pill */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onSelectTab('home')}
              className="flex items-center gap-2 shrink-0 cursor-pointer"
              title={settings.websiteName}
            >
              <BrandMark logoUrl={settings.websiteLogo} name={settings.websiteName} size={34} />
              <span className="hidden md:inline-block text-[15px] font-bold tracking-tight text-white whitespace-nowrap">
                {settings.websiteName}
              </span>
            </button>

            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#0E281D] border border-[#1A563C] text-[10px] font-bold tracking-wider text-[#10B981] shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              {t('live')}
            </span>

            {/* Credits Badge */}
            <div className="flex items-center gap-2 bg-[#132033] border border-[#243E63] rounded-xl pl-2.5 pr-1.5 py-1 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold text-white tabular-nums leading-none">
                  {user.basicCredits}
                </span>
                <div className="flex flex-col leading-[1.05]">
                  <span className="text-[11px] font-medium text-[#CBDDF5]">{t('basic')}</span>
                  <span className="text-[10px] text-[#7D9BC4]">
                    {user.premiumCredits > 0 ? `+${user.premiumCredits}P` : t('credits')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddCreditsOpen(true)}
                aria-label={t('add_credits')}
                title={t('add_credits')}
                className="w-7 h-7 rounded-lg bg-[#223B5E] hover:bg-[#2C4C78] text-[#8AB4F8] flex items-center justify-center transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.4]" />
              </button>
            </div>
          </div>

          {/* Right: Language Flag, Inbox/Coupons Badge, Notification Bell, User Avatar */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Language Selector */}
            <div className="relative" ref={langRef}>
              <button
                type="button"
                onClick={() => setLangOpen((v) => !v)}
                aria-label={t('select_language')}
                title={activeLang.label}
                className="w-9 h-9 rounded-xl hover:bg-[#19191D] flex items-center justify-center transition-colors cursor-pointer"
              >
                <RegionFlag codeOrId={activeLang.flag} className="w-6 h-4" />
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-48 max-h-80 overflow-y-auto bg-[#151517] border border-[#2A2A2E] rounded-xl shadow-2xl py-1.5 z-50">
                  {LANGUAGES.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        onLanguageChange(item.code);
                        setLangOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2.5 transition-colors cursor-pointer ${
                        item.code === currentLang
                          ? 'bg-[#282218] text-[#DEC79B] font-semibold'
                          : 'text-[#D1D1D6] hover:bg-[#1E1E22]'
                      }`}
                    >
                      <RegionFlag codeOrId={item.flag} className="w-5 h-3.5" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Coupon / Inbox Shortcut with badge */}
            <button
              type="button"
              onClick={() => onSelectTab('coupons')}
              aria-label={t('nav_coupons')}
              className="relative w-9 h-9 rounded-xl hover:bg-[#19191D] flex items-center justify-center text-[#A1A1AA] hover:text-white transition-colors cursor-pointer"
            >
              <MailCheck className="w-[19px] h-[19px]" />
              {inboxCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DEC79B] text-[#141414] text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {inboxCount}
                </span>
              )}
            </button>

            {/* Notification Bell with green dot */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={handleOpenNotifs}
                aria-label={t('notifications')}
                className="relative w-9 h-9 rounded-xl hover:bg-[#19191D] flex items-center justify-center text-[#A1A1AA] hover:text-white transition-colors cursor-pointer"
              >
                <Bell className="w-[19px] h-[19px]" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-[#10B981] ring-2 ring-[#0D0D0E]" />
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] bg-[#151517] border border-[#2A2A2E] rounded-2xl shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[#242428] flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{t('notifications')}</span>
                    <span className="text-[11px] text-[#8E8E95] tabular-nums">
                      {notifications.length} {t('notifications_total')}
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#202024]">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#7A7A82]">
                        {t('no_notifications')}
                      </div>
                    ) : (
                      notifications.slice(0, 15).map((n) => (
                        <div key={n.id} className="p-3.5 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#DEC79B]">{n.title}</span>
                            <span className="text-[10px] text-[#6E6E76]">
                              {new Date(n.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-[#C4C4CA] leading-relaxed">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Initial Avatar */}
            <button
              type="button"
              onClick={() => onSelectTab('account')}
              aria-label={t('nav_account')}
              title={`${user.username} (${user.email})`}
              className="w-9 h-9 rounded-full bg-[#1C1A16] border border-[#6E5F44] text-[#DEC79B] text-[14px] font-bold flex items-center justify-center uppercase hover:border-[#DEC79B] transition-colors cursor-pointer"
            >
              {user.username.charAt(0).toUpperCase()}
            </button>
          </div>
        </div>

        {/* Optional Website Announcement Bar controlled from Admin Panel */}
        {settings.websiteAnnouncement && (
          <div className="bg-[#1C1913] border-t border-[#383020] px-4 py-1.5 text-center text-xs text-[#DEC79B]">
            {settings.websiteAnnouncement}
          </div>
        )}
      </header>

      {/* Add Funds & Credits Modal */}
      <AddFundsModal
        isOpen={addCreditsOpen}
        onClose={() => setAddCreditsOpen(false)}
        user={user}
        pricing={pricing}
        onSelectTab={onSelectTab}
        onRefreshData={onRefreshData}
      />
    </>
  );
};
