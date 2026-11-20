import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import {
  ensureUserProfile,
  subscribeCompanies,
  subscribeNotifications,
  subscribeResolutions,
} from './lib/firestoreService';
import { hasDirectorSigned } from './lib/escalation';
import { showLocalPushNotification, syncAppBadgeCount } from './lib/badging';
import { Company, NotificationItem, Resolution, UserProfile } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthPortal } from './components/AuthPortal';
import { AdminPortal } from './components/AdminPortal';
import { DirectorMobileApp } from './components/DirectorMobileApp';
import { OfflineIndicator } from './components/OfflineIndicator';

function QuorumSealWorkspace() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [viewMode, setViewMode] = useState<'admin' | 'user'>('user');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

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
        syncAppBadgeCount(0);
        setAuthReady(true);
        return;
      }

      setUser(firebaseUser);
      try {
        const userProfile = await ensureUserProfile(firebaseUser);
        setProfile(userProfile);
        setViewMode(userProfile.role === 'admin' ? 'admin' : 'user');
      } catch (err) {
        console.error('Failed to load user profile:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  // 2. Real-time Firestore subscriptions (only when auth is ready & user authenticated)
  useEffect(() => {
    if (!authReady || !user || !profile) return;

    const unsubCompanies = subscribeCompanies(user, profile.role, setCompanies);
    const unsubResolutions = subscribeResolutions(user, profile.role, setResolutions);
    const unsubNotifications = subscribeNotifications(user, profile.role, (items) => {
      setNotifications(items);

      // Dispatch local PWA notification for genuinely new incoming alerts
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
    };
  }, [authReady, user, profile]);

  // 3. Sync Web App Badging API (navigator.setAppBadge) with exact count of unsigned resolutions
  useEffect(() => {
    if (!user) {
      syncAppBadgeCount(0);
      return;
    }
    const unsignedCount = resolutions.filter(
      (r) => r.status !== 'signed' && !hasDirectorSigned(r, user.uid, user.email)
    ).length;
    syncAppBadgeCount(unsignedCount);
  }, [resolutions, user]);

  const handleSignOut = async () => {
    await signOut(auth);
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

  if (viewMode === 'admin' && profile.role === 'admin') {
    return (
      <AdminPortal
        user={user}
        profile={profile}
        companies={companies}
        resolutions={resolutions}
        notifications={notifications}
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
