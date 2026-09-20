import test from "node:test";
import assert from "node:assert/strict";
import { aggregateStudies, angularDistance, calculateStudy, dailyEnergyBalance, facadeBearingFromCoordinates, facadeBearingsFromCoordinates, footprintAreaSquareMeters, longestSouthFacingFacade, MODULE_AREA_SQUARE_METERS, recommendedPanelCount, roofPlaneSurfaceForType, roofSurfaceForType, southFacingFacade } from "./solar.js";

test("angularDistance handles the 0/360 boundary", () => {
  assert.equal(angularDistance(350, 10), 20);
  assert.equal(angularDistance(180, 180), 0);
});

test("a south-facing unshaded roof produces more than a north-facing roof", () => {
  const base = { area: 30, pitch: 35, shade: 0, irradiance: 1250, panelCount: 10, panelPower: 500, inverterEfficiency: 96.6, cableLoss: 2, soilingLoss: 3, mismatchLoss: 2, availabilityLoss: 1, thermalLoss: 6, clippingLoss: 1 };
  assert.ok(calculateStudy({ ...base, azimuth: 180 }).annualProduction > calculateStudy({ ...base, azimuth: 0 }).annualProduction);
});

test("shade lowers the production", () => {
  const base = { area: 30, azimuth: 180, pitch: 35, irradiance: 1250, panelCount: 10, panelPower: 500, inverterEfficiency: 96.6, cableLoss: 2, soilingLoss: 3, mismatchLoss: 2, availabilityLoss: 1, thermalLoss: 6, clippingLoss: 1 };
  assert.ok(calculateStudy({ ...base, shade: 0 }).annualProduction > calculateStudy({ ...base, shade: 50 }).annualProduction);
});

test("facade bearings are measured clockwise from north", () => {
  const building = [[2, 47], [2.002, 47], [2.002, 47.001], [2, 47.001], [2, 47]];

  assert.equal(Math.round(facadeBearingFromCoordinates(building, [2.001, 46.9998])), 180);
  assert.equal(Math.round(facadeBearingFromCoordinates(building, [2.001, 47.0012])), 0);
  assert.equal(Math.round(facadeBearingFromCoordinates(building, [1.9998, 47.0005])), 270);
  assert.equal(Math.round(facadeBearingFromCoordinates(building, [2.0022, 47.0005])), 90);
});

test("facade bearing supports clockwise and unclosed footprints", () => {
  const clockwiseUnclosed = [[2, 47.001], [2.002, 47.001], [2.002, 47], [2, 47]];

  assert.equal(Math.round(facadeBearingFromCoordinates(clockwiseUnclosed, [2.001, 46.9998])), 180);
});

test("facade bearing list contains each cardinal facade", () => {
  const building = [[2, 47], [2.002, 47], [2.002, 47.001], [2, 47.001], [2, 47]];
  const bearings = facadeBearingsFromCoordinates(building).map((facade) => Math.round(facade.bearing)).sort((first, second) => first - second);

  assert.deepEqual(bearings, [0, 90, 180, 270]);
});

test("footprint area supports closed and unclosed polygons", () => {
  const closed = [[2, 47], [2.001, 47], [2.001, 47.001], [2, 47.001], [2, 47]];
  const unclosed = closed.slice(0, -1);

  assert.ok(footprintAreaSquareMeters(closed) > 8000);
  assert.equal(Math.round(footprintAreaSquareMeters(closed)), Math.round(footprintAreaSquareMeters(unclosed)));
});

test("south-facing facade is closest to a 180 degree bearing", () => {
  const facades = [{ bearing: 90 }, { bearing: 205 }, { bearing: 330 }];

  assert.equal(southFacingFacade(facades).bearing, 205);
});

test("longest roof side supplies the ridge axis and selects its south-facing facade", () => {
  const facades = [{ bearing: 0, length: 12 }, { bearing: 180, length: 12 }, { bearing: 90, length: 7 }, { bearing: 270, length: 7 }];

  assert.equal(longestSouthFacingFacade(facades).bearing, 180);
});

test("double pitch uses half of the footprint for one roof plane", () => {
  assert.equal(roofSurfaceForType(40, "terrace"), 40);
  assert.equal(roofSurfaceForType(40, "single"), 40);
  assert.equal(roofSurfaceForType(40, "double"), 20);
});

test("sloped roof plane accounts for pitch while a terrace stays horizontal", () => {
  assert.equal(roofPlaneSurfaceForType(40, "terrace", 35), 40);
  assert.ok(roofPlaneSurfaceForType(40, "single", 35) > 40);
  assert.ok(roofPlaneSurfaceForType(40, "double", 35) > 20);
});

