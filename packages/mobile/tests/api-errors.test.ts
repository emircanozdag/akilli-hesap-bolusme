import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: { hostUri: "192.168.1.1:8081" },
    sessionId: "test-session",
  },
}));

import {
  backendOfflineMessage,
  formatHttpError,
  formatNetworkError,
} from "../src/api-errors";

describe("formatHttpError", () => {
  it("429 kota mesajına elle gir fallback ekler", () => {
    const msg = formatHttpError(
      429,
      { error: "Günlük tarama kotası doldu", remaining: 0 },
      "analyze",
    );
    expect(msg).toContain("kota");
    expect(msg).toContain("elle");
  });

  it("502 yoğunluk mesajını korur", () => {
    const msg = formatHttpError(
      502,
      { error: "AI servisi şu an yoğun. Lütfen birkaç saniye sonra tekrar deneyin." },
      "analyze",
    );
    expect(msg).toContain("yoğun");
  });

  it("suggest bağlamında farklı fallback kullanır", () => {
    const msg = formatHttpError(429, { error: "Günlük atama önerisi kotası doldu" }, "suggest");
    expect(msg).toContain("Atamaları elle");
  });
});

describe("formatNetworkError", () => {
  const envBackup = process.env.EXPO_PUBLIC_AHB_API;

  afterEach(() => {
    if (envBackup === undefined) delete process.env.EXPO_PUBLIC_AHB_API;
    else process.env.EXPO_PUBLIC_AHB_API = envBackup;
  });

  it("production API'de geliştirici komutu göstermez", () => {
    vi.stubEnv("EXPO_PUBLIC_AHB_API", "https://api.example.com");
    const msg = formatNetworkError(new Error("Network request failed"), "analyze");
    expect(msg).not.toContain("npm run dev");
    expect(msg).toContain("İnternet");
  });

  it("zaman aşımında anlaşılır mesaj verir", () => {
    const err = new Error("timeout");
    err.name = "AbortError";
    const msg = formatNetworkError(err, "analyze");
    expect(msg).toContain("zaman aşımı");
  });
});

describe("backendOfflineMessage", () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_AHB_API;
  });

  it("yapılandırılmış API'de kullanıcı dostu mesaj döner", () => {
    vi.stubEnv("EXPO_PUBLIC_AHB_API", "https://api.example.com");
    const msg = backendOfflineMessage();
    expect(msg).not.toContain("npm run dev");
  });
});
