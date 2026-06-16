/**
 * DocumentAiProvider — Google Document AI Expense Parser (görsel → yapılandırılmış JSON).
 * Fişe özel, önceden eğitilmiş çıkarım; line_item/quantity + unit_price + amount verir.
 * SDK'ya bağımlı kalmamak için doğrudan REST (fetch) kullanır → her runtime'da çalışır.
 * Kimlik (access token) dışarıdan enjekte edilir → ai-orchestrator auth'a bağımlı kalmaz.
 */
import { ProviderError, type VisionProvider } from "../provider.js";
import type { AnalyzeInput } from "../types.js";

export interface DocumentAiOptions {
  projectId: string;
  /** İşlemci bölgesi, ör. "eu" veya "us". */
  location: string;
  processorId: string;
  /** Her istek için taze OAuth2 access token üretir (Node tarafında GoogleAuth ile). */
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Geçici hatalarda (429/5xx + ağ) toplam deneme sayısı. Varsayılan 3. */
  maxAttempts?: number;
  /** İlk geri çekilme gecikmesi (ms); her denemede üstel olarak ikiye katlanır. */
  retryBaseDelayMs?: number;
  /** Test edilebilirlik için enjekte edilebilir bekleme. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Hata ayıklama: map'lemeden önce ham Document AI yanıtını alır (ör. dosyaya yazmak için). */
  onRawDocument?: (doc: unknown) => void;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DOCAI_REQUEST_TIMEOUT_MS = 90_000;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class DocumentAiProvider implements VisionProvider {
  readonly name = "documentai";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(private readonly opts: DocumentAiOptions) {
    if (!opts.projectId) throw new ProviderError("Document AI projectId gerekli", "documentai");
    if (!opts.location) throw new ProviderError("Document AI location gerekli", "documentai");
    if (!opts.processorId) throw new ProviderError("Document AI processorId gerekli", "documentai");
    if (!opts.getAccessToken) {
      throw new ProviderError("Document AI getAccessToken gerekli", "documentai");
    }
    this.baseUrl =
      opts.baseUrl ?? `https://${opts.location}-documentai.googleapis.com/v1`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
  }

  async analyze(input: AnalyzeInput): Promise<unknown> {
    const url =
      `${this.baseUrl}/projects/${this.opts.projectId}` +
      `/locations/${this.opts.location}/processors/${this.opts.processorId}:process`;
    const body = {
      rawDocument: { content: input.imageBase64, mimeType: input.mimeType },
      // İşlenecek alanları daraltmak gerekirse fieldMask burada eklenebilir.
    };

    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let token: string;
      try {
        token = await this.opts.getAccessToken();
      } catch (cause) {
        throw new ProviderError("Document AI kimlik doğrulaması başarısız", "documentai", cause);
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DOCAI_REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        lastError = new ProviderError("Document AI isteği başarısız (ağ)", "documentai", cause);
        if (await this.maybeBackoff(attempt)) continue;
        throw lastError;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = new ProviderError(
          `Document AI HTTP ${res.status}: ${detail.slice(0, 300)}`,
          "documentai",
        );
        if (!RETRYABLE_STATUS.has(res.status)) throw error;
        lastError = error;
        if (await this.maybeBackoff(attempt)) continue;
        throw error;
      }

      let payload: DocumentAiResponse;
      try {
        payload = (await res.json()) as DocumentAiResponse;
      } catch (cause) {
        throw new ProviderError("Document AI JSON ayrıştırılamadı", "documentai", cause);
      }

      if (this.opts.onRawDocument) {
        try {
          this.opts.onRawDocument(payload.document ?? {});
        } catch {
          /* debug hook hataları analizi bozmamalı */
        }
      }
      return mapDocAiToRaw(payload.document ?? {}, input);
    }

    throw lastError ?? new ProviderError("Document AI denemeleri tükendi", "documentai");
  }

