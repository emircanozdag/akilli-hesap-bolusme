import { describe, it, expect } from "vitest";
import { consumeSseBuffer, extractLineItems } from "../src/partial-json.js";

describe("extractLineItems — akışlı kısmi JSON", () => {
  it("tamamlanmış kalemleri çıkarır, yarım sondaki nesneyi atlar", () => {
    const partial =
      '{"meta":{"currency":"TRY"},"lineItems":[' +
      '{"name":"Steak","totalPriceCents":2500,"confidence":0.9},' +
      '{"name":"Salata","totalPriceCents":800,"confidence":0.9},' +
      '{"name":"Paylas'; // yarım üçüncü kalem
    const items = extractLineItems(partial);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: "Steak", totalPriceCents: 2500 });
    expect(items[1]).toMatchObject({ name: "Salata", totalPriceCents: 800 });
  });

  it("string içindeki süslü parantez ve kaçışlı tırnağı bozmaz", () => {
    const partial =
      '"lineItems":[{"name":"Tavuk {özel} \\"acılı\\"","totalPriceCents":1200,"confidence":0.8}]';
    const items = extractLineItems(partial);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('Tavuk {özel} "acılı"');
  });

  it("lineItems yoksa boş döner", () => {
    expect(extractLineItems('{"meta":{"currency":"TRY"}}')).toEqual([]);
  });

  it("kapanmış tam diziyi de okur", () => {
    const full = '{"lineItems":[{"name":"X","totalPriceCents":100,"confidence":1}],"charges":{}}';
    const items = extractLineItems(full);
    expect(items).toHaveLength(1);
  });

  it("anlamlı alanı olmayan nesneyi atlar", () => {
    const items = extractLineItems('"lineItems":[{"foo":"bar"}]');
    expect(items).toEqual([]);
  });
});

describe("consumeSseBuffer — Gemini SSE birleştirme", () => {
  it("tam data satırlarından metni birleştirir, yarım satırı rest'e taşır", () => {
    const chunk =
      'data: {"candidates":[{"content":{"parts":[{"text":"{\\"lineItems\\":["}]}}]}\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"{\\"name\\":\\"X\\"}"}]}}]}\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"incomplete'; // newline yok
    const { text, rest } = consumeSseBuffer(chunk);
    expect(text).toBe('{"lineItems":[{"name":"X"}');
    expect(rest.startsWith("data:")).toBe(true);
  });

  it("[DONE] ve boş satırları yok sayar", () => {
    const chunk = "data: [DONE]\n\n";
    const { text } = consumeSseBuffer(chunk);
    expect(text).toBe("");
  });

  it("newline içermeyen buffer'ı tümüyle rest olarak tutar", () => {
    const { text, rest } = consumeSseBuffer("data: {partial");
    expect(text).toBe("");
    expect(rest).toBe("data: {partial");
  });
});
