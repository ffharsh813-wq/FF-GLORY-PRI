import React, { useEffect, useState } from 'react';
import { Check, Lock, LogOut, Mail, Save, Shield, User } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { LANGUAGES, useI18n } from '../lib/i18n';
import type { PublicUser } from '../types';

interface AccountTabProps {
  user: PublicUser;
  onUserUpdated: (user: PublicUser) => void;
  onLogout: () => Promise<void>;
}

export const AccountTab: React.FC<AccountTabProps> = ({ user, onUserUpdated, onLogout }) => {
  const { t, setLang } = useI18n();

  // Change Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [updatingPw, setUpdatingPw] = useState(false);
  const [pwFeedback, setPwFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Account Settings
  const [email, setEmail] = useState(user.email);
  const [language, setLanguage] = useState(user.language || 'en');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  useEffect(() => {
    if (user.language) {
      setLanguage(user.language);
    }
  }, [user.language]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwFeedback(null);
    if (newPassword !== confirmNewPassword) {
      setPwFeedback({ ok: false, text: t('passwords_mismatch') });
      return;
    }
    setUpdatingPw(true);
    try {
      const res = await apiRequest<{ success: boolean; message: string }>(
        '/api/auth/change-password',
        {
          method: 'POST',
          body: { currentPassword, newPassword, confirmNewPassword },
        }
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPwFeedback({ ok: true, text: res.message });
    } catch (err) {
      setPwFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to update password.',
      });
    } finally {
      setUpdatingPw(false);
    }
  };

  const handleSaveAccountSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsFeedback(null);
    try {
      const res = await apiRequest<{ success: boolean; user: PublicUser }>(
        '/api/account/settings',
        {
          method: 'PATCH',
          body: { email, language },
        }
      );
      setLang(res.user.language || language);
      onUserUpdated(res.user);
      setSettingsFeedback({ ok: true, text: t('settings_saved') });
    } catch (err) {
      setSettingsFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to update account settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* Change Password Card */}
      <form
        onSubmit={handleUpdatePassword}
        className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-[19px] font-bold text-white">{t('change_password')}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold tracking-wider text-[#9A9AA2] uppercase mb-2">
              {t('current_password')} <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t('enter_current_pw')}
              autoComplete="current-password"
              className="w-full h-[50px] px-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-wider text-[#9A9AA2] uppercase mb-2">
              {t('new_password')} <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('min_6_chars')}
              autoComplete="new-password"
              className="w-full h-[50px] px-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-wider text-[#9A9AA2] uppercase mb-2">
              {t('confirm_password')} <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder={t('reenter_new_pw')}
              autoComplete="new-password"
              className="w-full h-[50px] px-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
            />
          </div>
        </div>

        {pwFeedback && (
          <div
            className={`p-3 rounded-xl text-xs border ${
              pwFeedback.ok
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-red-950/40 border-red-800/60 text-red-300'
            }`}
          >
            {pwFeedback.text}
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={updatingPw}
            className="px-6 h-[48px] rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-60 text-[#141414] font-semibold text-[14px] inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            {updatingPw ? t('updating') : t('update_password')}
          </button>
        </div>
      </form>

      {/* Account Information & Settings Card */}
      <div className="bg-[#141416] border border-[#242428] rounded-[20px] p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#1B1915] border border-[#322C21] flex items-center justify-center text-[#DEC79B] shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[19px] font-bold text-white">{t('account_information')}</h2>
              <p className="text-xs text-[#8E8E95]">{t('account_info_desc')}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="px-3.5 h-9 rounded-xl bg-red-950/30 hover:bg-red-950/60 border border-red-900/50 text-xs font-semibold text-red-400 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('logout')}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
            <span className="text-[11px] text-[#8E8E95] block">{t('basic_credits_title')}</span>
            <span className="text-xl font-bold text-white font-mono tabular-nums">
              {user.basicCredits}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
            <span className="text-[11px] text-[#8E8E95] block">{t('premium_credits_title')}</span>
            <span className="text-xl font-bold text-[#DEC79B] font-mono tabular-nums">
              {user.premiumCredits}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-[#101012] border border-[#242429]">
            <span className="text-[11px] text-[#8E8E95] block">{t('wallet_balance_title')}</span>
            <span className="text-xl font-bold text-emerald-400 font-mono tabular-nums">
              ₹{(user.walletBalance ?? 0).toFixed(2)}
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveAccountSettings} className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold tracking-wider text-[#9A9AA2] uppercase mb-1.5">
              {t('username_upper')}
            </label>
            <div className="h-[46px] px-3.5 rounded-xl bg-[#101012] border border-[#242429] text-sm font-mono text-[#D1D1D6] flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-[#DEC79B]" />
              <span>{user.username}</span>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-wider text-[#9A9AA2] uppercase mb-1.5">
              {t('email_address')}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-[46px] pl-10 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white text-sm focus:outline-none focus:border-[#DEC79B]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-wider text-[#9A9AA2] uppercase mb-1.5">
              {t('default_language')}
            </label>
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setLang(e.target.value);
              }}
              className="w-full h-[46px] px-3.5 rounded-xl bg-[#101012] border border-[#28282C] text-white text-sm focus:outline-none focus:border-[#DEC79B]"
            >
              {LANGUAGES.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {settingsFeedback && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                settingsFeedback.ok
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-red-950/40 border-red-800/60 text-red-300'
              }`}
            >
              {settingsFeedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={savingSettings}
            className="px-5 h-[44px] rounded-xl bg-[#1D1D22] hover:bg-[#26262C] border border-[#2E2E35] text-sm font-semibold text-white inline-flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4 text-[#DEC79B]" />
            {savingSettings ? t('saving') : t('save_account_settings')}
          </button>
        </form>
      </div>
    </div>
  );
};
