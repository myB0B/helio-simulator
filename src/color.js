function relativeLuminance(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? "");
  if (!match) return 1;
  const value = Number.parseInt(match[1], 16);
  return [value >> 16, (value >> 8) & 255, value & 255]
    .map((channel) => {
      const linear = channel / 255;
      return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
    })
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

export function contrastingTextColor(background) {
  const luminance = relativeLuminance(background);
  const light = relativeLuminance("#fff8e7");
  const dark = relativeLuminance("#173b2d");
  return (Math.max(luminance, light) + 0.05) / (Math.min(luminance, light) + 0.05)
    >= (Math.max(luminance, dark) + 0.05) / (Math.min(luminance, dark) + 0.05)
    ? "#fff8e7"
    : "#173b2d";
}
