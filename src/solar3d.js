import { MercatorCoordinate } from "maplibre-gl";

export function calculateRoofHeight(run, pitchDegrees) {
  const safeRun = Number(run);
  const pitch = Number(pitchDegrees);
  if (!Number.isFinite(safeRun) || safeRun < 0 || !Number.isFinite(pitch) || pitch < 0 || pitch >= 90) {
    throw new RangeError("Invalid roof run or pitch");
  }
  return safeRun * Math.tan((pitch * Math.PI) / 180);
}

export function calculateWallHeight(totalHeight, roofHeight) {
  const total = Number(totalHeight);
  const roof = Number(roofHeight);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(roof) || roof < 0) {
    throw new RangeError("Invalid building or roof height");
  }
  const wall = total - roof;
  if (wall < -1e-6) throw new RangeError("Roof height exceeds the total building height");
  return Math.max(0, wall);
}

// Editor bearings are clockwise from north. The local mesh uses east/north metres.
export function editorBearingToLocalDirection(bearing) {
  const radians = (Number(bearing) * Math.PI) / 180;
  return { x: Math.sin(radians), y: Math.cos(radians) };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : { x: 0, y: 0, z: 1 };
}

function project(point, direction) {
  return point.x * direction.x + point.y * direction.y;
}

function clipPolygon(points, direction, threshold, keepGreater) {
  const clipped = [];
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const startProjection = project(start, direction);
    const endProjection = project(end, direction);
    const startInside = keepGreater ? startProjection >= threshold : startProjection <= threshold;
    const endInside = keepGreater ? endProjection >= threshold : endProjection <= threshold;
    if (startInside) clipped.push(start);
    if (startInside !== endInside) {
      const ratio = (threshold - startProjection) / (endProjection - startProjection);
      clipped.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
    }
  });
  return clipped;
}

function colorComponents(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? "");
  if (!match) return [0.7, 0.7, 0.7, 0];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 0];
}

export function normalizeRing(ring) {
  const points = ring?.map((coordinate) => [...coordinate]) ?? [];
  if (points.length < 3) return points;
  const first = points[0];
  const last = points.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function localPoints(ring) {
  const points = normalizeRing(ring).slice(0, -1);
  const origin = points.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]).map((value) => value / points.length);
  const mercatorOrigin = MercatorCoordinate.fromLngLat(origin, 0);
  const meter = mercatorOrigin.meterInMercatorCoordinateUnits();
  const fromLngLat = ([longitude, latitude]) => {
    const coordinate = MercatorCoordinate.fromLngLat([longitude, latitude], 0);
    return {
      x: (coordinate.x - mercatorOrigin.x) / meter,
      y: (mercatorOrigin.y - coordinate.y) / meter,
    };
  };
  return {
    origin,
    points: points.map(fromLngLat),
    fromLngLat,
  };
}

function roofDefinition(points, values) {
  const direction = editorBearingToLocalDirection(values.azimuth);
  const projections = points.map((point) => project(point, direction));
  const minimum = Math.min(...projections);
  const maximum = Math.max(...projections);
  const span = maximum - minimum;
  const shape = values.roofShape ?? ({ terrace: "flat", single: "skillion", double: "gabled" }[values.roofType] ?? "gabled");
  const run = shape === "gabled" ? span / 2 : shape === "skillion" ? span : 0;
  const roofHeight = calculateRoofHeight(run, values.pitch);
  const wallHeight = calculateWallHeight(values.buildingHeight, roofHeight);
  return { direction, minimum, maximum, middle: (minimum + maximum) / 2, shape, pitchRadians: (Number(values.pitch) * Math.PI) / 180, roofHeight, wallHeight, totalHeight: Number(values.buildingHeight) };
}

export function getRoofSurfacePoint(point2D, roof) {
  const position = project(point2D, roof.direction);
  if (roof.shape === "flat") return { position: { x: point2D.x, y: point2D.y, z: roof.totalHeight }, normal: { x: 0, y: 0, z: 1 } };
  const slope = Math.tan(roof.pitchRadians);
  if (roof.shape === "skillion") {
    const z = roof.totalHeight - (position - roof.minimum) * slope;
    return { position: { x: point2D.x, y: point2D.y, z }, normal: normalize({ x: slope * roof.direction.x, y: slope * roof.direction.y, z: 1 }) };
  }
  const side = position >= roof.middle ? 1 : -1;
  const z = roof.totalHeight - Math.abs(position - roof.middle) * slope;
  return { position: { x: point2D.x, y: point2D.y, z }, normal: normalize({ x: side * slope * roof.direction.x, y: side * slope * roof.direction.y, z: 1 }) };
}

