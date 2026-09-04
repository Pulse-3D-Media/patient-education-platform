import QRCode from "qrcode";

/**
 * QR codes for share links, drawn by the qrcode package. Both functions take
 * the full link to encode. A patient points their phone camera at the code
 * and the link opens. Nothing about the patient is in the code, only the link.
 */

/** A QR code as a PNG image (the bytes of the file), for downloading. */
export function qrPng(text: string, widthInPixels = 1024) {
  return QRCode.toBuffer(text, { type: "png", width: widthInPixels, margin: 2 });
}

/** A QR code as SVG markup, which stays sharp at any size, for printing. */
export function qrSvg(text: string) {
  return QRCode.toString(text, { type: "svg", margin: 0 });
}
