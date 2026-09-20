const MONTHLY_SHARE = [0.036, 0.052, 0.081, 0.103, 0.119, 0.123, 0.127, 0.115, 0.09, 0.068, 0.048, 0.038];
export const MODULE_LENGTH_METERS = 1.961;
export const MODULE_WIDTH_METERS = 1.134;
export const MODULE_AREA_SQUARE_METERS = MODULE_LENGTH_METERS * MODULE_WIDTH_METERS;

export function angularDistance(first, second) {
  const difference = Math.abs(((first - second + 540) % 360) - 180);
  return difference;
}

export function dailyEnergyBalance(dailyProduction, dailyConsumption) {
  const production = Math.max(0, Number(dailyProduction) || 0);
  const consumption = Math.max(0, Number(dailyConsumption) || 0);
  const coverage = consumption > 0 ? production / consumption * 100 : 0;
  return {
    dailySelfSufficiency: Math.min(100, coverage),
    surplusPercent: Math.max(0, coverage - 100),
    surplusEnergy: Math.max(0, production - consumption),
  };
}

export function calculateStudy(input) {
  const area = Math.max(0, Number(input.area) || 0);
  const azimuth = Math.max(0, Math.min(359, Number(input.azimuth) || 0));
  const pitch = Math.max(0, Math.min(90, Number(input.pitch) || 0));
  const shade = Math.max(0, Math.min(100, Number(input.shade) || 0));
  const irradiance = Math.max(500, Number(input.irradiance) || 1250);
  const panelCount = Math.max(0, Math.floor(Number(input.panelCount) || 0));
  const panelPower = Math.max(0, Number(input.panelPower) || 0);
  const moduleEfficiency = Math.max(0, Math.min(100, Number(input.moduleEfficiency) || 0));
  const moduleWidth = Math.max(0.1, Number(input.moduleWidth) || MODULE_WIDTH_METERS);
  const moduleHeight = Math.max(0.1, Number(input.moduleHeight) || MODULE_LENGTH_METERS);
  const moduleArea = moduleWidth * moduleHeight;
  const edgeAllowance = Math.max(0, Math.min(80, Number(input.edgeAllowance) || 0));
  const mountingAllowance = Math.max(0, Math.min(100, Number(input.mountingAllowance) || 0)) / 100;
  const rowSpacing = Math.max(0, Math.min(300, Number(input.rowSpacing) || 0)) / 100;
  const inverterEfficiency = Math.max(0, Math.min(100, Number(input.inverterEfficiency) || 0));
  const cableLoss = Math.max(0, Math.min(100, Number(input.cableLoss) || 0));
  const soilingLoss = Math.max(0, Math.min(100, Number(input.soilingLoss) || 0));
  const mismatchLoss = Math.max(0, Math.min(100, Number(input.mismatchLoss) || 0));
  const availabilityLoss = Math.max(0, Math.min(100, Number(input.availabilityLoss) || 0));
  const thermalLoss = Math.max(0, Math.min(100, Number(input.thermalLoss) || 0));
  const clippingLoss = Math.max(0, Math.min(100, Number(input.clippingLoss) || 0));
  const dailyConsumption = Math.max(0, Number(input.dailyConsumption) || 0);
  const usableArea = area * (1 - edgeAllowance / 100);
  const panelSurface = panelCount * moduleArea;
  const panelInstallationSurface = (moduleWidth + mountingAllowance) * (moduleHeight + mountingAllowance + rowSpacing);
  const installationSurface = panelCount * panelInstallationSurface;
  const remainingArea = usableArea - installationSurface;
  const systemEfficiency = (inverterEfficiency / 100)
    * (1 - cableLoss / 100)
    * (1 - soilingLoss / 100)
    * (1 - mismatchLoss / 100)
    * (1 - availabilityLoss / 100)
    * (1 - thermalLoss / 100)
    * (1 - clippingLoss / 100);
  const systemLoss = (1 - systemEfficiency) * 100;
  const orientationFactor = 0.55 + 0.45 * Math.max(0, Math.cos((angularDistance(azimuth, 180) * Math.PI) / 180));
  const pitchFactor = Math.max(0.78, 1 - Math.abs(pitch - 35) * 0.006);
  const exposureFactor = orientationFactor * pitchFactor * (1 - shade / 100);
  const power = (panelCount * panelPower) / 1000;
  const annualProduction = power * irradiance * exposureFactor * systemEfficiency;
  const dailyProduction = annualProduction / 365;
  const dailyBalance = dailyEnergyBalance(dailyProduction, dailyConsumption);
  const exposureHours = Math.round(1600 * exposureFactor);
  const monthlyProduction = MONTHLY_SHARE.map((share) => Math.round(annualProduction * share));

  return {
    panelCount,
    usableArea,
    recommendedPanelCount: Math.floor(usableArea / panelInstallationSurface),
    excludedArea: area - usableArea,
    panelSurface,
    moduleArea,
    installationSurface,
    remainingArea,
    capacityExceeded: installationSurface > usableArea,
    power,
    moduleNominalPower: moduleArea * moduleEfficiency * 10,
    systemEfficiency,
    systemLoss,
    annualProduction,
    dailyProduction,
    dailyConsumption,
    ...dailyBalance,
    monthlyProduction,
    exposureHours,
    orientationFactor,
    pitchFactor,
    exposureFactor,
  };
}