function meshBuilder() {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const addVertex = (position, normal, color) => {
    const index = positions.length / 3;
    positions.push(position.x, position.y, position.z);
    normals.push(normal.x, normal.y, normal.z);
    colors.push(...color);
    return index;
  };
  const addTriangle = (first, second, third) => indices.push(first, second, third);
  const addSurface = (points, roof, color, offset = 0) => {
    if (points.length < 3) return;
    const vertices = points.map((point) => {
      const surface = getRoofSurfacePoint(point, roof);
      return addVertex({
        x: surface.position.x + surface.normal.x * offset,
        y: surface.position.y + surface.normal.y * offset,
        z: surface.position.z + surface.normal.z * offset,
      }, surface.normal, color);
    });
    for (let index = 1; index < vertices.length - 1; index += 1) addTriangle(vertices[0], vertices[index], vertices[index + 1]);
  };

  const addPanelVolume = (points, roof, color, topOffset = 0.04, thickness = 0.03) => {
    if (points.length < 3) return;
    const bottomOffset = topOffset - thickness;
    const surfaces = points.map((point) => getRoofSurfacePoint(point, roof));
    const topVertices = surfaces.map((surface) => ({
      x: surface.position.x,
      y: surface.position.y,
      z: surface.position.z + topOffset,
    }));
    const bottomVertices = surfaces.map((surface) => ({
      x: surface.position.x,
      y: surface.position.y,
      z: surface.position.z + bottomOffset,
    }));
    const addFace = (vertices, normal, reverse = false, faceColor = color) => {
      const indices = vertices.map((position) => addVertex(position, normal, faceColor));
      for (let index = 1; index < indices.length - 1; index += 1) {
        if (reverse) addTriangle(indices[0], indices[index + 1], indices[index]);
        else addTriangle(indices[0], indices[index], indices[index + 1]);
      }
    };
    // Keep the panel's former 4 cm elevation, then close it with a vertical 3 cm thickness.
    addFace(topVertices, surfaces[0].normal, false, [...color.slice(0, 3), 1]);
    addFace(bottomVertices, { x: -surfaces[0].normal.x, y: -surfaces[0].normal.y, z: -surfaces[0].normal.z }, true);
    topVertices.forEach((topStart, index) => {
      const next = (index + 1) % topVertices.length;
      const topEnd = topVertices[next];
      const edge = { x: topEnd.x - topStart.x, y: topEnd.y - topStart.y };
      const normal = normalize({ x: edge.y, y: -edge.x, z: 0 });
      addFace([bottomVertices[index], bottomVertices[next], topEnd, topStart], normal);
    });
  };
  return { positions, normals, colors, indices, addVertex, addTriangle, addSurface, addPanelVolume };
}

function addWalls(builder, points, roof, color) {
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const segments = [start];
    const startProjection = project(start, roof.direction);
    const endProjection = project(end, roof.direction);
    if (roof.shape === "gabled" && (startProjection - roof.middle) * (endProjection - roof.middle) < 0) {
      const ratio = (roof.middle - startProjection) / (endProjection - startProjection);
      segments.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
    }
    segments.push(end);
    for (let segment = 0; segment < segments.length - 1; segment += 1) {
      const wallStart = segments[segment];
      const wallEnd = segments[segment + 1];
      const topStart = getRoofSurfacePoint(wallStart, roof).position;
      const topEnd = getRoofSurfacePoint(wallEnd, roof).position;
      const edge = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y };
      const normal = normalize({ x: edge.y, y: -edge.x, z: 0 });
      const bottomStart = builder.addVertex({ x: wallStart.x, y: wallStart.y, z: 0 }, normal, color);
      const bottomEnd = builder.addVertex({ x: wallEnd.x, y: wallEnd.y, z: 0 }, normal, color);
      const topEndIndex = builder.addVertex(topEnd, normal, color);
      const topStartIndex = builder.addVertex(topStart, normal, color);
      builder.addTriangle(bottomStart, bottomEnd, topEndIndex);
      builder.addTriangle(bottomStart, topEndIndex, topStartIndex);
    }
  });
}

export function generateSolarProjectMesh(project) {
  const ring = project.roofRing ?? project.feature?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) throw new RangeError("A closed building footprint is required");
  const local = localPoints(ring);
  const roof = roofDefinition(local.points, project.values);
  const builder = meshBuilder();
  addWalls(builder, local.points, roof, colorComponents(project.values.buildingColor));
  const roofColor = colorComponents(project.values.roofColor);
  if (roof.shape === "gabled") {
    builder.addSurface(clipPolygon(local.points, roof.direction, roof.middle, false), roof, roofColor);
    builder.addSurface(clipPolygon(local.points, roof.direction, roof.middle, true), roof, roofColor);
  } else {
    builder.addSurface(local.points, roof, roofColor);
  }
  const panelColor = colorComponents(project.panelColor ?? "#1a4f8c");
  (project.panels ?? []).forEach((panel) => {
    const points = panel.slice(0, -1).map(local.fromLngLat);
    builder.addPanelVolume(points, roof, panelColor, 0.04, 0.03);
  });
  return {
    origin: local.origin,
    positions: new Float32Array(builder.positions),
    normals: new Float32Array(builder.normals),
    colors: new Float32Array(builder.colors),
    indices: new Uint32Array(builder.indices),
    wallHeight: roof.wallHeight,
    roofHeight: roof.roofHeight,
  };
}
