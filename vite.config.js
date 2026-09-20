import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

function formatBuildVersion(date = new Date()) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${part(date.getMonth() + 1)}.${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}`;
}

function buildVersion() {
  try {
    const version = readFileSync(".helio-build-version", "utf8").trim();
    if (/^\d{4}\.\d{2}\.\d{2}-\d{4}$/.test(version)) return version;
  } catch {
    // Direct Vite invocations still receive a useful timestamp.
  }
  return formatBuildVersion();
}

export default defineConfig({
  // Production is hosted at https://fcinc.fr/heliosim/ rather than the domain root.
  base: "/heliosim/",
  define: {
    __HELIO_BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  optimizeDeps: {
    // MapLibre loads its WebGL worker as an ES module at runtime.
    exclude: ["maplibre-gl"],
  },
});
