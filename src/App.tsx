import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import QRCode from 'qrcode';
import { auth } from './lib/firebase';
import {
  ensureUserProfile,
  subscribeAuditLogs,
  subscribeCompanies,
  subscribeNotifications,
  subscribeResolutions,
  subscribeUsers,
  activateUserTwoFactor,
} from './lib/firestoreService';
import { generateTotpSecret, verifyTotpToken } from './lib/totp';
import { hasDirectorSigned } from './lib/escalation';
import { showLocalPushNotification, syncAppBadgeCount } from './lib/badging';
import { AuditLogItem, Company, NotificationItem, Resolution, UserProfile } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthPortal } from './components/AuthPortal';
import { AdminPortal } from './components/AdminPortal';
import { DirectorMobileApp } from './components/DirectorMobileApp';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ShieldCheck, KeyRound, LogOut, Smartphone } from 'lucide-react';

function QuorumSealWorkspace() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [viewMode, setViewMode] = useState<'admin' | 'user'>('user');

  const [twoFactorVerified, setTwoFactorVerified] = useState<boolean>(
    () => sessionStorage.getItem('quorumseal_2fa_verified') === 'true'
  );
  const [totpData, setTotpData] = useState<{ secret: string; uri: string } | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [totpCodeInput, setTotpCodeInput] = useState('');
  const [totpError, setTotpError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<UserProfile[]>([]);

  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const initialNotifLoadedRef = useRef(false);

  // 1. Persistent Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setCompanies([]);
        setResolutions([]);
        setNotifications([]);
        setAuditLogs([]);
        setAuthorizedUsers([]);
        syncAppBadgeCount(0);
        setAuthReady(true);
        return;
      }

      setUser(firebaseUser);
      try {
        const loginTab = (localStorage.getItem('quorumseal_login_tab') as 'user' | 'admin') || 'user';
        const userProfile = await ensureUserProfile(firebaseUser, loginTab);
        setProfile(userProfile);

        if (loginTab === 'admin' && userProfile.role !== 'admin') {
          alert('Administrator access denied. Your account does not have admin privileges. You have been routed to the User portal.');
          setViewMode('user');
        } else {
          setViewMode(userProfile.role === 'admin' ? 'admin' : 'user');
        }
      } catch (err) {
        console.error('Failed to load user profile:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  // Generate TOTP secret if first time activation needed
  useEffect(() => {
    if (user && profile && !profile.twoFactorEnabled && !totpData) {
      const data = generateTotpSecret(profile.email || user.email || 'user@quorumseal.local');
      setTotpData(data);
      QRCode.toDataURL(data.uri).then(setQrCodeDataUrl).catch(console.error);
    }
  }, [user, profile, totpData]);

  // 2. Real-time Firestore subscriptions (only when auth ready, user authenticated, and 2FA verified)
  useEffect(() => {
    if (!authReady || !user || !profile || !twoFactorVerified) return;

    const unsubCompanies = subscribeCompanies(user, profile.role, setCompanies);
    const unsubResolutions = subscribeResolutions(user, profile.role, setResolutions);
    const unsubAuditLogs = subscribeAuditLogs(user, profile.role, setAuditLogs);
    const unsubUsers = profile.role === 'admin' ? subscribeUsers(setAuthorizedUsers) : () => {};
    const unsubNotifications = subscribeNotifications(user, profile.role, (items) => {
      setNotifications(items);

      if (!initialNotifLoadedRef.current) {
        items.forEach((n) => seenNotificationIdsRef.current.add(n.id));
        initialNotifLoadedRef.current = true;
      } else {
        for (const item of items) {
          if (!seenNotificationIdsRef.current.has(item.id) && !item.read) {
            seenNotificationIdsRef.current.add(item.id);
            showLocalPushNotification(
              `QuorumSeal · ${item.companyName}`,
              item.message,
              item.resolutionId
            );
          }
        }
      }
    });

    return () => {
      unsubCompanies();
      unsubResolutions();
      unsubNotifications();
      unsubAuditLogs();
      unsubUsers();
    };
  }, [authReady, user, profile, twoFactorVerified]);

  // 3. Sync Web App Badging API
  useEffect(() => {
    if (!user || !twoFactorVerified) {
      syncAppBadgeCount(0);
      return;
    }
    const unsignedCount = resolutions.filter(
      (r) => r.status !== 'signed' && !hasDirectorSigned(r, user.uid, user.email)
    ).length;
    syncAppBadgeCount(unsignedCount);
  }, [resolutions, user, twoFactorVerified]);

  const handleSignOut = async () => {
    sessionStorage.removeItem('quorumseal_2fa_verified');
    await signOut(auth);
  };

  const handleActivate2Fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpData || !user || !profile) return;
    setActivating(true);
    setTotpError(null);
    try {
      const valid = verifyTotpToken(totpCodeInput, totpData.secret);
      if (!valid) {
        throw new Error('Invalid 6-digit authenticator code. Please check your authenticator app and try again.');
      }
      await activateUserTwoFactor(user, totpData.secret, profile.role);
      sessionStorage.setItem('quorumseal_2fa_verified', 'true');
      setTwoFactorVerified(true);
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Failed to activate 2FA.');
    } finally {
      setActivating(false);
    }
  };

  const handleVerifyReturning2Fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.twoFactorSecret) {
      setTotpError('2FA configuration missing. Please contact your administrator.');
      return;
    }
    setActivating(true);
    setTotpError(null);
    try {
      const valid = verifyTotpToken(totpCodeInput, profile.twoFactorSecret);
      if (!valid) {
        throw new Error('Invalid 6-digit authenticator code. Please enter the current code from your app.');
      }
      sessionStorage.setItem('quorumseal_2fa_verified', 'true');
      setTwoFactorVerified(true);
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setActivating(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex flex-col items-center justify-center gap-4 text-white">
        <img
          src="/icon.svg"
          alt="QuorumSeal"
          referrerPolicy="no-referrer"
          className="w-12 h-12 rounded-xl"
        />
        <p className="text-sm font-medium text-slate-300">Restoring secure session...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return <AuthPortal />;
  }

  // Mandatory 2FA Gate
  if (!twoFactorVerified) {
    // First-Time Activation Screen
    if (!profile.twoFactorEnabled) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 space-y-6 shadow-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0F172A] text-white flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Activate Two-Factor Authentication</h2>
                <p className="text-xs text-slate-500">Mandatory Enterprise Security Setup</p>
              </div>
            </div>

            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <p>
                To comply with statutory governance standards, all accounts must secure access with time-based One-Time Passwords (TOTP).
              </p>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center gap-3 text-center">
                {qrCodeDataUrl ? (
                  <img src={qrCodeDataUrl} alt="2FA QR Code" className="w-40 h-40 rounded-lg border border-slate-300 bg-white p-2" />
                ) : (
                  <div className="w-40 h-40 flex items-center justify-center text-slate-400">Loading QR Code...</div>
                )}
                <div>
                  <p className="text-[11px] font-semibold text-slate-500">Manual Setup Key (Base32):</p>
                  <p className="font-mono text-xs font-bold text-[#0F172A] select-all bg-white px-2 py-1 rounded border border-slate-200 mt-1">
                    {totpData?.secret || 'Generating...'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Scan this QR code with Google Authenticator, Microsoft Authenticator, or Authy, then enter the 6-digit code below.
              </p>
            </div>

            <form onSubmit={handleActivate2Fa} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  6-Digit Authenticator Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  maxLength={6}
                  value={totpCodeInput}
                  onChange={(e) => setTotpCodeInput(e.target.value)}
                  placeholder="123456"
                  className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 font-mono text-lg tracking-widest text-center text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                />
              </div>

              {totpError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-[#DC2626]">
                  {totpError}
                </div>
              )}

              <button
                type="submit"
                disabled={activating || !totpCodeInput.trim()}
                className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-[#0F172A] text-white text-sm font-bold shadow-md hover:bg-slate-800 disabled:opacity-60 transition-all cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" />
                <span>{activating ? 'Activating 2FA...' : 'Verify &amp; Activate 2FA'}</span>
              </button>
            </form>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500 truncate">{profile.email}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs font-semibold text-slate-600 hover:text-[#DC2626] inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Returning 2FA Challenge Screen
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl max-w-md w-full p-8 space-y-6 shadow-xl border border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F172A] text-white flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Two-Factor Authentication</h2>
              <p className="text-xs text-slate-500">Enter authenticator code to proceed</p>
            </div>
          </div>

          <form onSubmit={handleVerifyReturning2Fa} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                6-Digit Authenticator Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                required
                maxLength={6}
                value={totpCodeInput}
                onChange={(e) => setTotpCodeInput(e.target.value)}
                placeholder="123456"
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 font-mono text-lg tracking-widest text-center text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
              />
            </div>

            {totpError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-[#DC2626]">
                {totpError}
              </div>
            )}

            <button
              type="submit"
              disabled={activating || !totpCodeInput.trim()}
              className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-[#0F172A] text-white text-sm font-bold shadow-md hover:bg-slate-800 disabled:opacity-60 transition-all cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              <span>{activating ? 'Verifying...' : 'Verify Session'}</span>
            </button>
          </form>

          <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500 truncate">{profile.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs font-semibold text-slate-600 hover:text-[#DC2626] inline-flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'admin' && profile.role === 'admin') {
    return (
      <AdminPortal
        user={user}
        profile={profile}
        companies={companies}
        resolutions={resolutions}
        notifications={notifications}
        auditLogs={auditLogs}
        authorizedUsers={authorizedUsers}
        onSwitchToDirectorMobile={() => setViewMode('user')}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <DirectorMobileApp
      user={user}
      profile={profile}
      companies={companies}
      resolutions={resolutions}
      notifications={notifications}
      canSwitchToAdmin={profile.role === 'admin'}
      onSwitchToAdmin={() => setViewMode('admin')}
      onSignOut={handleSignOut}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QuorumSealWorkspace />
      <OfflineIndicator />
    </ErrorBoundary>
  );
}
