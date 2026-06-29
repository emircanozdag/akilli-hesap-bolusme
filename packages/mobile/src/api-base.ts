/**
 * Ortak API yardımcıları — api.ts ve suggest-api.ts paylaşır.
 */
import Constants from "expo-constants";

const BACKEND_PORT = 8787;

export type ApiBaseSource = "env" | "expo-host" | "localhost";

export function resolveApiBase(): string {
  const override = process.env.EXPO_PUBLIC_AHB_API;
  if (override && override.length > 0) return override.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host) return `http://${host}:${BACKEND_PORT}`;
  }
  return `http://localhost:${BACKEND_PORT}`;
}

/** Hangi yapılandırmadan API adresi geldiği (hata metinleri için). */
export function apiBaseSource(): ApiBaseSource {
  const override = process.env.EXPO_PUBLIC_AHB_API;
  if (override && override.length > 0) return "env";

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;

  return hostUri ? "expo-host" : "localhost";
}

/** Production / yapılandırılmış uç nokta mı (geliştirici LAN ip'si değil). */
export function isConfiguredProductionApi(): boolean {
  return apiBaseSource() === "env";
}

/** Kullanıcıya gösterilecek kısa API etiketi (tam URL sızdırmadan). */
export function apiBaseLabel(): string {
  if (isConfiguredProductionApi()) return "sunucu";
  const base = resolveApiBase();
  try {
    const u = new URL(base);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return "localhost";
    return u.hostname;
  } catch {
    return "sunucu";
  }
}

let cachedDeviceId: string | null = null;
export function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  const sessionId = (Constants as unknown as { sessionId?: string }).sessionId;
  cachedDeviceId =
    sessionId ?? `ahb-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return cachedDeviceId;
}
