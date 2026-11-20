import React from 'react';
import { Archive, ClipboardList, Clock, Settings, Ticket, Zap } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import type { DashboardTab } from './DashboardHeader';

interface BottomNavProps {
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
}

const NAV_ITEMS: Array<{
  id: DashboardTab;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'home', labelKey: 'nav_home', icon: Zap },
  { id: 'transactions', labelKey: 'nav_transactions', icon: ClipboardList },
  { id: 'coupons', labelKey: 'nav_coupons', icon: Ticket },
  { id: 'history', labelKey: 'nav_history', icon: Clock },
  { id: 'archive', labelKey: 'nav_archive', icon: Archive },
  { id: 'account', labelKey: 'nav_account', icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab }) => {
  const { t } = useI18n();
  return (
    <nav
      aria-label="Primary Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#0F0F11]/95 backdrop-blur-md border-t border-[#1E1E22]"
    >
      <div className="max-w-3xl mx-auto px-1.5 py-1.5 grid grid-cols-6 gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors cursor-pointer min-h-[48px] ${
                active
                  ? 'bg-[#1D1D21] text-[#DEC79B]'
                  : 'text-[#84848C] hover:text-[#D4D4D8]'
              }`}
            >
              <Icon className={`w-[19px] h-[19px] mb-1 ${active ? 'text-[#DEC79B]' : ''}`} />
              <span className="text-[11px] font-medium leading-none truncate max-w-full">
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