  private async maybeBackoff(attempt: number): Promise<boolean> {
    if (attempt >= this.maxAttempts) return false;
    await this.sleepImpl(this.retryBaseDelayMs * 2 ** (attempt - 1));
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Mapping: Document AI entities → rawOcrResultSchema şekli (saf fonk.) */
/* ------------------------------------------------------------------ */

interface DocumentAiResponse {
  document?: DocAiDocument;
}
interface DocAiDocument {
  entities?: DocAiEntity[];
  /** Tam sayfa OCR metni (entity etiketleme kaçırsa da satır metni burada durur). */
  text?: string;
  pages?: DocAiPage[];
}
interface DocAiTextSegment {
  startIndex?: string | number;
  endIndex?: string | number;
}
interface DocAiLayout {
  textAnchor?: { textSegments?: DocAiTextSegment[] };
  boundingPoly?: { normalizedVertices?: DocAiVertex[] };
}
interface DocAiPage {
  lines?: Array<{ layout?: DocAiLayout }>;
}
interface DocAiMoney {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
}
interface DocAiNormalizedValue {
  text?: string;
  moneyValue?: DocAiMoney;
  integerValue?: number;
  floatValue?: number;
  dateValue?: { year?: number; month?: number; day?: number };
}
interface DocAiVertex {
  x?: number;
  y?: number;
}
interface DocAiEntity {
  type?: string;
  mentionText?: string;
  confidence?: number;
  normalizedValue?: DocAiNormalizedValue;
  properties?: DocAiEntity[];
  pageAnchor?: {
    pageRefs?: Array<{ boundingPoly?: { normalizedVertices?: DocAiVertex[] } }>;
  };
}

interface Box {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  yMid: number;
}

function boxOfVertices(v: DocAiVertex[] | undefined): Box | null {
  if (!v || v.length === 0) return null;
  const xs = v.map((p) => p.x ?? 0);
  const ys = v.map((p) => p.y ?? 0);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin, yMax, yMid: (yMin + yMax) / 2 };
}

/** Entity'nin normalize edilmiş sınırlayıcı kutusu (yoksa null). */
function boxOf(entity: DocAiEntity | undefined): Box | null {
  return boxOfVertices(entity?.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices);
}

/** Tam sayfa OCR'dan konumlu satır metinleri. */
interface OcrLine {
  text: string;
  box: Box;
}

function extractOcrLines(doc: DocAiDocument): OcrLine[] {
  const text = doc.text ?? "";
  if (!text) return [];
  const out: OcrLine[] = [];
  for (const page of doc.pages ?? []) {
    for (const line of page.lines ?? []) {
      const segs = line.layout?.textAnchor?.textSegments;
      const box = boxOfVertices(line.layout?.boundingPoly?.normalizedVertices);
      if (!segs?.length || !box) continue;
      const t = segs
        .map((s) => text.slice(Number(s.startIndex ?? 0), Number(s.endIndex ?? 0)))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (t) out.push({ text: t, box });
    }
  }
  return out;
}

/**
 * Ürün olmayan satırlar (TR + EN, aksan duyarsız): toplam/ara-toplam/KDV ve
 * ödeme/footer terimleri (kredi kartı, nakit, ödeme, tahsil, kalan, para üstü...).
 */
const NON_ITEM_NAME =
  /(kisi\s*sayisi|ara\s*toplam|toplam|kdv|tutar|indirim|iskonto|subtotal|total|vat|tax|discount|kredi\s*kart|nakit|\bodeme|odenecek|tahsil|\bkalan\b|para\s*ust|yemek\s*cek|sodexo|multinet|setcard|ticket)/i;

/** Porsiyon/birim kelimeleri: tek başına isim olamaz ("Tam", "Yarım", "Adet", "Porsiyon"). */
const PORTION_WORD = /^(tam|yarim|yarrim|porsiyon|pors|adet|ad|tane|tabak)$/;

/** Fiş başlık etiketleri: OCR'dan türetilen isim bunlarla başlıyorsa satır ürün değildir. */
const HEADER_LABEL = /^(tarih|saat|masa|adisyon|bolum|salon|garson|kasiyer|fis|vergi|tel)\b/;

/** Birim fiyat detay satırı: "2 AD X 252.00", "3 ADET x 25,00", "2 x 252" → kalem değil, üst kalemin birimi. */
const UNIT_DETAIL_LINE = /^\d+([.,]\d+)?\s+(ad|adet|x)\b\s*[x×*]?\s*\d/i;

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir (filtre eşleşmesi için). */
function normalizeName(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .replace(/Ş/g, "s")
    .replace(/ş/g, "s")
    .replace(/Ğ/g, "g")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "u")
    .replace(/ü/g, "u")
    .replace(/Ö/g, "o")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "c")
    .replace(/ç/g, "c")
    .toLowerCase()
    .trim();
}

/** Para değerini kuruşa çevirir. moneyValue → normalizedValue.text → mentionText (TR format). */
function toCents(entity: DocAiEntity | undefined): number | null {
  if (!entity) return null;
  const nv = entity.normalizedValue;

  if (nv?.moneyValue && (nv.moneyValue.units !== undefined || nv.moneyValue.nanos !== undefined)) {
    const units = Number(nv.moneyValue.units ?? 0);
    const nanos = Number(nv.moneyValue.nanos ?? 0);
    if (Number.isFinite(units) && Number.isFinite(nanos)) {
      // nanos/1e9 * 100 = nanos/1e7. İşaret units ile tutarlı gelir.
      return Math.round(units * 100 + nanos / 1e7);
    }
  }

  if (nv?.text !== undefined) {
    const c = parseAmountToCents(nv.text);
    if (c !== null) return c;
  }

  if (entity.mentionText !== undefined) {
    const c = parseAmountToCents(entity.mentionText);
    if (c !== null) return c;
  }
  return null;
}

/**
 * Serbest metin tutarı kuruşa çevirir. TR (1.350,00) ve US (1,350.00) formatlarına dayanıklı:
 * son görülen ayraç (`.` veya `,`) ondalık kabul edilir, diğerleri binlik ayracı sayılır.
 */
export function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,-]/g, "").trim();
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const digitsOnly = cleaned.replace(/-/g, "");

  const lastComma = digitsOnly.lastIndexOf(",");
  const lastDot = digitsOnly.lastIndexOf(".");
  const decimalPos = Math.max(lastComma, lastDot);

  let intPart: string;
  let fracPart: string;
  if (decimalPos === -1) {
    intPart = digitsOnly.replace(/[.,]/g, "");
    fracPart = "";
  } else {
    intPart = digitsOnly.slice(0, decimalPos).replace(/[.,]/g, "");
    fracPart = digitsOnly.slice(decimalPos + 1).replace(/[.,]/g, "");
  }

  // Ondalık kısım iki haneye normalize edilir (kuruş).
  const frac2 = (fracPart + "00").slice(0, 2);
  const intValue = intPart === "" ? 0 : Number(intPart);
  const fracValue = frac2 === "" ? 0 : Number(frac2);
  if (!Number.isFinite(intValue) || !Number.isFinite(fracValue)) return null;

  const cents = intValue * 100 + fracValue;
  return negative ? -cents : cents;
}

