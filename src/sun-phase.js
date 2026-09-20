export function sunPhase(altitude) {
  if (!Number.isFinite(altitude)) return { id: "day", label: "Jour" };
  if (altitude <= -6) return { id: "night", label: "Nuit" };
  if (altitude < 6) return { id: "twilight", label: "Crépuscule" };
  return { id: "day", label: "Jour" };
}
