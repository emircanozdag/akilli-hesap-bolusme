/**
 * Fiş tarama istemcisi — backend (/analyze) ile konuşur (DESIGN.md §6.2).
 */
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import { prepareImageForUpload } from "./image-optimize";
import { fetchWithTimeout } from "./fetch-timeout";

const BACKEND_PORT = 8787;
const ANALYZE_TIMEOUT_MS = 120_000;

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

export interface PickedImage {
  base64: string;
  mimeType: string;
}

export type ScanPhase = "idle" | "picking" | "preparing" | "uploading" | "analyzing";

export const SCAN_PHASE_MESSAGES: Record<Exclude<ScanPhase, "idle">, string> = {
  picking: "Kamera açılıyor…",
  preparing: "Fotoğraf hazırlanıyor…",
  uploading: "Fiş okunuyor…",
  analyzing: "Kalemler okunuyor… (30–60 sn sürebilir)",
};

export interface PickedUri {
  uri: string;
}

export async function captureFromCamera(): Promise<PickedUri | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Kamera izni verilmedi. Ayarlardan izin verebilirsin.");
  }
  const result = await ImagePicker.launchCameraAsync({
    base64: false,
    allowsEditing: false,
  });
  return toPickedUri(result);
}

export async function pickFromLibrary(): Promise<PickedUri | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    base64: false,
    mediaTypes: ["images"],
    allowsEditing: false,
  });
  return toPickedUri(result);
}

function toPickedUri(result: ImagePicker.ImagePickerResult): PickedUri | null {
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) {
    throw new Error("Görüntü okunamadı, tekrar dener misin?");
  }
  return { uri: asset.uri };
}

export async function optimizePickedImage(picked: PickedUri): Promise<PickedImage> {
  return prepareImageForUpload(picked.uri);
}

export async function analyzeViaServer(
  image: PickedImage,
  locale: string,
): Promise<AnalyzedReceipt> {
  const url = `${resolveApiBase()}/analyze`;
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log(`[ahb] analyze → ${url}`);
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": deviceId() },
        body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType, locale }),
      },
      ANALYZE_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Fiş okuma zaman aşımına uğradı. Tekrar dener misin?");
    }
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[ahb] analyze fetch failed", url, err);
    }
    throw new Error(
      `Sunucuya ulaşılamadı (${url.replace("/analyze", "")}). Aynı Wi‑Fi’da olduğundan ve backend’in çalıştığından emin ol.`,
    );
  }

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Sunucu hatası (${res.status})`);
  }
  return (await res.json()) as AnalyzedReceipt;
}

export async function checkBackendHealth(): Promise<boolean> {
  const url = `${resolveApiBase()}/health`;
  try {
    const res = await fetchWithTimeout(url, {}, 8_000);
    return res.ok;
  } catch {
    return false;
  }
}

export function prewarmBackend(): void {
  void checkBackendHealth();
}

let cachedDeviceId: string | null = null;
function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  const sessionId = (Constants as unknown as { sessionId?: string }).sessionId;
  cachedDeviceId =
    sessionId ?? `ahb-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return cachedDeviceId;
}
