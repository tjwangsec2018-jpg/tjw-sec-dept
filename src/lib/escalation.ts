import { Resolution, ResolutionStatus } from '../types';

export interface DeadlineMetrics {
  isOverdue: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  countdownLabel: string;
  effectiveStatus: ResolutionStatus;
  urgencyLevel: 'signed' | 'overdue' | 'urgent' | 'upcoming';
}

export function getDeadlineMetrics(
  statutoryDueDate: string,
  status: ResolutionStatus,
  nowMs: number = Date.now()
): DeadlineMetrics {
  if (status === 'signed') {
    return {
      isOverdue: false,
      daysRemaining: 0,
      hoursRemaining: 0,
      countdownLabel: 'Completed',
      effectiveStatus: 'signed',
      urgencyLevel: 'signed',
    };
  }

  const dueMs = new Date(`${statutoryDueDate}T23:59:59`).getTime();
  const diffMs = dueMs - nowMs;
  const hoursRemaining = Math.round(diffMs / (1000 * 60 * 60));
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    const overdueDays = Math.max(1, Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24)));
    return {
      isOverdue: true,
      daysRemaining: -overdueDays,
      hoursRemaining,
      countdownLabel:
        overdueDays === 1 ? 'Overdue by 1 day' : `Overdue by ${overdueDays} days`,
      effectiveStatus: 'overdue',
      urgencyLevel: 'overdue',
    };
  }

  if (hoursRemaining <= 48) {
    const label =
      hoursRemaining <= 1
        ? 'Due within 1 hour'
        : hoursRemaining < 24
          ? `Due in ${hoursRemaining} hours`
          : `Due in ${Math.ceil(hoursRemaining / 24)} days`;
    return {
      isOverdue: false,
      daysRemaining,
      hoursRemaining,
      countdownLabel: label,
      effectiveStatus: status,
      urgencyLevel: 'urgent',
    };
  }

  return {
    isOverdue: false,
    daysRemaining,
    hoursRemaining,
    countdownLabel: daysRemaining === 1 ? 'Due in 1 day' : `Due in ${daysRemaining} days`,
    effectiveStatus: status,
    urgencyLevel: 'upcoming',
  };
}

export function getNextEscalationLabel(resolution: Resolution): string {
  if (resolution.status === 'signed') return 'Completed';
  const sent = new Set(resolution.sentEscalations || []);
  const stages: Array<{ key: string; label: string }> = [
    { key: '7d', label: '7-day notice' },
    { key: '3d', label: '3-day reminder' },
    { key: '48h', label: '48-hour escalation' },
  ];
  const pending = stages.filter(
    (s) => (resolution.escalationSchedule || []).includes(s.key) && !sent.has(s.key)
  );
  if (pending.length === 0) return 'All stages dispatched';
  return `Next: ${pending[0].label}`;
}

export function hasDirectorSigned(
  resolution: Resolution,
  uid?: string | null,
  email?: string | null
): boolean {
  if (uid && resolution.signedByUids.includes(uid)) return true;
  if (
    email &&
    resolution.signedByEmails.some((e) => e.toLowerCase() === email.toLowerCase())
  ) {
    return true;
  }
  return false;
}

export function isDirectorAssigned(
  resolution: Resolution,
  uid?: string | null,
  email?: string | null
): boolean {
  if (uid && resolution.assignedDirectorUids.includes(uid)) return true;
  if (
    email &&
    resolution.assignedDirectorEmails.some((e) => e.toLowerCase() === email.toLowerCase())
  ) {
    return true;
  }
  return false;
}
