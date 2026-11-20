import { User } from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut as signOutAuth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
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
  AuditLogItem,
  NotificationItem,
  NotificationType,
  Resolution,
  ResolutionCategory,
  ResolutionSignature,
  ResolutionStatus,
  SignatureMethod,
  UserProfile,
  UserRole,
  SystemSecuritySettings,
} from '../types';
import { generateResolutionPdfBytes } from './pdfEngine';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export async function countAdmins(): Promise<number> {
  try {
    const q = query(collection(db, 'users'), where('role', '==', 'admin'));
    const snap = await getDocs(q);
    return snap.size;
  } catch {
    return 0;
  }
}

export async function ensureUserProfile(user: User, loginTab: 'user' | 'admin' = 'user'): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const emailLower = (user.email || '').toLowerCase().trim();
  const isBootstrapped = emailLower === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
  const totalAdmins = await countAdmins();

  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      let finalRole = existing.role;

      if (isBootstrapped) {
        finalRole = 'admin';
      } else if (loginTab === 'admin' && totalAdmins === 0) {
        finalRole = 'admin';
      } else if (loginTab === 'admin' && existing.role !== 'admin' && totalAdmins > 0) {
        throw new Error('Access denied. Administrator privileges required.');
      }

      if (finalRole !== existing.role) {
        await updateDoc(ref, {
          role: finalRole,
          updatedAt: serverTimestamp(),
        });
        return { ...existing, role: finalRole };
      }
      return existing;
    }

    // If logging in as admin tab
    if (loginTab === 'admin') {
      let role: UserRole = 'user';
      if (isBootstrapped || totalAdmins === 0) {
        role = 'admin';
      } else {
        // Check if user email exists in users collection with admin role
        const qEmail = query(collection(db, 'users'), where('email', '==', emailLower));
        const emailSnap = await getDocs(qEmail);
        let foundAdmin = false;
        emailSnap.forEach((d) => {
          if ((d.data() as UserProfile).role === 'admin') foundAdmin = true;
        });
        role = foundAdmin ? 'admin' : 'user';
      }

      if (role !== 'admin') {
        throw new Error('Access denied. Administrator privileges required.');
      }

      const displayName = clampString(
        user.displayName || emailLower.split('@')[0] || 'Admin',
        120
      );
      const profilePayload = {
        uid: user.uid,
        displayName,
        email: emailLower,
        role,
        designation: 'Managing Corporate Secretary',
        fcmToken: '',
        notificationsEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, profilePayload);
      return {
        uid: user.uid,
        displayName,
        email: emailLower,
        role,
        designation: profilePayload.designation,
        fcmToken: '',
        notificationsEnabled: false,
      };
    }

    // Logging in as user tab: search pre-registered users collection by email
    if (emailLower) {
      const qEmail = query(collection(db, 'users'), where('email', '==', emailLower));
      const emailSnap = await getDocs(qEmail);

      if (!emailSnap.empty) {
        const docSnap = emailSnap.docs[0];
        const existing = docSnap.data() as UserProfile;
        const preRegRef = doc(db, 'users', docSnap.id);

        const updatedPayload = {
          uid: user.uid,
          displayName: clampString(user.displayName || existing.displayName || emailLower.split('@')[0], 120),
          updatedAt: serverTimestamp(),
        };
        await updateDoc(preRegRef, updatedPayload);

        return {
          ...existing,
          uid: user.uid,
          displayName: updatedPayload.displayName,
          email: emailLower,
        };
      }
    }

    if (isBootstrapped || totalAdmins === 0) {
      const role: UserRole = 'admin';
      const displayName = clampString(user.displayName || emailLower.split('@')[0] || 'User', 120);
      const profilePayload = {
        uid: user.uid,
        displayName,
        email: emailLower,
        role,
        designation: 'Managing Corporate Secretary',
        fcmToken: '',
        notificationsEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, profilePayload);
      return {
        uid: user.uid,
        displayName,
        email: emailLower,
        role,
        designation: 'Managing Corporate Secretary',
        fcmToken: '',
        notificationsEnabled: false,
      };
    }

    throw new Error('Access denied. Your email address has not been registered by the Administrator.');
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Access denied') || error.message.includes('not registered'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function createClientAuthAndProfile(
  adminUid: string,
  input: {
    email: string;
    name: string;
    tempPassword?: string;
    companyIds: string[];
    designation?: string;
  }
): Promise<string> {
  const emailLower = input.email.toLowerCase().trim();
  const nameTrim = input.name.trim() || emailLower.split('@')[0];
  const companyIds = input.companyIds || [];

  let newUid = `user_${emailLower.replace(/[^a-z0-9]/g, '_')}`;

  if (input.tempPassword && input.tempPassword.length >= 6) {
    const secondaryAppName = `SecondaryUserCreator_${Date.now()}`;
    const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, emailLower, input.tempPassword);
      newUid = cred.user.uid;
      await signOutAuth(secondaryAuth);
      await deleteApp(secondaryApp);
    } catch (err) {
      try {
        await deleteApp(secondaryApp);
      } catch {}
      throw err;
    }
  }

  const userRef = doc(db, 'users', newUid);
  await setDoc(userRef, {
    uid: newUid,
    email: emailLower,
    displayName: clampString(nameTrim, 120),
    role: 'user',
    companyIds,
    designation: clampString(input.designation || 'Board Director', 120),
    fcmToken: '',
    notificationsEnabled: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return newUid;
}

export async function preRegisterAuthorizedUser(
  adminUid: string,
  input: { email: string; displayName: string; designation?: string }
): Promise<void> {
  const emailLower = input.email.toLowerCase().trim();
  const userDocId = `user_${emailLower.replace(/[^a-z0-9]/g, '_')}`;
  const path = `users/${userDocId}`;
  try {
    await setDoc(doc(db, 'users', userDocId), {
      uid: '',
      displayName: clampString(input.displayName, 120),
      email: emailLower,
      role: 'user',
      designation: clampString(input.designation || 'Board Director', 120),
      fcmToken: '',
      notificationsEnabled: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteUserProfile(userId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', userId));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
}

export function subscribeUsers(
  onData: (users: UserProfile[]) => void
): Unsubscribe {
  const colRef = collection(db, 'users');
  return onSnapshot(
    colRef,
    (snap) => {
      const list = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'users')
  );
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

export async function deleteCompany(companyId: string, companyName: string, user: User, role: UserRole): Promise<void> {
  const path = `companies/${companyId}`;
  try {
    await deleteDoc(doc(db, 'companies', companyId));
    await recordAuditLog({
      user,
      role,
      action: 'COMPANY_DELETED',
      details: `Permanent deletion of client company ${companyName}`,
      targetId: companyId,
      companyName,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteResolution(resolutionId: string, resolutionTitle: string, companyName: string, user: User, role: UserRole): Promise<void> {
  const path = `resolutions/${resolutionId}`;
  try {
    await deleteDoc(doc(db, 'resolutions', resolutionId));
    await recordAuditLog({
      user,
      role,
      action: 'RESOLUTION_DELETED',
      details: `Permanent deletion of resolution "${resolutionTitle}"`,
      targetId: resolutionId,
      companyName,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function recordAuditLog(params: {
  user: User;
  role: UserRole;
  action: string;
  details: string;
  targetId?: string;
  companyName?: string;
}): Promise<void> {
  const { user, role, action, details, targetId, companyName } = params;
  const logId = makeSafeId('log');
  const userEmail = clampString(user.email || `${user.uid}@quorumseal.local`, 160);
  try {
    await setDoc(doc(db, 'audit_logs', logId), {
      userUid: user.uid,
      userEmail,
      userRole: role,
      action: clampString(action, 80),
      details: clampString(details, 500),
      targetId: targetId ? clampString(targetId, 64) : '',
      companyName: companyName ? clampString(companyName, 160) : '',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Failed to record audit log:', err);
  }
}

export function subscribeAuditLogs(
  user: User,
  role: UserRole,
  onData: (logs: AuditLogItem[]) => void
): Unsubscribe {
  const colRef = collection(db, 'audit_logs');
  const q = role === 'admin'
    ? colRef
    : query(colRef, where('userUid', '==', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogItem, 'id'>) }))
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
  );
}

export async function deleteAuditLog(logId: string): Promise<void> {
  const path = `audit_logs/${logId}`;
  try {
    await deleteDoc(doc(db, 'audit_logs', logId));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeSystemSecuritySettings(
  onData: (settings: SystemSecuritySettings) => void
): Unsubscribe {
  const docRef = doc(db, 'system_settings', 'security');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as SystemSecuritySettings);
      } else {
        onData({ enforceTwoFactor: false, twoFactorMethod: 'email' });
      }
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'system_settings/security')
  );
}

export async function updateSystemSecuritySettings(
  adminUser: User,
  enforceTwoFactor: boolean,
  twoFactorMethod: 'sms' | 'email' | 'totp',
  approvalReason: string
): Promise<void> {
  const path = 'system_settings/security';
  try {
    const docRef = doc(db, 'system_settings', 'security');
    await setDoc(docRef, {
      enforceTwoFactor,
      twoFactorMethod,
      updatedBy: adminUser.email || adminUser.uid,
      updatedAt: serverTimestamp(),
      approvalReason: clampString(approvalReason, 500),
    });
    await recordAuditLog({
      user: adminUser,
      role: 'admin',
      action: '2FA_POLICY_UPDATED',
      details: `System 2FA enforced: ${enforceTwoFactor} (Method: ${twoFactorMethod}). Reason: ${approvalReason}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCompanyAndAssociatedResolutions(
  adminUser: User,
  companyId: string,
  companyName: string,
  confirmationName: string
): Promise<void> {
  if (companyName.trim().toLowerCase() !== confirmationName.trim().toLowerCase()) {
    throw new Error('Confirmation company name does not match exact record name.');
  }
  const path = `companies/${companyId}`;
  try {
    const resQ = query(collection(db, 'resolutions'), where('companyId', '==', companyId));
    const resSnap = await getDocs(resQ);
    const batch = writeBatch(db);

    resSnap.forEach((resDoc) => {
      batch.delete(resDoc.ref);
    });

    batch.delete(doc(db, 'companies', companyId));
    await batch.commit();

    await recordAuditLog({
      user: adminUser,
      role: 'admin',
      action: 'COMPANY_PERMANENTLY_DELETED',
      details: `Permanent deletion of company "${companyName}" and ${resSnap.size} associated resolutions.`,
      targetId: companyId,
      companyName,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function revokeAndDeleteUser(
  adminUser: User,
  targetUid: string,
  targetEmail: string,
  confirmationEmail: string
): Promise<void> {
  if (targetEmail.trim().toLowerCase() !== confirmationEmail.trim().toLowerCase()) {
    throw new Error('Confirmation email does not match exact user email.');
  }
  const path = `users/${targetUid}`;
  try {
    await deleteDoc(doc(db, 'users', targetUid));
    await recordAuditLog({
      user: adminUser,
      role: 'admin',
      action: 'USER_ACCOUNT_REVOKED_DELETED',
      details: `Permanent revocation and deletion of user account "${targetEmail}" (UID: ${targetUid}).`,
      targetId: targetUid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}


