/**
 * Akışlı (henüz tamamlanmamış) JSON'dan tamamlanmış kalem nesnelerini çıkarır.
 * Vision-LLM streamGenerateContent ile JSON parça parça gelir; bu fonksiyon biriken
 * metinden o ana dek BÜTÜN olan lineItem'ları ayıklar → UI kalemleri geldikçe gösterir.
 *
 * Saf + I/O'suz → vitest ile birebir test edilebilir.
 */

export interface PartialLineItem {
  name?: string;
  qty?: number;
  unitPriceCents?: number;
  totalPriceCents?: number;
  confidence?: number;
}

/**
 * Biriken JSON metninden "lineItems" dizisindeki tamamlanmış {…} nesnelerini döndürür.
 * Dizi henüz kapanmamış olabilir; sondaki yarım nesne yok sayılır. String içindeki
 * süslü parantezler ve kaçışlı tırnaklar doğru ele alınır.
 */
export function extractLineItems(text: string): PartialLineItem[] {
  const arrStart = findLineItemsArrayStart(text);
  if (arrStart < 0) return [];

  const out: PartialLineItem[] = [];
  let i = arrStart;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objStart = -1;

  for (; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const slice = text.slice(objStart, i + 1);
        const parsed = tryParseItem(slice);
        if (parsed) out.push(parsed);
        objStart = -1;
      }
      continue;
    }
    // Dizi kapanışı: lineItems bitti.
    if (ch === "]" && depth === 0) break;
  }

  return out;
}

/** `"lineItems"` anahtarından sonraki açılış `[`'inin indeksini bulur (string-duyarlı). */
function findLineItemsArrayStart(text: string): number {
  const keyIdx = text.indexOf('"lineItems"');
  if (keyIdx < 0) return -1;
  for (let i = keyIdx + '"lineItems"'.length; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "[") return i + 1;
    // ":" ve boşluk dışında bir şey gelirse beklenmedik biçim → yine de [ ara.
  }
  return -1;
}

function tryParseItem(slice: string): PartialLineItem | null {
  try {
    const obj = JSON.parse(slice) as Record<string, unknown>;
    const item: PartialLineItem = {};
    if (typeof obj.name === "string") item.name = obj.name;
    if (typeof obj.qty === "number") item.qty = obj.qty;
    if (typeof obj.unitPriceCents === "number") item.unitPriceCents = obj.unitPriceCents;
    if (typeof obj.totalPriceCents === "number") item.totalPriceCents = obj.totalPriceCents;
    if (typeof obj.confidence === "number") item.confidence = obj.confidence;
    // En az bir anlamlı alan içermeyen nesneyi atla.
    if (item.name === undefined && item.totalPriceCents === undefined) return null;
    return item;
  } catch {
    return null;
  }
}

/**
 * Gemini SSE gövdesinden (alt=sse) biriken ham metin parçalarını birleştirir.
 * Her `data: {…}` satırındaki candidates[0].content.parts[*].text eklenir.
 * Tam (kapanmış) olmayan son SSE satırı `rest` olarak döndürülür → sonraki chunk'a taşınır.
 */
export function consumeSseBuffer(buffer: string): { text: string; rest: string } {
  let text = "";
  const lastNl = buffer.lastIndexOf("\n");
  if (lastNl < 0) return { text: "", rest: buffer };
  const complete = buffer.slice(0, lastNl);
  const rest = buffer.slice(lastNl + 1);

  for (const line of complete.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const parts = obj.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) if (typeof p.text === "string") text += p.text;
    } catch {
      // Yarım/parçalı JSON satırı → yok say (bir sonraki chunk'ta tamamlanır).
    }
  }
  return { text, rest };
}
