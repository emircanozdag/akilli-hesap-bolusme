import { describe, it, expect, vi } from "vitest";
import {
  DocumentAiProvider,
  ProviderError,
  analyzeRaw,
  mapDocAiToRaw,
  parseAmountToCents,
  orchestrate,
  rawOcrResultSchema,
} from "../src/index.js";
import type { AnalyzeInput } from "../src/types.js";

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/jpeg", hints: { locale: "tr-TR" } };

/** Test fixture'ları için yapısal entity tipi (mapper'ın DocAiEntity'siyle uyumlu). */
interface FixtureEntity {
  type: string;
  mentionText?: string;
  confidence?: number;
  normalizedValue?: {
    text?: string;
    moneyValue?: { currencyCode?: string; units?: string; nanos?: number };
    integerValue?: number;
  };
  pageAnchor?: {
    pageRefs?: Array<{ boundingPoly?: { normalizedVertices?: Array<{ x: number; y: number }> } }>;
  };
  properties?: FixtureEntity[];
}

/** moneyValue üreten yardımcı (units string + nanos). */
function money(units: number, nanos = 0) {
  return { normalizedValue: { moneyValue: { currencyCode: "TRY", units: String(units), nanos } } };
}

/** line_item entity üretir. */
function lineItem(opts: {
  desc: string;
  qty?: number;
  unitCents?: number;
  amountCents?: number;
  amountText?: string;
  conf?: number;
}) {
  const properties: FixtureEntity[] = [
    { type: "line_item/description", mentionText: opts.desc, confidence: opts.conf ?? 0.95 },
  ];
  if (opts.qty !== undefined) {
    properties.push({ type: "line_item/quantity", normalizedValue: { integerValue: opts.qty } });
  }
  if (opts.unitCents !== undefined) {
    properties.push({ type: "line_item/unit_price", ...money(Math.floor(opts.unitCents / 100), (opts.unitCents % 100) * 1e7) });
  }
  if (opts.amountCents !== undefined) {
    properties.push({ type: "line_item/amount", ...money(Math.floor(opts.amountCents / 100), (opts.amountCents % 100) * 1e7), confidence: opts.conf ?? 0.95 });
  } else if (opts.amountText !== undefined) {
    properties.push({ type: "line_item/amount", mentionText: opts.amountText, confidence: opts.conf ?? 0.95 });
  }
  return { type: "line_item", confidence: opts.conf ?? 0.95, properties };
}

/** Ekteki gerçek fişi (BAHÇE 26A) temsil eden Document AI yanıtı. */
function realReceiptDoc() {
  return {
    document: {
      entities: [
        // KISI SAYISI 7 0,00 0,00 → ürün değil, elenmeli.
        lineItem({ desc: "KISI SAYISI", qty: 7, amountCents: 0 }),
        lineItem({ desc: "CAM SISE SU", qty: 9, unitCents: 15000, amountCents: 135000 }),
        lineItem({ desc: "URFA KEBAP", qty: 2, unitCents: 95000, amountCents: 190000 }),
        lineItem({ desc: "KUZU SIS", qty: 2, unitCents: 115000, amountCents: 230000 }),
        // TR metin formatlı tutar (moneyValue yok).
        lineItem({ desc: "AYRAN", qty: 1, amountText: "1.000,00" }),
        { type: "currency", mentionText: "TL", confidence: 0.9 },
        { type: "supplier_name", mentionText: "BAHCE 26A" },
      ],
    },
  };
}

describe("parseAmountToCents — TR/US sayı formatı", () => {
  it("TR formatı (binlik . / ondalık ,)", () => {
    expect(parseAmountToCents("1.350,00")).toBe(135000);
    expect(parseAmountToCents("16.945,00")).toBe(1694500);
    expect(parseAmountToCents("70,00")).toBe(7000);
  });
  it("US formatı (binlik , / ondalık .)", () => {
    expect(parseAmountToCents("1,350.00")).toBe(135000);
  });
  it("ayraçsız tam sayı", () => {
    expect(parseAmountToCents("100")).toBe(10000);
  });
  it("negatif (indirim)", () => {
    expect(parseAmountToCents("-50,00")).toBe(-5000);
  });
  it("sayısal olmayan → null", () => {
    expect(parseAmountToCents("abc")).toBeNull();
  });
});

