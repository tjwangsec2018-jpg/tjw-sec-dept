import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { getMessaging, getToken, isSupported as isMessagingSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'tjwangsec2018@gmail.com';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Ensure permanent persistent login session across restarts on mobile & desktop
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Could not enforce local auth persistence:', err);
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Uploads a PDF or wet-ink scan image to the server storage route for immediate
 * inline PDF rendering and mirrors to Firebase Cloud Storage when permitted.
 */
export async function uploadDocumentFile(
  bytes: Uint8Array,
  fileName: string,
  contentType: string = 'application/pdf'
): Promise<{ url: string; storageUrl?: string }> {
  let storageUrl: string | undefined;

  // Attempt Firebase Cloud Storage upload in parallel/best-effort
  try {
    const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._\-]/g, '_')}`;
    const storageRef = ref(storage, `resolutions/${safeName}`);
    await uploadBytes(storageRef, bytes, { contentType });
    storageUrl = await getDownloadURL(storageRef);
  } catch {
    // Cloud Storage bucket rules may not be deployed on starter tier; server API handles durable serving.
  }

  const base64Data = uint8ToBase64(bytes);
  const response = await fetch('/api/pdfs/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, base64Data, contentType }),
  });

  if (!response.ok) {
    if (storageUrl) return { url: storageUrl, storageUrl };
    throw new Error('Failed to upload document file.');
  }

  const data = (await response.json()) as { url: string };
  return { url: data.url, storageUrl };
}

/**
 * Requests browser push permission and retrieves an FCM registration token
 * if Firebase Cloud Messaging is supported and VAPID key is configured.
 */
export async function requestPushAndFcmToken(): Promise<{
  permission: NotificationPermission | 'unsupported';
  fcmToken: string;
}> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { permission: 'unsupported', fcmToken: '' };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  let fcmToken = '';
  if (permission === 'granted') {
    try {
      const supported = await isMessagingSupported();
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
      if (supported && vapidKey) {
        const messaging = getMessaging(app);
        const swReg = await navigator.serviceWorker?.register('/firebase-messaging-sw.js');
        fcmToken = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: swReg,
        });
      }
    } catch {
      // FCM VAPID token retrieval requires VITE_FIREBASE_VAPID_KEY; PWA Notification API still functions.
    }
  }

  return { permission, fcmToken };
}
