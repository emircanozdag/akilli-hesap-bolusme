import { beforeEach, describe, expect, it, vi } from "vitest";

const { manipulateAsync } = vi.hoisted(() => ({
  manipulateAsync: vi.fn(),
}));

vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync,
}));

import { prepareImageForUpload, SCAN_IMAGE } from "../src/image-optimize";

describe("prepareImageForUpload", () => {
  beforeEach(() => {
    manipulateAsync.mockReset();
  });

  it("1400px genişlik ve 0.55 sıkıştırma ile JPEG üretir", async () => {
    manipulateAsync.mockResolvedValue({
      base64: "Zm9v",
      uri: "file:///optimized.jpg",
    });

    const result = await prepareImageForUpload("file:///receipt.jpg");

    expect(manipulateAsync).toHaveBeenCalledWith(
      "file:///receipt.jpg",
      [{ resize: { width: SCAN_IMAGE.maxWidth } }],
      {
        compress: SCAN_IMAGE.compress,
        format: SCAN_IMAGE.format,
        base64: true,
      },
    );
    expect(result).toEqual({ base64: "Zm9v", mimeType: "image/jpeg" });
  });

  it("boş URI → hata", async () => {
    await expect(prepareImageForUpload("")).rejects.toThrow(/Görüntü okunamadı/);
    expect(manipulateAsync).not.toHaveBeenCalled();
  });

  it("base64 dönmezse → hata", async () => {
    manipulateAsync.mockResolvedValue({ uri: "file:///x.jpg" });
    await expect(prepareImageForUpload("file:///receipt.jpg")).rejects.toThrow(
      /Görüntü hazırlanamadı/,
    );
  });
});