describe("mapDocAiToRaw — gerçek fiş", () => {
  const raw = mapDocAiToRaw(realReceiptDoc().document, input);
  const parsed = rawOcrResultSchema.safeParse(raw);

  it("şemaya uygun çıktı üretir", () => {
    expect(parsed.success).toBe(true);
  });

  it("0-tutar (KISI SAYISI) satırını eler", () => {
    if (!parsed.success) throw new Error("parse fail");
    const names = parsed.data.lineItems.map((it) => it.name);
    expect(names).not.toContain("KISI SAYISI");
    expect(parsed.data.lineItems).toHaveLength(4);
  });

  it("adet birincil okunur (qty=9, 1'e düşmez)", () => {
    if (!parsed.success) throw new Error("parse fail");
    const su = parsed.data.lineItems.find((it) => it.name === "CAM SISE SU");
    expect(su?.qty).toBe(9);
    expect(su?.unitPriceCents).toBe(15000);
    expect(su?.totalPriceCents).toBe(135000);
  });

  it("qty x birim = tutar (çapraz kontrol için)", () => {
    if (!parsed.success) throw new Error("parse fail");
    for (const it of parsed.data.lineItems) {
      if (it.unitPriceCents !== undefined) {
        expect(it.unitPriceCents * it.qty).toBe(it.totalPriceCents);
      }
    }
  });

  it("TR metin formatlı tutarı kuruşa çevirir (AYRAN 1.000,00)", () => {
    if (!parsed.success) throw new Error("parse fail");
    const ayran = parsed.data.lineItems.find((it) => it.name === "AYRAN");
    expect(ayran?.totalPriceCents).toBe(100000);
  });

  it("currency entity'den TRY çözer", () => {
    if (!parsed.success) throw new Error("parse fail");
    expect(parsed.data.meta.currency).toBe("TRY");
  });
});

describe("mapDocAiToRaw — indirim (negatif kalem) toplam indirime ayrılır", () => {
  // QUICK CHINA fişindeki "Kampanya İndirim" gibi negatif satırlar eskiden
  // NON_ITEM_NAME (indirim) yüzünden sessizce eleniyordu → kalemler toplamı fiş
  // toplamından sapıyor, "kayma"/dengesizlik oluşuyordu. Artık indirime ayrılmalı.
  const doc = {
    entities: [
      lineItem({ desc: "CALIFORNIA ROLL", qty: 1, amountCents: 65000 }),
      lineItem({ desc: "Kampanya İndirim", amountText: "-162,50" }),
      lineItem({ desc: "PIKACHU", qty: 1, amountCents: 29000 }),
      { type: "total_amount", mentionText: "777,50" },
      { type: "currency", mentionText: "TL", confidence: 0.9 },
    ],
  };
  const raw = mapDocAiToRaw(doc, input);
  const parsed = rawOcrResultSchema.safeParse(raw);

  it("indirim satırını kalem listesinden çıkarır", () => {
    if (!parsed.success) throw new Error("parse fail");
    const names = parsed.data.lineItems.map((it) => it.name);
    expect(names).not.toContain("Kampanya İndirim");
    expect(parsed.data.lineItems).toHaveLength(2);
  });

  it("negatif tutarları toplam indirime toplar (pozitif kuruş)", () => {
    if (!parsed.success) throw new Error("parse fail");
    expect(parsed.data.charges.discountCents).toBe(16250);
    expect(parsed.data.charges.subtotalCents).toBe(94000);
    expect(parsed.data.charges.totalCents).toBe(77750);
  });

  it("ara toplam − indirim = fiş toplamı (aritmetik dengeli)", () => {
    if (!parsed.success) throw new Error("parse fail");
    const ana = analyzeRaw(parsed.data, input);
    expect(ana.arithmetic.balanced).toBe(true);
    expect(ana.arithmetic.discrepancyCents).toBe(0);
  });
});

/** Kutulu line_item alt-alanı (bölünmüş parça simülasyonu için). */
function boxedProp(
  kind: "description" | "amount" | "quantity",
  value: string,
  yTop: number,
  xLeft: number,
) {
  const yBot = yTop + 0.012;
  return {
    type: `line_item/${kind}`,
    mentionText: value,
    confidence: 1,
    pageAnchor: {
      pageRefs: [
        {
          boundingPoly: {
            normalizedVertices: [
              { x: xLeft, y: yTop },
              { x: xLeft + 0.1, y: yTop },
              { x: xLeft + 0.1, y: yBot },
              { x: xLeft, y: yBot },
            ],
          },
        },
      ],
    },
  };
}

