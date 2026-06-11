/**
 * Fiş tarama istemcisi — backend (/analyze) ile konuşur (DESIGN.md §6.2).
 */
import { MockProvider, orchestrate, type AnalyzedReceipt } from "@ahb/ai-orchestrator";

const API_URL = (import.meta.env.VITE_AHB_API as string | undefined) ?? "http://localhost:8787";

export function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      resolve({ base64, mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function analyzeViaServer(
  base64: string,
  mimeType: string,
  locale: string,
): Promise<AnalyzedReceipt> {
  const res = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": deviceId() },
    body: JSON.stringify({ imageBase64: base64, mimeType, locale }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Sunucu hatası (${res.status})`);
  }
  return (await res.json()) as AnalyzedReceipt;
}

export async function analyzeDemo(locale: string): Promise<AnalyzedReceipt> {
  return orchestrate(new MockProvider(), {
    imageBase64: "demo",
    mimeType: "image/jpeg",
    hints: { locale },
  });
}

function deviceId(): string {
  const key = "ahb_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
