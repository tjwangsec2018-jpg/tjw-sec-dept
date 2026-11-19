import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
  uploadDocumentFile,
} from './firebase';
import {
  Company,
  NotificationItem,
  NotificationType,
  Resolution,
  ResolutionCategory,
  ResolutionSignature,
  ResolutionStatus,
  SignatureMethod,
  UserProfile,
  UserRole,
} from '../types';
import { generateResolutionPdfBytes } from './pdfEngine';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    const isBootstrapped =
      Boolean(user.emailVerified) &&
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      // Ensure bootstrapped admin always reflects admin role
      if (isBootstrapped && existing.role !== 'admin') {
        await updateDoc(ref, {
          role: 'admin',
          updatedAt: serverTimestamp(),
        });
        return { ...existing, role: 'admin' };
      }
      return existing;
    }

    // Check /admins/{uid} marker
    let role: UserRole = isBootstrapped ? 'admin' : 'director';
    if (!isBootstrapped && user.emailVerified) {
      try {
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        if (adminSnap.exists()) role = 'admin';
      } catch {
        // Not an admin
      }
    }

    const displayName = clampString(
      user.displayName || user.email?.split('@')[0] || user.phoneNumber || 'Board Director',
      120
    );

    const profilePayload: Record<string, unknown> = {
      uid: user.uid,
      displayName,
      role,
      designation: role === 'admin' ? 'Managing Corporate Secretary' : 'Board Director',
      fcmToken: '',
      notificationsEnabled:
        typeof Notification !== 'undefined' && Notification.permission === 'granted',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (user.email) profilePayload.email = clampString(user.email.toLowerCase(), 160);
    if (user.phoneNumber) profilePayload.phone = clampString(user.phoneNumber, 32);

    // Only attempt Firestore write if user is verified (email_verified or phone auth)
    if (user.emailVerified || user.phoneNumber) {
      await setDoc(ref, profilePayload);
    }

    return {
      uid: user.uid,
      displayName,
      email: user.email?.toLowerCase() || undefined,
      phone: user.phoneNumber || undefined,
      role,
      designation: profilePayload.designation as string,
      fcmToken: '',
      notificationsEnabled: profilePayload.notificationsEnabled as boolean,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateUserNotificationSettings(
  uid: string,
  fcmToken: string,
  notificationsEnabled: boolean
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      fcmToken: clampString(fcmToken, 512),
      notificationsEnabled,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeCompanies(
  user: User,
  role: UserRole,
  onData: (companies: Company[]) => void
): Unsubscribe {
  const colRef = collection(db, 'companies');

  if (role === 'admin') {
    const q =
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
        ? colRef
        : query(colRef, where('createdBy', '==', user.uid));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Company, 'id'>) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        onData(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'companies')
    );
  }

  // Director: merge UID-assigned and verified-email-assigned queries
  const map = new Map<string, Company>();
  const emit = () =>
    onData(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));

  const unsubs: Unsubscribe[] = [];

  const qUid = query(colRef, where('directorUids', 'array-contains', user.uid));
  unsubs.push(
    onSnapshot(
      qUid,
      (snap) => {
        snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...(d.data() as Omit<Company, 'id'>) }));
        emit();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'companies')
    )
  );

  if (user.email && user.emailVerified) {
    const qEmail = query(
      colRef,
      where('directorEmails', 'array-contains', user.email.toLowerCase())
    );
    unsubs.push(
      onSnapshot(
        qEmail,
        (snap) => {
          snap.docs.forEach((d) =>
            map.set(d.id, { id: d.id, ...(d.data() as Omit<Company, 'id'>) })
          );
          emit();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'companies')
      )
    );
  }

  return () => unsubs.forEach((u) => u());
}

