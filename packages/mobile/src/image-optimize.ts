/**
 * Fiş görüntüsünü yüklemeden önce küçültür — upload + OCR gecikmesini azaltır (DESIGN.md §7).
 */
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

export interface OptimizedImage {
  base64: string;
  mimeType: string;
  /** Optimize edilmiş dosyanın yerel URI'si — binary (base64'süz) upload için. */
  uri: string;
}

// Hız/doğruluk dengesi (DESIGN.md §7): 1600px genişlik tipik fişlerde ≥200 DPI'yi korur
// ama 2200px'e göre yükü ~yarıya indirir. compress 0.85 → ince rakam/ondalık noktası bozulmaz.
// (Faz 0 benchmark harness'ı ile doğrulanır: maxWidth düşürünce F1 düşmemeli.)
export const SCAN_IMAGE = {
  maxWidth: 1600,
  compress: 0.85,
  format: SaveFormat.JPEG,
} as const;

/** Yerel URI → sıkıştırılmış JPEG base64 (sunucuya gönderim için). */
export async function prepareImageForUpload(uri: string): Promise<OptimizedImage> {
  if (!uri.trim()) {
    throw new Error("Görüntü okunamadı, tekrar dener misin?");
  }

  const result = await manipulateAsync(
    uri,
    [{ resize: { width: SCAN_IMAGE.maxWidth } }],
    {
      compress: SCAN_IMAGE.compress,
      format: SCAN_IMAGE.format,
      base64: true,
    },
  );

  if (!result.base64) {
    throw new Error("Görüntü hazırlanamadı, tekrar dener misin?");
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const kb = Math.round((result.base64.length * 3) / 4 / 1024);
    console.log(`[ahb] optimize edilmiş görüntü ~${kb} KB`);
  }

  return { base64: result.base64, mimeType: "image/jpeg", uri: result.uri };
}
