/**
 * Fiş tarama istemcisi — backend (/analyze) ile konuşur (DESIGN.md §6.2).
 */
import * as ImagePicker from "expo-image-picker";
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import { prepareImageForUpload } from "./image-optimize";
import { fetchWithTimeout } from "./fetch-timeout";
import { deviceId, resolveApiBase } from "./api-base";
import {
  formatHttpError,
  formatNetworkError,
  type ApiErrorBody,
} from "./api-errors";

export { resolveApiBase, apiBaseSource, isConfiguredProductionApi } from "./api-base";
export { backendOfflineMessage } from "./api-errors";

const ANALYZE_TIMEOUT_MS = 90_000;

export interface PickedImage {
  base64: string;
  mimeType: string;
  /** Optimize edilmiş dosyanın yerel URI'si — binary (base64'süz) upload için. */
  uri?: string;
}

export type ScanPhase = "idle" | "picking" | "preparing" | "uploading" | "analyzing";

/** Sunucudan dönen genişletilmiş tarama sonucu (kota bilgisi dahil). */
export interface ScanResult extends AnalyzedReceipt {
  quotaRemaining?: number;
}

export const SCAN_PHASE_MESSAGES: Record<Exclude<ScanPhase, "idle">, string> = {
  picking: "Galeri veya kamera açılıyor…",
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
  // allowsEditing: çekim sonrası yerleşik kırp-yakınlaştır adımı; kullanıcı yalnızca fişi
  // çerçeveler → arka plan gürültüsü (tarayıcı/menü) silinir, fiş kareyi doldurunca etkin DPI artar.
  const result = await ImagePicker.launchCameraAsync({
    base64: false,
    allowsEditing: true,
  });
  return toPickedUri(result);
}

export async function pickFromLibrary(): Promise<PickedUri | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Galeri izni verilmedi. Ayarlardan fotoğraflara erişime izin ver.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    base64: false,
    mediaTypes: ["images"],
    allowsEditing: true,
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

/**
 * Sunucuya yüklenecek isteği kurar. Mümkünse BINARY yol (optimize edilmiş dosyanın
 * URI'sinden blob) → base64'ün +%33 şişmesi ve JSON serileştirme maliyeti kalkar.
 * URI yoksa ya da blob okunamazsa base64 JSON'a düşer (geriye dönük uyum).
 */
async function buildAnalyzeRequest(image: PickedImage, locale: string): Promise<RequestInit> {
  if (image.uri) {
    try {
      const fileRes = await fetch(image.uri);
      const blob = await fileRes.blob();
      return {
        method: "POST",
        headers: {
          "content-type": image.mimeType,
          "x-device-id": deviceId(),
          "x-locale": locale,
        },
        body: blob,
      };
    } catch {
      // Blob okunamadı → base64 JSON'a düş.
    }
  }
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": deviceId() },
    body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType, locale }),
  };
}

export async function analyzeViaServer(
  image: PickedImage,
  locale: string,
): Promise<ScanResult> {
  const url = `${resolveApiBase()}/analyze`;
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log(`[ahb] analyze → ${url}`);
  }

  const init = await buildAnalyzeRequest(image, locale);

  let res: Response;
  try {
    res = await fetchWithTimeout(url, init, ANALYZE_TIMEOUT_MS);
  } catch (err) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[ahb] analyze fetch failed", url, err);
    }
    throw new Error(formatNetworkError(err, "analyze"));
  }

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(formatHttpError(res.status, detail, "analyze"));
  }
  return (await res.json()) as ScanResult;
}

/**
 * Çekilen görüntüyü tek eager zincirde işler: optimize → analiz. Faz geçişlerini
 * `onPhase` ile bildirir. Çağıran (App), pick biter bitmez bunu başlatır → optimize
 * ve upload, UI adım geçişlerini beklemeden hemen akar (algılanan gecikme azalır).
 */
export async function scanReceipt(
  picked: PickedUri,
  locale: string,
  onPhase?: (phase: Exclude<ScanPhase, "idle" | "picking">) => void,
): Promise<AnalyzedReceipt> {
  onPhase?.("preparing");
  const image = await optimizePickedImage(picked);
  onPhase?.("uploading");
  onPhase?.("analyzing");
  return analyzeViaServer(image, locale);
}

/** Akışlı taramada UI'ya anlık gösterilecek kısmi kalem. */
export interface StreamItem {
  name?: string;
  qty?: number;
  totalPriceCents?: number;
  confidence?: number;
}

/**
 * Akışlı tarama (SSE): kalemler geldikçe `onItem` çağrılır, sonda doğrulanmış tam
 * sonuç döner. RN'de fetch akışı güvenilir olmadığından XMLHttpRequest + onprogress
 * ile SSE çözümlenir. Herhangi bir sorunda çağıran tek-seferlik scanReceipt'e düşmeli.
 */
export function analyzeViaServerStream(
  image: PickedImage,
  locale: string,
  onItem: (item: StreamItem) => void,
): Promise<ScanResult> {
  const url = `${resolveApiBase()}/analyze/stream`;
  return buildAnalyzeRequest(image, locale).then(
    (init) =>
      new Promise<ScanResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        const headers = init.headers as Record<string, string> | undefined;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            if (typeof v === "string") xhr.setRequestHeader(k, v);
          }
        }
        xhr.timeout = ANALYZE_TIMEOUT_MS;

        let cursor = 0;
        let finalResult: ScanResult | null = null;
        let streamError: string | null = null;

        const handleEvent = (event: string, data: string) => {
          if (!data) return;
          if (event === "item") {
            try {
              onItem(JSON.parse(data) as StreamItem);
            } catch {
              /* yarım/parçalı kalem → yok say */
            }
          } else if (event === "result") {
            try {
              finalResult = JSON.parse(data) as ScanResult;
            } catch {
              streamError = "Sonuç çözümlenemedi";
            }
          } else if (event === "error") {
            try {
              const parsed = JSON.parse(data) as ApiErrorBody;
              streamError = parsed.error ?? "AI hatası";
            } catch {
              streamError = "AI hatası";
            }
          }
        };

        const drain = () => {
          const text = xhr.responseText;
          const blocks = text.slice(cursor).split("\n\n");
          for (let b = 0; b < blocks.length - 1; b++) {
            const block = blocks[b]!;
            let event = "message";
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            handleEvent(event, data);
          }
          cursor += blocks.slice(0, blocks.length - 1).join("\n\n").length;
          if (blocks.length > 1) cursor += "\n\n".length * (blocks.length - 1);
        };

        xhr.onprogress = drain;
        xhr.onload = () => {
          drain();
          if (finalResult) resolve(finalResult);
          else if (xhr.status >= 400) {
            let body: ApiErrorBody = {};
            try {
              body = JSON.parse(xhr.responseText) as ApiErrorBody;
            } catch {
              /* SSE gövdesi JSON olmayabilir */
            }
            reject(new Error(formatHttpError(xhr.status, body, "analyze")));
          } else {
            reject(new Error(streamError ?? formatNetworkError(new Error("Sunucuya ulaşılamadı"), "analyze")));
          }
        };
        xhr.onerror = () => reject(new Error(formatNetworkError(new Error("Network request failed"), "analyze")));
        xhr.ontimeout = () => {
          const err = new Error("timeout");
          err.name = "AbortError";
          reject(new Error(formatNetworkError(err, "analyze")));
        };

        xhr.send(init.body as Blob | string | null);
      }),
  );
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
