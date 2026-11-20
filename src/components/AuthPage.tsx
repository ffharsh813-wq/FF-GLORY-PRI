import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
  Zap,
} from 'lucide-react';
import { apiRequest, setUserToken } from '../lib/api';
import { LANGUAGES, useI18n } from '../lib/i18n';
import type { PublicUser, SiteSettings } from '../types';
import { RegionFlag } from './RegionFlag';

interface AuthPageProps {
  settings: SiteSettings;
  onAuthenticated: (user: PublicUser) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ settings, onAuthenticated }) => {
  const { lang, setLang, t } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Forgot password state
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [issuedCodeHint, setIssuedCodeHint] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const activeLang = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  const switchMode = (next: 'signin' | 'signup' | 'forgot') => {
    setMode(next);
    setError('');
    setSuccessMsg('');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: PublicUser }>('/api/auth/login', {
        method: 'POST',
        scope: 'public',
        body: { username, password },
      });
      setUserToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!settings.registrationEnabled) {
      setError(t('registration_closed_desc'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('passwords_mismatch'));
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: PublicUser }>('/api/auth/signup', {
        method: 'POST',
        scope: 'public',
        body: { username, email, password, confirmPassword },
      });
      setUserToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; message: string; resetCode: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          scope: 'public',
          body: { username, email },
        }
      );
      setResetCodeSent(true);
      setIssuedCodeHint(res.resetCode);
      setSuccessMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate reset code.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; message: string }>(
        '/api/auth/reset-password',
        {
          method: 'POST',
          scope: 'public',
          body: {
            username,
            email,
            resetCode,
            newPassword,
            confirmPassword,
          },
        }
      );
      setSuccessMsg(res.message);
      setResetCodeSent(false);
      setIssuedCodeHint('');
      setPassword('');
      setConfirmPassword('');
      setMode('signin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  const isSignUp = mode === 'signup';

  return (
    <div className="min-h-screen bg-[#0D0D0E] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-[430px] bg-[#141416] border border-[#242428] rounded-[24px] p-6 sm:p-8 shadow-2xl relative">
        {/* Top-right Language Selector */}
        <div className="flex justify-end mb-2" ref={langRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLangOpen((v) => !v)}
              className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1D] hover:bg-[#222227] border border-[#2A2A2F] text-xs text-[#D1D1D6] inline-flex items-center gap-2 cursor-pointer"
            >
              <RegionFlag codeOrId={activeLang.flag} className="w-4 h-3" />
              <span className="max-w-[96px] truncate">{activeLang.label.split(' ')[0]}</span>
            </button>
            {langOpen && (
              <div className="absolute right-0 mt-1.5 w-48 max-h-72 overflow-y-auto bg-[#151517] border border-[#2A2A2E] rounded-xl shadow-2xl py-1 z-50">
                {LANGUAGES.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setLang(item.code);
                      setLangOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2.5 cursor-pointer ${
                      item.code === lang
                        ? 'bg-[#282218] text-[#DEC79B] font-semibold'
                        : 'text-[#D1D1D6] hover:bg-[#1E1E22]'
                    }`}
                  >
                    <RegionFlag codeOrId={item.flag} className="w-4 h-3" />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top Square Icon Badge */}
        <div className="flex justify-center mb-5">
          {settings.websiteLogo ? (
            <div className="w-[74px] h-[74px] rounded-[18px] bg-[#1D1C1A] border border-[#353027] flex items-center justify-center p-2 shadow-[0_0_30px_rgba(222,199,155,0.18)]">
              <img
                src={settings.websiteLogo}
                alt={settings.websiteName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain rounded-xl"
              />
            </div>
          ) : (
            <div
              className={`w-[74px] h-[74px] rounded-[18px] flex items-center justify-center transition-colors ${
                isSignUp
                  ? 'bg-[#0FA968] shadow-[0_0_32px_rgba(15,169,104,0.28)]'
                  : 'bg-[#DEC79B] shadow-[0_0_32px_rgba(222,199,155,0.24)]'
              }`}
            >
              <Zap className="w-9 h-9 text-white stroke-[2.2]" />
            </div>
          )}
        </div>

        {/* Heading & Subtitle */}
        <div className="text-center mb-6">
          <h1 className="text-[28px] font-bold tracking-tight text-white leading-tight">
            {mode === 'signin'
              ? t('welcome_back')
              : mode === 'signup'
                ? t('create_account')
                : t('reset_password')}
          </h1>
          <p className="text-[14px] text-[#8E8E95] mt-1.5">
            {mode === 'signin' && (
              <>
                {t('sign_in_to')} <span className="font-semibold text-white">{settings.websiteName}</span> {t('panel_word')}
              </>
            )}
            {mode === 'signup' && (
              <>
                {t('join_panel')} <span className="font-semibold text-[#10B981]">{settings.websiteName}</span> {t('panel_word')}
              </>
            )}
            {mode === 'forgot' && (
              <>
                {t('recover_access')} <span className="font-semibold text-white">{settings.websiteName}</span>
              </>
            )}
          </p>
        </div>

        {/* Segmented Toggle Switch */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-2 p-1.5 bg-[#1B1B1E] border border-[#28282D] rounded-2xl mb-6">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`py-2.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer ${
                mode === 'signin'
                  ? 'bg-[#DEC79B] text-[#141414] shadow-sm'
                  : 'text-[#8E8E95] hover:text-white'
              }`}
            >
              {t('sign_in')}
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer ${
                mode === 'signup'
                  ? 'bg-[#0FA968] text-white shadow-sm'
                  : 'text-[#8E8E95] hover:text-white'
              }`}
            >
              {t('sign_up')}
            </button>
          </div>
        )}

        {/* Maintenance Notice */}
        {settings.maintenanceMode && (
          <div className="mb-5 p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('maintenance_active')}</span>
          </div>
        )}

        {/* Error / Success Feedback */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-[13px] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-[13px] flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* SIGN IN FORM */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('username_or_email')}
              </label>
              <div className="relative">
                <User className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('enter_username_email')}
                  autoComplete="username"
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B] transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('password')}
              </label>
              <div className="relative">
                <Lock className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('enter_password')}
                  autoComplete="current-password"
                  className="w-full h-[50px] pl-11 pr-11 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label="Toggle password"
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#7A7A82] hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[52px] mt-2 rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] disabled:opacity-60 text-[#141414] font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogIn className="w-[18px] h-[18px]" />
              {loading ? t('signing_in') : t('sign_in')}
            </button>

            <div className="pt-4 mt-4 border-t border-[#242428]">
              <div className="flex items-center justify-between text-xs text-[#7E7E86]">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="hover:text-[#DEC79B] transition-colors cursor-pointer"
                >
                  {t('forgot_password')}
                </button>
                <a
                  href="/admin"
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', '/admin');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="hover:text-[#DEC79B] transition-colors"
                >
                  {t('admin_portal')}
                </a>
              </div>
            </div>
          </form>
        )}

        {/* SIGN UP FORM */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-4">
            {settings.registrationEnabled ? (
              <div className="p-4 rounded-xl bg-[#0A261B] border border-[#134B35] text-center space-y-1">
                <div className="flex items-center justify-center gap-2 text-[#10B981] font-semibold text-[15px]">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('open_registration')}</span>
                </div>
                <p className="text-[12px] text-[#4EA882]">{t('open_registration_desc')}</p>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-red-950/30 border border-red-900/50 text-center space-y-1">
                <div className="flex items-center justify-center gap-2 text-red-400 font-semibold text-[15px]">
                  <AlertCircle className="w-4 h-4" />
                  <span>{t('registration_closed')}</span>
                </div>
                <p className="text-[12px] text-red-300/80">{t('registration_closed_desc')}</p>
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('username')}
              </label>
              <div className="relative">
                <User className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder={t('choose_username')}
                  autoComplete="username"
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#10B981] transition-colors"
                />
              </div>
              <p className="text-[12px] text-[#7A7A82] mt-1.5">{t('username_hint')}</p>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('email')}
              </label>
              <div className="relative">
                <Mail className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('enter_email')}
                  autoComplete="email"
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#10B981] transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('password')}
              </label>
              <div className="relative">
                <Lock className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('create_password')}
                  autoComplete="new-password"
                  className="w-full h-[50px] pl-11 pr-11 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#10B981] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label="Toggle password"
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#7A7A82] hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[12px] text-[#7A7A82] mt-1.5">{t('min_6_chars')}</p>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('confirm_password')}
              </label>
              <div className="relative">
                <ShieldCheck className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('confirm_your_password')}
                  autoComplete="new-password"
                  className="w-full h-[50px] pl-11 pr-11 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#10B981] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label="Toggle confirm password"
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#7A7A82] hover:text-white cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !settings.registrationEnabled}
              className="w-full h-[52px] mt-2 rounded-xl bg-[#0FA968] hover:bg-[#12BA73] disabled:opacity-50 text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <UserPlus className="w-[18px] h-[18px]" />
              {loading ? t('creating_account') : t('create_account')}
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD FORM */}
        {mode === 'forgot' && (
          <form
            onSubmit={resetCodeSent ? handleCompleteReset : handleRequestReset}
            className="space-y-4"
          >
            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('username')}
              </label>
              <div className="relative">
                <User className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('enter_username_email')}
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                {t('registered_email')}
              </label>
              <div className="relative">
                <Mail className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('enter_registered_email')}
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
                />
              </div>
            </div>

            {resetCodeSent && (
              <>
                {issuedCodeHint && (
                  <div className="p-3 rounded-xl bg-[#1D1B16] border border-[#5B4F37] text-xs text-[#DEC79B]">
                    {t('reset_code')}: <span className="font-mono font-bold">{issuedCodeHint}</span>
                  </div>
                )}
                <div>
                  <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                    {t('reset_code')}
                  </label>
                  <div className="relative">
                    <KeyRound className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.toUpperCase())}
                      placeholder={t('enter_reset_code')}
                      className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white font-mono placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                    {t('new_password')}
                  </label>
                  <div className="relative">
                    <Lock className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t('min_6_chars')}
                      className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#D1D1D6] mb-1.5">
                    {t('confirm_password')}
                  </label>
                  <div className="relative">
                    <ShieldCheck className="w-[18px] h-[18px] text-[#7A7A82] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t('reenter_new_pw')}
                      className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-[#101012] border border-[#28282C] text-white placeholder-[#5F5F66] text-[14px] focus:outline-none focus:border-[#DEC79B]"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[50px] rounded-xl bg-[#DEC79B] hover:bg-[#E7D4AF] text-[#141414] font-semibold text-[14px] cursor-pointer transition-colors"
            >
              {loading
                ? t('processing')
                : resetCodeSent
                  ? t('confirm_password_reset')
                  : t('request_reset_code')}
            </button>

            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full text-center text-xs text-[#8E8E95] hover:text-white pt-1 cursor-pointer"
            >
              {t('back_to_sign_in')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
