/**
 * Fiş görüntüsünü yüklemeden önce küçültür — upload + OCR gecikmesini azaltır (DESIGN.md §7).
 */
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

export interface OptimizedImage {
  base64: string;
  mimeType: string;
}

export const SCAN_IMAGE = {
  maxWidth: 1400,
  compress: 0.55,
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

  return { base64: result.base64, mimeType: "image/jpeg" };
}