export function subscribeResolutions(
  user: User,
  role: UserRole,
  onData: (resolutions: Resolution[]) => void
): Unsubscribe {
  const colRef = collection(db, 'resolutions');

  if (role === 'admin') {
    const q =
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
        ? colRef
        : query(colRef, where('createdBy', '==', user.uid));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Resolution, 'id'>) }))
          .sort((a, b) => a.statutoryDueDate.localeCompare(b.statutoryDueDate));
        onData(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'resolutions')
    );
  }

  const byUid = new Map<string, Resolution>();
  const byEmail = new Map<string, Resolution>();
  const emit = () => {
    const merged = new Map<string, Resolution>([...byUid, ...byEmail]);
    onData(
      Array.from(merged.values()).sort((a, b) =>
        a.statutoryDueDate.localeCompare(b.statutoryDueDate)
      )
    );
  };

  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      query(colRef, where('assignedDirectorUids', 'array-contains', user.uid)),
      (snap) => {
        byUid.clear();
        snap.docs.forEach((d) =>
          byUid.set(d.id, { id: d.id, ...(d.data() as Omit<Resolution, 'id'>) })
        );
        emit();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'resolutions')
    )
  );

  if (user.email && user.emailVerified) {
    unsubs.push(
      onSnapshot(
        query(colRef, where('assignedDirectorEmails', 'array-contains', user.email.toLowerCase())),
        (snap) => {
          byEmail.clear();
          snap.docs.forEach((d) =>
            byEmail.set(d.id, { id: d.id, ...(d.data() as Omit<Resolution, 'id'>) })
          );
          emit();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'resolutions')
      )
    );
  }

  return () => unsubs.forEach((u) => u());
}

export function subscribeNotifications(
  user: User,
  role: UserRole,
  onData: (items: NotificationItem[]) => void
): Unsubscribe {
  const colRef = collection(db, 'notifications');

  if (role === 'admin') {
    const q =
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
        ? colRef
        : query(colRef, where('createdBy', '==', user.uid));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
          .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
        onData(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );
  }

  const byUid = new Map<string, NotificationItem>();
  const byEmail = new Map<string, NotificationItem>();
  const emit = () => {
    const merged = new Map<string, NotificationItem>([...byUid, ...byEmail]);
    onData(
      Array.from(merged.values()).sort(
        (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)
      )
    );
  };

  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      query(colRef, where('recipientUid', '==', user.uid)),
      (snap) => {
        byUid.clear();
        snap.docs.forEach((d) =>
          byUid.set(d.id, { id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) })
        );
        emit();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    )
  );

  if (user.email && user.emailVerified) {
    unsubs.push(
      onSnapshot(
        query(colRef, where('recipientEmail', '==', user.email.toLowerCase())),
        (snap) => {
          byEmail.clear();
          snap.docs.forEach((d) =>
            byEmail.set(d.id, { id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) })
          );
          emit();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );
  }

  return () => unsubs.forEach((u) => u());
}

export function subscribeResolutionSignatures(
  resolutionId: string,
  user: User,
  isAdminView: boolean,
  onData: (signatures: ResolutionSignature[]) => void
): Unsubscribe {
  const subRef = collection(db, 'resolutions', resolutionId, 'signatures');
  const q = isAdminView
    ? subRef
    : query(subRef, where('directorUid', '==', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ResolutionSignature, 'id'>) }))
        .sort((a, b) => (a.signedAt?.toMillis() ?? 0) - (b.signedAt?.toMillis() ?? 0));
      onData(list);
    },
    (err) =>
      handleFirestoreError(err, OperationType.LIST, `resolutions/${resolutionId}/signatures`)
  );
}

export interface CreateCompanyInput {
  name: string;
  uen: string;
  jurisdiction: string;
  registeredAddress: string;
  incorporationDate: string;
  directors: Array<{ uid?: string; name: string; email: string }>;
}

