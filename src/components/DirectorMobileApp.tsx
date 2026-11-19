import React, { useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Archive,
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react';
import { Company, NotificationItem, Resolution, UserProfile } from '../types';
import { getDeadlineMetrics, hasDirectorSigned } from '../lib/escalation';
import { ResolutionViewerModal } from './ResolutionViewerModal';
import { PWAInstallButton } from './PWAInstallButton';
import { requestPushAndFcmToken } from '../lib/firebase';
import { markNotificationRead, updateUserNotificationSettings } from '../lib/firestoreService';

type MobileTab = 'pending' | 'archive' | 'companies';

interface Props {
  user: User;
  profile: UserProfile;
  companies: Company[];
  resolutions: Resolution[];
  notifications: NotificationItem[];
  canSwitchToAdmin: boolean;
  onSwitchToAdmin?: () => void;
  onSignOut: () => void;
}

export const DirectorMobileApp: React.FC<Props> = ({
  user,
  profile,
  companies,
  resolutions,
  notifications,
  canSwitchToAdmin,
  onSwitchToAdmin,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<MobileTab>('pending');
  const [selectedResolution, setSelectedResolution] = useState<Resolution | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(false);
  const [notifPerm, setNotifPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const { pendingList, archiveList, overdueCount } = useMemo(() => {
    const pending: Resolution[] = [];
    const archived: Resolution[] = [];
    let overdue = 0;

    for (const r of resolutions) {
      const signedByMe = hasDirectorSigned(r, user.uid, user.email);
      if (r.status === 'signed' || signedByMe) {
        archived.push(r);
      } else {
        pending.push(r);
        if (getDeadlineMetrics(r.statutoryDueDate, r.status).isOverdue) {
          overdue += 1;
        }
      }
    }

    // Sort pending: Overdue first, then earliest due date
    pending.sort((a, b) => a.statutoryDueDate.localeCompare(b.statutoryDueDate));
    archived.sort((a, b) => b.statutoryDueDate.localeCompare(a.statutoryDueDate));

    return { pendingList: pending, archiveList: archived, overdueCount: overdue };
  }, [resolutions, user.email, user.uid]);

  const unreadAlerts = useMemo(
    () => notifications.filter((n) => !n.read),
    [notifications]
  );

  const handleEnablePush = async () => {
    const result = await requestPushAndFcmToken();
    setNotifPerm(result.permission);
    if (result.permission === 'granted') {
      await updateUserNotificationSettings(user.uid, result.fcmToken, true).catch(() => {});
      setToastMessage('Push alerts and app icon badging are now active on this device.');
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col pb-20 lg:pb-10">
      {/* Compact Executive Top App Bar (56px, keeps mobile sticky height <= 15%) */}
      <header className="sticky top-0 z-30 h-14 bg-[#0F172A] text-white px-4 lg:px-8 flex items-center justify-between gap-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/icon.svg"
            alt="QuorumSeal"
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-md shrink-0"
          />
          <span className="font-display text-base font-bold tracking-tight whitespace-nowrap shrink-0">
            QuorumSeal
          </span>
        </div>

        {/* Desktop Inline Navigation (hidden on mobile where bottom tab bar rules) */}
        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'pending'
                ? 'text-white border-b-2 border-amber-400'
                : 'hover:text-white'
            }`}
          >
            Pending Signatures ({pendingList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('archive')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'archive'
                ? 'text-white border-b-2 border-amber-400'
                : 'hover:text-white'
            }`}
          >
            Signed Archive ({archiveList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('companies')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'companies'
                ? 'text-white border-b-2 border-amber-400'
                : 'hover:text-white'
            }`}
          >
            Companies ({companies.length})
          </button>
        </nav>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowAlertsDrawer(true)}
            className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Open push notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadAlerts.length > 0 && (
              <span className="absolute top-2 right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#DC2626] text-[10px] font-bold text-white flex items-center justify-center tabular-nums">
                {unreadAlerts.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Responsive Content Canvas */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 lg:px-8 pt-5 space-y-6">
        {/* Executive Welcome & Action Strip */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {profile.designation || 'Board Director'} · {profile.email || profile.phone}
            </p>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#0F172A] mt-0.5">
              {activeTab === 'pending'
                ? 'Pending Signatures'
                : activeTab === 'archive'
                  ? 'Signed Archive'
                  : 'My Companies'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {canSwitchToAdmin && onSwitchToAdmin && (
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#0F172A] hover:bg-slate-50 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <LayoutDashboard className="w-4 h-4" />
                Admin Portal
              </button>
            )}
            {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
              <button
                type="button"
                onClick={handleEnablePush}
                className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5" />
                Enable Push Alerts
              </button>
            )}
            <PWAInstallButton variant="compact" />
          </div>
        </section>

        {/* Summary Metric Bar (Banking-grade clarity, tabular numerals) */}
        <section className="grid grid-cols-3 gap-3 lg:gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Unsigned</p>
            <p className="mt-1 text-2xl font-bold text-[#0F172A] font-mono tabular-nums">
              {pendingList.length}
            </p>
          </div>
          <div
            className={`rounded-2xl p-4 border ${
              overdueCount > 0
                ? 'bg-red-50/60 border-red-200'
                : 'bg-white border-slate-200'
            }`}
          >
            <p className={`text-xs ${overdueCount > 0 ? 'text-[#DC2626] font-medium' : 'text-slate-500'}`}>
              Overdue
            </p>
            <p
              className={`mt-1 text-2xl font-bold font-mono tabular-nums ${
                overdueCount > 0 ? 'text-[#DC2626]' : 'text-[#0F172A]'
              }`}
            >
              {overdueCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Executed</p>
            <p className="mt-1 text-2xl font-bold text-[#059669] font-mono tabular-nums">
              {archiveList.length}
            </p>
          </div>
        </section>

        {toastMessage && (
          <div
            role="status"
            className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-medium text-[#059669] flex items-center gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* TAB 1: PENDING SIGNATURES */}
        {activeTab === 'pending' && (
          <section className="space-y-3">
            {pendingList.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                <CheckCircle2 className="w-9 h-9 text-[#059669] mx-auto mb-3" />
                <h2 className="text-base font-bold text-[#0F172A]">All resolutions executed</h2>
                <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                  You have no pending corporate resolutions awaiting signature. Your app icon badge is clear.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pendingList.map((res) => {
                  const metrics = getDeadlineMetrics(res.statutoryDueDate, res.status);
                  const signedCount = Math.max(
                    res.signedByUids.length,
                    res.signedByEmails.length
                  );
                  const progressPct = Math.min(
                    100,
                    Math.round((signedCount / Math.max(1, res.requiredSignatures)) * 100)
                  );

                  return (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => setSelectedResolution(res)}
                      className={`w-full text-left rounded-2xl p-5 border transition-colors active:scale-[0.99] cursor-pointer flex flex-col justify-between gap-4 ${
                        metrics.isOverdue
                          ? 'bg-red-50/45 border-red-200 hover:bg-red-50/80'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-2.5">
                        {/* Clean Unboxed Metadata Line (Zero-Pill Rule) */}
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium text-slate-600 truncate">
                            {res.companyName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-mono font-semibold whitespace-nowrap shrink-0 tabular-nums ${
                              metrics.isOverdue ? 'text-[#DC2626]' : 'text-[#D97706]'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            {metrics.countdownLabel}
                          </span>
                        </div>

                        <h2 className="text-base font-bold text-[#0F172A] leading-snug">
                          {res.title}
                        </h2>

                        <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                          {res.summary}
                        </p>

                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono">{res.referenceCode}</span>
                          <span aria-hidden="true">·</span>
                          <span>{res.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">Due {res.statutoryDueDate}</span>
                        </div>
                      </div>

                      {/* Peer Accountability Indicator & Tap CTA */}
                      <div className="pt-3.5 border-t border-slate-200/70 space-y-2.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 tabular-nums">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            {signedCount} of {res.requiredSignatures} Directors have signed
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold text-[#0F172A] whitespace-nowrap">
                            Review &amp; Sign
                            <ChevronRight className="w-4 h-4" />
                          </span>
                        </div>

                        <div className="w-full h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              metrics.isOverdue ? 'bg-[#DC2626]' : 'bg-[#0F172A]'
                            }`}
                            style={{ width: `${Math.max(progressPct, 6)}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: SIGNED ARCHIVE */}
        {activeTab === 'archive' && (
          <section className="space-y-3">
            {archiveList.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                <Archive className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                <h2 className="text-base font-bold text-[#0F172A]">No executed resolutions yet</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Signed resolutions and stamped PDF certificates will appear here permanently.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
                {archiveList.map((res) => {
                  const signedCount = Math.max(
                    res.signedByUids.length,
                    res.signedByEmails.length
                  );
                  const fullyDone = res.status === 'signed';
                  return (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => setSelectedResolution(res)}
                      className="w-full text-left px-5 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-medium text-[#0F172A] truncate">
                            {res.companyName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{res.referenceCode}</span>
                        </div>
                        <p className="text-sm font-semibold text-[#0F172A] truncate">{res.title}</p>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={fullyDone ? 'text-[#059669] font-semibold' : 'text-[#D97706] font-semibold'}>
                            {fullyDone
                              ? 'Fully Executed'
                              : `Signed by you (${signedCount} of ${res.requiredSignatures} total)`}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="text-slate-500 font-mono tabular-nums">
                            {res.statutoryDueDate}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: COMPANIES */}
        {activeTab === 'companies' && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {companies.length === 0 ? (
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-10 text-center">
                <Building2 className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                <h2 className="text-base font-bold text-[#0F172A]">No directorships linked</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Companies assigned to your director email by your secretarial firm will appear here.
                </p>
              </div>
            ) : (
              companies.map((co) => {
                const coRes = resolutions.filter((r) => r.companyId === co.id);
                const coPending = coRes.filter(
                  (r) => r.status !== 'signed' && !hasDirectorSigned(r, user.uid, user.email)
                ).length;
                return (
                  <div
                    key={co.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-bold text-[#0F172A]">{co.name}</h2>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          UEN {co.uen} · {co.jurisdiction}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold whitespace-nowrap ${
                          coPending > 0 ? 'text-[#D97706]' : 'text-[#059669]'
                        }`}
                      >
                        {coPending > 0 ? `${coPending} Pending` : 'Compliant'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">{co.registeredAddress}</p>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span>Board: {co.directorNames.join(', ')}</span>
                      <span className="font-mono tabular-nums shrink-0 ml-2">
                        Inc. {co.incorporationDate}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}
      </main>

      {/* Mobile Native Bottom Tab Navigation (Thumb-Zone Anchor) */}
      <nav
        aria-label="Director mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-3 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`relative flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer ${
              activeTab === 'pending' ? 'text-[#0F172A]' : 'text-slate-400'
            }`}
          >
            <div className="relative">
              <FileSignature className="w-5 h-5" />
              {pendingList.length > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#DC2626] text-[10px] font-bold text-white flex items-center justify-center tabular-nums">
                  {pendingList.length}
                </span>
              )}
            </div>
            <span className="text-[11px] font-semibold">Pending</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('archive')}
            className={`flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer ${
              activeTab === 'archive' ? 'text-[#0F172A]' : 'text-slate-400'
            }`}
          >
            <Archive className="w-5 h-5" />
            <span className="text-[11px] font-semibold">Signed Archive</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('companies')}
            className={`flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer ${
              activeTab === 'companies' ? 'text-[#0F172A]' : 'text-slate-400'
            }`}
          >
            <Building2 className="w-5 h-5" />
            <span className="text-[11px] font-semibold">Companies</span>
          </button>
        </div>
      </nav>

      {/* Push Notifications Slide-Over Drawer */}
      {showAlertsDrawer && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-white h-full flex flex-col border-l border-slate-200">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#0F172A]">Push Alerts &amp; Notices</h2>
              <button
                type="button"
                onClick={() => setShowAlertsDrawer(false)}
                className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 text-center">No notifications yet.</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (!n.read) markNotificationRead(n.id).catch(() => {});
                      const target = resolutions.find((r) => r.id === n.resolutionId);
                      if (target) {
                        setShowAlertsDrawer(false);
                        setSelectedResolution(target);
                      }
                    }}
                    className={`w-full text-left p-4 hover:bg-slate-50 transition-colors cursor-pointer ${
                      n.read ? 'bg-white' : 'bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#0F172A] truncate">{n.companyName}</span>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {n.type.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full In-App PDF Viewer & Signing Sheet */}
      {selectedResolution && (
        <ResolutionViewerModal
          resolution={selectedResolution}
          user={user}
          directorName={profile.displayName}
          isAdminView={false}
          onClose={() => setSelectedResolution(null)}
          onSignedSuccess={(signedTitle) => {
            setToastMessage(`Executed and stamped "${signedTitle}" onto the resolution PDF.`);
            setTimeout(() => setToastMessage(null), 5000);
          }}
        />
      )}
    </div>
  );
};
