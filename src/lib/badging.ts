/**
 * Web App Badging API (navigator.setAppBadge) & Local PWA Push Notification Helper
 */

type BadgingNavigator = {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export async function syncAppBadgeCount(pendingCount: number): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // Keep browser tab title synced as universal fallback
  document.title =
    pendingCount > 0
      ? `(${pendingCount}) QuorumSeal — Pending Signatures`
      : 'QuorumSeal — Corporate Secretarial Resolution Platform';

  const nav = navigator as unknown as BadgingNavigator;
  try {
    if (pendingCount > 0 && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(pendingCount);
      return true;
    }
    if (pendingCount === 0 && typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge();
      return true;
    }
  } catch {
    // Some browsers disallow setAppBadge inside cross-origin iframes; safely ignored.
  }
  return false;
}

export async function showLocalPushNotification(
  title: string,
  body: string,
  tag?: string
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: tag || 'quorumseal-alert',
      });
      return true;
    }
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag: tag || 'quorumseal-alert',
    });
    return true;
  } catch {
    return false;
  }
}
