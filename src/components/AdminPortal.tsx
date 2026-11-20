import React, { useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  BellRing,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  LogOut,
  Play,
  Plus,
  Search,
  Send,
  Smartphone,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  AuditLogItem,
  Company,
  NotificationItem,
  Resolution,
  ResolutionStatus,
  UserProfile,
} from '../types';
import { getDeadlineMetrics, getNextEscalationLabel } from '../lib/escalation';
import {
  deleteCompany,
  deleteResolution,
  deleteAuditLog,
  preRegisterAuthorizedUser,
  deleteUserProfile,
  createClientAuthAndProfile,
  runAutomatedEscalationSweep,
  sendManualPushNudge,
} from '../lib/firestoreService';
import { AdminUploadModal, NewCompanyModal } from './AdminUploadModal';
import { ResolutionViewerModal } from './ResolutionViewerModal';
import { PWAInstallButton } from './PWAInstallButton';

type AdminSection = 'board' | 'companies' | 'users' | 'escalations' | 'audit';
type DeadlineFilter = 'all' | 'overdue' | '48h' | '7d';

interface Props {
  user: User;
  profile: UserProfile;
  companies: Company[];
  resolutions: Resolution[];
  notifications: NotificationItem[];
  auditLogs: AuditLogItem[];
  authorizedUsers: UserProfile[];
  onSwitchToDirectorMobile: () => void;
  onSignOut: () => void;
}