test("module surface, power and installation capacity are derived from panel inputs", () => {
  const study = calculateStudy({ area: 30, panelCount: 10, panelPower: 500, edgeAllowance: 10, mountingAllowance: 3, rowSpacing: 0, inverterEfficiency: 96.6, cableLoss: 2, soilingLoss: 3, mismatchLoss: 2, availabilityLoss: 1, thermalLoss: 6, clippingLoss: 1 });

  assert.equal(study.power, 5);
  assert.equal(study.panelSurface, 10 * MODULE_AREA_SQUARE_METERS);
  assert.equal(study.capacityExceeded, false);
  assert.ok(study.remainingArea > 0);
});

test("custom module dimensions drive the physical panel surface", () => {
  const study = calculateStudy({ area: 30, panelCount: 4, moduleWidth: 1.2, moduleHeight: 2, mountingAllowance: 0, rowSpacing: 0 });

  assert.equal(study.moduleArea, 2.4);
  assert.equal(study.panelSurface, 9.6);
});

test("mounting and row gaps are expressed in centimetres", () => {
  const study = calculateStudy({ area: 30, panelCount: 1, moduleWidth: 1, moduleHeight: 2, mountingAllowance: 3, rowSpacing: 10 });

  assert.equal(study.installationSurface, 1.03 * 2.13);
});

test("recommended panel count fits the usable roof plane and installation margins", () => {
  const input = { area: 30, edgeAllowance: 10, mountingAllowance: 3, rowSpacing: 0 };
  const count = recommendedPanelCount(input);
  const study = calculateStudy({ ...input, panelCount: count });
  const nextStudy = calculateStudy({ ...input, panelCount: count + 1 });

  assert.equal(study.capacityExceeded, false);
  assert.equal(nextStudy.capacityExceeded, true);
});

test("installation warns when panels exceed the usable roof plane", () => {
  const study = calculateStudy({ area: 30, panelCount: 15, panelPower: 500, edgeAllowance: 10, mountingAllowance: 3, rowSpacing: 0 });

  assert.equal(study.capacityExceeded, true);
  assert.ok(study.remainingArea < 0);
});

test("system losses are composed from each efficiency factor", () => {
  const study = calculateStudy({ area: 30, panelCount: 1, panelPower: 500, inverterEfficiency: 96.6, cableLoss: 0, soilingLoss: 0, mismatchLoss: 0, availabilityLoss: 0, thermalLoss: 0, clippingLoss: 0 });

  assert.equal(Number(study.systemLoss.toFixed(1)), 3.4);
});

test("daily self-sufficiency is the capped share of daily consumption covered by production", () => {
  const study = calculateStudy({ area: 30, azimuth: 180, pitch: 35, shade: 0, irradiance: 1250, panelCount: 10, panelPower: 500, inverterEfficiency: 100, cableLoss: 0, soilingLoss: 0, mismatchLoss: 0, availabilityLoss: 0, thermalLoss: 0, clippingLoss: 0, dailyConsumption: 20 });

  assert.equal(study.dailyProduction, study.annualProduction / 365);
  assert.equal(study.dailySelfSufficiency, Math.min(100, (study.dailyProduction / 20) * 100));
});

test("daily energy balance reports surplus only above full self-sufficiency", () => {
  assert.deepEqual(dailyEnergyBalance(12, 20), { dailySelfSufficiency: 60, surplusPercent: 0, surplusEnergy: 0 });
  assert.deepEqual(dailyEnergyBalance(20, 20), { dailySelfSufficiency: 100, surplusPercent: 0, surplusEnergy: 0 });
  assert.deepEqual(dailyEnergyBalance(30, 20), { dailySelfSufficiency: 100, surplusPercent: 50, surplusEnergy: 10 });
});

test("aggregateStudies sums production, power and panels across buildings", () => {
  const total = aggregateStudies([
    { panelCount: 8, power: 3.6, annualProduction: 4100, dailyProduction: 11.23 },
    { panelCount: 12, power: 5.4, annualProduction: 5900, dailyProduction: 16.16 },
    { panelCount: 0, power: 0, annualProduction: 0, dailyProduction: 0 },
  ]);

  assert.deepEqual(total, {
    buildingCount: 2,
    panelCount: 20,
    power: 9,
    annualProduction: 10000,
    dailyProduction: 27.39,
  });
});
