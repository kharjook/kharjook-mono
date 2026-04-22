'use client';

import Link from 'next/link';
import { Lock, RefreshCw, User as UserIcon, Wallet } from 'lucide-react';
import useRegisterView from './useRegisterView';

export function RegisterView() {
  const {
    error,
    handleRegister,
    isSubmitting,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
  } = useRegisterView();

  return (
    <div className="bg-[#0F1015] text-slate-200 min-h-screen font-sans flex items-center justify-center p-4 selection:bg-purple-500/30">
      <div className="w-full max-w-md bg-[#161722] p-8 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -ml-10 -mb-10"></div>

        <div className="text-center mb-8 relative z-10">
          <div className="w-16 h-16 bg-purple-500/10 rounded-2xl mx-auto flex items-center justify-center mb-4 border border-purple-500/20">
            <Wallet size={32} className="text-purple-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
            خرجوک
          </h1>
          <p className="text-slate-500 text-xs">ساخت حساب جدید</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4 relative z-10">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-xl text-center">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 ml-1">
              ایمیل
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <UserIcon size={18} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1A1B26] border border-white/5 rounded-xl py-3 px-4 pl-10 text-white text-left focus:border-purple-500 outline-none transition-all font-mono"
                dir="ltr"
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 ml-1">
              رمز عبور
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <Lock size={18} />
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1A1B26] border border-white/5 rounded-xl py-3 px-4 pl-10 text-white text-left focus:border-purple-500 outline-none transition-all font-mono tracking-widest"
                dir="ltr"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 ml-1">
              تکرار رمز عبور
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <Lock size={18} />
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-[#1A1B26] border border-white/5 rounded-xl py-3 px-4 pl-10 text-white text-left focus:border-purple-500 outline-none transition-all font-mono tracking-widest"
                dir="ltr"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.3)] transition-all mt-6 active:scale-95 disabled:opacity-50 flex justify-center items-center"
          >
            {isSubmitting ? (
              <RefreshCw size={20} className="animate-spin" />
            ) : (
              'ساخت حساب'
            )}
          </button>

          <p className="text-center text-xs text-slate-500 pt-2">
            حساب داری؟{' '}
            <Link
              href="/login"
              className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
            >
              ورود
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
