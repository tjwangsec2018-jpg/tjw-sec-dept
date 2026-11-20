import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'user';

export type ResolutionCategory =
  | 'Board Resolution'
  | 'Shareholder Resolution'
  | 'AGM Notice'
  | 'Bank Mandate'
  | 'Allotment of Shares';

export type ResolutionStatus =
  | 'pending'
  | 'viewed'
  | 'partially_signed'
  | 'signed'
  | 'overdue';

export type SignatureMethod = 'e-signature' | 'wet-ink-scan';

export type NotificationType =
  | 'assignment'
  | 'escalation_7d'
  | 'escalation_3d'
  | 'escalation_48h'
  | 'manual_nudge'
  | 'signed_confirmation';

export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  phone?: string;
  role: UserRole;
  designation?: string;
  fcmToken?: string;
  notificationsEnabled?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorMethod?: 'sms' | 'email' | 'totp';
  companyIds?: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SystemSecuritySettings {
  enforceTwoFactor: boolean;
  twoFactorMethod: 'sms' | 'email' | 'totp';
  updatedBy?: string;
  updatedAt?: Timestamp;
  approvalReason?: string;
}

export interface Company {
  id: string;
  name: string;
  uen: string;
  jurisdiction: string;
  registeredAddress: string;
  incorporationDate: string;
  directorUids: string[];
  directorEmails: string[];
  directorNames: string[];
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Resolution {
  id: string;
  title: string;
  referenceCode: string;
  companyId: string;
  companyName: string;
  category: ResolutionCategory;
  summary: string;
  bodyText: string;
  pdfUrl: string;
  pdfFileName: string;
  statutoryDueDate: string;
  status: ResolutionStatus;
  assignedDirectorUids: string[];
  assignedDirectorEmails: string[];
  assignedDirectorNames: string[];
  signedByUids: string[];
  signedByEmails: string[];
  viewedByUids: string[];
  requiredSignatures: number;
  escalationSchedule: string[];
  sentEscalations: string[];
  lastNudgedAt: string;
  nudgeCount: number;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ResolutionSignature {
  id: string;
  resolutionId: string;
  directorUid: string;
  directorName: string;
  directorEmail: string;
  method: SignatureMethod;
  signatureDataUrl: string;
  signedPdfUrl: string;
  signedAt?: Timestamp;
  deviceNote: string;
}

export interface NotificationItem {
  id: string;
  recipientUid: string;
  recipientEmail: string;
  resolutionId: string;
  resolutionTitle: string;
  companyName: string;
  type: NotificationType;
  message: string;
  read: boolean;
  createdBy: string;
  createdAt?: Timestamp;
}

export interface AuditLogItem {
  id: string;
  userUid: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  details: string;
  targetId?: string;
  companyName?: string;
  createdAt?: Timestamp;
}