export async function createCompany(
  adminUid: string,
  input: CreateCompanyInput
): Promise<string> {
  const companyId = makeSafeId('co');
  const path = `companies/${companyId}`;
  const cleanUen = input.uen.toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 40) || '202600001A';
  const directors = input.directors.slice(0, 20);

  const payload = {
    name: clampString(input.name, 160),
    uen: cleanUen,
    jurisdiction: clampString(input.jurisdiction, 80),
    registeredAddress: clampString(input.registeredAddress, 240),
    incorporationDate: clampString(input.incorporationDate, 20),
    directorUids: directors.map((d) => d.uid).filter(Boolean) as string[],
    directorEmails: directors.map((d) => clampString(d.email.toLowerCase(), 160)),
    directorNames: directors.map((d) => clampString(d.name, 120)),
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'companies', companyId), payload);
    return companyId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export interface CreateResolutionInput {
  title: string;
  referenceCode: string;
  company: Company;
  category: ResolutionCategory;
  summary: string;
  bodyText: string;
  statutoryDueDate: string;
  uploadedPdfBytes?: Uint8Array | null;
  uploadedFileName?: string;
  assignedDirectors: Array<{ uid?: string; name: string; email: string }>;
  escalationSchedule: string[];
}

export async function createResolutionAndNotify(
  adminUid: string,
  input: CreateResolutionInput
): Promise<string> {
  const resolutionId = makeSafeId('res');
  const path = `resolutions/${resolutionId}`;

  const refCode =
    input.referenceCode
      .toUpperCase()
      .replace(/[^A-Z0-9\-]/g, '')
      .slice(0, 40) || `RES-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

  const directors = input.assignedDirectors.slice(0, 20);
  const pdfBytes =
    input.uploadedPdfBytes && input.uploadedPdfBytes.length > 0
      ? input.uploadedPdfBytes
      : await generateResolutionPdfBytes({
          referenceCode: refCode,
          companyName: input.company.name,
          companyUen: input.company.uen,
          jurisdiction: input.company.jurisdiction,
          category: input.category,
          title: input.title,
          statutoryDueDate: input.statutoryDueDate,
          summary: input.summary,
          bodyText: input.bodyText,
          directorNames: directors.map((d) => d.name),
        });

  const fileName = clampString(
    input.uploadedFileName || `${refCode}_${input.company.uen}.pdf`,
    200
  );
  const { url: pdfUrl } = await uploadDocumentFile(pdfBytes, fileName, 'application/pdf');

  const dueMs = new Date(`${input.statutoryDueDate}T23:59:59`).getTime();
  const initialStatus: ResolutionStatus = dueMs < Date.now() ? 'overdue' : 'pending';

  const resolutionPayload = {
    title: clampString(input.title, 200),
    referenceCode: refCode,
    companyId: input.company.id,
    companyName: clampString(input.company.name, 160),
    category: input.category,
    summary: clampString(input.summary, 2000),
    bodyText: clampString(input.bodyText, 15000),
    pdfUrl: clampString(pdfUrl, 2000),
    pdfFileName: fileName,
    statutoryDueDate: clampString(input.statutoryDueDate, 30),
    status: initialStatus,
    assignedDirectorUids: directors.map((d) => d.uid).filter(Boolean) as string[],
    assignedDirectorEmails: directors.map((d) => clampString(d.email.toLowerCase(), 160)),
    assignedDirectorNames: directors.map((d) => clampString(d.name, 120)),
    signedByUids: [] as string[],
    signedByEmails: [] as string[],
    viewedByUids: [] as string[],
    requiredSignatures: Math.max(1, directors.length),
    escalationSchedule: input.escalationSchedule.slice(0, 5),
    sentEscalations: [] as string[],
    lastNudgedAt: '',
    nudgeCount: 0,
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'resolutions', resolutionId), resolutionPayload);

    // Create notification items for every assigned director
    const notifPromises = directors.map((director) => {
      const notifId = makeSafeId('ntf');
      return setDoc(doc(db, 'notifications', notifId), {
        recipientUid: director.uid || '',
        recipientEmail: clampString(director.email.toLowerCase(), 160),
        resolutionId,
        resolutionTitle: clampString(input.title, 200),
        companyName: clampString(input.company.name, 160),
        type: 'assignment' as NotificationType,
        message: clampString(
          `New ${input.category} assigned for ${input.company.name}. Statutory deadline: ${input.statutoryDueDate}.`,
          500
        ),
        read: false,
        createdBy: adminUid,
        createdAt: serverTimestamp(),
      });
    });
    await Promise.all(notifPromises);

    // Dispatch instant push notification via Node.js API
    await fetch('/api/push/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients: directors.map((d) => ({ email: d.email, name: d.name })),
        title: `Action Required: ${input.company.name}`,
        body: `${input.title} — Due ${input.statutoryDueDate}`,
        resolutionId,
        pendingCount: 1,
        triggerType: 'assignment',
      }),
    }).catch(() => {});

    return resolutionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function markResolutionViewed(resolution: Resolution, user: User): Promise<void> {
  if (resolution.status === 'signed') return;
  if (resolution.viewedByUids.includes(user.uid)) return;

  const path = `resolutions/${resolution.id}`;
  const nextViewed = Array.from(new Set([...resolution.viewedByUids, user.uid])).slice(0, 20);
  const nextStatus: ResolutionStatus =
    resolution.status === 'pending' ? 'viewed' : resolution.status;

  try {
    await updateDoc(doc(db, 'resolutions', resolution.id), {
      viewedByUids: nextViewed,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function signResolutionAtomically(params: {
  resolution: Resolution;
  user: User;
  directorName: string;
  method: SignatureMethod;
  signatureDataUrl: string;
  stampedPdfUrl: string;
}): Promise<void> {
  const { resolution, user, directorName, method, signatureDataUrl, stampedPdfUrl } = params;
  const path = `resolutions/${resolution.id}`;

  const directorEmail = clampString(
    (user.email || `${user.uid}@director.quorumseal.local`).toLowerCase(),
    160
  );
  const nextSignedUids = Array.from(new Set([...resolution.signedByUids, user.uid])).slice(0, 20);
  const nextSignedEmails = Array.from(
    new Set([...resolution.signedByEmails, directorEmail])
  ).slice(0, 20);
  const nextViewedUids = Array.from(new Set([...resolution.viewedByUids, user.uid])).slice(0, 20);

  const uniqueSignersCount = Math.max(nextSignedUids.length, nextSignedEmails.length);
  const isNowComplete = uniqueSignersCount >= resolution.requiredSignatures;
  const nextStatus: ResolutionStatus = isNowComplete ? 'signed' : 'partially_signed';

  const sigId = makeSafeId('sig');
  const deviceNote = clampString(
    `${method === 'e-signature' ? 'Touch E-Sign' : 'Wet-Ink Scan'} · ${navigator.platform || 'Web PWA'}`,
    200
  );

  try {
    const batch = writeBatch(db);

    // 1. Atomic parent resolution update (required by getAfter() Pillar 7)
    batch.update(doc(db, 'resolutions', resolution.id), {
      signedByUids: nextSignedUids,
      signedByEmails: nextSignedEmails,
      viewedByUids: nextViewedUids,
      status: nextStatus,
      pdfUrl: clampString(stampedPdfUrl || resolution.pdfUrl, 2000),
      updatedAt: serverTimestamp(),
    });

    // 2. Immutable signature record in subcollection
    batch.set(doc(db, 'resolutions', resolution.id, 'signatures', sigId), {
      resolutionId: resolution.id,
      directorUid: user.uid,
      directorName: clampString(directorName, 120),
      directorEmail,
      method,
      signatureDataUrl: signatureDataUrl.slice(0, 290000),
      signedPdfUrl: clampString(stampedPdfUrl || resolution.pdfUrl, 2000),
      signedAt: serverTimestamp(),
      deviceNote,
    });

    await batch.commit();

    // 3. Emit confirmation notification
    const notifId = makeSafeId('ntf');
    await setDoc(doc(db, 'notifications', notifId), {
      recipientUid: resolution.createdBy,
      recipientEmail: BOOTSTRAPPED_ADMIN_EMAIL,
      resolutionId: resolution.id,
      resolutionTitle: resolution.title,
      companyName: resolution.companyName,
      type: 'signed_confirmation' as NotificationType,
      message: clampString(
        `${directorName} executed "${resolution.title}" (${uniqueSignersCount} of ${resolution.requiredSignatures} signed).`,
        500
      ),
      read: false,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function sendManualPushNudge(
  resolution: Resolution,
  adminUid: string
): Promise<{ nudgedCount: number }> {
  const signedSet = new Set(resolution.signedByEmails.map((e) => e.toLowerCase()));
  const unsignedEmails = resolution.assignedDirectorEmails.filter(
    (email) => !signedSet.has(email.toLowerCase())
  );

  if (unsignedEmails.length === 0) {
    return { nudgedCount: 0 };
  }

  const nowIso = new Date().toISOString();
  const path = `resolutions/${resolution.id}`;

  try {
    await updateDoc(doc(db, 'resolutions', resolution.id), {
      lastNudgedAt: nowIso,
      nudgeCount: Math.min(500, (resolution.nudgeCount || 0) + 1),
      updatedAt: serverTimestamp(),
    });

    await Promise.all(
      unsignedEmails.map((email) => {
        const idx = resolution.assignedDirectorEmails.findIndex(
          (e) => e.toLowerCase() === email.toLowerCase()
        );
        const uid = resolution.assignedDirectorUids[idx] || '';
        const notifId = makeSafeId('ntf');
        return setDoc(doc(db, 'notifications', notifId), {
          recipientUid: uid,
          recipientEmail: email.toLowerCase(),
          resolutionId: resolution.id,
          resolutionTitle: resolution.title,
          companyName: resolution.companyName,
          type: 'manual_nudge' as NotificationType,
          message: clampString(
            `Reminder from Company Secretary: Please review and execute "${resolution.title}" for ${resolution.companyName} (Due ${resolution.statutoryDueDate}).`,
            500
          ),
          read: false,
          createdBy: adminUid,
          createdAt: serverTimestamp(),
        });
      })
    );

    await fetch('/api/push/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients: unsignedEmails.map((email) => ({ email })),
        title: `Reminder: ${resolution.companyName}`,
        body: `Signature pending on "${resolution.title}" (Due ${resolution.statutoryDueDate})`,
        resolutionId: resolution.id,
        pendingCount: 1,
        triggerType: 'manual_nudge',
      }),
    }).catch(() => {});

    return { nudgedCount: unsignedEmails.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function runAutomatedEscalationSweep(
  resolutions: Resolution[],
  adminUid: string
): Promise<{ dispatchedCount: number; summary: string }> {
  const res = await fetch('/api/escalations/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolutions }),
  });

  if (!res.ok) {
    throw new Error('Failed to evaluate escalation schedule.');
  }

  const data = (await res.json()) as {
    dueEscalations: Array<{
      resolutionId: string;
      title: string;
      companyName: string;
      stage: NotificationType;
      stageKey: string;
      unsignedEmails: string[];
      message: string;
    }>;
  };

  let dispatchedCount = 0;

  for (const esc of data.dueEscalations) {
    const targetRes = resolutions.find((r) => r.id === esc.resolutionId);
    if (!targetRes) continue;

    const nextSent = Array.from(new Set([...(targetRes.sentEscalations || []), esc.stageKey])).slice(
      0,
      10
    );

    try {
      await updateDoc(doc(db, 'resolutions', targetRes.id), {
        sentEscalations: nextSent,
        lastNudgedAt: new Date().toISOString(),
        nudgeCount: Math.min(500, (targetRes.nudgeCount || 0) + 1),
        updatedAt: serverTimestamp(),
      });

      await Promise.all(
        esc.unsignedEmails.map((email) => {
          const notifId = makeSafeId('ntf');
          return setDoc(doc(db, 'notifications', notifId), {
            recipientUid: '',
            recipientEmail: email.toLowerCase(),
            resolutionId: targetRes.id,
            resolutionTitle: targetRes.title,
            companyName: targetRes.companyName,
            type: esc.stage,
            message: clampString(esc.message, 500),
            read: false,
            createdBy: adminUid,
            createdAt: serverTimestamp(),
          });
        })
      );

      await fetch('/api/push/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: esc.unsignedEmails.map((email) => ({ email })),
          title: `Statutory Escalation: ${esc.companyName}`,
          body: esc.message,
          resolutionId: esc.resolutionId,
          pendingCount: 1,
          triggerType: esc.stage,
        }),
      }).catch(() => {});

      dispatchedCount += esc.unsignedEmails.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `resolutions/${targetRes.id}`);
    }
  }

  return {
    dispatchedCount,
    summary:
      dispatchedCount > 0
        ? `Dispatched ${dispatchedCount} scheduled escalation alert(s) across ${data.dueEscalations.length} resolution(s).`
        : 'All resolutions are up to date with the 7d / 3d / 48h escalation schedule.',
  };
}

export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

function isoDateOffset(daysOffset: number): string {
  const d = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Seeds a realistic executive corporate portfolio (3 client companies + 4 statutory resolutions
 * with real generated PDFs) into Firestore so the user can test every workflow immediately.
 */
export async function seedSamplePortfolio(adminUser: User): Promise<void> {
  const adminEmail = (adminUser.email || BOOTSTRAPPED_ADMIN_EMAIL).toLowerCase();
  const adminName = adminUser.displayName || 'Managing Director';

  const co1Id = await createCompany(adminUser.uid, {
    name: 'Meridian Precision Holdings Pte. Ltd.',
    uen: '201824910K',
    jurisdiction: 'Singapore (ACRA)',
    registeredAddress: '10 Marina Boulevard, #34-02 Marina Bay Financial Centre, Singapore 018983',
    incorporationDate: '2018-07-14',
    directors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'Eleanor Tan Wei Ling', email: 'eleanor.tan@meridian-holdings.sg' },
    ],
  });

  const co2Id = await createCompany(adminUser.uid, {
    name: 'Harbourview Capital Partners Ltd.',
    uen: '202011842D',
    jurisdiction: 'Hong Kong (CR)',
    registeredAddress: 'Suite 4108, Two International Finance Centre, 8 Finance Street, Central',
    incorporationDate: '2020-03-02',
    directors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'Marcus Chen Jianhui', email: 'm.chen@harbourviewcap.hk' },
      { name: 'Priya Nair', email: 'priya.nair@harbourviewcap.hk' },
    ],
  });

  const co3Id = await createCompany(adminUser.uid, {
    name: 'Straitline Maritime Logistics Pte. Ltd.',
    uen: '201509321R',
    jurisdiction: 'Singapore (ACRA)',
    registeredAddress: '80 Robinson Road, #19-01, Singapore 068898',
    incorporationDate: '2015-11-20',
    directors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'David Lim Kah Seng', email: 'd.lim@straitline.com.sg' },
    ],
  });

  const companiesMap: Record<string, Company> = {
    co1: {
      id: co1Id,
      name: 'Meridian Precision Holdings Pte. Ltd.',
      uen: '201824910K',
      jurisdiction: 'Singapore (ACRA)',
      registeredAddress: '10 Marina Boulevard, #34-02, Singapore 018983',
      incorporationDate: '2018-07-14',
      directorUids: [adminUser.uid],
      directorEmails: [adminEmail, 'eleanor.tan@meridian-holdings.sg'],
      directorNames: [adminName, 'Eleanor Tan Wei Ling'],
      createdBy: adminUser.uid,
    },
    co2: {
      id: co2Id,
      name: 'Harbourview Capital Partners Ltd.',
      uen: '202011842D',
      jurisdiction: 'Hong Kong (CR)',
      registeredAddress: 'Suite 4108, Two IFC, Central',
      incorporationDate: '2020-03-02',
      directorUids: [adminUser.uid],
      directorEmails: [adminEmail, 'm.chen@harbourviewcap.hk', 'priya.nair@harbourviewcap.hk'],
      directorNames: [adminName, 'Marcus Chen Jianhui', 'Priya Nair'],
      createdBy: adminUser.uid,
    },
    co3: {
      id: co3Id,
      name: 'Straitline Maritime Logistics Pte. Ltd.',
      uen: '201509321R',
      jurisdiction: 'Singapore (ACRA)',
      registeredAddress: '80 Robinson Road, #19-01, Singapore 068898',
      incorporationDate: '2015-11-20',
      directorUids: [adminUser.uid],
      directorEmails: [adminEmail, 'd.lim@straitline.com.sg'],
      directorNames: [adminName, 'David Lim Kah Seng'],
      createdBy: adminUser.uid,
    },
  };

  // 1. Overdue Resolution (Overdue by 3 days)
  await createResolutionAndNotify(adminUser.uid, {
    title: 'Approval of FY2026 Audited Financial Statements & Annual Return Filing',
    referenceCode: 'RES-2026-104',
    company: companiesMap.co1,
    category: 'Board Resolution',
    summary:
      'Approval of the statutory audited financial statements for the financial year ended 30 June 2026 and authorisation to lodge the Annual Return with ACRA.',
    bodyText: `DIRECTORS' RESOLUTIONS IN WRITING PASSED PURSUANT TO THE CONSTITUTION OF MERIDIAN PRECISION HOLDINGS PTE. LTD.

1. APPROVAL OF AUDITED FINANCIAL STATEMENTS
IT WAS NOTED that the Directors' Statement and Audited Financial Statements of the Company for the financial year ended 30 June 2026 had been circulated to all Directors for review together with the Independent Auditor's Report issued by KPMG LLP.

RESOLVED THAT:
(a) The Audited Financial Statements of the Company for the financial year ended 30 June 2026 be and are hereby approved and adopted;
(b) Any two Directors of the Company be and are hereby authorised to sign the Statement by Directors on behalf of the Board; and
(c) The Company Secretary be and is hereby instructed to file the Annual Return and XBRL financial statements with the Accounting and Corporate Regulatory Authority (ACRA) within the statutory timeframe.

2. AUTHORISATION OF EXECUTION
RESOLVED THAT this resolution may be executed in any number of counterparts, including by electronic signature or scanned wet-ink signature, each of which shall be deemed an original and all of which together shall constitute one and the same instrument.`,
    statutoryDueDate: isoDateOffset(-3),
    assignedDirectors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'Eleanor Tan Wei Ling', email: 'eleanor.tan@meridian-holdings.sg' },
    ],
    escalationSchedule: ['7d', '3d', '48h'],
  });

  // 2. Partially Signed Resolution (Due in 2 days, 1 of 2 directors signed)
  const partialResId = await createResolutionAndNotify(adminUser.uid, {
    title: 'Opening of Multi-Currency Corporate Treasury Account & Bank Mandate',
    referenceCode: 'RES-2026-108',
    company: companiesMap.co3,
    category: 'Bank Mandate',
    summary:
      'Authorisation to open a USD/SGD corporate treasury facility with DBS Institutional Banking and designate dual-signatory mandate limits.',
    bodyText: `DIRECTORS' RESOLUTIONS IN WRITING — STRAITLINE MARITIME LOGISTICS PTE. LTD.

1. ESTABLISHMENT OF CORPORATE TREASURY FACILITY
RESOLVED THAT an application be made to DBS Bank Ltd ("the Bank") for the opening and operation of a Multi-Currency Corporate Treasury Account in the name of the Company.

2. AUTHORISED SIGNATORIES & MANDATE LIMITS
RESOLVED THAT:
(a) Transactions up to SGD 100,000 may be authorised singly by any Executive Director;
(b) Transactions exceeding SGD 100,000 shall require joint electronic or written authorisation by any two Directors of the Board; and
(c) The Company Secretary be authorised to deliver certified true extracts of this resolution to the Bank.`,
    statutoryDueDate: isoDateOffset(2),
    assignedDirectors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'David Lim Kah Seng', email: 'd.lim@straitline.com.sg' },
    ],
    escalationSchedule: ['7d', '3d', '48h'],
  });

  // Mark co-director as already signed so Peer Accountability shows "1 of 2 Directors have signed"
  await updateDoc(doc(db, 'resolutions', partialResId), {
    signedByEmails: ['d.lim@straitline.com.sg'],
    status: 'partially_signed',
    sentEscalations: ['7d', '3d'],
    updatedAt: serverTimestamp(),
  });

  // 3. Upcoming Pending Resolution (Due in 6 days, 3 directors)
  await createResolutionAndNotify(adminUser.uid, {
    title: 'Allotment and Issue of 500,000 Series B Preference Shares',
    referenceCode: 'RES-2026-112',
    company: companiesMap.co2,
    category: 'Allotment of Shares',
    summary:
      'Board approval for the allotment of 500,000 Series B Preference Shares pursuant to the Subscription Agreement and updating of the Register of Members.',
    bodyText: `DIRECTORS' RESOLUTIONS IN WRITING — HARBOURVIEW CAPITAL PARTNERS LTD.

1. ALLOTMENT OF SERIES B PREFERENCE SHARES
IT WAS NOTED that the Company has received cleared subscription funds in full pursuant to the Series B Subscription Agreement dated 10 November 2026.

RESOLVED THAT:
(a) 500,000 fully paid Series B Preference Shares in the capital of the Company be and are hereby allotted and issued to the subscribers listed in Schedule A;
(b) Share certificates be issued under the common seal or authorised execution of the Company; and
(c) The Company Secretary be instructed to update the Electronic Register of Members and lodge the Return of Allotment within 14 days.`,
    statutoryDueDate: isoDateOffset(6),
    assignedDirectors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'Marcus Chen Jianhui', email: 'm.chen@harbourviewcap.hk' },
      { name: 'Priya Nair', email: 'priya.nair@harbourviewcap.hk' },
    ],
    escalationSchedule: ['7d', '3d', '48h'],
  });

  // 4. Signed Archive Resolution (Completed)
  const completedId = await createResolutionAndNotify(adminUser.uid, {
    title: 'Re-Appointment of External Auditors & Interim Dividend Declaration',
    referenceCode: 'RES-2026-091',
    company: companiesMap.co1,
    category: 'Shareholder Resolution',
    summary:
      'Declaration of a one-tier tax-exempt interim dividend of SGD 0.04 per ordinary share and confirmation of external auditor engagement.',
    bodyText: `WRITTEN RESOLUTION OF THE MEMBERS & DIRECTORS — MERIDIAN PRECISION HOLDINGS PTE. LTD.

RESOLVED THAT:
(a) An interim one-tier tax-exempt dividend of SGD 0.04 per ordinary share be declared payable to members registered as at 30 October 2026;
(b) KPMG LLP be re-appointed as external auditors of the Company until the conclusion of the next Annual General Meeting.`,
    statutoryDueDate: isoDateOffset(-14),
    assignedDirectors: [
      { uid: adminUser.uid, name: adminName, email: adminEmail },
      { name: 'Eleanor Tan Wei Ling', email: 'eleanor.tan@meridian-holdings.sg' },
    ],
    escalationSchedule: ['7d', '3d', '48h'],
  });

  await updateDoc(doc(db, 'resolutions', completedId), {
    signedByUids: [adminUser.uid],
    signedByEmails: [adminEmail, 'eleanor.tan@meridian-holdings.sg'],
    viewedByUids: [adminUser.uid],
    status: 'signed',
    sentEscalations: ['7d', '3d', '48h'],
    updatedAt: serverTimestamp(),
  });
}
