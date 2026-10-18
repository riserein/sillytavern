const lum = (hex) => {
  const c = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
export function contrastRatio(a, b) {
  return (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
}
export function readableColors(colors, locked = new Set()) {
  const next = { ...colors };
  if (contrastRatio(next.background, next.text) < 4.5) {
    if (!locked.has("text"))
      next.text =
        contrastRatio(next.background, "#f8f6f1") >
        contrastRatio(next.background, "#192124")
          ? "#f8f6f1"
          : "#192124";
    else if (!locked.has("background"))
      next.background =
        contrastRatio(next.text, "#f8f6f1") >
        contrastRatio(next.text, "#192124")
          ? "#f8f6f1"
          : "#192124";
  }
  return next;
}
