export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** FNV-1a 32-bit — stable seed for per-server simulated telemetry. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function isVideoUrl(url: string): boolean {
  return url.startsWith("data:video/") || /\.(mp4|webm|ogv|mov|mkv|m4v)(\?|#|$)/i.test(url);
}

export function toHexColor(value: string | undefined | null, fallback: string): string {
  const v = (value ?? "").trim();
  const six = v.match(/^#?([0-9a-f]{6})$/i);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = v.match(/^#?([0-9a-f]{3})$/i);
  if (three) return `#${three[1].split("").map((c) => c + c).join("").toLowerCase()}`;
  return fallback;
}

export function hexToRgbTriplet(hex: string): string {
  const n = parseInt(toHexColor(hex, "#0c1424").slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
