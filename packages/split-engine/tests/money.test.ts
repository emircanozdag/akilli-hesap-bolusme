import { describe, it, expect } from "vitest";
import { toCents, formatCents, sumCents } from "../src/money.js";

describe("money — kuruş-int (DESIGN.md §4 altın kural)", () => {
  it("string ve sayı tutarları kuruşa çevirir", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(toCents("19,99")).toBe(1999); // virgül ondalık
    expect(toCents(25)).toBe(2500);
    expect(toCents("0.5")).toBe(50);
    expect(toCents("0.05")).toBe(5);
    expect(toCents("-3.20")).toBe(-320);
  });

  it("float yuvarlama tuzağına düşmez", () => {
    expect(toCents("0.1")).toBe(10);
    expect(toCents("0.3")).toBe(30);
    expect(toCents("8.00")).toBe(800);
  });

  it("geçersiz tutarı reddeder", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("1.2.3")).toThrow();
  });

  it("kuruşu görüntü dizisine çevirir", () => {
    expect(formatCents(1999)).toBe("19.99");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-320)).toBe("-3.20");
    expect(formatCents(4730)).toBe("47.30");
  });

  it("sumCents toplar", () => {
    expect(sumCents([3118, 1246, 366])).toBe(4730);
  });
});