/** Adet değerini okur (integer/float/text/mentionText). Bulunamazsa null. */
function toQuantity(entity: DocAiEntity | undefined): number | null {
  if (!entity) return null;
  const nv = entity.normalizedValue;
  if (typeof nv?.integerValue === "number") return nv.integerValue;
  if (typeof nv?.floatValue === "number") return nv.floatValue;
  const text = nv?.text ?? entity.mentionText;
  if (text !== undefined) {
    const n = Number(text.replace(",", ".").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function childByType(entity: DocAiEntity, type: string): DocAiEntity | undefined {
  return entity.properties?.find((p) => p.type === type);
}

/**
 * Kalem adını seçer: line_item/description alanlarından porsiyon kelimesi olmayan
 * ilkini alır ("ARNAVUT CIGERI" + "Tam" → "ARNAVUT CIGERI"; yalnız "Tam" → "").
 */
function pickItemName(entity: DocAiEntity): string {
  const descs = (entity.properties ?? []).filter((p) => p.type === "line_item/description");
  for (const d of descs) {
    const t = (d.mentionText ?? "").trim();
    if (!t) continue;
    if (PORTION_WORD.test(normalizeName(t))) continue;
    return t;
  }
  return "";
}

/** ISO 4217 para birimi: currency entity → locale ipucu. */
function resolveCurrency(
  currencyEntity: DocAiEntity | undefined,
  hintLocale: string | undefined,
): { currency?: string; confidence: number } {
  const region = hintLocale?.split("-")[1]?.toUpperCase();
  const byRegion: Record<string, string> = { TR: "TRY", US: "USD", GB: "GBP" };
  const regionCurrency = region ? byRegion[region] : undefined;

  const raw = currencyEntity?.normalizedValue?.text ?? currencyEntity?.mentionText;
  if (raw) {
    const sym = raw.trim().toUpperCase();
    const bySymbol: Record<string, string> = { "₺": "TRY", TL: "TRY", "$": "USD", "€": "EUR", "£": "GBP" };
    const code = bySymbol[sym] ?? (/^[A-Z]{3}$/.test(sym) ? sym : undefined);
    if (code) {
      // Tek glif semboller (₺/€/$/£) OCR'da kolay karışır: bölge ipucuyla çelişiyorsa
      // güveni onay eşiğinin (0.6) altına çek → uygulama kullanıcıya sorar.
      const fromSingleGlyph = (currencyEntity?.mentionText?.trim().length ?? 0) === 1;
      if (fromSingleGlyph && regionCurrency && code !== regionCurrency) {
        return { currency: code, confidence: 0.4 };
      }
      return { currency: code, confidence: currencyEntity?.confidence ?? 0.9 };
    }
  }
  if (regionCurrency) return { currency: regionCurrency, confidence: 0.5 };
  return { confidence: 0 };
}

interface RawLine {
  name: string;
  qty: number;
  unitPriceCents?: number;
  totalPriceCents: number;
  confidence: number;
}

/** Bir kalem nesnesi kurar; geçersizse (tutar yok, isimsiz 0 tutar, ürün-dışı isim) null döner. */
function buildLine(parts: {
  name: string;
  qty: number | null;
  unitPriceCents: number | null;
  totalPriceCents: number | null;
  confidences: Array<number | undefined>;
}): RawLine | null {
  let total = parts.totalPriceCents;
  if (total === null && parts.unitPriceCents !== null && parts.qty !== null) {
    total = Math.round(parts.unitPriceCents * parts.qty);
  }
  if (total === null) return null;
  // OCR'ın isme yapıştırdığı salt sayısal ilk satırı at ("100\nKALAMAR TAVA" → "KALAMAR TAVA").
  const name = parts.name
    .replace(/^\d+([.,]\d+)?\s*\n/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Negatif tutarlı satır (ör. "Kampanya İndirim −162,50") gerçek bir indirimdir;
  // NON_ITEM_NAME (indirim/iskonto) yüzünden ELENMEZ — mapDocAiToRaw bunu toplam
  // indirime ayırır. Yalnızca pozitif özet satırları (TOPLAM/KDV/ARA TOPLAM) atılır.
  if (name && total >= 0 && NON_ITEM_NAME.test(normalizeName(name))) return null;
  // İsimli 0-tutar gerçek bir satır olabilir (ikram); isimsiz 0 ise gürültüdür.
  if (total === 0 && !name) return null;

  const conf = parts.confidences.filter((c): c is number => typeof c === "number");
  return {
    name: name || "Kalem",
    qty: parts.qty !== null && parts.qty > 0 ? parts.qty : 1,
    ...(parts.unitPriceCents !== null ? { unitPriceCents: parts.unitPriceCents } : {}),
    totalPriceCents: total,
    confidence: conf.length > 0 ? Math.min(...conf) : 1,
  };
}

/** Bölünmüş entity'den çıkarılan yarım kalem (yalnız isim ya da yalnız tutar). */
interface PartialItem {
  name: string;
  qty: number | null;
  unitPriceCents: number | null;
  totalPriceCents: number | null;
  confidences: Array<number | undefined>;
  yMid: number;
  timeLike: boolean;
  /** Tutarın geldiği kaynak entity (adet satırı artıklarını ayıklamak için). */
  source?: DocAiEntity;
  /** Tutar kutusu (OCR metninden isim geri-dönüşü için). */
  band?: Box;
}

/** Kalemin alt satırında ayrı gelen adet (ve varsa birim fiyat) — üstteki kaleme iliştirilir. */
interface QtyAttachment {
  qty: number;
  amountCents: number | null;
  yMid: number;
  source: DocAiEntity;
}

interface PlacedItem {
  line: RawLine;
  yMid: number;
  named: boolean;
  explicitQty: boolean;
  timeLike: boolean;
  source?: DocAiEntity;
  band?: Box;
  /** OCR metni satırın toplam/KDV gibi ürün-dışı olduğunu gösterdi → atılacak. */
  dropAsNonItem?: boolean;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

/** "23.02" / "23:02" gibi saat görünümlü metin (başlıktaki Saat satırı tutara karışmasın). */
function looksLikeClockTime(s: string | undefined): boolean {
  if (!s) return false;
  const m = /^([01]?\d|2[0-3])[.:]([0-5]\d)$/.exec(s.trim());
  if (!m) return false;
  // "0.00" saatten çok 0-tutardır (ikram satırı) → saat sayılmaz.
  return Number(m[1]) !== 0 || Number(m[2]) !== 0;
}

/** OCR satır metnini kalem adına dönüştürür: adet önekini ve tutar/para birimi son ekini atar. */
function cleanOcrName(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  // "2 x Kuver" → "Kuver"
  t = t.replace(/^\d+([.,]\d+)?\s*[x×*]\s*/i, "");
  // "1.00 (Ikram) Tursu" → "(Ikram) Tursu" (ondalıklı adet öneki)
  t = t.replace(/^\d+[.,]\d{2}\s+/, "");
  // "Kuver 70.00 TRY" → "Kuver"
  t = t.replace(/\s+\d[\d.,]*[.,]\d{2}\s*(TRY|TL|USD|EUR|GBP|₺|€|\$|£)?$/i, "");
  t = t.replace(/\s+(TRY|TL|USD|EUR|GBP|₺|€|\$|£)$/i, "").trim();
  // Harf içermiyorsa isim değildir (salt sayı/noktalama).
  return /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(t) ? t : "";
}

/** Aksan/noktalama duyarsız karşılaştırma anahtarı ("(Ikram) Turşu" → "ikramtursu"). */
function nameKey(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9]/g, "");
}

/**
 * İsimsiz kalem satırı için tam sayfa OCR'dan isim arar: tutar kutusuyla dikey örtüşen,
 * tutar sütununun solunda kalan en soldaki satır metni alınır. DocAI'nın entity
 * etiketleyicisi ismi kaçırsa da OCR katmanında satır metni durur ("2 x Kuver").
 * `usedNames`: başka kalemlerce zaten kullanılan isimler (eğiklikte komşu satırın
 * ismini çalmamak için atlanır).
 */
function ocrNameForRow(
  ocrLines: OcrLine[],
  band: Box,
  usedNames?: Set<string>,
): { cleaned: string; raw: string } | null {
  const bandH = Math.max(band.yMax - band.yMin, 1e-6);
  let best: { box: Box; cleaned: string; raw: string } | null = null;
  for (const ln of ocrLines) {
    const h = ln.box.yMax - ln.box.yMin;
    // Birden çok satıra yayılan gürültü blokları isim olamaz.
    if (h > 2.5 * bandH) continue;
    const overlap = Math.min(ln.box.yMax, band.yMax) - Math.max(ln.box.yMin, band.yMin);
    if (overlap < 0.5 * Math.min(h || 1e-6, bandH)) continue;
    // Tutar sütununun kendisi ya da sağındaki metinler isim olamaz.
    if (ln.box.xMin >= band.xMin - 0.02) continue;
    const cleaned = cleanOcrName(ln.text);
    if (!cleaned) continue;
    if (usedNames?.has(nameKey(cleaned))) continue;
    if (!best || ln.box.xMin < best.box.xMin) best = { box: ln.box, cleaned, raw: ln.text };
  }
  return best ? { cleaned: best.cleaned, raw: best.raw } : null;
}

/** OCR metnindeki ondalıklı tutar belirteçleri (TR "1.350,00" + US "1,350.00" + "70,00"). */
const AMOUNT_TOKEN = /-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2}/g;

/**
 * Bir isim satırının (band) tutarını tam-sayfa OCR metninden kurtarır. DocAI bazen
 * kalemin İSMİNİ etiketler ama TUTARINI kaçırır → kalem büsbütün kaybolur (özellikle
 * en üstteki satır). Aynı satıra dikey örtüşen OCR metnindeki EN SAĞDAKİ (satır toplamı
 * sütunu) tutar alınır. Saat görünümlü belirteçler atlanır. Bulunamazsa null.
 */
function priceForRow(ocrLines: OcrLine[], band: Box): number | null {
  const bandH = Math.max(band.yMax - band.yMin, 1e-6);
  let best: { cents: number; x: number } | null = null;
  for (const ln of ocrLines) {
    const h = ln.box.yMax - ln.box.yMin;
    if (h > 2.5 * bandH) continue;
    const overlap = Math.min(ln.box.yMax, band.yMax) - Math.max(ln.box.yMin, band.yMin);
    if (overlap < 0.5 * Math.min(h || 1e-6, bandH)) continue;
    const matches = ln.text.match(AMOUNT_TOKEN);
    if (!matches) continue;
    // Sağdaki sütun = satır toplamı → metindeki SON geçerli tutarı al.
    for (let k = matches.length - 1; k >= 0; k--) {
      const tok = matches[k]!;
      if (looksLikeClockTime(tok)) continue;
      const cents = parseAmountToCents(tok);
      if (cents === null) continue;
      if (!best || ln.box.xMax > best.x) best = { cents, x: ln.box.xMax };
      break;
    }
  }
  return best ? best.cents : null;
}

/**
 * Document AI line_item alt-alanlarını satırlara gruplar (Google'ın önerdiği yöntem):
 * 1) description+amount aynı kalemde gelmişse korunur,
 * 2) bölünmüş (yalnız isim / yalnız tutar) parçalar dikey sıraya göre MONOTONİK eşleştirilir
 *    (eğik fişlerde tutar yarım satır kayar; örtüşme yerine sıra + satır-aralığı toleransı),
 * 3) isimsiz adet satırları ("3" ya da "2 252.00" = adet × birim) üstteki kaleme iliştirilir,
 * 4) hâlâ isimsiz kalanlar için tam sayfa OCR metninden satır bazında isim aranır,
 * 5) isimli kalemlerin toplamı fişin toplamını birebir tutuyorsa eşsiz isimsiz tutarlar
 *    (ör. başlıktaki saat) gürültü sayılıp atılır.
 */
function buildLineItems(
  entities: DocAiEntity[],
  referenceTotals: number[],
  ocrLines: OcrLine[],
): RawLine[] {
  const placed: PlacedItem[] = [];
  const namePartials: PartialItem[] = [];
  const amountPartials: PartialItem[] = [];
  const qtyAttachments: QtyAttachment[] = [];
  // Eşleşemeyen isim parçaları (tutarı okunamamış kalem): aritmetik mutabakatta kurtarılır.
  const leftoverNames: PartialItem[] = [];

  for (const entity of entities.filter((e) => e.type === "line_item")) {
    const descChild = childByType(entity, "line_item/description");
    // İsim YALNIZCA description alanından gelir: amount-only entity'nin metni (ör. OCR'ın
    // bozduğu "2.700,C") yanlışlıkla isim olamaz; porsiyon kelimesi ("Tam") de isim değildir.
    const name = pickItemName(entity);
    const qtyChild = childByType(entity, "line_item/quantity");
    const qty = toQuantity(qtyChild);
    const unitPriceCents = toCents(childByType(entity, "line_item/unit_price"));
    const amountChild =
      childByType(entity, "line_item/amount") ?? childByType(entity, "line_item/payment_amount");
    const totalPriceCents = toCents(amountChild);
    const confidences = [amountChild?.confidence, descChild?.confidence, entity.confidence];
    const timeLike = looksLikeClockTime(amountChild?.mentionText ?? entity.mentionText);

    if (name && totalPriceCents !== null) {
      // Document AI bunu doğru eşlemiş → koru.
      const line = buildLine({ name, qty, unitPriceCents, totalPriceCents, confidences });
      if (line)
        placed.push({
          line,
          yMid: boxOf(amountChild ?? entity)?.yMid ?? 0,
          named: true,
          explicitQty: qty !== null,
          timeLike: false,
        });
      continue;
    }

    if (!name && qty !== null) {
      // İsimsiz adet satırı (ör. "2 252.00" → adet × birim fiyat): üstteki kaleme iliştirilecek.
      const qtyY = boxOf(qtyChild ?? entity)?.yMid;
      if (qtyY !== undefined) {
        qtyAttachments.push({
          qty,
          amountCents: totalPriceCents ?? unitPriceCents,
          yMid: qtyY,
          source: entity,
        });
      }
      // DocAI bazen kalemin TUTARINI alt satırın adediyle aynı entity'de birleştirir
      // (eğik kamera çekimi): tutar, eşsiz kalan bir ismin kayıp tutarı olabilir →
      // eşleşme havuzuna da girer. Gerçek birim fiyatsa isimle eşleşmez; artığı,
      // toplam doğrulaması ya da adet-iliştirmedeki aritmetik kontrol eler.
      const amountBox = boxOf(amountChild);
      if (totalPriceCents !== null && amountBox) {
        amountPartials.push({
          name: "",
          qty,
          unitPriceCents,
          totalPriceCents,
          confidences,
          yMid: amountBox.yMid,
          timeLike,
          source: entity,
          band: amountBox,
        });
      }
      continue;
    }

    if (name) {
      const descBox = boxOf(descChild ?? entity);
      // Kutusuz isim: tutarı yok, kalem üretilemez → düşer.
      if (descBox) {
        namePartials.push({
          name,
          qty,
          unitPriceCents,
          totalPriceCents,
          confidences,
          yMid: descBox.yMid,
          timeLike,
          band: descBox,
        });
      }
      continue;
    }

    if (totalPriceCents !== null) {
      const amountBox = boxOf(amountChild ?? entity);
      if (amountBox) {
        amountPartials.push({
          name: "",
          qty,
          unitPriceCents,
          totalPriceCents,
          confidences,
          yMid: amountBox.yMid,
          timeLike,
          source: entity,
          band: amountBox,
        });
      } else {
        // Kutusuz tutar eşleştirilemez ama fiyatı korunur (toplam bozulmasın).
        const line = buildLine({ name: "", qty, unitPriceCents, totalPriceCents, confidences });
        if (line) placed.push({ line, yMid: 0, named: false, explicitQty: qty !== null, timeLike });
      }
    }
  }

  namePartials.sort((a, b) => a.yMid - b.yMid);
  amountPartials.sort((a, b) => a.yMid - b.yMid);

  // Satır aralığı (pitch): ardışık tutar satırlarının medyan dikey mesafesi.
  // Tutar parçası azsa tam kalemlerin aralığından türetilir.
  const gaps: number[] = [];
  for (let k = 1; k < amountPartials.length; k++) {
    gaps.push(amountPartials[k]!.yMid - amountPartials[k - 1]!.yMid);
  }
  const completeYs = placed
    .filter((p) => p.named)
    .map((p) => p.yMid)
    .sort((a, b) => a - b);
  const completeGaps: number[] = [];
  for (let k = 1; k < completeYs.length; k++) {
    completeGaps.push(completeYs[k]! - completeYs[k - 1]!);
  }
  const pitch =
    median(gaps.filter((g) => g > 1e-4)) ?? median(completeGaps.filter((g) => g > 1e-4)) ?? 0.02;
  // Eğiklikten gelen kaymayı tolere et ama komşu satıra atlamayı engelle.
  const tol = Math.min(Math.max(0.6 * pitch, 0.008), 0.045);

  const emitAmountOnly = (a: PartialItem) => {
    // İsimsiz 0-tutar normalde elenir; ama OCR satırında gerçek bir isim varsa
    // ikram satırıdır ("1.00 (Ikram) TURSU TABAGI ... 0.00") → isimle kurtarılır.
    let name = "";
    if (a.totalPriceCents === 0 && !a.timeLike && a.band && ocrLines.length > 0) {
      const usedNames = new Set(placed.filter((p) => p.named).map((p) => nameKey(p.line.name)));
      const hit = ocrNameForRow(ocrLines, a.band, usedNames);
      if (hit && !UNIT_DETAIL_LINE.test(hit.raw)) {
        const norm = normalizeName(hit.cleaned);
        if (!NON_ITEM_NAME.test(norm) && !HEADER_LABEL.test(norm)) name = hit.cleaned;
      }
    }
    const line = buildLine({
      name,
      qty: a.qty,
      unitPriceCents: a.unitPriceCents,
      totalPriceCents: a.totalPriceCents,
      confidences: a.confidences,
    });
    if (line)
      placed.push({
        line,
        yMid: a.yMid,
        named: name !== "",
        explicitQty: a.qty !== null,
        timeLike: a.timeLike,
        ...(a.source ? { source: a.source } : {}),
        ...(a.band ? { band: a.band } : {}),
      });
  };

  let i = 0;
  let j = 0;
  while (i < namePartials.length && j < amountPartials.length) {
    const d = namePartials[i]!;
    const a = amountPartials[j]!;
    const delta = a.yMid - d.yMid;
    if (delta < -tol) {
      // Tutar, sıradaki isimden belirgin yukarıda → eşsiz tutar.
      emitAmountOnly(a);
      j++;
    } else if (delta > tol) {
      // İsmin hizasında tutar yok (okunamamış) → şimdilik düşer; mutabakatta kurtarılabilir.
      leftoverNames.push(d);
      i++;
    } else {
      const line = buildLine({
        name: d.name,
        qty: d.qty ?? a.qty,
        unitPriceCents: d.unitPriceCents ?? a.unitPriceCents,
        totalPriceCents: a.totalPriceCents,
        confidences: [...d.confidences, ...a.confidences],
      });
      if (line)
        placed.push({
          line,
          yMid: d.yMid,
          named: true,
          explicitQty: (d.qty ?? a.qty) !== null,
          timeLike: false,
        });
      i++;
      j++;
    }
  }
  for (; j < amountPartials.length; j++) emitAmountOnly(amountPartials[j]!);
  // Tutar tükendiyse geri kalan isimler de eşsiz kaldı → mutabakat havuzuna gir.
  for (; i < namePartials.length; i++) leftoverNames.push(namePartials[i]!);

  // --- Gürültü ayıklama 1: başlıktaki saat görünümlü eşsiz tutar ---
  // OCR isimlendirmesinden ÖNCE çalışmalı: "Saat 22.02" tutarı, solundaki başlık
  // etiketinden ("Tarih") isim alıp hayatta kalmamalı.
  const minNamedY = placed
    .filter((p) => p.named)
    .reduce((min, p) => Math.min(min, p.yMid), Number.POSITIVE_INFINITY);
  let result = placed.filter((p) => !(p.timeLike && !p.named && p.yMid < minNamedY));

  result.sort((a, b) => a.yMid - b.yMid);

  // --- Adet iliştirme: ayrı satırdaki adet, hemen üstündeki kaleme aittir ---
  // OCR isimlendirmesinden ÖNCE: "2 AD X 252.00" gibi birim-fiyat detay satırının
  // artığı, isim almadan önce silinmeli (yoksa OCR ona "2 AD X" diye isim verip korur).
  if (qtyAttachments.length > 0 && result.length > 0) {
    const itemGaps: number[] = [];
    for (let k = 1; k < result.length; k++) {
      itemGaps.push(result[k]!.yMid - result[k - 1]!.yMid);
    }
    const itemPitch = median(itemGaps.filter((g) => g > 1e-4));
    const maxGap = itemPitch !== null ? 1.2 * itemPitch : 0.06;
    const verifiedUnitSources = new Set<DocAiEntity>();

    for (const att of qtyAttachments.sort((a, b) => a.yMid - b.yMid)) {
      let target: PlacedItem | undefined;
      for (const p of result) {
        // Adet satırının kendi tutarından doğan isimsiz artık hedef olamaz.
        if (p.source === att.source) continue;
        if (p.yMid < att.yMid && (!target || p.yMid > target.yMid)) target = p;
      }
      if (!target || target.explicitQty) continue;
      if (att.yMid - target.yMid > maxGap) continue;
      // Aritmetik doğrulama: adet × tutar = kalem toplamı ise tutar birim fiyattır →
      // aynı entity'den üretilmiş isimsiz "Kalem" artığı gürültüdür, silinir.
      if (
        att.amountCents !== null &&
        Math.round(att.qty * att.amountCents) === target.line.totalPriceCents
      ) {
        target.line.unitPriceCents = att.amountCents;
        verifiedUnitSources.add(att.source);
      }
      target.line.qty = att.qty;
      target.explicitQty = true;
    }

    if (verifiedUnitSources.size > 0) {
      // Doğrulanmış birim-fiyat kaynağının artığı gürültüdür. Hedef kalemin kaynağı
      // (att.source) bu kümeye hiç eklenmediğinden hedef güvende kalır.
      result = result.filter((p) => !p.source || !verifiedUnitSources.has(p.source));
    }
  }

  // --- OCR metin geri-dönüşü: isimsiz kalemler için satır metninden isim ara ---
  // DocAI'nın etiketleyicisi ismi kaçırsa da ("2 x Kuver  70.00") OCR katmanı okur.
  if (ocrLines.length > 0) {
    const usedNames = new Set(
      result.filter((p) => p.named).map((p) => nameKey(p.line.name)),
    );
    for (const p of result) {
      if (p.named || !p.band) continue;
      const hit = ocrNameForRow(ocrLines, p.band, usedNames);
      if (!hit) continue;
      const norm = normalizeName(hit.cleaned);
      if (NON_ITEM_NAME.test(norm) || HEADER_LABEL.test(norm) || UNIT_DETAIL_LINE.test(hit.raw)) {
        // Toplam/KDV, başlık alanı (Tarih/Masa) ya da birim-fiyat detayı (2 AD X) → atılır.
        p.dropAsNonItem = true;
      } else {
        p.line.name = hit.cleaned;
        p.named = true;
        usedNames.add(nameKey(hit.cleaned));
      }
    }
    result = result.filter((p) => !p.dropAsNonItem);
  }

  // --- Aritmetik mutabakat (Katman C): isim kurtarma ---
  // Monotonik eşleme, isim kutusu tutar kutusundan ~1 satır kaymışsa (iki satıra taşan
  // kalem / eğik çekim) ismi eşsiz bırakıp tutarı isimsiz "Kalem" olarak yerleştirir.
  // Eşsiz ismi, satır bandında (≈ pitch toleransı) en yakın isimsiz kaleme bağlarız.
  // Bu adım TUTARLARI DEĞİŞTİRMEZ; yalnız "Kalem"e gerçek isim verir → her zaman güvenli.
  if (leftoverNames.length > 0) {
    const reconTol = Math.min(Math.max(pitch, 0.012), 0.08);
    const usedNames = new Set(result.filter((p) => p.named).map((p) => nameKey(p.line.name)));
    for (const nm of [...leftoverNames].sort((a, b) => a.yMid - b.yMid)) {
      const cleaned = nm.name.replace(/\s+/g, " ").trim();
      const norm = normalizeName(cleaned);
      if (!cleaned || NON_ITEM_NAME.test(norm) || HEADER_LABEL.test(norm)) continue;
      if (usedNames.has(nameKey(cleaned))) continue;
      let target: PlacedItem | undefined;
      for (const p of result) {
        if (p.named || p.dropAsNonItem) continue;
        if (Math.abs(p.yMid - nm.yMid) > reconTol) continue;
        if (!target || Math.abs(p.yMid - nm.yMid) < Math.abs(target.yMid - nm.yMid)) target = p;
      }
      if (target) {
        target.line.name = cleaned;
        target.named = true;
        if (nm.qty !== null && nm.qty > 0) target.line.qty = nm.qty;
        usedNames.add(nameKey(cleaned));
        continue;
      }
      // Eşsiz tutar yok → DocAI bu kalemin TUTARINI da kaçırmış olabilir (kalem büsbütün
      // kaybolurdu — örn. en üstteki satır). Tutarı OCR satır metninden kurtar; OCR'dan
      // geldiği için güveni eşik altında bırak → pipeline kullanıcıya onaylatır (sessiz
      // yanlış yerine görünür kurtarma). Tutar bulunamazsa eskisi gibi düşer.
      if (nm.band && ocrLines.length > 0) {
        const cents = nm.totalPriceCents ?? priceForRow(ocrLines, nm.band);
        if (cents !== null && cents > 0) {
          const line = buildLine({
            name: cleaned,
            qty: nm.qty,
            unitPriceCents: nm.unitPriceCents,
            totalPriceCents: cents,
            confidences: [0.5],
          });
          if (line) {
            result.push({
              line,
              yMid: nm.yMid,
              named: true,
              explicitQty: nm.qty !== null,
              timeLike: false,
            });
            usedNames.add(nameKey(cleaned));
          }
        }
      }
    }
  }

  // İsimli kalemlerin toplamı fişin toplamını (net ya da genel) birebir tutuyorsa,
  // isimsiz artıklar gürültüdür (saat, birim fiyat vb.) → atılır.
  const namedSum = result.filter((p) => p.named).reduce((acc, p) => acc + p.line.totalPriceCents, 0);
  const allSum = result.reduce((acc, p) => acc + p.line.totalPriceCents, 0);
  if (
    result.some((p) => !p.named) &&
    referenceTotals.includes(namedSum) &&
    !referenceTotals.includes(allSum)
  ) {
    result = result.filter((p) => p.named);
  }

  // Mutabakattan sonra toplam HÂLÂ tutmuyorsa, isimsiz ("Kalem") kalemler şüphelidir:
  // güvenlerini eşik altına çek ki pipeline tek tek onaya düşürsün (sessizce yanlış dönme).
  if (referenceTotals.length > 0) {
    const finalSum = result.reduce((acc, p) => acc + p.line.totalPriceCents, 0);
    if (!referenceTotals.includes(finalSum)) {
      for (const p of result) {
        if (!p.named) p.line.confidence = Math.min(p.line.confidence, 0.5);
      }
    }
  }

  result.sort((a, b) => a.yMid - b.yMid);
  return result.map((p) => p.line);
}

export function mapDocAiToRaw(doc: DocAiDocument, input: AnalyzeInput): unknown {
  const entities = doc.entities ?? [];
  const byType = (type: string) => entities.find((e) => e.type === type);

  const netCents = toCents(byType("net_amount"));
  const taxCents = toCents(byType("total_tax_amount"));
  const totalCents = toCents(byType("total_amount"));

  // Gürültü ayıklamada çapa olarak kullanılacak fiş toplamları.
  const referenceTotals = [netCents, totalCents].filter((v): v is number => v !== null && v > 0);
  const allLines = buildLineItems(entities, referenceTotals, extractOcrLines(doc));

  // Negatif tutarlı satırlar indirim/iskonto kalemleridir (ör. "Kampanya İndirim").
  // Kalem listesinden ayrılıp toplam indirim olarak biriktirilir; split-engine bunu
  // kalem tabanına oransal düşürür (DESIGN §4). Kalemler brüt kalır, böylece
  // ara toplam − indirim = fiş toplamı tutar ve "kayma"/dengesizlik oluşmaz.
  const lineItems = allLines.filter((it) => it.totalPriceCents >= 0);
  const discountCents = allLines
    .filter((it) => it.totalPriceCents < 0)
    .reduce((acc, it) => acc - it.totalPriceCents, 0);
  const itemsSum = lineItems.reduce((acc, it) => acc + it.totalPriceCents, 0);

  const subtotalCents = netCents ?? itemsSum;
  const tax = taxCents ?? 0;
  const total = totalCents ?? subtotalCents + tax - discountCents;

  // KDV kalem fiyatlarına dahil mi? subtotal + tax − indirim == total ise ayrı KDV var.
  const taxIncludedInItems = !(tax > 0 && subtotalCents + tax - discountCents === total);

  const { currency, confidence: currencyConfidence } = resolveCurrency(
    byType("currency"),
    input.hints?.locale,
  );

  const dateEntity = byType("receipt_date") ?? byType("purchase_time");
  const dv = dateEntity?.normalizedValue?.dateValue;
  const date =
    dv?.year && dv.month && dv.day
      ? `${dv.year}-${String(dv.month).padStart(2, "0")}-${String(dv.day).padStart(2, "0")}`
      : dateEntity?.mentionText?.trim();

  const merchant = (byType("supplier_name")?.mentionText ?? "").trim() || undefined;

  return {
    meta: {
      ...(merchant ? { merchant } : {}),
      ...(date ? { date } : {}),
      ...(currency ? { currency } : {}),
      ...(input.hints?.locale ? { locale: input.hints.locale } : {}),
      currencyConfidence,
    },
    lineItems,
    charges: {
      subtotalCents,
      taxCents: tax,
      serviceChargeCents: 0,
      discountCents,
      tipCents: 0,
      totalCents: total,
      taxIncludedInItems,
    },
  };
}