/** Belirli bir y satırında (kutulu) tek alanlı line_item üretir. */
function boxedFrag(
  kind: "description" | "amount",
  value: string,
  yTop: number,
  xLeft: number,
) {
  return { type: "line_item", confidence: 1, properties: [boxedProp(kind, value, yTop, xLeft)] };
}

describe("mapDocAiToRaw — geometri ile satır gruplama", () => {
  it("bölünmüş isim/tutar entity'lerini dikey örtüşmeye göre eşler", () => {
    // Document AI isim ve tutarı ayrı line_item olarak döndürmüş; konuma göre birleşmeli.
    const doc = {
      entities: [
        boxedFrag("description", "KUZU SIS", 0.4, 0.34),
        boxedFrag("amount", "230,00", 0.405, 0.66),
        boxedFrag("description", "AYRAN", 0.45, 0.34),
        boxedFrag("amount", "70,00", 0.455, 0.66),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(2);
    const kuzu = raw.lineItems.find((it) => it.name === "KUZU SIS");
    const ayran = raw.lineItems.find((it) => it.name === "AYRAN");
    expect(kuzu?.totalPriceCents).toBe(23000);
    expect(ayran?.totalPriceCents).toBe(7000);
  });

  it("eğik fişte (kutular hiç örtüşmese de) isim-tutar sırayla eşleşir", () => {
    // Gerçek hata modu: fiş eğik çekilmiş, tutar ismin yarım satır altında.
    const doc = {
      entities: [
        boxedFrag("description", "KUVER", 0.4, 0.34),
        boxedFrag("amount", "120,00", 0.413, 0.66), // örtüşme yok, Δy < satır aralığı
        boxedFrag("description", "MANTAR", 0.44, 0.34),
        boxedFrag("amount", "40,00", 0.453, 0.66),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems.map((it) => [it.name, it.totalPriceCents])).toEqual([
      ["KUVER", 12000],
      ["MANTAR", 4000],
    ]);
  });

  it("isimli 0-tutar satırı korunur (ikram), isimsiz 0 elenir", () => {
    const doc = {
      entities: [
        boxedFrag("description", "ŞİŞE MEYVESİ", 0.4, 0.34),
        boxedFrag("amount", "0,00", 0.405, 0.66),
        boxedFrag("amount", "0,00", 0.8, 0.66), // eşsiz 0 → gürültü
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(1);
    expect(raw.lineItems[0]).toMatchObject({ name: "ŞİŞE MEYVESİ", totalPriceCents: 0 });
  });

  it("alt satırdaki adet üstteki kaleme iliştirilir; adet × birim = toplam ise birim de bağlanır", () => {
    // LEMAN düzeni: "KANKALAR SEPETI  504.00" altında "2 252.00" (adet × birim) satırı.
    const doc = {
      entities: [
        { type: "total_amount", mentionText: "681.00", normalizedValue: { text: "681" } },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "BITKI CAYI", 0.36, 0.25),
            boxedProp("amount", "177.00", 0.36, 0.62),
          ],
        },
        { type: "line_item", confidence: 1, properties: [boxedProp("quantity", "3", 0.4, 0.31)] },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "KANKALAR SEPETI", 0.5, 0.24),
            boxedProp("amount", "504.00", 0.5, 0.63),
          ],
        },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("quantity", "2", 0.53, 0.3),
            boxedProp("amount", "252.00", 0.53, 0.37),
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; qty: number; unitPriceCents?: number; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(2);
    expect(raw.lineItems[0]).toMatchObject({ name: "BITKI CAYI", qty: 3, totalPriceCents: 17700 });
    expect(raw.lineItems[1]).toMatchObject({
      name: "KANKALAR SEPETI",
      qty: 2,
      unitPriceCents: 25200,
      totalPriceCents: 50400,
    });
  });

  it("OCR'da '2 AD X 252.00' birim-fiyat detay satırı ayrı kalem olmaz", () => {
    // Gerçek hata modu: "2 AD X 252.00" artığı, OCR geri-dönüşüyle "2 AD X" diye
    // isimlenip ayrı kalem oluyordu. Birim doğrulanıp (2×252=504) artık silinmeli.
    const text = "KANKALAR SEPETI\n504.00\n2 AD X 252.00\nKLASIK DEMLEME CAY\n75.00\n3 AD X 25.00\n";
    const seg = (start: number, end: number) => ({
      textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] },
    });
    const poly = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      boundingPoly: {
        normalizedVertices: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax },
        ],
      },
    });
    const doc = {
      text,
      pages: [
        {
          lines: [
            { layout: { ...seg(0, 15), ...poly(0.24, 0.47, 0.49, 0.52) } }, // KANKALAR SEPETI
            { layout: { ...seg(16, 22), ...poly(0.63, 0.7, 0.49, 0.51) } }, // 504.00
            { layout: { ...seg(23, 35), ...poly(0.24, 0.55, 0.53, 0.55) } }, // "2 AD X 252.00"
          ],
        },
      ],
      entities: [
        { type: "total_amount", mentionText: "504.00", normalizedValue: { text: "504" } },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "KANKALAR SEPETI", 0.5, 0.24),
            boxedProp("amount", "504.00", 0.5, 0.63),
          ],
        },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("quantity", "2", 0.53, 0.3),
            boxedProp("amount", "252.00", 0.53, 0.37),
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; qty: number; unitPriceCents?: number; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(1);
    expect(raw.lineItems[0]).toMatchObject({
      name: "KANKALAR SEPETI",
      qty: 2,
      unitPriceCents: 25200,
      totalPriceCents: 50400,
    });
    expect(raw.lineItems.some((it) => /AD\s*X/i.test(it.name))).toBe(false);
  });

  it("DocAI tutarı kaçırdığı en üstteki kalemi OCR satır metninden kurtarır", () => {
    // Gerçek hata modu ("atom" fişi): DocAI en üstteki kalemin İSMİNİ etiketler ama
    // TUTARINI kaçırır → kalem büsbütün kaybolurdu. OCR satırında "ATOM 120,00" durur;
    // tutar oradan kurtarılır. OCR'dan geldiği için güven eşik altı (kullanıcı onayı).
    const text = "ATOM 120,00\nKOLA 30,00\nSU 15,00\n";
    const seg = (start: number, end: number) => ({
      textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] },
    });
    const poly = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      boundingPoly: {
        normalizedVertices: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax },
        ],
      },
    });
    const doc = {
      text,
      pages: [
        {
          lines: [
            { layout: { ...seg(0, 11), ...poly(0.12, 0.82, 0.1, 0.112) } }, // ATOM 120,00
            { layout: { ...seg(12, 22), ...poly(0.12, 0.8, 0.16, 0.172) } }, // KOLA 30,00
            { layout: { ...seg(23, 31), ...poly(0.12, 0.8, 0.2, 0.212) } }, // SU 15,00
          ],
        },
      ],
      entities: [
        { type: "total_amount", mentionText: "165,00" },
        // En üstte YALNIZ isim — tutar entity'si yok (DocAI kaçırdı).
        { type: "line_item", confidence: 1, properties: [boxedProp("description", "ATOM", 0.1, 0.12)] },
        {
          type: "line_item",
          confidence: 1,
          properties: [boxedProp("description", "KOLA", 0.16, 0.12), boxedProp("amount", "30,00", 0.16, 0.7)],
        },
        {
          type: "line_item",
          confidence: 1,
          properties: [boxedProp("description", "SU", 0.2, 0.12), boxedProp("amount", "15,00", 0.2, 0.7)],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input);
    const parsed = rawOcrResultSchema.safeParse(raw);
    if (!parsed.success) throw new Error("parse fail");
    const atom = parsed.data.lineItems.find((it) => it.name === "ATOM");
    expect(atom?.totalPriceCents).toBe(12000);
    expect(atom?.confidence).toBeLessThan(0.6); // OCR'dan kurtarıldı → onaya düşer
    expect(parsed.data.lineItems).toHaveLength(3);
    const ana = analyzeRaw(parsed.data, input);
    expect(ana.arithmetic.balanced).toBe(true);
  });

  it("yalnız porsiyon kelimesi ('Tam') isim sayılmaz; gerçek isim OCR'dan gelir (SU)", () => {
    // GÜZELİZ düzeni: "SU  3 Tam  36,00" satırında isim etiketlenmemiş, sadece "Tam".
    const text = "SODA\n1 Tam\n10,00\nSU\n3 Tam\n36,00\n";
    const seg = (start: number, end: number) => ({
      textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] },
    });
    const poly = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      boundingPoly: {
        normalizedVertices: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax },
        ],
      },
    });
    const doc = {
      text,
      pages: [
        {
          lines: [
            { layout: { ...seg(0, 4), ...poly(0.29, 0.33, 0.632, 0.64) } }, // SODA
            { layout: { ...seg(17, 19), ...poly(0.29, 0.31, 0.643, 0.653) } }, // SU
            { layout: { ...seg(20, 25), ...poly(0.49, 0.53, 0.644, 0.652) } }, // "3 Tam"
          ],
        },
      ],
      entities: [
        { type: "total_amount", mentionText: "46,00", normalizedValue: { text: "46" } },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "SODA", 0.632, 0.29),
            boxedProp("quantity", "1", 0.632, 0.49),
            boxedProp("description", "Tam", 0.632, 0.5),
            boxedProp("amount", "10,00", 0.632, 0.58),
          ],
        },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("quantity", "3", 0.644, 0.49),
            boxedProp("description", "Tam", 0.644, 0.5),
            boxedProp("amount", "36,00", 0.645, 0.57),
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; qty: number; totalPriceCents: number }>;
    };
    expect(raw.lineItems.some((it) => it.name === "Tam")).toBe(false);
    expect(raw.lineItems).toContainEqual(
      expect.objectContaining({ name: "SU", qty: 3, totalPriceCents: 3600 }),
    );
    expect(raw.lineItems).toContainEqual(
      expect.objectContaining({ name: "SODA", qty: 1, totalPriceCents: 1000 }),
    );
  });

  it("ödeme/footer satırları (Kredi Kartı, Tahsil Edilen, Kalan) kalem sayılmaz", () => {
    const doc = {
      entities: [
        { type: "total_amount", mentionText: "60,00", normalizedValue: { text: "60" } },
        lineItem({ desc: "ATOM", qty: 1, amountText: "60,00" }),
        lineItem({ desc: "Kredi Kartı Ödemeler", qty: 1, amountText: "60,00" }),
        lineItem({ desc: "Tahsil Edilen", qty: 1, amountText: "60,00" }),
        lineItem({ desc: "Kalan", qty: 1, amountText: "0,00" }),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as { lineItems: Array<{ name: string }> };
    expect(raw.lineItems.map((it) => it.name)).toEqual(["ATOM"]);
  });

  it("mutabakat: isim kutusu ~1 satır kaymışsa, eşsiz isim bandındaki isimsiz tutara bağlanır", () => {
    // İsim kutusu (PORTAKAL) tutar kutusundan ~1 satır aşağıda → monotonik eşleme
    // ismi eşsiz bırakır, tutarı "Kalem" olarak yerleştirir; mutabakat geri bağlar.
    const doc = {
      entities: [
        { type: "total_amount", mentionText: "100,00", normalizedValue: { text: "100" } },
        boxedFrag("description", "CAY", 0.48, 0.34),
        boxedFrag("amount", "25,00", 0.48, 0.66),
        boxedFrag("description", "PORTAKAL", 0.515, 0.34),
        boxedFrag("amount", "75,00", 0.5, 0.66),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems.some((it) => it.name === "Kalem")).toBe(false);
    expect(raw.lineItems).toContainEqual(
      expect.objectContaining({ name: "PORTAKAL", totalPriceCents: 7500 }),
    );
    expect(raw.lineItems).toContainEqual(
      expect.objectContaining({ name: "CAY", totalPriceCents: 2500 }),
    );
  });

  it("mutabakat dengeli fişte hiçbir şeyi değiştirmez (geriye dönük güvenlik)", () => {
    // Σ kalem == genel toplam → isimsiz kalem korunur, güveni düşürülmez.
    const doc = {
      entities: [
        { type: "total_amount", mentionText: "100,00", normalizedValue: { text: "100" } },
        boxedFrag("description", "CAY", 0.48, 0.34),
        boxedFrag("amount", "25,00", 0.48, 0.66),
        boxedFrag("amount", "75,00", 0.6, 0.66),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number; confidence: number }>;
    };
    const kalem = raw.lineItems.find((it) => it.name === "Kalem");
    expect(kalem?.totalPriceCents).toBe(7500);
    expect(kalem?.confidence).toBe(1);
  });

  it("mutabakat: toplam tutmuyor ve kapatılamıyorsa isimsiz kalemin güveni eşik altına çekilir", () => {
    // Σ kalem (100) ≠ genel toplam (200), kurtarılacak isim yok → "Kalem" şüpheli sayılır;
    // pipeline bunu düşük güvenle tek tek onaya düşürebilsin diye conf ≤ 0.5.
    const doc = {
      entities: [
        { type: "total_amount", mentionText: "200,00", normalizedValue: { text: "200" } },
        boxedFrag("description", "CAY", 0.48, 0.34),
        boxedFrag("amount", "25,00", 0.48, 0.66),
        boxedFrag("amount", "75,00", 0.6, 0.66),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; confidence: number }>;
    };
    const kalem = raw.lineItems.find((it) => it.name === "Kalem");
    expect(kalem).toBeDefined();
    expect(kalem!.confidence).toBeLessThanOrEqual(0.5);
  });

  it("tutar, alt satırın adediyle aynı entity'de birleşmişse isim yine tutarına kavuşur (kamera/eğik)", () => {
    // Gerçek hata modu (LEMAN kamera çekimi): "TAZE PORTAKAL SUYU" isim olarak ayrı,
    // tutarı 180.00 ise alt satırın adedi (3) ile aynı entity'de geldi → kalem kaybolmamalı.
    const doc = {
      entities: [
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "KLASIK DEMLEME CAY", 0.605, 0.21),
          ],
        },
        boxedFrag("amount", "75.00", 0.616, 0.71),
        {
          type: "line_item",
          confidence: 1,
          properties: [boxedProp("description", "MILKSHAKE CIKOLATALI", 0.665, 0.21)],
        },
        boxedFrag("amount", "74.00", 0.68, 0.71),
        {
          type: "line_item",
          confidence: 1,
          properties: [boxedProp("description", "TAZE PORTAKAL SUYU", 0.725, 0.21)],
        },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("quantity", "3", 0.75, 0.28),
            boxedProp("amount", "180.00", 0.742, 0.69),
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; qty: number; totalPriceCents: number }>;
    };
    expect(raw.lineItems.map((it) => [it.name, it.qty, it.totalPriceCents])).toEqual([
      ["KLASIK DEMLEME CAY", 1, 7500],
      ["MILKSHAKE CIKOLATALI", 1, 7400],
      ["TAZE PORTAKAL SUYU", 3, 18000],
    ]);
  });

  it("entity'de ismi olmayan kalem, tam sayfa OCR satırından isimlendirilir (2 x Kuver)", () => {
    // Gerçek hata modu (adisyon kamera çekimi): "2 x Kuver 70.00" satırının ismi
    // entity olarak etiketlenmedi; isim OCR metninden geri kazanılmalı.
    const text = "2 x Kuver\nПят\n70.00 TRY\n1 x Terleten\n100.00 TRY\n";
    const seg = (start: number, end: number) => ({
      textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] },
    });
    const poly = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      boundingPoly: {
        normalizedVertices: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax },
        ],
      },
    });
    const doc = {
      text,
      pages: [
        {
          lines: [
            { layout: { ...seg(0, 9), ...poly(0.09, 0.25, 0.255, 0.279) } }, // "2 x Kuver"
            { layout: { ...seg(10, 13), ...poly(0.43, 0.8, 0.244, 0.393) } }, // çok satırlı gürültü
            { layout: { ...seg(14, 23), ...poly(0.82, 1.0, 0.249, 0.276) } }, // "70.00 TRY"
            { layout: { ...seg(24, 36), ...poly(0.09, 0.31, 0.307, 0.332) } }, // "1 x Terleten"
            { layout: { ...seg(37, 47), ...poly(0.8, 1.0, 0.304, 0.331) } }, // "100.00 TRY"
          ],
        },
      ],
      entities: [
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("quantity", "2", 0.256, 0.09),
            boxedProp("amount", "70.00", 0.249, 0.82),
          ],
        },
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("quantity", "1", 0.307, 0.09),
            boxedProp("description", "Terleten", 0.307, 0.16),
            boxedProp("amount", "100.00", 0.305, 0.8),
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; qty: number; totalPriceCents: number }>;
    };
    expect(raw.lineItems.map((it) => [it.name, it.qty, it.totalPriceCents])).toEqual([
      ["Kuver", 2, 7000],
      ["Terleten", 1, 10000],
    ]);
  });

  it("başlıktaki 'Saat 22.02' tutarı, solundaki 'Tarih' etiketiyle isimlenip kalem olamaz", () => {
    // Gerçek hata modu: saat görünümlü tutar OCR'daki başlık etiketinden isim alıp
    // saat filtresinden kaçıyordu. Saat filtresi artık OCR isimlendirmeden önce çalışır.
    const text = "Tarih\nSaat 22.02\nKARIDES TAVA\n35.00\n";
    const seg = (start: number, end: number) => ({
      textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] },
    });
    const poly = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      boundingPoly: {
        normalizedVertices: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax },
        ],
      },
    });
    const doc = {
      text,
      pages: [
        {
          lines: [
            { layout: { ...seg(0, 5), ...poly(0.03, 0.15, 0.07, 0.09) } }, // "Tarih"
            { layout: { ...seg(6, 16), ...poly(0.7, 0.98, 0.069, 0.092) } }, // "Saat 22.02"
            { layout: { ...seg(17, 29), ...poly(0.2, 0.5, 0.24, 0.26) } }, // "KARIDES TAVA"
            { layout: { ...seg(30, 35), ...poly(0.85, 0.95, 0.24, 0.26) } }, // "35.00"
          ],
        },
      ],
      entities: [
        boxedFrag("amount", "22.02", 0.07, 0.88), // başlıktaki saat → tutar sanıldı
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "KARIDES TAVA", 0.24, 0.2),
            boxedProp("amount", "35.00", 0.24, 0.85),
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(1);
    expect(raw.lineItems[0]).toMatchObject({ name: "KARIDES TAVA", totalPriceCents: 3500 });
  });

  it("isimsiz 0-tutar, OCR satırında isim varsa ikram olarak kurtarılır", () => {
    const text = "1.00 (Ikram) TURSU TABAGI\n0.00\n";
    const seg = (start: number, end: number) => ({
      textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] },
    });
    const poly = (xMin: number, xMax: number, yMin: number, yMax: number) => ({
      boundingPoly: {
        normalizedVertices: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax },
        ],
      },
    });
    const doc = {
      text,
      pages: [
        {
          lines: [
            { layout: { ...seg(0, 25), ...poly(0.1, 0.63, 0.765, 0.803) } },
            { layout: { ...seg(26, 30), ...poly(0.89, 0.96, 0.761, 0.777) } },
          ],
        },
      ],
      entities: [
        lineItem({ desc: "KUVER", qty: 1, amountCents: 2000 }),
        {
          type: "line_item",
          confidence: 1,
          properties: [
            {
              type: "line_item/amount",
              mentionText: "0.00",
              confidence: 1,
              pageAnchor: { pageRefs: [poly(0.89, 0.96, 0.761, 0.777)] },
            },
          ],
        },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(2);
    expect(raw.lineItems.some((it) => it.name === "(Ikram) TURSU TABAGI" && it.totalPriceCents === 0)).toBe(true);
  });

  it("bölge ipucuyla çelişen tek glif para sembolü düşük güvene çekilir (₺→€ karışması)", () => {
    const doc = {
      entities: [
        lineItem({ desc: "Çay", qty: 1, amountCents: 5000 }),
        { type: "currency", mentionText: "€", normalizedValue: { text: "EUR" }, confidence: 0.88 },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      meta: { currency?: string; currencyConfidence: number };
    };
    expect(raw.meta.currency).toBe("EUR");
    expect(raw.meta.currencyConfidence).toBeLessThan(0.6); // pipeline onay ister
  });

  it("başlıktaki saat (23.02) ve eşsiz tutarlar, isimli toplam fiş toplamını tutuyorsa elenir", () => {
    const doc = {
      entities: [
        { type: "total_amount", mentionText: "120.00", normalizedValue: { text: "120" } },
        boxedFrag("amount", "23.02", 0.17, 0.62), // Saat: 23.02 → gürültü
        {
          type: "line_item",
          confidence: 1,
          properties: [
            boxedProp("description", "BIRA", 0.4, 0.25),
            boxedProp("amount", "120.00", 0.4, 0.62),
          ],
        },
        boxedFrag("amount", "55.00", 0.8, 0.62), // toplamı bozan eşsiz tutar → gürültü
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(1);
    expect(raw.lineItems[0]).toMatchObject({ name: "BIRA", totalPriceCents: 12000 });
  });

  it("eşi olmayan tutar 'Kalem' adıyla gelir, fiyatı korunur (toplam bozulmaz)", () => {
    const doc = {
      entities: [
        boxedFrag("description", "BIRA", 0.4, 0.34),
        boxedFrag("amount", "120,00", 0.405, 0.66),
        // Bu tutarın çok uzakta, eşi yok.
        boxedFrag("amount", "55,00", 0.8, 0.66),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as {
      lineItems: Array<{ name: string; totalPriceCents: number }>;
    };
    expect(raw.lineItems).toHaveLength(2);
    const orphan = raw.lineItems.find((it) => it.totalPriceCents === 5500);
    expect(orphan?.name).toBe("Kalem");
  });
});

describe("mapDocAiToRaw — fallback davranışları", () => {
  it("currency entity yoksa locale ipucundan TRY türetir (düşük confidence)", () => {
    const doc = {
      entities: [lineItem({ desc: "Çay", qty: 1, amountCents: 5000 })],
    };
    const raw = mapDocAiToRaw(doc, input) as { meta: { currency?: string; currencyConfidence: number } };
    expect(raw.meta.currency).toBe("TRY");
    expect(raw.meta.currencyConfidence).toBeLessThan(0.6);
  });

  it("net_amount yoksa subtotal kalem toplamından gelir", () => {
    const doc = {
      entities: [
        lineItem({ desc: "A", qty: 1, amountCents: 5000 }),
        lineItem({ desc: "B", qty: 1, amountCents: 3000 }),
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as { charges: { subtotalCents: number; totalCents: number } };
    expect(raw.charges.subtotalCents).toBe(8000);
    expect(raw.charges.totalCents).toBe(8000);
  });

  it("ayrı KDV varsa taxIncludedInItems=false", () => {
    const doc = {
      entities: [
        lineItem({ desc: "A", qty: 1, amountCents: 10000 }),
        { type: "net_amount", ...money(100) },
        { type: "total_tax_amount", ...money(20) },
        { type: "total_amount", ...money(120) },
      ],
    };
    const raw = mapDocAiToRaw(doc, input) as { charges: { taxIncludedInItems: boolean } };
    expect(raw.charges.taxIncludedInItems).toBe(false);
  });

  it("hiç line_item yoksa şema reddedilir (boş sonuç)", () => {
    const doc = { entities: [{ type: "currency", mentionText: "TL" }] };
    const raw = mapDocAiToRaw(doc, input);
    expect(rawOcrResultSchema.safeParse(raw).success).toBe(false);
  });
});

/* --------------------- Provider HTTP davranışı --------------------- */

function okResponse(doc: unknown): Response {
  return new Response(JSON.stringify(doc), { status: 200 });
}
const unavailable = (): Response => new Response("overloaded", { status: 503 });

function provider(fetchImpl: ReturnType<typeof vi.fn>, maxAttempts = 3) {
  return new DocumentAiProvider({
    projectId: "p",
    location: "eu",
    processorId: "proc",
    getAccessToken: async () => "token",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    maxAttempts,
    sleepImpl: async () => {},
  });
}

describe("DocumentAiProvider — HTTP", () => {
  it("başarılı yanıtı map'leyip döndürür", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(realReceiptDoc()));
    const result = (await provider(fetchImpl).analyze(input)) as { lineItems: unknown[] };
    expect(result.lineItems).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("503 sonrası başarılı olursa sonucu döndürür (retry)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(okResponse(realReceiptDoc()));
    const result = (await provider(fetchImpl).analyze(input)) as { lineItems: unknown[] };
    expect(result.lineItems).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("kalıcı hatada (400) anında durur", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(provider(fetchImpl).analyze(input)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("tüm denemeler 503 ise ProviderError fırlatır", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(unavailable());
    await expect(provider(fetchImpl).analyze(input)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("DocumentAiProvider — uçtan uca (orchestrate)", () => {
  it("map + pipeline: dengeli sonuç, mismatch flag yok", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(realReceiptDoc()));
    const analyzed = await orchestrate(provider(fetchImpl), input);
    expect(analyzed.receipt.lineItems).toHaveLength(4);
    expect(analyzed.arithmetic.balanced).toBe(true);
    expect(analyzed.flags.some((f) => f.reason === "qty_price_mismatch")).toBe(false);
    expect(analyzed.meta.currency).toBe("TRY");
  });
});