export function aggregateStudies(studies) {
  return studies.reduce((total, study) => ({
    buildingCount: total.buildingCount + ((Number(study.panelCount) || 0) > 0 ? 1 : 0),
    panelCount: total.panelCount + (Number(study.panelCount) || 0),
    power: total.power + (Number(study.power) || 0),
    annualProduction: total.annualProduction + (Number(study.annualProduction) || 0),
    dailyProduction: total.dailyProduction + (Number(study.dailyProduction) || 0),
  }), {
    buildingCount: 0,
    panelCount: 0,
    power: 0,
    annualProduction: 0,
    dailyProduction: 0,
  });
}

export function recommendedPanelCount(input) {
  return calculateStudy({ ...input, panelCount: 0 }).recommendedPanelCount;
}

export function roofSurfaceForType(area, roofType) {
  const footprint = Math.max(0, Number(area) || 0);
  return roofType === "double" ? footprint / 2 : footprint;
}

export function roofPlaneSurfaceForType(area, roofType, pitch) {
  const projectedSurface = roofSurfaceForType(area, roofType);
  if (roofType === "terrace") return projectedSurface;
  const cosine = Math.max(0.1, Math.cos((Math.max(0, Math.min(85, Number(pitch) || 0)) * Math.PI) / 180));
  return projectedSurface / cosine;
}

export function directionLabel(azimuth) {
  const directions = ["Nord", "Nord-est", "Est", "Sud-est", "Sud", "Sud-ouest", "Ouest", "Nord-ouest"];
  return directions[Math.round((Number(azimuth) % 360) / 45) % 8];
}

export function facadeBearingFromCoordinates(coordinates, clickedPoint) {
  const points = [...coordinates];
  const first = points[0];
  const last = points.at(-1);
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) points.pop();
  if (points.length < 3) return null;

  const latitudeScale = Math.cos((clickedPoint[1] * Math.PI) / 180);
  const projected = points.map(([longitude, latitude]) => ({
    x: (longitude - clickedPoint[0]) * latitudeScale,
    y: latitude - clickedPoint[1],
  }));
  const signedArea = projected.reduce((area, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0);
  if (!signedArea) return null;

  let closestEdge = null;
  projected.forEach((start, index) => {
    const end = projected[(index + 1) % projected.length];
    const east = end.x - start.x;
    const north = end.y - start.y;
    const lengthSquared = east * east + north * north;
    if (!lengthSquared) return;
    const position = Math.max(0, Math.min(1, -(start.x * east + start.y * north) / lengthSquared));
    const closestEast = start.x + position * east;
    const closestNorth = start.y + position * north;
    const distanceSquared = closestEast * closestEast + closestNorth * closestNorth;
    if (!closestEdge || distanceSquared < closestEdge.distanceSquared) closestEdge = { east, north, distanceSquared };
  });
  if (!closestEdge) return null;

  const outwardEast = signedArea > 0 ? closestEdge.north : -closestEdge.north;
  const outwardNorth = signedArea > 0 ? -closestEdge.east : closestEdge.east;
  return ((Math.atan2(outwardEast, outwardNorth) * 180) / Math.PI + 360) % 360;
}

export function facadeBearingsFromCoordinates(coordinates) {
  const points = [...coordinates];
  const first = points[0];
  const last = points.at(-1);
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) points.pop();
  if (points.length < 3) return [];

  const latitude = points.reduce((total, point) => total + point[1], 0) / points.length;
  const latitudeScale = Math.cos((latitude * Math.PI) / 180);
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (!signedArea) return [];

  return points.flatMap((start, index) => {
    const end = points[(index + 1) % points.length];
    const east = (end[0] - start[0]) * latitudeScale;
    const north = end[1] - start[1];
    const length = Math.hypot(east, north);
    if (!length) return [];
    const outwardEast = signedArea > 0 ? north : -north;
    const outwardNorth = signedArea > 0 ? -east : east;
    return [{
      bearing: ((Math.atan2(outwardEast, outwardNorth) * 180) / Math.PI + 360) % 360,
      length,
      midpoint: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    }];
  });
}

export function footprintAreaSquareMeters(coordinates) {
  const points = [...coordinates];
  const first = points[0];
  const last = points.at(-1);
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) points.pop();
  if (points.length < 3) return 0;

  const latitude = points.reduce((total, point) => total + point[1], 0) / points.length;
  const latitudeScale = Math.cos((latitude * Math.PI) / 180);
  const origin = points[0];
  const projected = points.map(([longitude, pointLatitude]) => ({
    east: (longitude - origin[0]) * latitudeScale * 111320,
    north: (pointLatitude - origin[1]) * 110540,
  }));
  const area = projected.reduce((total, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return total + point.east * next.north - next.east * point.north;
  }, 0) / 2;
  return Math.abs(area);
}

export function southFacingFacade(facades) {
  return facades.reduce(
    (closest, facade) => (!closest || angularDistance(facade.bearing, 180) < angularDistance(closest.bearing, 180) ? facade : closest),
    null,
  );
}

export function longestSouthFacingFacade(facades) {
  const longest = Math.max(0, ...facades.map((facade) => facade.length || 0));
  const candidates = facades.filter((facade) => (facade.length || 0) >= longest * 0.98);
  return southFacingFacade(candidates);
}
