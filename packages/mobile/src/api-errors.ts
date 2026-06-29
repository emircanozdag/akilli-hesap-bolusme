/**
 * API hatalarını kullanıcı dostu Türkçe mesajlara çevirir.
 * Geliştirici ayrıntıları yalnızca __DEV__ modunda gösterilir.
 */
import { apiBaseLabel, apiBaseSource, isConfiguredProductionApi } from "./api-base";

export type ApiErrorContext = "analyze" | "suggest" | "health";

export interface ApiErrorBody {
  error?: string;
  detail?: string;
  code?: string;
  remaining?: number;
}

function isDev(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function manualFallback(context: ApiErrorContext): string {
  if (context === "suggest") {
    return "Atamaları elle yapabilirsin.";
  }
  return "Kalemleri elle girebilir veya biraz sonra tekrar deneyebilirsin.";
}

/** HTTP yanıt gövdesi + durum kodundan mesaj üretir. */
export function formatHttpError(
  status: number,
  body: ApiErrorBody,
  context: ApiErrorContext,
): string {
  const serverMsg = body.error?.trim();

  if (status === 429) {
    if (serverMsg?.includes("kota")) {
      return `${serverMsg} Yarın gece yarısı (UTC) yenilenir. ${manualFallback(context)}`;
    }
    return `Günlük tarama limitine ulaşıldı. Yarın tekrar kullanılabilir. ${manualFallback(context)}`;
  }

  if (status === 503) {
    return (
      serverMsg ??
      `Servis şu an kullanılamıyor. ${manualFallback(context)}`
    );
  }

  if (status === 502) {
    const busy =
      serverMsg?.includes("yoğun") || serverMsg?.includes("AI servisi")
        ? serverMsg
        : "AI servisi yanıt veremedi.";
    return `${busy} ${manualFallback(context)}`;
  }

  if (status === 422) {
    return serverMsg ?? "Fiş okunamadı — fotoğrafı netleştir veya kalemleri elle gir.";
  }

  if (status === 400) {
    return serverMsg ?? "Geçersiz istek. Fotoğrafı tekrar seçmeyi dene.";
  }

  if (status >= 500) {
    return `Sunucu hatası (${status}). ${manualFallback(context)}`;
  }

  if (serverMsg) return serverMsg;
  return `İstek başarısız (${status}). ${manualFallback(context)}`;
}

/** fetch / XHR ağ hataları (bağlantı yok, zaman aşımı). */
export function formatNetworkError(err: unknown, context: ApiErrorContext): string {
  if (err instanceof Error && err.name === "AbortError") {
    return `Fiş okuma zaman aşımına uğradı. Tekrar dener misin? ${manualFallback(context)}`;
  }

  if (isConfiguredProductionApi()) {
    return `Sunucuya ulaşılamadı (${apiBaseLabel()}). İnternet bağlantını kontrol edip tekrar dene. ${manualFallback(context)}`;
  }

  const source = apiBaseSource();
  if (isDev() && (source === "expo-host" || source === "localhost")) {
    return `Sunucuya ulaşılamıyor (${apiBaseLabel()}). Aynı Wi‑Fi’da olduğundan ve backend’in çalıştığından emin ol: npm run dev -w @ahb/server`;
  }

  return `Sunucuya ulaşılamıyor. Bağlantını kontrol edip tekrar dene. ${manualFallback(context)}`;
}

/** Ana ekranda backend kapalıyken gösterilecek banner metni. */
export function backendOfflineMessage(): string {
  if (isConfiguredProductionApi()) {
    return "Sunucuya ulaşılamıyor. İnternet bağlantını kontrol edip tekrar dene.";
  }
  if (isDev()) {
    return `Backend’e ulaşılamıyor (${apiBaseLabel()}). Sunucuyu başlat: npm run dev -w @ahb/server`;
  }
  return "Sunucuya ulaşılamıyor. Bağlantını kontrol edip tekrar dene.";
}
