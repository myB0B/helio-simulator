import test from "node:test";
import assert from "node:assert/strict";
import { MercatorCoordinate } from "maplibre-gl";
import { calculateRoofHeight, calculateWallHeight, editorBearingToLocalDirection, generateSolarProjectMesh, getRoofSurfacePoint, normalizeRing } from "./solar3d.js";

test("gabled roof height preserves the total building height", () => {
  const roofHeight = calculateRoofHeight(4, 30);
  const wallHeight = calculateWallHeight(7, roofHeight);
  assert.ok(Math.abs(roofHeight - 2.309401) < 0.00001);
  assert.ok(Math.abs(wallHeight + roofHeight - 7) < 0.00001);
});

test("impossible roof height is reported", () => {
  assert.throws(() => calculateWallHeight(3, 4), RangeError);
});

test("editor bearings map clockwise from north into east/north vectors", () => {
  assert.deepEqual(editorBearingToLocalDirection(0), { x: 0, y: 1 });
  assert.ok(Math.abs(editorBearingToLocalDirection(90).x - 1) < 1e-12);
  assert.ok(Math.abs(editorBearingToLocalDirection(90).y) < 1e-12);
});

test("roof surface and panel mesh remain parallel across rotated roofs", () => {
  const project = {
    roofRing: [[2, 47], [2.0001, 47], [2.0001, 47.0001], [2, 47.0001], [2, 47]],
    values: { buildingHeight: 7, roofType: "double", roofShape: "gabled", pitch: 30, azimuth: 45, buildingColor: "#cccccc", roofColor: "#993333" },
    panels: [[[2.00002, 47.00002], [2.00004, 47.00002], [2.00004, 47.00004], [2.00002, 47.00004], [2.00002, 47.00002]]],
  };
  const mesh = generateSolarProjectMesh(project);
  assert.ok(mesh.positions.length > 0);
  assert.ok(mesh.roofHeight > 0);
  assert.ok(Math.abs(mesh.wallHeight + mesh.roofHeight - 7) < 0.00001);
  const panelStart = mesh.positions.length - 24 * 3;
  const first = mesh.positions.slice(panelStart, panelStart + 3);
  const second = mesh.positions.slice(panelStart + 3, panelStart + 6);
  const third = mesh.positions.slice(panelStart + 6, panelStart + 9);
  const firstEdge = second.map((value, index) => value - first[index]);
  const secondEdge = third.map((value, index) => value - first[index]);
  const triangleNormal = [
    firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
    firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
    firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
  ];
  const panelNormal = mesh.normals.slice(panelStart, panelStart + 3);
  const alignment = triangleNormal.reduce((sum, value, index) => sum + value * panelNormal[index], 0)
    / Math.hypot(...triangleNormal);
  assert.ok(Math.abs(panelNormal[0]) > 0.01 && Math.abs(panelNormal[1]) > 0.01);
  assert.ok(Math.abs(alignment) > 0.9999);
  const surface = getRoofSurfacePoint({ x: 0, y: 0 }, { direction: editorBearingToLocalDirection(45), minimum: -4, maximum: 4, middle: 0, shape: "gabled", pitchRadians: Math.PI / 6, totalHeight: 7 });
  assert.equal(surface.normal.z > 0, true);
});

test("gabled end walls reach the ridge at the total building height", () => {
  const mesh = generateSolarProjectMesh({
    roofRing: [[2, 47], [2.0001, 47], [2.0001, 47.0001], [2, 47.0001], [2, 47]],
    values: { buildingHeight: 7, roofType: "double", roofShape: "gabled", pitch: 30, azimuth: 0, buildingColor: "#cccccc", roofColor: "#993333" },
    panels: [],
  });
  // Walls are emitted before roof faces; the two gable walls each split at the ridge.
  const wallHeights = Array.from(mesh.positions.slice(0, 24 * 3)).filter((_, index) => index % 3 === 2);
  assert.ok(wallHeights.some((height) => Math.abs(height - 7) < 0.00001));
});
test("unclosed and closed roof rings share the same mesh origin", () => {
  const openRing = [[2, 47], [2.0001, 47], [2.0001, 47.0001], [2, 47.0001]];
  const closedRing = [...openRing, openRing[0]];
  const values = { buildingHeight: 7, roofType: "double", roofShape: "gabled", pitch: 30, azimuth: 45, buildingColor: "#cccccc", roofColor: "#993333" };

  assert.deepEqual(normalizeRing(openRing), closedRing);
  assert.deepEqual(
    generateSolarProjectMesh({ roofRing: openRing, values, panels: [] }).origin,
    generateSolarProjectMesh({ roofRing: closedRing, values, panels: [] }).origin,
  );
});

