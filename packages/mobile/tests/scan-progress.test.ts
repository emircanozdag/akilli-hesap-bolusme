import { describe, expect, it } from "vitest";
import { scanProgressPercent, scanProgressStep } from "../src/scan-progress";

describe("scanProgressStep", () => {
  it("faz başına adım numarası döner", () => {
    expect(scanProgressStep("preparing")).toEqual({
      current: 2,
      total: 4,
      label: "Fotoğraf hazırlanıyor",
    });
  });

  it("idle için null döner", () => {
    expect(scanProgressStep("idle")).toBeNull();
  });
});

describe("scanProgressPercent", () => {
  it("fazlar monoton artar", () => {
    expect(scanProgressPercent({ phase: "picking" })).toBeLessThan(
      scanProgressPercent({ phase: "preparing" }),
    );
    expect(scanProgressPercent({ phase: "preparing" })).toBeLessThan(
      scanProgressPercent({ phase: "uploading" }),
    );
  });

  it("akış kalemleri yüzdeyi artırır", () => {
    const base = scanProgressPercent({
      phase: "analyzing",
      analyzingStartedAt: Date.now(),
    });
    const withItems = scanProgressPercent({
      phase: "analyzing",
      analyzingStartedAt: Date.now(),
      streamItemCount: 5,
    });
    expect(withItems).toBeGreaterThan(base);
  });
});
