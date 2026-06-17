import * as Crypto from "expo-crypto";

/** Sunucu önbelleği ile aynı anahtar: SHA-256(base64 string). */
export async function hashImageBase64(base64: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
}
