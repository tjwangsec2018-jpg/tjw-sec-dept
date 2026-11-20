import React, { useEffect, useRef, useState } from 'react';
import {
  ConfirmationResult,
  createUserWithEmailAndPassword,
  RecaptchaVerifier,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  ArrowRight,
  KeyRound,
  Mail,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { PWAInstallButton } from './PWAInstallButton';

type AuthTab = 'google' | 'email' | 'phone';

export const AuthPortal: React.FC = () => {
  const [tab, setTab] = useState<AuthTab>('email');
  const [emailMode, setEmailMode] = useState<'signin' | 'register'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    return () => {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear();
        recaptchaRef.current = null;
      }
    };
  }, []);

  const formatAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || '';
    const msg = err instanceof Error ? err.message : String(err);

    if (code === 'auth/operation-not-allowed') {
      return 'This sign-in provider is not yet enabled in your Firebase Console. To activate it, open Firebase Console -> Authentication -> Sign-in method and enable Email/Password or Phone, or sign in immediately with Google below.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      return 'Invalid email or password. Please verify your credentials and try again.';
    }
    if (code === 'auth/user-not-found') {
      return 'No user account found for this email. Switch to Register User or use Google Sign-In.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'An account already exists with this email. Please sign in instead.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Sign-in window was closed before completion.';
    }
    if (code === 'auth/invalid-phone-number') {
      return 'Please enter a valid phone number in international E.164 format (e.g. +6591234567).';
    }
    return msg.replace('Firebase: ', '');
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (emailMode === 'signin') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
        await sendEmailVerification(cred.user).catch(() => {});
        setInfoMsg(
          'Director account created. A verification link has been sent to your email address.'
        );
      }
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
        });
      }
      const result = await signInWithPhoneNumber(auth, phoneNumber.trim(), recaptchaRef.current);
      setConfirmationResult(result);
      setInfoMsg(`Verification code dispatched via SMS to ${phoneNumber.trim()}.`);
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await confirmationResult.confirm(otpCode.trim());
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] grid grid-cols-1 lg:grid-cols-12">
      {/* Left Executive Corporate Column */}
      <div className="lg:col-span-5 bg-[#0F172A] text-white p-8 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <img
              src="/icon.svg"
              alt="QuorumSeal Emblem"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-lg shrink-0"
            />
            <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
              QuorumSeal
            </span>
          </div>

          <div className="mt-14 lg:mt-20 max-w-md">
            <p className="text-xs font-medium text-amber-400 tracking-wide">
              Corporate Secretarial Governance
            </p>
            <h1 className="mt-3 text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight">
              Board resolutions executed with statutory certainty.
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed">
              Sign in once to remain persistently authenticated across mobile and desktop. Company secretaries track statutory deadlines while directors review, e-sign, or upload wet-ink scans in seconds.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 space-y-4">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-mono text-base font-semibold text-white tabular-nums">7d · 3d · 48h</p>
              <p className="text-slate-400 mt-0.5">Auto Escalation</p>
            </div>
            <div>
              <p className="font-mono text-base font-semibold text-white tabular-nums">PDF Stamp</p>
              <p className="text-slate-400 mt-0.5">E-Sign &amp; Wet-Ink</p>
            </div>
            <div>
              <p className="font-mono text-base font-semibold text-white tabular-nums">Live Badge</p>
              <p className="text-slate-400 mt-0.5">iOS &amp; Android PWA</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Role-based routing automatically opens Admin Portal or Director App.</span>
          </p>
        </div>
      </div>

      {/* Right Authentication Workspace */}
      <div className="lg:col-span-7 flex flex-col justify-center items-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-[#0F172A]">Sign in to QuorumSeal</h2>
              <p className="text-sm text-slate-500 mt-1">
                Persistent session enabled for directors and corporate secretaries.
              </p>
            </div>
          </div>

          {/* Primary Instant Access via Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-3 cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#FFFFFF"
                d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.24-.93 2.29-1.98 3v2.49h3.2c1.87-1.72 2.95-4.26 2.95-7.27 0-.42-.04-.82-.11-1.2z"
              />
              <path
                fill="#E2E8F0"
                d="M12.17 21c2.67 0 4.91-.88 6.55-2.39l-3.2-2.49c-.89.6-2.02.95-3.35.95-2.58 0-4.76-1.74-5.54-4.08H3.32v2.57C4.95 18.8 8.3 21 12.17 21z"
              />
              <path
                fill="#CBD5E1"
                d="M6.63 12.99c-.2-.6-.31-1.24-.31-1.9s.11-1.3.31-1.9V6.62H3.32C2.65 7.96 2.27 9.48 2.27 11.09s.38 3.13 1.05 4.47l3.31-2.57z"
              />
              <path
                fill="#FFFFFF"
                d="M12.17 5.11c1.45 0 2.75.5 3.78 1.48l2.84-2.84C17.07 2.15 14.84 1.18 12.17 1.18 8.3 1.18 4.95 3.38 3.32 6.62l3.31 2.57c.78-2.34 2.96-4.08 5.54-4.08z"
              />
            </svg>
            <span>{loading ? 'Authenticating...' : 'Continue with Google Account'}</span>
          </button>

          <div className="relative flex items-center">
            <div className="flex-1 border-t border-slate-200" />
            <span className="px-3 text-xs text-slate-400">or authenticate directly</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          {/* Method Switcher: Email/Password vs Phone OTP */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setTab('email');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`min-h-[40px] rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                tab === 'email'
                  ? 'bg-white text-[#0F172A] shadow-2xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Email &amp; Password
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('phone');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`min-h-[40px] rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                tab === 'phone'
                  ? 'bg-white text-[#0F172A] shadow-2xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Phone OTP
            </button>
          </div>

          {/* Email / Password Form */}
          {tab === 'email' && (
            <form
              onSubmit={handleEmailSubmit}
              className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  {emailMode === 'signin' ? 'Executive Email Sign-In' : 'Register User'}
                </h3>
                <button
                  type="button"
                  onClick={() => setEmailMode(emailMode === 'signin' ? 'register' : 'signin')}
                  className="text-xs font-semibold text-slate-600 hover:text-[#0F172A] underline underline-offset-4 cursor-pointer"
                >
                  {emailMode === 'signin' ? 'New user?' : 'Already registered?'}
                </button>
              </div>

              {emailMode === 'register' && (
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-slate-600 mb-1.5">
                    Full Legal Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Eleanor Tan Wei Ling"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                  />
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-slate-600 mb-1.5">
                  Corporate Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="director@company.com"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                />
              </div>

              <div>
                <label htmlFor="auth-pass" className="block text-xs font-medium text-slate-600 mb-1.5">
                  Password
                </label>
                <input
                  id="auth-pass"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                <span>
                  {emailMode === 'signin' ? 'Sign In Permanently' : 'Create User Account'}
                </span>
              </button>
            </form>
          )}

          {/* Phone OTP Form */}
          {tab === 'phone' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-[#0F172A]">Mobile Phone OTP Sign-In</h3>
              {!confirmationResult ? (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div>
                    <label htmlFor="auth-phone" className="block text-xs font-medium text-slate-600 mb-1.5">
                      Mobile Number (International Format)
                    </label>
                    <input
                      id="auth-phone"
                      type="tel"
                      required
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+65 9123 4567"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 font-mono text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Send SMS Verification Code</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <label htmlFor="auth-otp" className="block text-xs font-medium text-slate-600 mb-1.5">
                      6-Digit SMS Code
                    </label>
                    <input
                      id="auth-otp"
                      type="text"
                      inputMode="numeric"
                      required
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 font-mono text-base tracking-widest text-center text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmationResult(null);
                        setOtpCode('');
                      }}
                      className="min-h-[44px] px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Change Number
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#059669] text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                    >
                      Verify &amp; Sign In
                    </button>
                  </div>
                </form>
              )}
              <div id="recaptcha-container" />
            </div>
          )}

          {errorMsg && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-[#DC2626] leading-relaxed">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-[#059669] leading-relaxed">
              {infoMsg}
            </div>
          )}

          <div className="pt-2">
            <PWAInstallButton variant="banner" />
          </div>
        </div>
      </div>
    </div>
  );
};
