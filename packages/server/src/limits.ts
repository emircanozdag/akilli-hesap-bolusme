/** OCR için izin verilen maksimum ham görüntü boyutu (bayt). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Base64 kodlu görüntü için üst karakter sınırı (~4/3 şişme). */
export const MAX_IMAGE_BASE64_LEN = Math.ceil((MAX_IMAGE_BYTES * 4) / 3);

export function rejectOversizeContentLength(contentLengthHeader: string | undefined): boolean {
  if (contentLengthHeader === undefined || contentLengthHeader === "") return false;
  const cl = Number(contentLengthHeader);
  return Number.isFinite(cl) && cl > MAX_IMAGE_BYTES;
}

export function imageTooLarge(imageBase64: string): boolean {
  if (imageBase64.length > MAX_IMAGE_BASE64_LEN) return true;
  const decodedApprox = Math.floor((imageBase64.length * 3) / 4);
  return decodedApprox > MAX_IMAGE_BYTES;
}

export function binaryImageTooLarge(byteLength: number): boolean {
  return byteLength > MAX_IMAGE_BYTES;
}
