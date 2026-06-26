/**
 * usePushSubscription — client-side hook for Web Push subscription management.
 *
 * Task 5.5. Browser-side only — not unit-testable in the Node.js Vitest suite.
 *
 * Responsibilities:
 *  - Check Notification API and PushManager availability (browser support detection)
 *  - Request notification permission from the user
 *  - Subscribe via the browser PushManager with the VAPID public key
 *  - POST the subscription to /api/push/subscribe (stored server-side per user)
 *  - Expose subscribe / unsubscribe / permission state to the caller
 *
 * Note: This hook is intentionally minimal. VAPID_PUBLIC_KEY is passed as a
 * prop/arg (injected from the server loader) so the hook has no env dependency.
 *
 * Not covered by the unit test suite (requires browser APIs: Notification,
 * navigator.serviceWorker, PushManager). Integration/E2E coverage is deferred
 * to PR 6 (tests/e2e/reminders.spec.ts).
 */

import { useState, useCallback } from "react";
import { subscribePush } from "#/routes/api/push/-subscribe";
import { unsubscribePush } from "#/routes/api/push/-unsubscribe";

export type NotificationPermission = "default" | "granted" | "denied";

export interface UsePushSubscriptionOptions {
  /**
   * Base64-encoded VAPID public key — provided by the server loader so
   * this hook has no knowledge of env vars.
   */
  vapidPublicKey: string;
}

export interface UsePushSubscriptionResult {
  /** Whether the browser supports Web Push (Notification API + PushManager). */
  isSupported: boolean;
  /** Current Notification.permission state — refreshed after each subscribe/unsubscribe. */
  permission: NotificationPermission;
  /** Whether a subscription is currently active for this browser/user. */
  isSubscribed: boolean;
  /** True while a subscribe or unsubscribe request is in flight. */
  isLoading: boolean;
  /** Last error from subscribe/unsubscribe, or null. */
  error: string | null;
  /** Request permission and subscribe the current browser to Web Push. */
  subscribe: () => Promise<void>;
  /** Unsubscribe and remove the subscription from the server. */
  unsubscribe: () => Promise<void>;
}

function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

export function usePushSubscription({
  vapidPublicKey,
}: UsePushSubscriptionOptions): UsePushSubscriptionResult {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "default"
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported = isWebPushSupported();

  const subscribe = useCallback(async (): Promise<void> => {
    if (!isSupported) {
      setError("Web Push is not supported in this browser.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Request notification permission
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== "granted") {
        setError("Notification permission was not granted.");
        return;
      }

      // Get the service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = subscription.toJSON();

      const p256dh = json.keys?.["p256dh"];
      const auth = json.keys?.["auth"];

      if (!json.endpoint || !p256dh || !auth) {
        throw new Error("Incomplete subscription data from browser PushManager.");
      }

      // Send to server
      await subscribePush({
        data: {
          endpoint: json.endpoint,
          keys: {
            p256dh,
            auth,
          },
        },
      });

      setIsSubscribed(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to subscribe.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, vapidPublicKey]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isSupported) return;

    setIsLoading(true);
    setError(null);

    try {
      // Unsubscribe from browser PushManager
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }

      // Remove from server
      await unsubscribePush();

      setIsSubscribed(false);
      setPermission("default");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to unsubscribe.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
  };
}