test("mesh vertices map back to their geographic footprint", () => {
  const roofRing = [[2, 47], [2.0001, 47], [2.0001, 47.0001], [2, 47.0001], [2, 47]];
  const mesh = generateSolarProjectMesh({
    roofRing,
    values: { buildingHeight: 7, roofType: "terrace", roofShape: "flat", pitch: 0, azimuth: 0, buildingColor: "#cccccc", roofColor: "#993333" },
    panels: [],
  });
  const origin = MercatorCoordinate.fromLngLat(mesh.origin, 0);
  const meter = origin.meterInMercatorCoordinateUnits();

  roofRing.slice(0, -1).forEach((coordinate, index) => {
    const vertex = mesh.positions.slice(index * 12, index * 12 + 3);
    const expected = MercatorCoordinate.fromLngLat(coordinate, 0);
    assert.ok(Math.abs(origin.x + vertex[0] * meter - expected.x) < 1e-10);
    assert.ok(Math.abs(origin.y - vertex[1] * meter - expected.y) < 1e-10);
  });
});

test("panel volume has correct thickness and closed faces", () => {
  const project = {
    roofRing: [[2, 47], [2.0001, 47], [2.0001, 47.0001], [2, 47.0001], [2, 47]],
    values: { buildingHeight: 7, roofType: "terrace", roofShape: "flat", pitch: 0, azimuth: 0, buildingColor: "#cccccc", roofColor: "#993333", panelColor: "#1a4f8c" },
    panels: [[[2.00002, 47.00002], [2.00004, 47.00002], [2.00004, 47.00004], [2.00002, 47.00004], [2.00002, 47.00002]]],
  };
  const mesh = generateSolarProjectMesh(project);
  // For flat roof, roof surface is at buildingHeight, normal is (0,0,1)
  // Top face at 7 + 0.04 = 7.04, bottom at 7 + 0.01 = 7.01
  const withoutPanel = generateSolarProjectMesh({ ...project, panels: [] });
  assert.equal(mesh.positions.length - withoutPanel.positions.length, 24 * 3);
  assert.equal(mesh.indices.length - withoutPanel.indices.length, 36);
  const zValues = Array.from(mesh.positions).filter((_, i) => i % 3 === 2);
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  // Wall top at 7, roof at 7, panel top at 7.04, panel bottom at 7.01
  assert.ok(Math.abs(maxZ - 7.04) < 0.0001, `maxZ ${maxZ} should be 7.04`);
  assert.ok(Math.abs(minZ - 0) < 0.0001, `minZ ${minZ} should be 0 (ground)`);
  // Panel volume has 8 unique corner vertices (4 top + 4 bottom) but triangulated = more
  // A closed rectangular prism: 6 faces * 2 triangles = 12 triangles = 36 indices
  // The exact count depends on triangulation, but we verify volume exists
  assert.ok(mesh.indices.length > 0);
  // Verify there are vertices at both panel top and bottom heights
  const panelTopZ = zValues.filter((z) => Math.abs(z - 7.04) < 0.001);
  const panelBottomZ = zValues.filter((z) => Math.abs(z - 7.01) < 0.001);
  assert.ok(panelTopZ.length >= 4, `expected at least 4 vertices at panel top (7.04), got ${panelTopZ.length}`);
  assert.ok(panelBottomZ.length >= 4, `expected at least 4 vertices at panel bottom (7.01), got ${panelBottomZ.length}`);
});
