import { readFileSync, writeFileSync } from "node:fs";

const versionFile = ".helio-build-version";

function formatVersion(timestamp) {
  const date = new Date(timestamp);
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${part(date.getMonth() + 1)}.${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}`;
}

function parseVersion(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})(\d{2})$/.exec(version);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime();
}

let previous = null;
try {
  previous = parseVersion(readFileSync(versionFile, "utf8").trim());
} catch {
  // The first build creates the version file.
}

const currentMinute = Math.floor(Date.now() / 60000) * 60000;
const nextMinute = previous === null ? currentMinute : Math.max(currentMinute, previous + 60000);
writeFileSync(versionFile, `${formatVersion(nextMinute)}\n`);