export const AdminPortal: React.FC<Props> = ({
  user,
  profile,
  companies,
  resolutions,
  notifications,
  auditLogs,
  authorizedUsers,
  onSwitchToDirectorMobile,
  onSignOut,
}) => {
  const [section, setSection] = useState<AdminSection>('board');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [viewingResolution, setViewingResolution] = useState<Resolution | null>(null);

  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);
  const [clientEmail, setClientEmail] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientDesignation, setClientDesignation] = useState('Board Director');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [registeringUser, setRegisteringUser] = useState(false);
  const [showTempPass, setShowTempPass] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const handleCopyPass = () => {
    if (!clientPassword) return;
    navigator.clipboard.writeText(clientPassword);
    setCopiedPass(true);
    setTimeout(() => setCopiedPass(false), 2500);
  };

  const notify = (msg: string) => {
    setBannerNotice(msg);
    setTimeout(() => setBannerNotice(null), 5500);
  };

  const handleDeleteResolution = async (res: Resolution) => {
    if (!window.confirm(`Permanently delete resolution "${res.title}" (${res.referenceCode})?`)) return;
    try {
      await deleteResolution(res.id, res.title, res.companyName, user, profile.role);
      notify(`Resolution ${res.referenceCode} deleted permanently.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete resolution.');
    }
  };

  const handleDeleteCompany = async (co: Company) => {
    if (!window.confirm(`Permanently delete client company "${co.name}" (${co.uen})?`)) return;
    try {
      await deleteCompany(co.id, co.name, user, profile.role);
      notify(`Client company ${co.name} deleted permanently.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete company.');
    }
  };


  const enrichedResolutions = useMemo(() => {
    return resolutions.map((r) => ({
      resolution: r,
      metrics: getDeadlineMetrics(r.statutoryDueDate, r.status),
    }));
  }, [resolutions]);

  const kpis = useMemo(() => {
    let pending = 0;
    let overdue = 0;
    let partial = 0;
    let signed = 0;

    for (const { resolution, metrics } of enrichedResolutions) {
      if (metrics.effectiveStatus === 'signed') signed++;
      else if (metrics.effectiveStatus === 'overdue') overdue++;
      else if (resolution.status === 'partially_signed') partial++;
      else pending++;
    }
    return { pending, overdue, partial, signed };
  }, [enrichedResolutions]);

  const filteredRows = useMemo(() => {
    return enrichedResolutions.filter(({ resolution, metrics }) => {
      if (companyFilter !== 'all' && resolution.companyId !== companyFilter) return false;

      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue') {
          if (!metrics.isOverdue) return false;
        } else if (resolution.status !== (statusFilter as ResolutionStatus)) {
          return false;
        }
      }

      if (deadlineFilter === 'overdue' && !metrics.isOverdue) return false;
      if (
        deadlineFilter === '48h' &&
        (resolution.status === 'signed' || metrics.hoursRemaining > 48)
      ) {
        return false;
      }
      if (
        deadlineFilter === '7d' &&
        (resolution.status === 'signed' || metrics.daysRemaining > 7)
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${resolution.title} ${resolution.companyName} ${resolution.referenceCode} ${resolution.assignedDirectorNames.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [enrichedResolutions, companyFilter, statusFilter, deadlineFilter, searchQuery]);

  const handleInstantNudge = async (resolution: Resolution) => {
    setNudgingId(resolution.id);
    try {
      const { nudgedCount } = await sendManualPushNudge(resolution, user.uid);
      notify(
        nudgedCount > 0
          ? `Instant push nudge dispatched to ${nudgedCount} unsigned director(s) on ${resolution.referenceCode}.`
          : 'All directors have already executed this resolution.'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to dispatch nudge.');
    } finally {
      setNudgingId(null);
    }
  };

  const handleRunEscalationSweep = async () => {
    setSweeping(true);
    try {
      const result = await runAutomatedEscalationSweep(resolutions, user.uid);
      notify(result.summary);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Escalation sweep failed.');
    } finally {
      setSweeping(false);
    }
  };

  const renderStatusText = (status: ResolutionStatus, isOverdue: boolean) => {
    if (status === 'signed') {
      return <span className="text-xs font-semibold text-[#059669]">Signed</span>;
    }
    if (isOverdue || status === 'overdue') {
      return <span className="text-xs font-semibold text-[#DC2626]">Overdue</span>;
    }
    if (status === 'partially_signed') {
      return <span className="text-xs font-semibold text-[#D97706]">Partially Signed</span>;
    }
    if (status === 'viewed') {
      return <span className="text-xs font-semibold text-slate-700">Viewed</span>;
    }
    return <span className="text-xs font-semibold text-[#D97706]">Pending</span>;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Executive Deep Navy Sidebar (256px) */}
      <aside className="w-full lg:w-64 bg-[#0F172A] text-white flex flex-col justify-between shrink-0">
        <div>
          <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800">
            <img
              src="/icon.svg"
              alt="QuorumSeal"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg shrink-0"
            />
            <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
              QuorumSeal
            </span>
          </div>

          <nav className="p-4 space-y-1">
            <button
              type="button"
              onClick={() => setSection('board')}
              className={`w-full min-h-[42px] px-3.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                section === 'board'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Tracking Board</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('companies')}
              className={`w-full min-h-[42px] px-3.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                section === 'companies'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Client Companies</span>
              <span className="ml-auto font-mono text-xs text-slate-400 tabular-nums">
                {companies.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSection('users')}
              className={`w-full min-h-[42px] px-3.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                section === 'users'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Authorized Users</span>
              <span className="ml-auto font-mono text-xs text-slate-400 tabular-nums">
                {authorizedUsers.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSection('escalations')}
              className={`w-full min-h-[42px] px-3.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                section === 'escalations'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <BellRing className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Escalation Rules</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('audit')}
              className={`w-full min-h-[42px] px-3.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                section === 'audit'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Immutable Audit Logs</span>
              <span className="ml-auto font-mono text-xs text-slate-400 tabular-nums">
                {auditLogs.length}
              </span>
            </button>
          </nav>

        </div>

        <div className="p-4 border-t border-slate-800 space-y-2.5">
          <button
            type="button"
            onClick={onSwitchToDirectorMobile}
            className="w-full min-h-[40px] px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <Smartphone className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="whitespace-nowrap">Open Director Mobile App</span>
          </button>

          <div className="pt-2 flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{profile.displayName}</p>
              <p className="text-[11px] text-slate-400 truncate">
                {profile.email || 'Firm Administrator'}
              </p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Right Main Desktop Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb Left — Primary Action Right */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 lg:px-8 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 whitespace-nowrap">Secretarial Portal</span>
            <span className="text-slate-300">/</span>
            <h1 className="font-semibold text-[#0F172A] truncate">
              {section === 'board'
                ? 'Live Tracking Board'
                : section === 'companies'
                  ? 'Client Companies'
                  : section === 'users'
                    ? 'Authorized Users & Clients'
                    : section === 'escalations'
                      ? 'Automated Escalation Rules'
                      : 'Immutable Audit Logs'}
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={() => {
                if (companies.length === 0) {
                  setShowCompanyModal(true);
                } else {
                  setShowUploadModal(true);
                }
              }}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FilePlus2 className="w-4 h-4 shrink-0" />
              Upload &amp; Assign
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-6">
          {bannerNotice && (
            <div
              role="status"
              className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm font-medium text-[#059669] flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {bannerNotice}
              </span>
              <button
                type="button"
                onClick={() => setBannerNotice(null)}
                className="text-xs font-semibold underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* 4-Column Flat KPI Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Pending &amp; Viewed</p>
              <p className="mt-2 text-2xl font-bold text-[#D97706] font-mono tabular-nums">
                {kpis.pending}
              </p>
              <p className="mt-1 text-xs text-slate-500">Awaiting first signature</p>
            </div>

            <div
              className={`rounded-xl p-5 border ${
                kpis.overdue > 0 ? 'bg-red-50/50 border-red-200' : 'bg-white border-slate-200'
              }`}
            >
              <p
                className={`text-xs font-medium ${
                  kpis.overdue > 0 ? 'text-[#DC2626]' : 'text-slate-500'
                }`}
              >
                Overdue Statutory
              </p>
              <p className="mt-2 text-2xl font-bold text-[#DC2626] font-mono tabular-nums">
                {kpis.overdue}
              </p>
              <p className="mt-1 text-xs text-slate-500">Past statutory due date</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Partially Signed</p>
              <p className="mt-2 text-2xl font-bold text-[#0F172A] font-mono tabular-nums">
                {kpis.partial}
              </p>
              <p className="mt-1 text-xs text-slate-500">Awaiting co-directors</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Executed &amp; Archived</p>
              <p className="mt-2 text-2xl font-bold text-[#059669] font-mono tabular-nums">
                {kpis.signed}
              </p>
              <p className="mt-1 text-xs text-slate-500">Stamped PDF certificates</p>
            </div>
          </section>

          {/* SECTION 1: LIVE TRACKING BOARD */}
          {section === 'board' && (
            <section className="space-y-4">
              {resolutions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
                  <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                  <h2 className="text-lg font-bold text-[#0F172A]">
                    No corporate resolutions tracked yet
                  </h2>
                  <p className="text-sm text-slate-600 max-w-md mx-auto">
                    {companies.length === 0
                      ? 'First, add a client company to begin issuing corporate resolutions and managing board executions.'
                      : 'Upload a board resolution PDF or generate one to assign directors with instant push notifications.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    {companies.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowCompanyModal(true)}
                        className="min-h-[42px] px-5 rounded-lg bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Add First Client Company
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowUploadModal(true)}
                        className="min-h-[42px] px-5 rounded-lg bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer"
                      >
                        <FilePlus2 className="w-4 h-4" />
                        Upload &amp; Assign Resolution
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Filter Toolbar */}
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      {/* Segmented Status Filter */}
                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                        {[
                          { key: 'all', label: 'All' },
                          { key: 'pending', label: 'Pending' },
                          { key: 'viewed', label: 'Viewed' },
                          { key: 'partially_signed', label: 'Partially Signed' },
                          { key: 'signed', label: 'Signed' },
                          { key: 'overdue', label: 'Overdue' },
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setStatusFilter(tab.key)}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              statusFilter === tab.key
                                ? 'bg-white text-[#0F172A] shadow-2xs'
                                : 'text-slate-600 hover:text-[#0F172A]'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="relative flex-1 sm:flex-none sm:w-56">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search title, ref, director..."
                            className="w-full min-h-[38px] pl-8 pr-3 rounded-lg border border-slate-300 text-xs text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                          />
                        </div>

                        <select
                          aria-label="Filter by company"
                          value={companyFilter}
                          onChange={(e) => setCompanyFilter(e.target.value)}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-[#0F172A]"
                        >
                          <option value="all">All Companies</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Filter by statutory deadline"
                          value={deadlineFilter}
                          onChange={(e) => setDeadlineFilter(e.target.value as DeadlineFilter)}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-[#0F172A]"
                        >
                          <option value="all">All Deadlines</option>
                          <option value="overdue">Overdue Only</option>
                          <option value="48h">Due Within 48 Hours</option>
                          <option value="7d">Due Within 7 Days</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* High-Density Executive Data Table */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                            <th className="py-3 px-4">Resolution &amp; Client Company</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4">Directors</th>
                            <th className="py-3 px-4">Statutory Deadline</th>
                            <th className="py-3 px-4">Escalation</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {filteredRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                                No resolutions match the selected filters.
                              </td>
                            </tr>
                          ) : (
                            filteredRows.map(({ resolution, metrics }) => {
                              const signedCount = Math.max(
                                resolution.signedByUids.length,
                                resolution.signedByEmails.length
                              );
                              return (
                                <tr
                                  key={resolution.id}
                                  className={`transition-colors ${
                                    metrics.isOverdue
                                      ? 'bg-red-50/30 hover:bg-red-50/60'
                                      : 'hover:bg-slate-50/80'
                                  }`}
                                >
                                  <td className="py-3.5 px-4 max-w-md">
                                    <button
                                      type="button"
                                      onClick={() => setViewingResolution(resolution)}
                                      className="text-left group cursor-pointer"
                                    >
                                      <p className="font-semibold text-[#0F172A] group-hover:underline line-clamp-1">
                                        {resolution.title}
                                      </p>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        <span className="font-mono">{resolution.referenceCode}</span>
                                        <span aria-hidden="true"> · </span>
                                        <span>{resolution.companyName}</span>
                                        <span aria-hidden="true"> · </span>
                                        <span>{resolution.category}</span>
                                      </p>
                                    </button>
                                  </td>

                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    {renderStatusText(resolution.status, metrics.isOverdue)}
                                  </td>

                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    <p className="text-xs font-mono font-semibold text-[#0F172A] tabular-nums">
                                      {signedCount} of {resolution.requiredSignatures} signed
                                    </p>
                                    <p className="text-[11px] text-slate-500 max-w-[160px] truncate">
                                      {resolution.assignedDirectorNames.join(', ')}
                                    </p>
                                  </td>

                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    <p className="font-mono text-xs font-medium text-[#0F172A] tabular-nums">
                                      {resolution.statutoryDueDate}
                                    </p>
                                    <p
                                      className={`text-xs font-medium mt-0.5 ${
                                        metrics.isOverdue
                                          ? 'text-[#DC2626]'
                                          : resolution.status === 'signed'
                                            ? 'text-[#059669]'
                                            : 'text-[#D97706]'
                                      }`}
                                    >
                                      {metrics.countdownLabel}
                                    </p>
                                  </td>

                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    <p className="text-xs text-slate-700">
                                      {getNextEscalationLabel(resolution)}
                                    </p>
                                    <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                                      {resolution.nudgeCount || 0} nudge(s) sent
                                    </p>
                                  </td>

                                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setViewingResolution(resolution)}
                                        className="min-h-[34px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0F172A] hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                                      >
                                        View PDF
                                      </button>
                                      {resolution.status !== 'signed' && (
                                        <button
                                          type="button"
                                          disabled={nudgingId === resolution.id}
                                          onClick={() => handleInstantNudge(resolution)}
                                          className="min-h-[34px] px-3 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                                        >
                                          <Send className="w-3 h-3" />
                                          {nudgingId === resolution.id
                                            ? 'Sending...'
                                            : 'Send Instant Push Nudge'}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {/* SECTION 2: CLIENT COMPANIES */}
          {section === 'companies' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-slate-600">
                  Manage client corporate registers and director email assignments.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCompanyModal(true)}
                  className="min-h-[40px] px-4 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Client Company
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                      <th className="py-3 px-4">Company &amp; UEN</th>
                      <th className="py-3 px-4">Jurisdiction</th>
                      <th className="py-3 px-4">Board Directors</th>
                      <th className="py-3 px-4 text-right">Active Resolutions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {companies.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-sm text-slate-500">
                          <Building2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                          <p className="font-semibold text-[#0F172A]">No client companies registered yet.</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Click &quot;Add Client Company&quot; above to register your first corporate client.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      companies.map((co) => {
                        const openCount = resolutions.filter(
                          (r) => r.companyId === co.id && r.status !== 'signed'
                        ).length;
                        return (
                          <tr key={co.id} className="hover:bg-slate-50/70">
                            <td className="py-3.5 px-4">
                              <p className="font-semibold text-[#0F172A]">{co.name}</p>
                              <p className="text-xs font-mono text-slate-500 mt-0.5">
                                {co.uen} · Inc. {co.incorporationDate}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                              {co.jurisdiction}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-700">
                              {co.directorNames.map((n, i) => (
                                <div key={i} className="truncate">
                                  {n}{' '}
                                  <span className="text-slate-400">({co.directorEmails[i]})</span>
                                </div>
                              ))}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-xs font-semibold tabular-nums">
                              <div className="flex items-center justify-end gap-3">
                                <span className={openCount > 0 ? 'text-[#D97706]' : 'text-[#059669]'}>
                                  {openCount} Open
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCompany(co)}
                                  className="min-h-[32px] px-2.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-[#DC2626] hover:bg-red-100 whitespace-nowrap cursor-pointer inline-flex items-center gap-1"
                                  title="Permanently delete company"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SECTION 3: AUTOMATED ESCALATION RULES */}
          {section === 'escalations' && (
            <section className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-[#0F172A]">
                    Automated Statutory Escalation Engine
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Automatically dispatches push notifications to unsigned directors at 7 days, 3 days, and 48 hours prior to every statutory deadline.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunEscalationSweep}
                  disabled={sweeping}
                  className="min-h-[42px] px-4 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  {sweeping ? 'Evaluating Schedule...' : 'Run Escalation Sweep Now'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    stage: 'Stage 01 · T-7 Days',
                    title: 'Early Statutory Notice',
                    desc: 'Dispatched 7 days before statutory deadline to all directors who have not yet opened or signed.',
                  },
                  {
                    stage: 'Stage 02 · T-3 Days',
                    title: 'Priority Board Reminder',
                    desc: 'Dispatched 3 days prior to deadline with peer co-director execution progress.',
                  },
                  {
                    stage: 'Stage 03 · T-48 Hours',
                    title: 'Urgent Statutory Escalation',
                    desc: 'High-priority mobile push alert and crimson highlight when fewer than 48 hours remain.',
                  },
                ].map((rule) => (
                  <div
                    key={rule.stage}
                    className="bg-white border border-slate-200 rounded-xl p-5 space-y-2"
                  >
                    <p className="font-mono text-xs font-semibold text-[#D97706] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {rule.stage}
                    </p>
                    <h3 className="text-sm font-bold text-[#0F172A]">{rule.title}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{rule.desc}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Push Notification &amp; Escalation Dispatch Log
                  </h3>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {notifications.length} event(s)
                  </span>
                </div>
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500 text-center">
                      No push notifications dispatched yet.
                    </p>
                  ) : (
                    notifications.slice(0, 40).map((n) => (
                      <div
                        key={n.id}
                        className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A]">
                            {n.companyName} · <span className="font-normal text-slate-600">{n.recipientEmail}</span>
                          </p>
                          <p className="text-slate-600 mt-0.5">{n.message}</p>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                          {n.type.replace('_', ' ')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          )}

          {/* SECTION: AUTHORIZED USERS */}
          {section === 'users' && (
            <section className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-[#0F172A]">
                    Pre-Register Authorized Client Users
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Add client email addresses and names before they sign in. When they sign in with Google or Email/Password using their registered email, their access is activated instantly.
                  </p>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!clientEmail.trim() || !clientEmail.includes('@')) {
                      notify('Please enter a valid email address.');
                      return;
                    }
                    setRegisteringUser(true);
                    try {
                      await createClientAuthAndProfile(user.uid, {
                        email: clientEmail.trim(),
                        name: clientName.trim() || clientEmail.split('@')[0],
                        tempPassword: clientPassword.trim() || undefined,
                        companyIds: selectedCompanyIds,
                        designation: clientDesignation,
                      });
                      notify(`Client account for ${clientEmail.trim()} successfully created.`);
                      setClientEmail('');
                      setClientName('');
                      setClientPassword('');
                      setSelectedCompanyIds([]);
                    } catch (err) {
                      notify(err instanceof Error ? err.message : 'Failed to create client account.');
                    } finally {
                      setRegisteringUser(false);
                    }
                  }}
                  className="space-y-4 pt-2"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Client Email Address</label>
                      <input
                        type="email"
                        required
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="client@company.com"
                        className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Client Full Name</label>
                      <input
                        type="text"
                        required
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Eleanor Tan Wei Ling"
                        className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Temporary Password (Required, Min 6 chars)
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type={showTempPass ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={clientPassword}
                          onChange={(e) => setClientPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          className="w-full min-h-[42px] px-3.5 pr-20 rounded-lg border border-slate-300 text-sm font-mono"
                        />
                        <div className="absolute right-2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setShowTempPass(!showTempPass)}
                            className="p-1.5 text-slate-500 hover:text-[#0F172A] cursor-pointer"
                            title={showTempPass ? 'Hide password' : 'Show password'}
                          >
                            {showTempPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyPass}
                            className="p-1.5 text-slate-500 hover:text-[#0F172A] cursor-pointer"
                            title="Copy password"
                          >
                            {copiedPass ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                      <input
                        type="text"
                        value={clientDesignation}
                        onChange={(e) => setClientDesignation(e.target.value)}
                        placeholder="Board Director"
                        className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Client Companies</label>
                    <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
                      {companies.length === 0 ? (
                        <p className="text-xs text-slate-500">No client companies created yet.</p>
                      ) : (
                        companies.map((co) => (
                          <label key={co.id} className="flex items-center gap-2.5 text-xs font-medium text-[#0F172A] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedCompanyIds.includes(co.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCompanyIds((prev) => [...prev, co.id]);
                                } else {
                                  setSelectedCompanyIds((prev) => prev.filter((id) => id !== co.id));
                                }
                              }}
                              className="w-4 h-4 accent-[#0F172A]"
                            />
                            <span>{co.name} ({co.uen})</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={registeringUser}
                      className="min-h-[42px] px-5 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60 inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      {registeringUser ? 'Creating Account...' : 'Create Client Account'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Registered User Directory
                  </h3>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {authorizedUsers.length} user(s)
                  </span>
                </div>
                <div className="divide-y divide-slate-100 overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4">Name &amp; Email</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Designation</th>
                        <th className="py-3 px-4">Account Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {authorizedUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-sm text-slate-500">
                            No authorized users pre-registered yet.
                          </td>
                        </tr>
                      ) : (
                        authorizedUsers.map((u) => {
                          const isClaimed = Boolean(u.uid && u.uid.length > 0);
                          return (
                            <tr key={u.uid || u.email} className="hover:bg-slate-50/70">
                              <td className="py-3.5 px-4">
                                <p className="font-semibold text-[#0F172A]">{u.displayName}</p>
                                <p className="text-xs font-mono text-slate-500">{u.email || 'No email'}</p>
                              </td>
                              <td className="py-3.5 px-4 text-xs font-mono uppercase text-slate-700">
                                {u.role}
                              </td>
                              <td className="py-3.5 px-4 text-xs text-slate-600">
                                {u.designation || 'Board Director'}
                              </td>
                              <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                                {isClaimed ? (
                                  <span className="font-semibold text-[#059669] inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Active (Signed In)
                                  </span>
                                ) : (
                                  <span className="font-semibold text-[#D97706]">
                                    Pre-Registered (Pending Login)
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                {u.email?.toLowerCase() !== user.email?.toLowerCase() && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!window.confirm(`Permanently remove authorization for ${u.email}?`)) return;
                                      try {
                                        await deleteUserProfile(u.uid || `user_${(u.email || '').replace(/[^a-z0-9]/g, '_')}`);
                                        notify(`Removed authorization for ${u.email}`);
                                      } catch (err) {
                                        notify(err instanceof Error ? err.message : 'Failed to delete user.');
                                      }
                                    }}
                                    className="min-h-[32px] px-2.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-[#DC2626] hover:bg-red-100 cursor-pointer inline-flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Revoke
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 4: IMMUTABLE AUDIT LOGS */}
          {section === 'audit' && (
            <section className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-[#0F172A]">
                    Immutable Audit &amp; Activity Logs
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Every key action (uploads, views, downloads, signatures, and reminders) is cryptographically recorded with user identity, role, and timestamp. Log entries are tamper-proof and can only be deleted by administrators.
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Activity Ledger
                  </h3>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {auditLogs.length} record(s)
                  </span>
                </div>
                <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                  {auditLogs.length === 0 ? (
                    <p className="p-10 text-sm text-slate-500 text-center">
                      No audit log entries recorded yet.
                    </p>
                  ) : (
                    auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="px-5 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[#0F172A] px-2 py-0.5 rounded bg-slate-100">
                              {log.action}
                            </span>
                            <span className="font-semibold text-slate-700 truncate">{log.userEmail}</span>
                            <span className="text-slate-400 uppercase text-[10px] font-mono">({log.userRole})</span>
                          </div>
                          <p className="text-slate-600">{log.details}</p>
                          {log.companyName && (
                            <p className="text-[11px] text-slate-400">Company: {log.companyName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString() : 'Just now'}
                          </span>
                          {profile.role === 'admin' && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Permanently delete audit log record "${log.action}"?`)) return;
                                try {
                                  await deleteAuditLog(log.id);
                                  notify('Audit log entry deleted.');
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Failed to delete audit log.');
                                }
                              }}
                              className="min-h-[32px] px-2.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-[#DC2626] hover:bg-red-100 whitespace-nowrap cursor-pointer inline-flex items-center gap-1"
                              title="Permanently delete audit log entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>


      {showUploadModal && (
        <AdminUploadModal
          adminUid={user.uid}
          companies={companies}
          onClose={() => setShowUploadModal(false)}
          onSuccess={notify}
        />
      )}

      {showCompanyModal && (
        <NewCompanyModal
          adminUid={user.uid}
          adminEmail={profile.email || user.email || ''}
          adminName={profile.displayName}
          onClose={() => setShowCompanyModal(false)}
          onSuccess={notify}
        />
      )}

      {viewingResolution && (
        <ResolutionViewerModal
          resolution={viewingResolution}
          user={user}
          directorName={profile.displayName}
          isAdminView={true}
          onClose={() => setViewingResolution(null)}
        />
      )}
    </div>
  );
};
