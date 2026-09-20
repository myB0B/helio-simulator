import "./style.css";
import "./welcome.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./editor.css";
import * as maplibregl from "maplibre-gl";
import { getPosition } from "suncalc";
import { aggregateStudies, angularDistance, calculateStudy, dailyEnergyBalance, directionLabel, facadeBearingsFromCoordinates, footprintAreaSquareMeters, longestSouthFacingFacade, MODULE_LENGTH_METERS, MODULE_WIDTH_METERS, recommendedPanelCount, roofPlaneSurfaceForType } from "./solar.js";
import { generateSolarProjectMesh, normalizeRing } from "./solar3d.js";
import { SolarProject3DLayer } from "./solar3d-layer.js";
import { contrastingTextColor } from "./color.js";
import { sunPhase } from "./sun-phase.js";

// MapLibre decodes vector tiles in this version-pinned ESM worker. Keeping it
// separate prevents Vite from transforming the worker into an incompatible IIFE.
maplibregl.setWorkerUrl("https://unpkg.com/maplibre-gl@6.7.0/dist/maplibre-gl-worker.mjs");

const defaultBuildingColor = "#cdd4d2";
const fallbackMapCenter = [2.2137, 46.2276];
const fallbackMapZoom = 5.5;
const savedStartLocationKey = "helio-simulator.start-location";
const welcomeSeenStorageKey = "helio-simulator.welcome-seen-v1";
const buildVersion = __HELIO_BUILD_VERSION__;

function hasSeenWelcome() {
  try {
    return localStorage.getItem(welcomeSeenStorageKey) === "true";
  } catch {
    return false;
  }
}

function markWelcomeSeen() {
  try {
    localStorage.setItem(welcomeSeenStorageKey, "true");
  } catch {
    // The welcome screen can still be dismissed for the current session.
  }
}

function clearHelioStorage() {
  if (!window.confirm("Supprimer toutes les créations, modifications et préférences enregistrées par Helio Simulator ? Cette action est irréversible.")) return;
  try {
    helioStorageKeys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Reloading still resets the current page when storage is unavailable.
  }
  window.location.reload();
}

function savedStartLocation() {
  try {
    const location = JSON.parse(localStorage.getItem(savedStartLocationKey));
    if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) return null;
    return { ...location, label: typeof location.label === "string" ? location.label : "Adresse mémorisée" };
  } catch {
    return null;
  }
}

function saveStartLocation(latitude, longitude, label) {
  try {
    localStorage.setItem(savedStartLocationKey, JSON.stringify({ latitude, longitude, label }));
  } catch {
    // The selected location still works for the current session if storage is unavailable.
  }
}

const state = {
  area: 42,
  buildingHeight: 9,
  azimuth: 172,
  roofType: "double",
  pitch: 32,
  shade: 12,
  panelCount: 0,
  panelsPerRow: 4,
  panelPower: 520,
  moduleEfficiency: 23.38,
  moduleWidth: MODULE_WIDTH_METERS,
  moduleHeight: MODULE_LENGTH_METERS,
  edgeNorth: 0,
  edgeSouth: 0,
  edgeEast: 0,
  edgeWest: 0,
  buildingColor: defaultBuildingColor,
  roofColor: "#9b3e35",
  roofShape: "gabled",
  customBuildingColor: "#e9a7bd",
  customRoofColor: "#9b3e35",
  marginTop: 0.1,
  marginBottom: 0.1,
  marginLeft: 0.1,
  marginRight: 0.1,
  mountingAllowance: 1,
  rowSpacing: 1,
  inverterType: "micro",
  inverterEfficiency: 96.6,
  cableLoss: 2,
  soilingLoss: 3,
  mismatchLoss: 2,
  availabilityLoss: 1,
  thermalLoss: 6,
  clippingLoss: 1,
  irradiance: 1250,
  dailyConsumption: 20,
  date: new Date(),
  selectedPoint: null,
  selectedBuilding: null,
};

const app = document.querySelector("#app");
const emptyCollection = { type: "FeatureCollection", features: [] };
const maximumPanelCount = 18;
let map;
let projectMarker;
let orientationMarkers = [];
let buildingLoadTimer;
let locationRequest;
let buildings = emptyCollection;
let panelCountIsManual = true;
let editorMode = false;
let editorMarker;
let editorVertexMarkers = [];
let editorPanelOrientation = "portrait";
let editorPanelLayoutIsManual = false;
let editorPanelHorizontalAlignment = "center";
let editorPanelVerticalAlignment = "center";
let roofPanelFields;
let activeRoofPanel = "first";
let editingFootprint = false;
let hoveredEditorEdgeIndex;
let hoveredEditorVertexIndex;
let hoveredEditorBuilding = false;
let editorEdgeDrag;
let editorBuildingDrag;
let editorLayerVisibility;
let solarProject3DLayer;
let editorConstraintFields = [];
let editorConstraintToastTimer;
const legacyLocalBuildingStorageKey = "helio-editor-buildings-v1";
const localBuildingStorageKey = "helio-editor-buildings-v2";
const hiddenBuildingStorageKey = "helio-editor-hidden-buildings-v1";
const buildingHeightStorageKey = "helio-editor-building-heights-v1";
const buildingColorStorageKey = "helio-editor-building-colors-v1";
const buildingConfigurationStorageKey = "helio-editor-roof-configurations-v1";
const helioStorageKeys = [
  welcomeSeenStorageKey,
  savedStartLocationKey,
  legacyLocalBuildingStorageKey,
  localBuildingStorageKey,
  hiddenBuildingStorageKey,
  buildingHeightStorageKey,
  buildingColorStorageKey,
  buildingConfigurationStorageKey,
];
const buildingConfigurationStateKeys = [
  "area", "buildingHeight", "azimuth", "roofType", "pitch", "shade", "panelCount", "panelsPerRow",
  "panelPower", "moduleEfficiency", "moduleWidth", "moduleHeight", "marginTop", "marginBottom",
  "marginLeft", "marginRight", "mountingAllowance", "rowSpacing", "inverterType", "inverterEfficiency",
  "cableLoss", "soilingLoss", "mismatchLoss", "availabilityLoss", "thermalLoss", "clippingLoss", "irradiance", "dailyConsumption",
  "buildingColor", "roofColor", "roofShape",
];
const panelFieldStateKeys = [
  "shade", "panelCount", "panelsPerRow", "panelPower", "moduleEfficiency", "moduleWidth", "moduleHeight",
  "marginTop", "marginBottom", "marginLeft", "marginRight", "mountingAllowance", "rowSpacing",
];
let localBuildings = loadLocalBuildings();
let hiddenBuildingIds = loadStoredIds(hiddenBuildingStorageKey);
let buildingHeights = loadStoredObject(buildingHeightStorageKey);
let buildingColors = loadStoredObject(buildingColorStorageKey);
let buildingConfigurations = loadStoredObject(buildingConfigurationStorageKey);

const cartoApiKey = import.meta.env.VITE_CARTO_API_KEY;
const geopfParcelsUrl = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png";
// WMTS is tile-native and avoids the one-request-per-second WMS limit.
const geopfSatelliteUrl = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg";
const satelliteEastOffsetMeters = 0;
const satelliteNorthOffsetMeters = 0;

function alignSatelliteRequest(url, resourceType) {
  if (resourceType !== "Tile" || !url.includes("LAYERS=ORTHOIMAGERY.ORTHOPHOTOS")) return { url };
  const request = new URL(url, window.location.origin);
  const bbox = request.searchParams.get("BBOX")?.split(",").map(Number);
  if (!bbox || bbox.length !== 4 || bbox.some(Number.isNaN)) return { url };

  // Requesting an east/north shifted image places the imagery west/south on
  // its map tile to match the local vector reference.
  bbox[0] += satelliteEastOffsetMeters;
  bbox[2] += satelliteEastOffsetMeters;
  bbox[1] += satelliteNorthOffsetMeters;
  bbox[3] += satelliteNorthOffsetMeters;
  request.searchParams.set("BBOX", bbox.join(","));
  return { url: request.toString() };
}

function cartoTileUrl(style) {
  const url = `https://a.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png`;
  return cartoApiKey ? `${url}?key=${encodeURIComponent(cartoApiKey)}` : url;
}

function ensureParcelsSource() {
  if (map?.getSource("parcels")) return;
  map.addSource("parcels", {
    type: "raster",
    tiles: [geopfParcelsUrl],
    tileSize: 256,
    maxzoom: 19,
    attribution: "&copy; IGN - Parcelles cadastrales",
  });
  map.addLayer({
    id: "parcel-boundaries",
    type: "raster",
    source: "parcels",
    minzoom: 17,
    layout: { visibility: "none" },
    paint: { "raster-opacity": 0.45 },
  }, "buildings-3d");
}

function showParcelBoundaries() {
  ensureParcelsSource();
  if (map?.getLayer("parcel-boundaries")) map.setLayoutProperty("parcel-boundaries", "visibility", "visible");
  refreshLayerControls();
}

function loadLocalBuildings() {
  // v1 allowed arbitrary polygons. New local buildings are quadrilaterals only.
  try {
    window.localStorage.removeItem(legacyLocalBuildingStorageKey);
  } catch {
    // Storage can be disabled without preventing map use.
  }
  const stored = loadStoredFeatures(localBuildingStorageKey);
  return {
    ...stored,
    features: stored.features.filter((feature) => feature.geometry?.type === "Polygon" && feature.geometry.coordinates?.[0]?.length === 5).map((feature, index) => {
      const id = String(feature.properties?.localId ?? feature.properties?.id ?? feature.id ?? `local-legacy-${index}`);
      return {
        ...feature,
        id,
        properties: { ...feature.properties, local: true, id, localId: id },
      };
    }),
  };
}

function localBuildingId(feature) {
  return String(feature?.properties?.localId ?? feature?.properties?.id ?? feature?.id ?? "");
}

function createLocalBuildingId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadStoredFeatures(storageKey) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey));
    return saved?.type === "FeatureCollection" && Array.isArray(saved.features) ? saved : emptyCollection;
  } catch {
    return emptyCollection;
  }
}

function loadStoredIds(storageKey) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function loadStoredObject(storageKey) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveLocalBuildings() {
  try {
    window.localStorage.setItem(localBuildingStorageKey, JSON.stringify(localBuildings));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
}

function updateLocalBuildingsSource() {
  map?.getSource("local-buildings")?.setData(renderedLocalBuildings());
  saveLocalBuildings();
  updateSun();
}

function renderedLocalBuildings() {
  return {
    ...localBuildings,
    features: localBuildings.features.map((feature) => {
      const configuration = buildingConfigurations[localBuildingId(feature)];
      if (!configuration) return feature;
      return {
        ...feature,
        properties: { ...feature.properties, height: configurationWallHeight(configuration), custom3d: hasSolar3dData(configuration) },
      };
    }),
  };
}

function applyHiddenBuildings() {
  const visible = {
    type: "FeatureCollection",
    features: buildings.features
      .filter((feature) => !hiddenBuildingIds.includes(feature.id))
      .map((feature) => {
        const configuration = buildingConfigurations[feature.id];
        if (!configuration?.feature?.geometry) return feature;
        return {
          ...feature,
          geometry: cloneFeature(configuration.feature).geometry,
          properties: {
            ...feature.properties,
            ...configuration.feature.properties,
            height: configurationWallHeight(configuration),
            custom3d: hasSolar3dData(configuration),
          },
        };
      }),
  };
  map?.getSource("display-buildings")?.setData(visible);
  try {
    window.localStorage.setItem(hiddenBuildingStorageKey, JSON.stringify(hiddenBuildingIds));
  } catch {
    // The current map session still keeps the building hidden.
  }
}

function updateSelectedBuildingHeight() {
  const building = state.selectedBuilding;
  if (!building?.feature) return;
  const height = Number(state.buildingHeight.toFixed(1));
  building.feature.properties = { ...building.feature.properties, height };

  if (building.feature.properties.local) {
    localBuildings = {
      ...localBuildings,
      features: localBuildings.features.map((feature) => localBuildingId(feature) === String(building.id)
        ? { ...feature, properties: { ...feature.properties, height } }
        : feature),
    };
    updateLocalBuildingsSource();
  } else {
    buildingHeights = { ...buildingHeights, [building.id]: height };
    try {
      window.localStorage.setItem(buildingHeightStorageKey, JSON.stringify(buildingHeights));
    } catch {
      // The revised height remains active for the current browser session.
    }
    buildings = {
      ...buildings,
      features: buildings.features.map((feature) => String(feature.id) === String(building.id)
        ? { ...feature, properties: { ...feature.properties, height } }
        : feature),
    };
    applyHiddenBuildings();
  }
  updateSun();
  saveSelectedBuildingConfiguration();
}

function saveBuildingHeight() {
  const input = document.querySelector("#buildingHeight");
  if (!input || !state.selectedBuilding) return;
  const height = Number(input.value);
  if (!Number.isFinite(height) || height < 0) {
    reportEditorConstraint("La hauteur du batiment doit etre un nombre positif.", { fields: ["buildingHeight"] });
    input.value = String(state.buildingHeight);
    return;
  }
  const previousHeight = state.buildingHeight;
  state.buildingHeight = Math.min(300, height);
  if (height > 300) reportEditorConstraint("La hauteur maximale autorisee est de 300 m.", { fields: ["buildingHeight"] });
  if (selectedBuilding3dGeometryError()) {
    state.buildingHeight = previousHeight;
    input.value = String(previousHeight);
    show3dGeometryError(["buildingHeight"]);
    return;
  }
  if (height <= 300) clearEditorConstraint();
  input.value = String(state.buildingHeight);
  updateSelectedBuildingHeight();
}

function validBuildingColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : defaultBuildingColor;
}

function roofShapeForType(roofType) {
  return { terrace: "flat", single: "skillion", double: "gabled" }[roofType] ?? "gabled";
}

function roofTags(values) {
  return {
    height: values.buildingHeight,
    "building:colour": values.buildingColor,
    "roof:shape": values.roofShape ?? roofShapeForType(values.roofType),
    "roof:angle": values.pitch,
    "roof:direction": values.azimuth,
    "roof:colour": values.roofColor,
  };
}

function updateSelectedBuildingColor(color) {
  const building = state.selectedBuilding;
  if (!building?.feature) return;
  const nextColor = validBuildingColor(color);
  state.buildingColor = nextColor;
  building.feature.properties = { ...building.feature.properties, color: nextColor };
  if (building.originalFeature) building.originalFeature.properties = { ...building.originalFeature.properties, color: nextColor };

  if (building.feature.properties.local) {
    localBuildings = {
      ...localBuildings,
      features: localBuildings.features.map((feature) => localBuildingId(feature) === String(building.id)
        ? { ...feature, properties: { ...feature.properties, color: nextColor } }
        : feature),
    };
    updateLocalBuildingsSource();
  } else {
    buildingColors = { ...buildingColors, [building.id]: nextColor };
    try {
      window.localStorage.setItem(buildingColorStorageKey, JSON.stringify(buildingColors));
    } catch {
      // The selected color remains active for the current browser session.
    }
    buildings = {
      ...buildings,
      features: buildings.features.map((feature) => String(feature.id) === String(building.id)
        ? { ...feature, properties: { ...feature.properties, color: nextColor } }
        : feature),
    };
    applyHiddenBuildings();
  }
  saveSelectedBuildingConfiguration();
  renderPanelValues();
}

function updateSelectedRoofColor(color) {
  if (!state.selectedBuilding?.feature) return;
  state.roofColor = validBuildingColor(color);
  saveSelectedBuildingConfiguration();
  renderPanelValues();
}

function panelFieldSnapshot() {
  return {
    values: Object.fromEntries(panelFieldStateKeys.map((key) => [key, state[key]])),
    panelOrientation: editorPanelOrientation,
    panelLayoutManual: editorPanelLayoutIsManual,
    panelHorizontalAlignment: editorPanelHorizontalAlignment,
    panelVerticalAlignment: editorPanelVerticalAlignment,
  };
}

function applyPanelFieldSnapshot(field) {
  if (!field) return;
  Object.assign(state, field.values);
  editorPanelOrientation = field.panelOrientation ?? "portrait";
  editorPanelLayoutIsManual = Boolean(field.panelLayoutManual);
  editorPanelHorizontalAlignment = field.panelHorizontalAlignment ?? "center";
  editorPanelVerticalAlignment = field.panelVerticalAlignment ?? "center";
}

function hasSplitRoofPanels() {
  return state.roofType === "double" && Boolean(roofPanelFields?.first && roofPanelFields?.second);
}

function activePanelBearing() {
  return (roofLayoutBearing() + (hasSplitRoofPanels() && activeRoofPanel === "second" ? 180 : 0)) % 360;
}

function saveActivePanelField() {
  if (roofPanelFields?.[activeRoofPanel]) roofPanelFields[activeRoofPanel] = panelFieldSnapshot();
}

function selectRoofPanel(panel) {
  if (!hasSplitRoofPanels() || !roofPanelFields[panel] || panel === activeRoofPanel) return;
  saveActivePanelField();
  activeRoofPanel = panel;
  applyPanelFieldSnapshot(roofPanelFields[panel]);
  updateDefaultPanelCount();
  updateGeometricPanelCount();
  renderPanelValues();
  refreshEditorVisuals();
  saveSelectedBuildingConfiguration();
}

function enableSplitRoofPanels() {
  if (state.roofType !== "double" || hasSplitRoofPanels()) return;
  const current = panelFieldSnapshot();
  roofPanelFields = { first: current, second: JSON.parse(JSON.stringify(current)) };
  activeRoofPanel = "first";
  renderPanelValues();
  refreshEditorVisuals();
  saveSelectedBuildingConfiguration();
}

function withRoofPanel(panel, callback) {
  if (!hasSplitRoofPanels() || panel === activeRoofPanel) return callback();
  const savedPanel = activeRoofPanel;
  const savedField = panelFieldSnapshot();
  saveActivePanelField();
  activeRoofPanel = panel;
  applyPanelFieldSnapshot(roofPanelFields[panel]);
  try {
    return callback();
  } finally {
    saveActivePanelField();
    activeRoofPanel = savedPanel;
    applyPanelFieldSnapshot(savedField);
  }
}

function configurationValues() {
  return Object.fromEntries(buildingConfigurationStateKeys.map((key) => [key, state[key]]));
}

function saveSelectedBuildingConfiguration() {
  const building = state.selectedBuilding;
  if (!building?.feature) return;
  saveActivePanelField();
  const roofRing = normalizeRing(building.feature.geometry.coordinates[0]);
  const configuration = {
    feature: cloneFeature(building.feature),
    roofRing: roofRing.map((coordinate) => [...coordinate]),
    values: configurationValues(),
    panelOrientation: editorPanelOrientation,
    panelLayoutManual: editorPanelLayoutIsManual,
    panelHorizontalAlignment: editorPanelHorizontalAlignment,
    panelVerticalAlignment: editorPanelVerticalAlignment,
    panelFields: roofPanelFields ? JSON.parse(JSON.stringify(roofPanelFields)) : undefined,
    activeRoofPanel,
    panels: allValidatedPanelPolygons(roofRing),
    tags: roofTags(state),
  };
  try {
    generateSolarProjectMesh(configuration);
  } catch (error) {
    if (error instanceof RangeError) show3dGeometryError();
    else throw error;
    return false;
  }
  buildingConfigurations = {
    ...buildingConfigurations,
    [building.id]: configuration,
  };
  try {
    window.localStorage.setItem(buildingConfigurationStorageKey, JSON.stringify(buildingConfigurations));
  } catch {
    // The active configuration remains rendered for this browser session.
  }
  applyHiddenBuildings();
  if (building.feature.properties?.local) updateLocalBuildingsSource();
  else updateSun();
  refreshSolarProject3d();
}

function removeBuildingConfiguration(id) {
  if (!Object.hasOwn(buildingConfigurations, id)) return;
  const { [id]: removed, ...remaining } = buildingConfigurations;
  buildingConfigurations = remaining;
  try {
    window.localStorage.setItem(buildingConfigurationStorageKey, JSON.stringify(buildingConfigurations));
  } catch {
    // Storage cleanup is best effort.
  }
  refreshSolarProject3d();
}

function formatDateTime(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);
}

function correctFrenchText(root = app) {
  const replacements = [
    ["Batiments", "Bâtiments"], ["batiments", "bâtiments"], ["batiment", "bâtiment"], ["Editeur", "Éditeur"], ["Editer", "Éditer"],
    ["Reinitialiser", "Réinitialiser"], ["personnalisee", "personnalisée"], ["Inter-rangees", "Inter-rangées"],
    ["rangees", "rangées"], ["rangee", "rangée"], ["faitage", "faîtage"], ["egout", "goutière"],
    ["Parametres", "Paramètres"], ["parametres", "paramètres"], ["Controle", "Contrôle"], ["controle", "contrôle"],
    ["Coordonnees", "Coordonnées"], ["elevation", "élévation"], ["energie", "énergie"], ["defaut", "défaut"],
    ["Reduction", "Réduction"], ["recue", "reçue"], ["cheminees", "cheminées"], ["Cables", "Câbles"],
    ["cables", "câbles"], ["poussieres", "poussières"], ["Ecart", "Écart"], ["Disponibilite", "Disponibilité"],
    ["Indisponibilite", "Indisponibilité"], ["liee", "liée"], ["arrets", "arrêts"], ["defauts", "défauts"],
    ["pre-etude", "pré-étude"], ["Ecretage", "Écrêtage"], ["depasse", "dépasse"], ["autorisee", "autorisée"],
    ["utilisee", "utilisée"], ["apres", "après"], ["Selectionnez", "Sélectionnez"], ["selectionne", "sélectionné"], ["etre", "être"],
    ["arrete", "arête"], ["aretes", "arêtes"], ["arete", "arête"], ["opposee", "opposée"], ["ecrase", "écrasé"],
    ["geolocalisation", "géolocalisation"], ["reessayez", "réessayez"], ["limite", "limité"], ["facades", "façades"],
    ["theorique", "théorique"], ["systeme", "système"], ["exploitee", "exploitée"], ["capacite", "capacité"], ["Aligner a", "Aligner à"], [" deg", " °"],
  ];
  const correct = (text) => replacements.reduce((value, [from, to]) => value.replaceAll(from, to), text);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => { node.nodeValue = correct(node.nodeValue); });
  root.querySelectorAll("[aria-label], [title], [placeholder]").forEach((element) => {
    ["aria-label", "title", "placeholder"].forEach((attribute) => {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, correct(element.getAttribute(attribute)));
    });
  });
}

function studyInput() {
  const roofArea = state.selectedBuilding?.feature
    ? footprintAreaSquareMeters(effectiveRoofRing(state.selectedBuilding.feature, roofLayoutBearing()))
    : state.area;
  return {
    ...state,
    azimuth: activePanelBearing(),
    area: roofPlaneSurfaceForType(roofArea, state.roofType, state.pitch),
    edgeAllowance: roofMarginAllowance(),
  };
}

function studyForBuildingConfiguration(configuration) {
  if (!hasSolar3dData(configuration)) return null;
  return withBuildingConfiguration(configuration, () => {
    if (!hasSplitRoofPanels()) return calculateStudy(studyInput());
    const study = aggregateStudies(["first", "second"].map((panel) => withRoofPanel(panel, () => calculateStudy(studyInput()))));
    const dailyConsumption = Number(state.dailyConsumption) || 0;
    return {
      ...study,
      dailyConsumption,
      dailySelfSufficiency: dailyConsumption > 0 ? Math.min(100, study.dailyProduction / dailyConsumption * 100) : 0,
    };
  });
}

function totalBuildingStudy() {
  return aggregateStudies(Object.values(buildingConfigurations)
    .map(studyForBuildingConfiguration)
    .filter(Boolean));
}

function totalEstimateMarkup(total = totalBuildingStudy()) {
  const consumption = Math.max(0, Number(state.dailyConsumption) || 0);
  const balance = dailyEnergyBalance(total.dailyProduction, consumption);
  const surplus = balance.surplusEnergy > 0 ? `<span class="daily-surplus">Surplus : ${formatNumber(balance.surplusPercent, 1)} % · ${formatNumber(balance.surplusEnergy, 1)} kWh/jour</span>` : "";
  return `<span>Total des bâtiments créés</span><strong>${formatNumber(total.annualProduction)} <small>kWh/an</small></strong><span class="daily-production">${formatNumber(total.dailyProduction, 1)} kWh/jour en moyenne</span><span class="daily-self-sufficiency">Autosuffisance journalière globale : ${formatNumber(balance.dailySelfSufficiency, 1)} %</span>${surplus}<div><b>${formatNumber(total.buildingCount)} bâtiments</b><b>${formatNumber(total.panelCount)} panneaux</b><b>${formatNumber(total.power, 2)} kWc</b></div>`;
}

function renderTotalEstimate() {
  const totalEstimate = document.querySelector(".total-estimate");
  if (totalEstimate) totalEstimate.innerHTML = totalEstimateMarkup();
}

function roofPanelEstimatesMarkup() {
  if (!hasSplitRoofPanels()) return "";
  return ["first", "second"].map((panel) => withRoofPanel(panel, () => {
    const study = calculateStudy(studyInput());
    const bearing = activePanelBearing();
    const label = panel === "first" ? "Pan A" : "Pan B";
    return `<div><span>${label} · ${directionLabel(Math.round(bearing))}</span><b>${formatNumber(study.annualProduction)} kWh/an</b><small>${formatNumber(state.panelCount)} panneaux · ${formatNumber(study.power, 2)} kWc</small></div>`;
  })).join("");
}

function selectedBuildingStudy() {
  if (!hasSplitRoofPanels()) return calculateStudy(studyInput());
  return aggregateStudies(["first", "second"].map((panel) => withRoofPanel(panel, () => calculateStudy(studyInput()))));
}

function updateDefaultPanelCount() {
  if (panelCountIsManual) return;
  state.panelCount = Math.min(maximumPanelCount, recommendedPanelCount(studyInput()));
}

function roofTypeLabel(roofType) {
  return { terrace: "Toit terrasse", single: "Simple pan", double: "Double pan" }[roofType];
}

function roofLayoutBearing() {
  // A terrace has no slope, but its module rows must remain aligned with the
  // selected building instead of being forced north-south.
  return state.azimuth;
}

function roofSurfaceDescription() {
  const surface = studyInput().area;
  return `${roofTypeLabel(state.roofType)} - surface theorique du pan : ${formatNumber(surface, 1)} m2`;
}

function facadeOptions() {
  const facades = state.selectedBuilding?.facades ?? [];
  if (!facades.length) return '<option value="">Selectionnez un batiment sur la carte</option>';
  return [...facades].sort((first, second) => first.bearing - second.bearing).map((facade) => {
    const bearing = Math.round(facade.bearing) % 360;
    return `<option value="${bearing}" ${bearing === state.azimuth ? "selected" : ""}>${directionLabel(bearing)} - ${bearing} deg</option>`;
  }).join("");
}

function render() {
  const study = calculateStudy(studyInput());
  const sun = getPosition(state.date, fallbackMapCenter[1], fallbackMapCenter[0]);
  const elevation = sun ? Math.round(sun.altitude) : null;

  app.innerHTML = `
    <div id="map" aria-label="Carte 3D des batiments et de leurs ombres"></div>
    <header class="map-header">
      <a class="brand" href="#map" aria-label="Helio Simulator"><span class="brand-mark">H</span><span>helio</span><span class="brand-handwritten">Simulator</span></a>
      <div class="header-caption"><span class="live-dot"></span> Cartographie d'exposition solaire</div>
       <button id="open-welcome" class="help-button" type="button" aria-label="Afficher l'aide du simulateur" aria-controls="welcome-modal" aria-expanded="false"></button>
       <button id="open-search" class="search-button" type="button" aria-label="Rechercher une adresse" aria-controls="search-popup" aria-expanded="false"></button>
      <button id="toggle-panel" class="header-button" type="button" aria-expanded="false">Simulateur</button>
     </header>

     <section id="welcome-modal" class="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title" hidden>
       <div class="welcome-dialog">
         <div class="welcome-heading"><span>BIENVENUE</span><button id="close-welcome" type="button" aria-label="Fermer l'aide"></button></div>
          <h1 id="welcome-title">Helio Simulator</h1>
          <p>Explorez l'ensoleillement d'un bâtiment sur une carte 3D : recherchez une adresse, adaptez l'emprise et la toiture, puis positionnez vos panneaux.</p>
          <p><strong>Éditeur de bâtiment</strong> : créez ou sélectionnez une emprise, déplacez ses arêtes et sommets, puis ajustez la hauteur, la forme du toit, ses dimensions et l’implantation des panneaux. Les limites de géométrie sont signalées directement dans l’éditeur.</p>
          <p>La date et l'heure animent le soleil, les ombres et le reflet des modules. Le simulateur fournit aussi une estimation indicative de production.</p>
          <p class="welcome-notice"><strong>À savoir</strong> : Ce projet est informatif et ludique. Les résultats affichés ne constituent ni une étude technique, financière, réglementaire ou structurelle, ni une garantie de production. Ils sont proposés uniquement à titre indicatif.</p>
          <footer class="welcome-footer"><span>Réalisé par FC avec l’aide d’OpenCode et ChatGPT 5.6 Terra Fast.</span><span>Version ${buildVersion}</span></footer>
          <section class="welcome-storage" aria-label="Données locales"><p>Vos créations et modifications sont enregistrées localement dans votre navigateur sur votre ordinateur. Aucune information personnelle n'est enregistrée ou conservée par le créateur de cette application. Vous pouvez les supprimer à tout moment avec le bouton ci-dessous :</p><button id="clear-helio-storage" type="button">Supprimer toutes les données<br /><span>(Attention : cela effacera toutes vos créations ou modifications.)</span></button></section>
          <button id="dismiss-welcome" class="welcome-confirm" type="button">Commencer l'exploration</button>
       </div>
     </section>

     <section id="search-popup" class="search-popup" aria-label="Recherche d'adresse" hidden>
        <div class="search-popup-title"><span>RECHERCHE</span><button id="close-search" type="button" aria-label="Fermer la recherche"></button></div>
      <form id="location-form" class="location-search">
        <label for="location-query">Ville ou adresse</label>
        <div class="location-row"><input id="location-query" type="search" autocomplete="street-address" placeholder="Ex. 12 rue de la Paix, Paris" /><button type="submit">Rechercher</button></div>
        <button id="locate-me" class="locate-button" type="button">Utiliser ma position</button>
        <div id="location-results" class="location-results" aria-live="polite"></div>
      </form>
    </section>

    <section id="editor-toolbar" class="editor-toolbar" aria-label="Editeur de configuration" hidden>
      <div class="editor-heading"><span>EDITEUR 2D</span><button id="exit-editor" class="editor-exit" type="button">Retour 3D</button></div>
      <details class="editor-section" open><summary>Batiments</summary><div class="editor-actions"><button id="new-footprint" type="button">Nouveau</button><button id="edit-footprint" type="button">Modifier</button></div><div id="building-edit-options" hidden><div class="editor-actions"><button id="reset-footprint" type="button">Reinitialiser</button><button id="delete-selection" class="editor-delete" type="button">Supprimer</button></div><div class="editor-panel-fields"><div class="editor-field-title">Dimensions</div>${field("buildingHeight", "Hauteur batiment", state.buildingHeight, "m", 0, 300, 0.1, "Hauteur utilisee pour le volume 3D et la longueur des ombres. Modifiez-la apres avoir selectionne le batiment.", !state.selectedBuilding)}${field("edgeNorth", "Nord", state.edgeNorth, "cm", 1, 20000, 1)}${field("edgeSouth", "Sud", state.edgeSouth, "cm", 1, 20000, 1)}${field("edgeEast", "Est", state.edgeEast, "cm", 1, 20000, 1)}${field("edgeWest", "Ouest", state.edgeWest, "cm", 1, 20000, 1)}<div class="editor-field-title">Couleur</div><div class="building-color-controls">${buildingColorButton("#70757a", "Gris")}${buildingColorButton("#ddd0b4", "Beige")}${buildingColorButton("#b8d7be", "Vert")}<button id="custom-building-color" class="building-color-button${!["#70757a", "#ddd0b4", "#b8d7be"].includes(state.buildingColor.toLowerCase()) ? " is-selected" : ""}" type="button" style="--building-color:${state.buildingColor}">Perso</button><input id="building-color-picker" class="building-color-picker" type="color" value="${state.buildingColor}" aria-label="Choisir une couleur personnalisee" /></div><div class="editor-field-title">Forme du toit</div><fieldset class="roof-type"><div>${roofTypeButton("terrace", "Toit terrasse")}${roofTypeButton("single", "Simple pan")}${roofTypeButton("double", "Double pan")}</div></fieldset><label class="field" for="roof-orientation"><span>Bas de pente</span><div><select id="roof-orientation" name="azimuth" ${state.roofType === "terrace" || !state.selectedBuilding ? "disabled" : ""}>${facadeOptions()}</select><em>deg</em></div></label>${field("pitch", "Inclinaison", state.pitch, "deg", 0, 90, 1)}${field("area", "Surface brute", state.area, "m2", 1, 300, 1)}<div id="roof-result" class="roof-result">${roofSurfaceDescription()}</div></div></div></details>
      <details class="editor-section"><summary>Panneaux</summary><div class="editor-actions"><button class="editor-layout is-selected" data-editor-layout="portrait" type="button">Portrait</button><button class="editor-layout" data-editor-layout="landscape" type="button">Paysage</button></div><div class="editor-panel-fields">${field("panelCount", "Nombre", state.panelCount, "", 0, maximumPanelCount, 1)}${field("panelsPerRow", "Panneaux / rangee", state.panelsPerRow, "", 1, maximumPanelCount, 1)}${field("moduleWidth", "Largeur", state.moduleWidth, "m", 0.1, 5, 0.001)}${field("moduleHeight", "Hauteur", state.moduleHeight, "m", 0.1, 5, 0.001)}<div class="editor-field-title">Marges du pan actif</div>${field("marginTop", "Haut / faitage", state.marginTop, "m", 0, 20, 0.1)}${field("marginBottom", "Bas / egout", state.marginBottom, "m", 0, 20, 0.1)}${field("marginLeft", "Gauche", state.marginLeft, "m", 0, 20, 0.1)}${field("marginRight", "Droite", state.marginRight, "m", 0, 20, 0.1)}${field("mountingAllowance", "Jeux de pose", state.mountingAllowance, "cm", 0, 100, 1)}${field("rowSpacing", "Inter-rangees", state.rowSpacing, "cm", 0, 300, 1)}<div id="surface-summary" class="surface-summary">${surfaceSummary(study)}</div><p id="layout-warning" class="layout-warning" hidden></p><div class="editor-key"><span><i class="key-footprint"></i>Emprise</span><span><i class="key-plane"></i>Pan</span><span><i class="key-setback"></i>Retrait</span><span><i class="key-panel"></i>Modules</span><span><i class="key-invalid-panel"></i>Hors pan</span><span><i class="key-ridge"></i>Faitage</span></div></div></details>
    </section>

    <aside id="study-panel" class="study-panel is-closed" aria-label="Parametres photovoltaiques">
       <div class="panel-title"><div><h1>Simulation solaire</h1></div><button id="close-panel" type="button" aria-label="Fermer les parametres"></button></div>
       <div class="study-section study-location">
         <div class="study-section-content"><p id="selected-coordinates" class="selected-coordinates" style="margin: 0; padding: 10px 0 4px; text-align: center;">Coordonnees</p></div>
       </div>
       <section class="simulation-control" aria-label="Controle du soleil">
        <label for="date-time">Date et heure locale</label>
        <div class="time-row"><input id="date-time" type="datetime-local" value="${formatDateTime(state.date)}" /><button id="now" type="button">Maintenant</button></div>
        <div class="hour-slider"><input id="time-slider" type="range" min="0" max="1439" step="1" value="${minutesSinceMidnight(state.date)}" aria-label="Heure de la simulation" /><output id="time-value" for="time-slider">${formatTime(state.date)}</output></div>
        <div class="sun-readout"><span><b>${elevation === null ? "--" : `${elevation} °`}</b> elevation solaire</span><span id="shadow-state">${sunPhase(elevation).label}${elevation !== null && elevation > 0 ? " · ombres actives" : ""}</span></div>
       </section>
       <form id="study-form">
         <details class="study-section">
          <summary>Modules et rendement</summary>
          <div class="study-section-content">${calculatedField("total-panel-power", "Puissance totale", state.panelCount * state.panelPower, "Wc")}${field("panelPower", "Puissance unitaire", state.panelPower, "Wc", 0, 1000, 5)}${field("moduleEfficiency", "Rendement panneau", state.moduleEfficiency, "%", 0, 30, 0.01)}</div>
        </details>
        <details class="study-section">
          <summary>Conversion et pertes</summary>
          <div class="study-section-content"><label class="field" for="inverter-type"><span>Conversion</span><div><select id="inverter-type" name="inverterType"><option value="central" ${state.inverterType === "central" ? "selected" : ""}>Onduleur central</option><option value="micro" ${state.inverterType === "micro" ? "selected" : ""}>Micro-onduleurs</option></select></div></label>${field("inverterEfficiency", "Rendement onduleur", state.inverterEfficiency, "%", 0, 100, 0.1, "Part de l'energie DC convertie en AC par l'onduleur ou les micro-onduleurs. Valeur par defaut : 96,6 %.")}${field("shade", "Ombrage estime", state.shade, "%", 0, 100, 1, "Reduction de l'energie solaire recue par les masques proches : arbres, cheminees, batiments voisins ou relief. Cette perte est distincte des pertes electriques du systeme.")}${field("cableLoss", "Cables", state.cableLoss, "%", 0, 30, 0.1, "Pertes resistives dans les cables entre modules, onduleur et raccordement. Valeur par defaut : 2 %.")}${field("soilingLoss", "Encrassement", state.soilingLoss, "%", 0, 30, 0.1, "Baisse de production due aux poussieres, pollens, feuilles et salissures. Valeur par defaut : 3 %.")}${field("mismatchLoss", "Mismatch", state.mismatchLoss, "%", 0, 30, 0.1, "Ecart de production entre modules cause par leur dispersion, temperature, vieillissement ou ombrage local. Valeur par defaut : 2 %.")}${field("availabilityLoss", "Disponibilite", state.availabilityLoss, "%", 0, 30, 0.1, "Indisponibilite previsionnelle liee aux arrets, maintenance ou defauts ponctuels. Valeur par defaut : 1 %.")}${field("thermalLoss", "Thermique", state.thermalLoss, "%", 0, 30, 0.1, "Perte de rendement lorsque les modules chauffent. Valeur de pre-etude : 6 %, a remplacer par un modele thermique si disponible.")}${field("clippingLoss", "Ecretage", state.clippingLoss, "%", 0, 30, 0.1, "Energie non convertie lorsque la puissance DC depasse la puissance AC disponible. Valeur par defaut : 1 %, a confirmer avec le ratio DC/AC.")}${field("irradiance", "Irradiation annuelle", state.irradiance, "kWh/m2", 500, 2000, 10)}</div>
         </details>
         <details class="study-section">
           <summary>Consommation</summary>
           <div class="study-section-content">${field("dailyConsumption", "Moyenne journalière", state.dailyConsumption, "kWh", 0, 1000, 0.1, "Consommation électrique moyenne quotidienne utilisée pour estimer l'autosuffisance journalière.")}</div>
         </details>
       </form>
        <div class="estimate"><span>Production indicative</span><strong>${formatNumber(study.annualProduction)} <small>kWh/an</small></strong><span class="daily-production">${formatNumber(study.dailyProduction, 1)} kWh/jour en moyenne</span><span class="daily-self-sufficiency">Autosuffisance journalière : ${formatNumber(study.dailySelfSufficiency, 1)} %</span><div><b>${formatNumber(state.panelCount)} panneaux</b><b>${formatNumber(study.power, 2)} kWc</b><b>${formatNumber(study.systemLoss, 1)} % pertes systeme</b></div></div>
         <div class="roof-panel-estimates"></div>
         <div class="total-estimate">${totalEstimateMarkup()}</div>
    </aside>

  `;
  document.querySelector("#editor-toolbar .editor-section summary").textContent = "Batiment";
  addRotationControls();
  addPanelAlignmentControls();
  addMaterialIcons();
  app.dataset.sunPhase = sunPhase(elevation).id;
  bindControls();
  renderPanelValues();
  correctFrenchText();
}

function field(id, label, value, unit, min, max, step, help = "", disabled = false) {
  return `<label class="field" for="${id}"><span>${label}${help ? infoTip(help) : ""}</span><div><input id="${id}" name="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" ${disabled ? "disabled" : ""} /><em>${unit}</em></div></label>`;
}

function ensureEditorConstraintNotice(fieldId) {
  let notice = document.querySelector("#editor-constraint-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "editor-constraint-notice";
    notice.className = "editor-constraint-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.hidden = true;
  }
  const anchor = fieldId
    ? document.querySelector(`#${fieldId}`)?.closest(".field")
    : document.querySelector("#editor-toolbar .editor-heading");
  if (!anchor) return null;
  anchor.insertAdjacentElement("afterend", notice);
  return notice;
}

function clearEditorConstraint() {
  editorConstraintFields.forEach((field) => {
    field.classList.remove("has-constraint");
    field.removeAttribute("aria-invalid");
    field.closest(".field")?.querySelector(".field-constraint-message")?.remove();
  });
  editorConstraintFields = [];
  const notice = document.querySelector("#editor-constraint-notice");
  if (notice) {
    notice.hidden = true;
    notice.textContent = "";
  }
}

function reportEditorConstraint(message, { fields = [], point, noticeField } = {}) {
  clearEditorConstraint();
  const notice = ensureEditorConstraintNotice(noticeField);
  if (notice) {
    notice.textContent = message;
    notice.hidden = false;
  }
  editorConstraintFields = fields.map((id) => document.querySelector(`#${id}`)).filter(Boolean);
  editorConstraintFields.forEach((field) => {
    field.classList.add("has-constraint");
    field.setAttribute("aria-invalid", "true");
    if (!noticeField) field.closest(".field")?.insertAdjacentHTML("beforeend", `<p class="field-constraint-message">${message}</p>`);
  });
  correctFrenchText();
  if (!point || !map) return;
  let toast = map.getContainer().querySelector(".editor-constraint-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "editor-constraint-toast";
    map.getContainer().append(toast);
  }
  toast.textContent = message;
  toast.style.left = `${point.x + 14}px`;
  toast.style.top = `${point.y + 14}px`;
  toast.hidden = false;
  window.clearTimeout(editorConstraintToastTimer);
  editorConstraintToastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function roofSlopeRun(feature = state.selectedBuilding?.feature, bearing = roofLayoutBearing()) {
  if (!feature || state.roofType === "terrace") return 0;
  const ring = effectiveRoofRing(feature, bearing);
  const center = footprintCenter(ring);
  const origin = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
  const meter = origin.meterInMercatorCoordinateUnits();
  const radians = (bearing * Math.PI) / 180;
  const projections = ring.slice(0, -1).map((coordinate) => {
    const point = maplibregl.MercatorCoordinate.fromLngLat(coordinate, 0);
    const east = (point.x - origin.x) / meter;
    const north = (origin.y - point.y) / meter;
    return east * Math.sin(radians) + north * Math.cos(radians);
  });
  const span = Math.max(...projections) - Math.min(...projections);
  return state.roofType === "double" ? span / 2 : span;
}

function maximumRoofPitch() {
  const run = roofSlopeRun();
  const height = Number(state.buildingHeight);
  if (!run || !Number.isFinite(height) || height < 0) return 0;
  return Math.min(89, Math.max(0, Math.atan(height / run) * 180 / Math.PI));
}

function minimumBuildingHeight(feature = state.selectedBuilding?.feature, bearing = roofLayoutBearing()) {
  const run = roofSlopeRun(feature, bearing);
  return Math.max(0, run * Math.tan((Number(state.pitch) * Math.PI) / 180));
}

function show3dGeometryError(fields = ["buildingHeight"], point) {
  const minimum = minimumBuildingHeight();
  const detail = minimum > 0 ? ` Hauteur minimale requise : ${formatNumber(minimum, 2)} m.` : "";
  reportEditorConstraint(`Modification impossible : la pente du toit depasse la hauteur totale du batiment.${detail}`, { fields, point, noticeField: "buildingHeight" });
}

function calculatedField(id, label, value, unit) {
  return `<label class="field" for="${id}"><span>${label}</span><div><input id="${id}" type="number" value="${value}" readonly /><em>${unit}</em></div></label>`;
}

function infoTip(text) {
  return `<span class="info-tip" tabindex="0" role="img" aria-label="Information"><span>i</span><em role="tooltip">${text}</em></span>`;
}

function selectedCoordinatesLabel() {
  if (!state.selectedPoint) return "Coordonnees";
  return `Coordonnees : ${state.selectedPoint.lat.toFixed(6)}, ${state.selectedPoint.lng.toFixed(6)}`;
}

function surfaceSummary(study) {
  const rows = [
    ["Surface non exploitable", study.excludedArea],
    ["Surface exploitable", study.usableArea],
    ["Surface panneaux", study.panelSurface],
    ["Emprise de pose", study.installationSurface],
    ["Surface non exploitee apres pose", Math.max(0, study.remainingArea)],
  ];
  const warning = study.capacityExceeded ? `<p class="capacity-warning">L'emprise des panneaux depasse la surface exploitable du pan de ${formatNumber(Math.abs(study.remainingArea), 1)} m2.</p>` : "";
  return `${rows.map(([label, value]) => `<div><span>${label}</span><b>${formatNumber(value, 1)} m2</b></div>`).join("")}${warning}`;
}

function roofTypeButton(type, label) {
  const selected = state.roofType === type;
  return `<button class="roof-type-button${selected ? " is-selected" : ""}" type="button" data-roof-type="${type}" aria-pressed="${selected}">${label}</button>`;
}

function buildingColorButton(color, label) {
  const selected = state.buildingColor.toLowerCase() === color;
  return `<button class="building-color-button${selected ? " is-selected" : ""}" type="button" data-building-color="${color}" style="--building-color:${color};--building-text-color:${contrastingTextColor(color)}">${label}</button>`;
}

function roofColorButton(color, label) {
  const selected = state.roofColor.toLowerCase() === color;
  return `<button class="building-color-button${selected ? " is-selected" : ""}" type="button" data-roof-color="${color}" style="--building-color:${color};--building-text-color:${contrastingTextColor(color)}">${label}</button>`;
}

function addRoofColorControls() {
  const buildingControls = document.querySelector("#building-color-picker")?.parentElement;
  if (!buildingControls) return;
  buildingControls.insertAdjacentHTML("afterend", `<div class="editor-field-title">Couleur du toit</div><div class="building-color-controls">${roofColorButton("#cdd4d2", "Gris")}${roofColorButton("#9b3e35", "Rouge tuile")}${roofColorButton("#465b73", "Bleu ardoise")}<button id="custom-roof-color" class="building-color-button${!["#cdd4d2", "#9b3e35", "#465b73"].includes(state.roofColor.toLowerCase()) ? " is-selected" : ""}" type="button" style="--building-color:${state.roofColor}">Perso</button><input id="roof-color-picker" class="building-color-picker" type="color" value="${state.roofColor}" aria-label="Choisir une couleur personnalisee du toit" /></div>`);
}

function addRoofPanelControls() {
  const panelFields = document.querySelector("#layout-warning")?.parentElement;
  if (!panelFields || document.querySelector("#roof-panel-controls")) return;
  panelFields.insertAdjacentHTML("afterbegin", `<div id="roof-panel-controls" class="roof-panel-controls" hidden><span>Configuration photovoltaïque</span><button id="split-roof-panels" type="button">Dissocier les deux pans</button><div class="roof-panel-tabs" hidden><button type="button" data-roof-panel="first">Pan A</button><button type="button" data-roof-panel="second">Pan B</button></div></div>`);
  document.querySelector("#split-roof-panels").addEventListener("click", enableSplitRoofPanels);
  document.querySelectorAll("[data-roof-panel]").forEach((button) => button.addEventListener("click", () => selectRoofPanel(button.dataset.roofPanel)));
}

function updateRoofPanelControls() {
  const controls = document.querySelector("#roof-panel-controls");
  if (!controls) return;
  const split = hasSplitRoofPanels();
  controls.hidden = state.roofType !== "double";
  document.querySelector("#split-roof-panels").hidden = split;
  const tabs = controls.querySelector(".roof-panel-tabs");
  tabs.hidden = !split;
  if (!split) return;
  tabs.querySelectorAll("button").forEach((button) => {
    const panel = button.dataset.roofPanel;
    const bearing = panel === "second" ? (roofLayoutBearing() + 180) % 360 : roofLayoutBearing();
    button.classList.toggle("is-selected", panel === activeRoofPanel);
    button.setAttribute("aria-pressed", String(panel === activeRoofPanel));
    button.textContent = `${panel === "first" ? "Pan A" : "Pan B"} · ${directionLabel(Math.round(bearing))}`;
  });
}

function nestColorPicker(buttonId, pickerId) {
  const button = document.querySelector(`#${buttonId}`);
  const picker = document.querySelector(`#${pickerId}`);
  if (!button || !picker) return null;
  const label = document.createElement("label");
  label.id = button.id;
  label.className = button.className;
  label.style.cssText = button.style.cssText;
  label.textContent = button.textContent;
  button.replaceWith(label);
  label.append(picker);
  label.style.setProperty("--building-text-color", contrastingTextColor(picker.value));
  return { button: label, picker };
}

function bindControls() {
  showBuildingEditorOptions();
  addRoofColorControls();
  addRoofPanelControls();
  const customBuildingColor = nestColorPicker("custom-building-color", "building-color-picker");
  const customRoofColor = nestColorPicker("custom-roof-color", "roof-color-picker");
  document.querySelector("#open-welcome").addEventListener("click", () => toggleWelcomeModal(true));
  document.querySelector("#close-welcome").addEventListener("click", dismissWelcome);
  document.querySelector("#dismiss-welcome").addEventListener("click", dismissWelcome);
  document.querySelector("#clear-helio-storage").addEventListener("click", clearHelioStorage);
  document.querySelector("#welcome-modal").addEventListener("click", (event) => {
    if (event.target.id === "welcome-modal") dismissWelcome();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#welcome-modal").hidden) dismissWelcome();
  });
  document.querySelector("#open-search").addEventListener("click", () => toggleSearchPopup());
  document.querySelector("#close-search").addEventListener("click", () => toggleSearchPopup(false));
  document.querySelector("#location-form").addEventListener("submit", searchLocation);
  document.querySelector("#locate-me").addEventListener("click", locateUser);
  document.querySelector("#date-time").addEventListener("change", (event) => {
    state.date = parseDateTime(event.target.value);
    updateSun();
    renderPanelValues();
  });
  document.querySelector("#time-slider").addEventListener("input", (event) => {
    const minutes = Number(event.target.value);
    const date = new Date(state.date);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    state.date = date;
    updateSun();
    renderPanelValues();
  });
  document.querySelector("#now").addEventListener("click", () => {
    state.date = new Date();
    updateSun();
    renderPanelValues();
  });
  document.querySelectorAll("[data-roof-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousType = state.roofType;
      const previousShape = state.roofShape;
      state.roofType = button.dataset.roofType;
      state.roofShape = roofShapeForType(state.roofType);
      editorPanelLayoutIsManual = false;
      updateDefaultPanelCount();
      updateGeometricPanelCount();
      if (selectedBuilding3dGeometryError()) {
        state.roofType = previousType;
        state.roofShape = previousShape;
        updateDefaultPanelCount();
        updateGeometricPanelCount();
        renderPanelValues();
        show3dGeometryError(["buildingHeight"]);
        return;
      }
      clearEditorConstraint();
      renderPanelValues();
      saveSelectedBuildingConfiguration();
    });
  });
  document.querySelectorAll("[data-building-color]").forEach((button) => {
    button.addEventListener("click", () => updateSelectedBuildingColor(button.dataset.buildingColor));
  });
  customBuildingColor.picker.addEventListener("click", () => {
    document.querySelectorAll("[data-building-color]").forEach((button) => button.classList.remove("is-selected"));
    document.querySelector("#custom-building-color").classList.add("is-selected");
  });
  document.querySelector("#building-color-picker").addEventListener("input", (event) => {
    state.customBuildingColor = validBuildingColor(event.target.value);
    updateSelectedBuildingColor(state.customBuildingColor);
  });
  document.querySelectorAll("[data-roof-color]").forEach((button) => {
    button.addEventListener("click", () => updateSelectedRoofColor(button.dataset.roofColor));
  });
  customRoofColor.picker.addEventListener("click", () => {
    document.querySelectorAll("[data-roof-color]").forEach((button) => button.classList.remove("is-selected"));
    document.querySelector("#custom-roof-color").classList.add("is-selected");
  });
  document.querySelector("#roof-color-picker").addEventListener("input", (event) => {
    state.customRoofColor = validBuildingColor(event.target.value);
    updateSelectedRoofColor(state.customRoofColor);
  });
  document.querySelector("#roof-orientation").addEventListener("change", (event) => {
    const previousAzimuth = state.azimuth;
    state.azimuth = Number(event.target.value);
    updateGeometricPanelCount();
    if (selectedBuilding3dGeometryError()) {
      state.azimuth = previousAzimuth;
      event.target.value = String(previousAzimuth);
      updateGeometricPanelCount();
      renderPanelValues();
      show3dGeometryError(["roof-orientation", "buildingHeight"]);
      return;
    }
    renderPanelValues();
    saveSelectedBuildingConfiguration();
  });
  document.querySelector("#buildingHeight").addEventListener("input", () => {
    if (document.querySelector("#buildingHeight").value !== "") saveBuildingHeight();
  });
  document.querySelector("#study-form").addEventListener("change", (event) => {
    if (event.target.name === "inverterType") state.inverterType = event.target.value;
    else if (event.target.name === "buildingHeight") saveBuildingHeight();
    else if (Object.hasOwn(state, event.target.name)) {
      const previousValue = state[event.target.name];
      const nextValue = Number(event.target.value);
      if (event.target.name === "pitch" && state.roofType !== "terrace" && state.selectedBuilding) {
        const maximum = maximumRoofPitch();
        if (!Number.isFinite(nextValue) || nextValue < 0 || nextValue > maximum) {
          event.target.value = String(previousValue);
          reportEditorConstraint(`Inclinaison maximale autorisée pour cette forme de toit : ${formatNumber(maximum, 1)} deg.`, { fields: ["pitch"], noticeField: "pitch" });
          return;
        }
      }
      state[event.target.name] = nextValue;
      if (event.target.name === "panelCount") {
        state.panelCount = Math.min(maximumPanelCount, Math.max(0, state.panelCount));
        panelCountIsManual = true;
      }
      else if (["area", "pitch", "panelsPerRow", "marginTop", "marginBottom", "marginLeft", "marginRight", "mountingAllowance", "rowSpacing"].includes(event.target.name)) {
        updateDefaultPanelCount();
        updateGeometricPanelCount();
      }
      if (event.target.name === "pitch" && selectedBuilding3dGeometryError()) {
        state.pitch = previousValue;
        event.target.value = String(previousValue);
        updateDefaultPanelCount();
        updateGeometricPanelCount();
        renderPanelValues();
        show3dGeometryError(["pitch", "buildingHeight"]);
        return;
      }
    }
    renderPanelValues();
    saveSelectedBuildingConfiguration();
  });
  document.querySelector("#toggle-panel").addEventListener("click", togglePanel);
  document.querySelector("#close-panel").addEventListener("click", togglePanel);
  document.querySelector("#exit-editor").addEventListener("click", exitEditor);
  document.querySelector("#reset-footprint").addEventListener("click", resetFootprint);
  document.querySelector("#delete-selection").addEventListener("click", deleteEditorSelection);
  document.querySelectorAll("[data-editor-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      editorPanelOrientation = button.dataset.editorLayout;
      editorPanelLayoutIsManual = true;
      refreshEditorVisuals();
      saveSelectedBuildingConfiguration();
    });
  });
  document.querySelectorAll(".editor-panel-fields input").forEach((input) => {
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || !Object.hasOwn(state, input.name)) return;
      state[input.name] = value;
      if (input.name === "panelCount") {
        const requested = Math.floor(value);
        state.panelCount = Math.min(maximumPanelCount, Math.max(0, requested));
        if (requested !== state.panelCount) reportEditorConstraint(`Le nombre de panneaux doit rester entre 0 et ${maximumPanelCount}.`, { fields: ["panelCount"] });
        panelCountIsManual = true;
      } else if (["edgeNorth", "edgeSouth", "edgeEast", "edgeWest"].includes(input.name)) {
        setCardinalEdgeLength(input.name.replace("edge", "").toLowerCase(), value);
        return;
      } else if (input.name === "panelsPerRow") {
        const requested = Math.floor(value);
        state.panelsPerRow = Math.min(maximumPanelCount, Math.max(1, requested));
        if (requested !== state.panelsPerRow) reportEditorConstraint(`Le nombre de panneaux par rangee doit rester entre 1 et ${maximumPanelCount}.`, { fields: ["panelsPerRow"] });
        updateDefaultPanelCount();
        updateGeometricPanelCount();
      } else {
        updateDefaultPanelCount();
        updateGeometricPanelCount();
      }
      renderPanelValues();
      saveSelectedBuildingConfiguration();
    });
  });
  document.querySelectorAll(".info-tip").forEach(bindInfoTip);
  if (!hasSeenWelcome()) toggleWelcomeModal(true);
}

function toggleWelcomeModal(open) {
  const modal = document.querySelector("#welcome-modal");
  const button = document.querySelector("#open-welcome");
  const isOpen = open ?? modal.hidden;
  modal.hidden = !isOpen;
  button.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) document.querySelector("#close-welcome").focus();
}

function dismissWelcome() {
  markWelcomeSeen();
  toggleWelcomeModal(false);
}

function toggleSearchPopup(open) {
  const popup = document.querySelector("#search-popup");
  const button = document.querySelector("#open-search");
  const isOpen = open ?? popup.hidden;
  popup.hidden = !isOpen;
  button.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) document.querySelector("#location-query").focus();
}

function positionInfoTip(tip) {
  const bubble = tip.querySelector("em");
  if (!bubble) return;
  const margin = 12;
  const width = Math.min(230, window.innerWidth - margin * 2);
  bubble.style.width = `${width}px`;
  const tipBounds = tip.getBoundingClientRect();
  const height = bubble.getBoundingClientRect().height;
  const left = Math.max(margin, Math.min(tipBounds.left + tipBounds.width / 2 - width / 2, window.innerWidth - width - margin));
  const above = tipBounds.top - height - 8;
  const top = above >= margin ? above : Math.min(window.innerHeight - height - margin, tipBounds.bottom + 8);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${Math.max(margin, top)}px`;
}

function bindInfoTip(tip) {
  tip.addEventListener("mouseenter", () => positionInfoTip(tip));
  tip.addEventListener("focus", () => positionInfoTip(tip));
}

function clearOrientationRose() {
  orientationMarkers.forEach((marker) => marker.remove());
  orientationMarkers = [];
  editorMarker?.remove();
  editorMarker = undefined;
  if (map?.getSource("orientation-rays")) map.getSource("orientation-rays").setData(emptyCollection);
  if (map?.getSource("orientation-center")) map.getSource("orientation-center").setData(emptyCollection);
}

function clearEditorVertices() {
  editorVertexMarkers.forEach((marker) => marker.remove());
  editorVertexMarkers = [];
  editingFootprint = false;
  hoveredEditorVertexIndex = undefined;
}

function showBuildingEditorOptions() {
  const options = document.querySelector("#building-edit-options");
  if (options) options.hidden = false;
  document.querySelector("#new-footprint")?.remove();
  document.querySelector("#edit-footprint")?.remove();
}

function repositionEditorVertices() {
  if (!editingFootprint || !state.selectedBuilding?.feature) return;
  const ring = state.selectedBuilding.feature.geometry.coordinates[0];
  editorVertexMarkers.forEach((marker, index) => {
    if (ring[index]) marker.setLngLat(ring[index]);
  });
}

function editorSourceData(sourceId, features) {
  map?.getSource(sourceId)?.setData({ type: "FeatureCollection", features });
}

function moveCoordinate(coordinate, east, north) {
  return [
    coordinate[0] + east / (111320 * Math.cos((coordinate[1] * Math.PI) / 180)),
    coordinate[1] + north / 110540,
  ];
}

function pointInsideRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index];
    const before = ring[previous];
    const east = before[0] - current[0];
    const north = before[1] - current[1];
    const pointEast = point[0] - current[0];
    const pointNorth = point[1] - current[1];
    const cross = east * pointNorth - north * pointEast;
    const epsilon = 1e-12;
    if (Math.abs(cross) <= epsilon
      && point[0] >= Math.min(current[0], before[0]) - epsilon
      && point[0] <= Math.max(current[0], before[0]) + epsilon
      && point[1] >= Math.min(current[1], before[1]) - epsilon
      && point[1] <= Math.max(current[1], before[1]) + epsilon) return true;
    if ((current[1] > point[1]) !== (before[1] > point[1]) && point[0] < ((before[0] - current[0]) * (point[1] - current[1])) / (before[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
}

function closestEditorEdge(point) {
  if (!map || !editingFootprint || !state.selectedBuilding?.feature) return null;
  if (closestEditorVertex(point) !== null) return null;
  const ring = state.selectedBuilding.feature.geometry.coordinates[0];
  let closest = null;
  ring.slice(0, -1).forEach((coordinate, index) => {
    const start = map.project(coordinate);
    const end = map.project(ring[index + 1]);
    const east = end.x - start.x;
    const north = end.y - start.y;
    const squaredLength = east * east + north * north;
    if (!squaredLength) return;
    const position = Math.max(0, Math.min(1, ((point.x - start.x) * east + (point.y - start.y) * north) / squaredLength));
    const distance = Math.hypot(point.x - (start.x + position * east), point.y - (start.y + position * north));
    if (!closest || distance < closest.distance) closest = { index, distance };
  });
  return closest?.distance <= 10 ? closest.index : null;
}

function closestEditorVertex(point) {
  if (!map || !editingFootprint || !state.selectedBuilding?.feature) return null;
  const ring = state.selectedBuilding.feature.geometry.coordinates[0];
  let closest = null;
  ring.slice(0, -1).forEach((coordinate, index) => {
    const vertex = map.project(coordinate);
    const distance = Math.hypot(point.x - vertex.x, point.y - vertex.y);
    if (!closest || distance < closest.distance) closest = { index, distance };
  });
  return closest?.distance <= 18 ? closest.index : null;
}

function setHoveredEditorVertex(index) {
  if (hoveredEditorVertexIndex === index) return;
  hoveredEditorVertexIndex = index;
  editorVertexMarkers.forEach((marker, markerIndex) => marker.getElement().classList.toggle("is-hovered", hoveredEditorBuilding || markerIndex === index));
}

function setHoveredEditorBuilding(hovered) {
  if (hoveredEditorBuilding === hovered) return;
  hoveredEditorBuilding = hovered;
  editorVertexMarkers.forEach((marker, markerIndex) => marker.getElement().classList.toggle("is-hovered", hovered || markerIndex === hoveredEditorVertexIndex));
  refreshEditorVisuals();
}

function setHoveredEditorEdge(index) {
  if (hoveredEditorEdgeIndex === index) return;
  hoveredEditorEdgeIndex = index;
  map?.getCanvas().classList.toggle("editor-edge-hover", index !== null && index !== undefined);
  refreshEditorVisuals();
}

function hasSimpleFootprint(ring) {
  const points = normalizeRing(ring).slice(0, -1);
  if (points.length < 3) return false;
  const cross = (first, second, third) => (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
  const intersects = (start, end, otherStart, otherEnd) => {
    const first = cross(start, end, otherStart);
    const second = cross(start, end, otherEnd);
    const third = cross(otherStart, otherEnd, start);
    const fourth = cross(otherStart, otherEnd, end);
    return first * second <= 0 && third * fourth <= 0;
  };
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    for (let otherIndex = index + 1; otherIndex < points.length; otherIndex += 1) {
      const otherNext = (otherIndex + 1) % points.length;
      if (index === otherIndex || next === otherIndex || otherNext === index) continue;
      if (intersects(points[index], points[next], points[otherIndex], points[otherNext])) return false;
    }
  }
  return true;
}

function footprintWinding(ring) {
  const points = normalizeRing(ring).slice(0, -1);
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
}

function startEditorEdgeDrag(event) {
  const target = event.originalEvent.target;
  if (event.originalEvent.button !== 0 || target?.closest?.(".editor-vertex")) return false;
  const index = closestEditorEdge(event.point);
  const feature = state.selectedBuilding?.feature;
  if (index === null || !feature) return false;
  const ring = feature.geometry.coordinates[0];
  const start = ring[index];
  const end = ring[index + 1];
  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const east = coordinateAlongBearing(midpoint, end, 90) - coordinateAlongBearing(midpoint, start, 90);
  const north = coordinateAlongBearing(midpoint, end, 0) - coordinateAlongBearing(midpoint, start, 0);
  const length = Math.hypot(east, north);
  if (!length) return false;
  const vertices = ring.slice(0, -1);
  const endIndex = (index + 1) % vertices.length;
  const normalEast = -north / length;
  const normalNorth = east / length;
  editorEdgeDrag = {
    index,
    startLngLat: event.lngLat,
    startRing: ring.map((coordinate) => [...coordinate]),
    normalEast,
    normalNorth,
    oppositeOffsets: vertices
      .filter((_, vertexIndex) => vertexIndex !== index && vertexIndex !== endIndex)
      .map((coordinate) => coordinateAlongBearing(midpoint, coordinate, 90) * normalEast + coordinateAlongBearing(midpoint, coordinate, 0) * normalNorth),
    dragPanEnabled: map.dragPan.isEnabled(),
  };
  map.dragPan.disable();
  map.getCanvas().classList.add("editor-edge-dragging");
  return true;
}

function dragEditorEdge(event) {
  if (!editorEdgeDrag || !state.selectedBuilding?.feature) return false;
  const latitude = editorEdgeDrag.startLngLat.lat;
  const east = (event.lngLat.lng - editorEdgeDrag.startLngLat.lng) * 111320 * Math.cos((latitude * Math.PI) / 180);
  const north = (event.lngLat.lat - editorEdgeDrag.startLngLat.lat) * 110540;
  const distance = east * editorEdgeDrag.normalEast + north * editorEdgeDrag.normalNorth;
  const nearestOppositeOffset = editorEdgeDrag.oppositeOffsets
    .filter((offset) => offset * distance > 0)
    .reduce((nearest, offset) => !Number.isFinite(nearest) || Math.abs(offset) < Math.abs(nearest) ? offset : nearest, NaN);
  if (Number.isFinite(nearestOppositeOffset) && Math.abs(distance) >= Math.abs(nearestOppositeOffset) - 0.01) {
    reportEditorConstraint("Cette arrete ne peut pas depasser l'arrete opposee : le batiment ne peut pas etre ecrase.", { point: event.point });
    return false;
  }
  const ring = editorEdgeDrag.startRing.map((coordinate) => [...coordinate]);
  const index = editorEdgeDrag.index;
  const offsetEast = distance * editorEdgeDrag.normalEast;
  const offsetNorth = distance * editorEdgeDrag.normalNorth;
  ring[index] = moveCoordinate(ring[index], offsetEast, offsetNorth);
  if (index === ring.length - 2) {
    // The last edge ends at the duplicated first vertex of a closed ring.
    ring[0] = moveCoordinate(ring[0], offsetEast, offsetNorth);
  } else {
    ring[index + 1] = moveCoordinate(ring[index + 1], offsetEast, offsetNorth);
  }
  ring[ring.length - 1] = [...ring[0]];
  if (!hasSimpleFootprint(ring) || footprintWinding(ring) * footprintWinding(editorEdgeDrag.startRing) <= 0) {
    reportEditorConstraint("Cette modification croiserait des aretes ou inverserait le contour du batiment.", { point: event.point });
    return false;
  }
  const feature = state.selectedBuilding.feature;
  const previousFeature = cloneFeature(feature);
  feature.geometry.coordinates = [ring];
  feature.properties = { ...feature.properties, manualFootprint: true, orthogonalized: true };
  if (selectedBuilding3dGeometryError()) {
    feature.geometry = previousFeature.geometry;
    feature.properties = previousFeature.properties;
    show3dGeometryError(["buildingHeight"], event.point);
    return false;
  }
  clearEditorConstraint();
  refreshEditorVisuals();
  repositionEditorVertices();
  return true;
}

function endEditorEdgeDrag() {
  if (!editorEdgeDrag) return;
  const shouldRestorePan = editorEdgeDrag.dragPanEnabled;
  editorEdgeDrag = undefined;
  if (shouldRestorePan) map.dragPan.enable();
  map.getCanvas().classList.remove("editor-edge-dragging");
  syncEditedFootprint();
}

function startEditorBuildingDrag(event) {
  const target = event.originalEvent.target;
  const feature = state.selectedBuilding?.feature;
  if (event.originalEvent.button !== 0 || target?.closest?.(".editor-vertex") || !feature) return false;
  if (!pointInsideRing([event.lngLat.lng, event.lngLat.lat], feature.geometry.coordinates[0])) return false;
  editorBuildingDrag = {
    startLngLat: event.lngLat,
    startRing: feature.geometry.coordinates[0].map((coordinate) => [...coordinate]),
    dragPanEnabled: map.dragPan.isEnabled(),
  };
  map.dragPan.disable();
  map.getCanvas().style.cursor = "move";
  return true;
}

function dragEditorBuilding(event) {
  if (!editorBuildingDrag || !state.selectedBuilding?.feature) return false;
  const latitude = editorBuildingDrag.startLngLat.lat;
  const east = (event.lngLat.lng - editorBuildingDrag.startLngLat.lng) * 111320 * Math.cos((latitude * Math.PI) / 180);
  const north = (event.lngLat.lat - editorBuildingDrag.startLngLat.lat) * 110540;
  const ring = editorBuildingDrag.startRing.map((coordinate) => moveCoordinate(coordinate, east, north));
  ring[ring.length - 1] = [...ring[0]];
  const feature = state.selectedBuilding.feature;
  feature.geometry.coordinates = [ring];
  feature.properties = { ...feature.properties, manualFootprint: true, orthogonalized: true };
  refreshEditorVisuals();
  repositionEditorVertices();
  return true;
}

function endEditorBuildingDrag() {
  if (!editorBuildingDrag) return;
  const shouldRestorePan = editorBuildingDrag.dragPanEnabled;
  editorBuildingDrag = undefined;
  if (shouldRestorePan) map.dragPan.enable();
  map.getCanvas().style.cursor = "";
  syncEditedFootprint();
}

function clipRingAt(ring, valueFor, threshold, keepGreater) {
  const points = ring.slice(0, -1);
  const clipped = [];
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const startValue = valueFor(start);
    const endValue = valueFor(end);
    const startInside = keepGreater ? startValue >= threshold : startValue <= threshold;
    const endInside = keepGreater ? endValue >= threshold : endValue <= threshold;
    if (startInside) clipped.push(start);
    if (startInside !== endInside) {
      const ratio = (threshold - startValue) / (endValue - startValue);
      clipped.push([start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]);
    }
  });
  return clipped.length >= 3 ? [...clipped, clipped[0]] : null;
}

function clipRingToBounds(ring, center, bearing, slopeMin, slopeMax, ridgeMin, ridgeMax) {
  const ridgeBearing = (bearing + 90) % 360;
  const slope = (coordinate) => coordinateAlongBearing(center, coordinate, bearing);
  const ridge = (coordinate) => coordinateAlongBearing(center, coordinate, ridgeBearing);
  let clipped = clipRingAt(ring, slope, slopeMin, true);
  if (clipped) clipped = clipRingAt(clipped, slope, slopeMax, false);
  if (clipped) clipped = clipRingAt(clipped, ridge, ridgeMin, true);
  if (clipped) clipped = clipRingAt(clipped, ridge, ridgeMax, false);
  return clipped;
}

function insetRing(ring) {
  const center = footprintCenter(ring);
  const bearing = activePanelBearing();
  const ridgeBearing = (bearing + 90) % 360;
  const points = ring.slice(0, -1);
  const slopes = points.map((coordinate) => coordinateAlongBearing(center, coordinate, bearing));
  const ridges = points.map((coordinate) => coordinateAlongBearing(center, coordinate, ridgeBearing));
  const minimumSlope = Math.min(...slopes);
  const maximumSlope = Math.max(...slopes);
  const minimumRidge = Math.min(...ridges);
  const maximumRidge = Math.max(...ridges);
  const margin = (name) => Math.max(0, Number(state[name]) || 0);
  const slopeStart = minimumSlope + margin("marginTop");
  const slopeEnd = maximumSlope - margin("marginBottom");
  const ridgeStart = minimumRidge + margin("marginRight");
  const ridgeEnd = maximumRidge - margin("marginLeft");
  // A zero-width inset creates an invalid polygon hole and makes MapLibre fill
  // the whole pan orange. An absent inset explicitly means no space remains.
  if (slopeEnd - slopeStart <= 0.01 || ridgeEnd - ridgeStart <= 0.01) return null;
  const clipped = clipRingToBounds(ring, center, bearing, slopeStart, slopeEnd, ridgeStart, ridgeEnd);
  return clipped && footprintAreaSquareMeters(clipped) > 0.01 ? clipped : null;
}

function roofMarginAllowance() {
  if (!state.selectedBuilding?.feature) return 0;
  const bearing = activePanelBearing();
  const roof = effectiveRoofRing(state.selectedBuilding.feature, bearing);
  const plane = clipRingToRoofPlane(roof, bearing);
  const outerArea = footprintAreaSquareMeters(plane);
  const innerRing = insetRing(plane);
  const innerArea = innerRing ? footprintAreaSquareMeters(innerRing) : 0;
  if (!outerArea) return 0;
  return Math.max(0, Math.min(100, (1 - innerArea / outerArea) * 100));
}

function setbackFeatures(outerRing, innerRing) {
  const center = footprintCenter(outerRing);
  const bearing = activePanelBearing();
  const ridgeBearing = (bearing + 90) % 360;
  const bounds = (ring) => {
    const points = ring.slice(0, -1);
    return {
      slopeMin: Math.min(...points.map((point) => coordinateAlongBearing(center, point, bearing))),
      slopeMax: Math.max(...points.map((point) => coordinateAlongBearing(center, point, bearing))),
      ridgeMin: Math.min(...points.map((point) => coordinateAlongBearing(center, point, ridgeBearing))),
      ridgeMax: Math.max(...points.map((point) => coordinateAlongBearing(center, point, ridgeBearing))),
    };
  };
  const outer = bounds(outerRing);
  const inner = bounds(innerRing);
  const band = (slopeMin, slopeMax, ridgeMin, ridgeMax) => {
    if (slopeMax - slopeMin <= 0.01 || ridgeMax - ridgeMin <= 0.01) return null;
    const clipped = clipRingToBounds(outerRing, center, bearing, slopeMin, slopeMax, ridgeMin, ridgeMax);
    return clipped ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [clipped] } } : null;
  };
  return [
    band(outer.slopeMin, inner.slopeMin, outer.ridgeMin, outer.ridgeMax),
    band(inner.slopeMax, outer.slopeMax, outer.ridgeMin, outer.ridgeMax),
    band(inner.slopeMin, inner.slopeMax, outer.ridgeMin, inner.ridgeMin),
    band(inner.slopeMin, inner.slopeMax, inner.ridgeMax, outer.ridgeMax),
  ].filter(Boolean);
}

function panelCornerFitsRing(corner, ring) {
  if (pointInsideRing(corner, ring)) return true;
  const latitudeRadians = (corner[1] * Math.PI) / 180;
  const longitudeScale = 111320 * Math.cos(latitudeRadians);
  const pointEast = corner[0] * longitudeScale;
  const pointNorth = corner[1] * 110540;
  const points = ring.slice(0, -1);
  return points.some((start, index) => {
    const end = points[(index + 1) % points.length];
    const startEast = start[0] * longitudeScale;
    const startNorth = start[1] * 110540;
    const endEast = end[0] * longitudeScale;
    const endNorth = end[1] * 110540;
    const edgeEast = endEast - startEast;
    const edgeNorth = endNorth - startNorth;
    const edgeLengthSquared = edgeEast ** 2 + edgeNorth ** 2;
    if (!edgeLengthSquared) return false;
    const position = Math.max(0, Math.min(1, ((pointEast - startEast) * edgeEast + (pointNorth - startNorth) * edgeNorth) / edgeLengthSquared));
    return Math.hypot(pointEast - (startEast + position * edgeEast), pointNorth - (startNorth + position * edgeNorth)) <= 0.005;
  });
}

function panelPolygon(center, bearing, length, width) {
  const longEast = Math.sin((bearing * Math.PI) / 180);
  const longNorth = Math.cos((bearing * Math.PI) / 180);
  const wideEast = Math.sin(((bearing + 90) * Math.PI) / 180);
  const wideNorth = Math.cos(((bearing + 90) * Math.PI) / 180);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([longSide, wideSide]) => moveCoordinate(
    center,
    longSide * length / 2 * longEast + wideSide * width / 2 * wideEast,
    longSide * length / 2 * longNorth + wideSide * width / 2 * wideNorth,
  ));
  return [...corners, corners[0]];
}

function coordinateAlongBearing(origin, coordinate, bearing) {
  const east = (coordinate[0] - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180);
  const north = (coordinate[1] - origin[1]) * 110540;
  return east * Math.sin((bearing * Math.PI) / 180) + north * Math.cos((bearing * Math.PI) / 180);
}

function roofSlopeScale() {
  if (state.roofType === "terrace") return 1;
  return Math.max(0.1, Math.cos((state.pitch * Math.PI) / 180));
}

function developRoofRing(ring, bearing, origin = footprintCenter(ring)) {
  const center = origin;
  const scale = roofSlopeScale();
  if (scale === 1) return ring;
  return ring.map((coordinate) => moveCoordinate(
    center,
    coordinateAlongBearing(center, coordinate, bearing) / scale * Math.sin((bearing * Math.PI) / 180)
      + coordinateAlongBearing(center, coordinate, (bearing + 90) % 360) * Math.sin(((bearing + 90) * Math.PI) / 180),
    coordinateAlongBearing(center, coordinate, bearing) / scale * Math.cos((bearing * Math.PI) / 180)
      + coordinateAlongBearing(center, coordinate, (bearing + 90) % 360) * Math.cos(((bearing + 90) * Math.PI) / 180),
  ));
}

function projectRoofRing(ring, bearing, origin = footprintCenter(ring)) {
  const center = origin;
  const scale = roofSlopeScale();
  if (scale === 1) return ring;
  return ring.map((coordinate) => moveCoordinate(
    center,
    coordinateAlongBearing(center, coordinate, bearing) * scale * Math.sin((bearing * Math.PI) / 180)
      + coordinateAlongBearing(center, coordinate, (bearing + 90) % 360) * Math.sin(((bearing + 90) * Math.PI) / 180),
    coordinateAlongBearing(center, coordinate, bearing) * scale * Math.cos((bearing * Math.PI) / 180)
      + coordinateAlongBearing(center, coordinate, (bearing + 90) % 360) * Math.cos(((bearing + 90) * Math.PI) / 180),
  ));
}

function clipRingToRoofPlane(ring, bearing) {
  if (state.roofType !== "double") return ring;
  const center = footprintCenter(ring);
  const openRing = ring.slice(0, -1);
  const clipped = [];
  openRing.forEach((start, index) => {
    const end = openRing[(index + 1) % openRing.length];
    const startSide = coordinateAlongBearing(center, start, bearing);
    const endSide = coordinateAlongBearing(center, end, bearing);
    const startInside = startSide >= 0;
    const endInside = endSide >= 0;
    if (startInside) clipped.push(start);
    if (startInside !== endInside) {
      const ratio = startSide / (startSide - endSide);
      clipped.push([start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]);
    }
  });
  return clipped.length >= 3 ? [...clipped, clipped[0]] : ring;
}

function rectangularRoofRing(ring, bearing) {
  const center = footprintCenter(ring);
  const ridgeBearing = (bearing + 90) % 360;
  const slopeCoordinates = ring.slice(0, -1).map((coordinate) => coordinateAlongBearing(center, coordinate, bearing));
  const ridgeCoordinates = ring.slice(0, -1).map((coordinate) => coordinateAlongBearing(center, coordinate, ridgeBearing));
  const corner = (slope, ridge) => moveCoordinate(
    center,
    slope * Math.sin((bearing * Math.PI) / 180) + ridge * Math.sin((ridgeBearing * Math.PI) / 180),
    slope * Math.cos((bearing * Math.PI) / 180) + ridge * Math.cos((ridgeBearing * Math.PI) / 180),
  );
  const minSlope = Math.min(...slopeCoordinates);
  const maxSlope = Math.max(...slopeCoordinates);
  const minRidge = Math.min(...ridgeCoordinates);
  const maxRidge = Math.max(...ridgeCoordinates);
  const corners = [
    corner(minSlope, minRidge),
    corner(maxSlope, minRidge),
    corner(maxSlope, maxRidge),
    corner(minSlope, maxRidge),
  ];
  return [...corners, corners[0]];
}

function configuredRoofRing(feature, bearing) {
  const ring = feature.geometry.coordinates[0];
  return feature.properties?.manualFootprint ? ring : rectangularRoofRing(ring, bearing);
}

function effectiveRoofRing(feature, bearing) {
  return configuredRoofRing(feature, bearing);
}

function cardinalEdges(ring) {
  const points = ring.slice(0, -1);
  if (points.length < 3) return [];
  const center = footprintCenter(ring);
  const projected = points.map((coordinate) => ({
    coordinate,
    east: coordinateAlongBearing(center, coordinate, 90),
    north: coordinateAlongBearing(center, coordinate, 0),
  }));
  const signedArea = projected.reduce((area, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return area + point.east * next.north - next.east * point.north;
  }, 0);
  return projected.flatMap((start, index) => {
    const end = projected[(index + 1) % projected.length];
    const east = end.east - start.east;
    const north = end.north - start.north;
    const length = Math.hypot(east, north);
    if (!length) return [];
    const outwardEast = signedArea > 0 ? north : -north;
    const outwardNorth = signedArea > 0 ? -east : east;
    return [{
      index,
      length,
      bearing: ((Math.atan2(outwardEast, outwardNorth) * 180) / Math.PI + 360) % 360,
    }];
  });
}

function cardinalEdge(ring, direction) {
  const target = { north: 0, east: 90, south: 180, west: 270 }[direction];
  return cardinalEdges(ring).reduce((closest, edge) => (!closest || angularDistance(edge.bearing, target) < angularDistance(closest.bearing, target) ? edge : closest), null);
}

function updateCardinalEdgeValues() {
  const feature = state.selectedBuilding?.feature;
  if (!feature) return;
  const ring = feature.geometry.coordinates[0];
  ["north", "south", "east", "west"].forEach((direction) => {
    const edge = cardinalEdge(ring, direction);
    state[`edge${direction[0].toUpperCase()}${direction.slice(1)}`] = edge ? Math.round(edge.length * 100) : 0;
  });
}

function normalizedRotation(value) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  return ((Math.round(angle) % 360) + 360) % 360;
}

function footprintRotation(feature = state.selectedBuilding?.feature) {
  if (!feature) return 0;
  const savedRotation = Number(feature.properties?.footprintRotation);
  if (Number.isFinite(savedRotation)) return normalizedRotation(savedRotation);
  const ring = feature.geometry.coordinates[0];
  if (ring.length < 2) return 0;
  const start = ring[0];
  const end = ring[1];
  const east = coordinateAlongBearing(start, end, 90);
  const north = coordinateAlongBearing(start, end, 0);
  return normalizedRotation((Math.atan2(east, north) * 180) / Math.PI - 90);
}

function updateRotationControl() {
  const input = document.querySelector("#footprint-rotation");
  const disabled = !state.selectedBuilding?.feature;
  if (input) {
    input.disabled = disabled;
    input.value = String(footprintRotation());
  }
  const resetButton = document.querySelector("#reset-footprint-rotation");
  if (resetButton) resetButton.disabled = disabled;
}

function setFootprintRotation(value) {
  const feature = state.selectedBuilding?.feature;
  if (!feature) return;
  const nextRotation = normalizedRotation(value);
  const currentRotation = footprintRotation(feature);
  const delta = ((nextRotation - currentRotation + 540) % 360) - 180;
  if (!delta) {
    updateRotationControl();
    return;
  }
  const previousFeature = cloneFeature(feature);
  const previousAzimuth = state.azimuth;
  const ring = feature.geometry.coordinates[0];
  const center = footprintCenter(ring);
  const radians = (delta * Math.PI) / 180;
  const nextRing = ring.slice(0, -1).map((coordinate) => {
    const east = coordinateAlongBearing(center, coordinate, 90);
    const north = coordinateAlongBearing(center, coordinate, 0);
    return moveCoordinate(center, east * Math.cos(radians) + north * Math.sin(radians), -east * Math.sin(radians) + north * Math.cos(radians));
  });
  nextRing.push([...nextRing[0]]);
  if (!hasSimpleFootprint(nextRing) || footprintWinding(nextRing) * footprintWinding(ring) <= 0) {
    reportEditorConstraint("Cette rotation rendrait le contour du batiment invalide.", { fields: ["footprint-rotation"] });
    updateRotationControl();
    return;
  }
  feature.geometry.coordinates = [nextRing];
  feature.properties = { ...feature.properties, manualFootprint: true, orthogonalized: true, footprintRotation: nextRotation };
  state.azimuth = normalizedRotation(previousAzimuth + delta);
  clearEditorConstraint();
  repositionEditorVertices();
  syncEditedFootprint();
}

function addRotationControls() {
  const fields = document.querySelector("#building-edit-options .editor-panel-fields");
  if (!fields) return;
  const colorTitle = [...fields.querySelectorAll(".editor-field-title")].find((title) => title.textContent === "Couleur");
  if (colorTitle) colorTitle.textContent = "Couleur des murs";
  const rotationControls = '<div class="editor-field-title">Rotation</div><label class="field" for="footprint-rotation" style="display:grid;grid-template-columns:minmax(0,1fr) auto 105px;column-gap:4px;"><span>Angle</span><button id="reset-footprint-rotation" type="button" style="border:0;padding:2px 4px;font-size:9px;font-weight:800;">RAZ</button><div><input id="footprint-rotation" type="number" min="0" max="359" step="1" value="0" /><em>deg</em></div></label>';
  if (colorTitle) colorTitle.insertAdjacentHTML("beforebegin", rotationControls);
  else fields.insertAdjacentHTML("beforeend", rotationControls);
  document.querySelector("#footprint-rotation").addEventListener("change", (event) => setFootprintRotation(event.target.value));
  document.querySelector("#reset-footprint-rotation").addEventListener("click", () => setFootprintRotation(0));
}

function updatePanelAlignmentControls() {
  document.querySelectorAll("[data-panel-alignment]").forEach((button) => {
    const [axis, alignment] = button.dataset.panelAlignment.split(":");
    const selected = axis === "horizontal" ? editorPanelHorizontalAlignment === alignment : editorPanelVerticalAlignment === alignment;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function addPanelAlignmentControls() {
  const layoutActions = document.querySelector("[data-editor-layout]")?.parentElement;
  if (!layoutActions) return;
  layoutActions.insertAdjacentHTML("afterend", '<div class="editor-actions" data-panel-alignment-controls><button class="editor-layout" data-panel-alignment="horizontal:left" type="button" title="Aligner a gauche" aria-label="Aligner les panneaux a gauche"><span class="material-symbols-rounded panel-alignment-horizontal-icon" aria-hidden="true">vertical_align_top</span></button><button class="editor-layout" data-panel-alignment="horizontal:center" type="button" title="Centrer horizontalement" aria-label="Centrer les panneaux horizontalement"><span class="material-symbols-rounded panel-alignment-horizontal-icon" aria-hidden="true">vertical_align_center</span></button><button class="editor-layout" data-panel-alignment="horizontal:right" type="button" title="Aligner a droite" aria-label="Aligner les panneaux a droite"><span class="material-symbols-rounded panel-alignment-horizontal-icon" aria-hidden="true">vertical_align_bottom</span></button><button class="editor-layout" data-panel-alignment="vertical:top" type="button" title="Aligner en haut" aria-label="Aligner les panneaux en haut"><span class="material-symbols-rounded" aria-hidden="true">vertical_align_top</span></button><button class="editor-layout" data-panel-alignment="vertical:center" type="button" title="Centrer verticalement" aria-label="Centrer les panneaux verticalement"><span class="material-symbols-rounded" aria-hidden="true">vertical_align_center</span></button><button class="editor-layout" data-panel-alignment="vertical:bottom" type="button" title="Aligner en bas" aria-label="Aligner les panneaux en bas"><span class="material-symbols-rounded" aria-hidden="true">vertical_align_bottom</span></button></div>');
  document.querySelectorAll("[data-panel-alignment]").forEach((button) => {
    button.addEventListener("click", () => {
      const [axis, alignment] = button.dataset.panelAlignment.split(":");
      if (axis === "horizontal") editorPanelHorizontalAlignment = alignment;
      else editorPanelVerticalAlignment = alignment;
      editorPanelLayoutIsManual = true;
      refreshEditorVisuals();
      saveSelectedBuildingConfiguration();
    });
  });
  updatePanelAlignmentControls();
}

function addMaterialIcons() {
  const icons = {
    "#open-welcome": "help",
    "#open-search": "search",
    "#toggle-panel": "add",
    "#close-search": "close",
    "#close-welcome": "close",
    "#exit-editor": "view_in_ar",
    "#reset-footprint": "restart_alt",
    "#delete-selection": "delete",
    "[data-editor-layout=portrait]": "stay_current_portrait",
    "[data-editor-layout=landscape]": "stay_current_landscape",
    "#close-panel": "close",
  };
  Object.entries(icons).forEach(([selector, icon]) => {
    const button = document.querySelector(selector);
    if (!button || button.querySelector(".material-symbols-rounded")) return;
    const symbol = document.createElement("span");
    symbol.className = "material-symbols-rounded";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = icon;
    button.prepend(symbol);
  });
}

function setCardinalEdgeLength(direction, valueCentimeters) {
  const feature = state.selectedBuilding?.feature;
  if (!feature) return;
  const previousFeature = cloneFeature(feature);
  const targetLength = Math.max(0.01, Number(valueCentimeters) || 0) / 100;
  const ring = feature.geometry.coordinates[0];
  const edge = cardinalEdge(ring, direction);
  if (!edge?.length) return;

  const points = ring.slice(0, -1);
  const start = points[edge.index];
  const endIndex = (edge.index + 1) % points.length;
  const end = points[endIndex];
  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const east = coordinateAlongBearing(midpoint, end, 90) - coordinateAlongBearing(midpoint, start, 90);
  const north = coordinateAlongBearing(midpoint, end, 0) - coordinateAlongBearing(midpoint, start, 0);
  const scale = targetLength / edge.length;
  points[edge.index] = moveCoordinate(midpoint, -east * scale / 2, -north * scale / 2);
  points[endIndex] = moveCoordinate(midpoint, east * scale / 2, north * scale / 2);
  const nextRing = [...points, [...points[0]]];
  if (!hasSimpleFootprint(nextRing) || footprintWinding(nextRing) * footprintWinding(ring) <= 0) {
    reportEditorConstraint("Cette dimension rendrait le contour du batiment invalide.", { fields: [`edge${direction[0].toUpperCase()}${direction.slice(1)}`] });
    updateCardinalEdgeValues();
    renderPanelValues();
    return;
  }
  feature.geometry.coordinates = [nextRing];
  feature.properties = { ...feature.properties, manualFootprint: true, orthogonalized: true };
  if (selectedBuilding3dGeometryError()) {
    feature.geometry = previousFeature.geometry;
    feature.properties = previousFeature.properties;
    updateCardinalEdgeValues();
    renderPanelValues();
    refreshEditorVisuals();
    show3dGeometryError([`edge${direction[0].toUpperCase()}${direction.slice(1)}`, "buildingHeight"]);
    return;
  }
  clearEditorConstraint();
  syncEditedFootprint();
}

function roofRidge(ring, bearing) {
  if (state.roofType === "terrace") return [];
  if (state.roofType === "single") {
    const points = ring.slice(0, -1);
    const facades = facadeBearingsFromCoordinates(ring);
    const highSide = (bearing + 180) % 360;
    const index = facades.reduce((closest, facade, current) => angularDistance(facade.bearing, highSide) < angularDistance(facades[closest].bearing, highSide) ? current : closest, 0);
    return points.length > 2 ? [{ type: "Feature", properties: { line: "high" }, geometry: { type: "LineString", coordinates: [points[index], points[(index + 1) % points.length]] } }] : [];
  }
  const center = footprintCenter(ring);
  const openRing = ring.slice(0, -1);
  const intersections = [];
  openRing.forEach((start, index) => {
    const end = openRing[(index + 1) % openRing.length];
    const startSide = coordinateAlongBearing(center, start, bearing);
    const endSide = coordinateAlongBearing(center, end, bearing);
    if (startSide === 0) intersections.push(start);
    if ((startSide < 0 && endSide > 0) || (startSide > 0 && endSide < 0)) {
      const ratio = startSide / (startSide - endSide);
      intersections.push([start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]);
    }
  });
  if (intersections.length < 2) return [];
  const ridgeBearing = (bearing + 90) % 360;
  const ordered = intersections.sort((first, second) => coordinateAlongBearing(center, first, ridgeBearing) - coordinateAlongBearing(center, second, ridgeBearing));
  return [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [ordered[0], ordered.at(-1)] } }];
}

function panelCandidates(ring, orientation, bearing = activePanelBearing(), mountingAllowance = state.mountingAllowance, rowSpacing = state.rowSpacing) {
  const center = footprintCenter(ring);
  const length = orientation === "portrait" ? state.moduleHeight : state.moduleWidth;
  const width = orientation === "portrait" ? state.moduleWidth : state.moduleHeight;
  const mountingGap = Math.max(0, mountingAllowance) / 100;
  const rowGap = Math.max(0, rowSpacing) / 100;
  const longGap = length + mountingGap + rowGap;
  const wideGap = width + mountingGap;
  const longitudinal = ring.slice(0, -1).map((coordinate) => coordinateAlongBearing(center, coordinate, bearing));
  const lateral = ring.slice(0, -1).map((coordinate) => coordinateAlongBearing(center, coordinate, (bearing + 90) % 360));
  const minimumLongitudinal = Math.min(...longitudinal);
  const maximumLongitudinal = Math.max(...longitudinal);
  const minimumLateral = Math.min(...lateral);
  const maximumLateral = Math.max(...lateral);
  let best = [];
  [0, 0.25, 0.5, 0.75].forEach((longOffset) => {
    [0, 0.25, 0.5, 0.75].forEach((wideOffset) => {
      const layout = [];
      for (let longitudinalPosition = minimumLongitudinal + length / 2 + longOffset * longGap; longitudinalPosition <= maximumLongitudinal - length / 2; longitudinalPosition += longGap) {
        for (let lateralPosition = minimumLateral + width / 2 + wideOffset * wideGap; lateralPosition <= maximumLateral - width / 2; lateralPosition += wideGap) {
          const candidate = moveCoordinate(
            center,
            longitudinalPosition * Math.sin((bearing * Math.PI) / 180) + lateralPosition * Math.sin(((bearing + 90) * Math.PI) / 180),
            longitudinalPosition * Math.cos((bearing * Math.PI) / 180) + lateralPosition * Math.cos(((bearing + 90) * Math.PI) / 180),
          );
          const polygon = panelPolygon(candidate, bearing, length, width);
          if (polygon.slice(0, -1).every((corner) => panelCornerFitsRing(corner, ring))) layout.push({ candidate, polygon, longitudinalPosition, lateralPosition });
        }
      }
      if (layout.length > best.length) best = layout;
    });
  });
  return best.sort((first, second) => first.longitudinalPosition - second.longitudinalPosition || first.lateralPosition - second.lateralPosition);
}

function panelSlots(ring, orientation, count = state.panelCount, panelsPerRow = state.panelsPerRow, bearing = activePanelBearing()) {
  const center = footprintCenter(ring);
  const length = orientation === "portrait" ? state.moduleHeight : state.moduleWidth;
  const width = orientation === "portrait" ? state.moduleWidth : state.moduleHeight;
  const mountingGap = Math.max(0, state.mountingAllowance) / 100;
  const rowGap = Math.max(0, state.rowSpacing) / 100;
  const longGap = length + mountingGap + rowGap;
  const wideGap = width + mountingGap;
  const longitudinal = ring.slice(0, -1).map((coordinate) => coordinateAlongBearing(center, coordinate, bearing));
  const lateral = ring.slice(0, -1).map((coordinate) => coordinateAlongBearing(center, coordinate, (bearing + 90) % 360));
  const minimumLongitudinal = Math.min(...longitudinal);
  const maximumLongitudinal = Math.max(...longitudinal);
  const minimumLateral = Math.min(...lateral);
  const maximumLateral = Math.max(...lateral);
  const requested = Math.max(0, Math.floor(count));
  const columns = Math.max(1, Math.min(maximumPanelCount, Math.floor(panelsPerRow) || 1));
  const rows = Math.ceil(requested / columns);
  const usedColumns = Math.min(columns, Math.max(1, requested));
  const gridLength = length + Math.max(0, rows - 1) * longGap;
  const gridWidth = width + Math.max(0, usedColumns - 1) * wideGap;
  const longitudinalStart = editorPanelVerticalAlignment === "top"
    ? minimumLongitudinal + length / 2
    : editorPanelVerticalAlignment === "bottom"
      ? maximumLongitudinal - gridLength + length / 2
      : (minimumLongitudinal + maximumLongitudinal - gridLength + length) / 2;
  const lateralStart = editorPanelHorizontalAlignment === "left"
    ? maximumLateral - width / 2
    : editorPanelHorizontalAlignment === "right"
      ? minimumLateral + gridWidth - width / 2
      : (minimumLateral + maximumLateral + gridWidth - width) / 2;
  return Array.from({ length: requested }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const longitudinalPosition = longitudinalStart + row * longGap;
    const lateralPosition = lateralStart - column * wideGap;
    const candidate = moveCoordinate(
      center,
      longitudinalPosition * Math.sin((bearing * Math.PI) / 180) + lateralPosition * Math.sin(((bearing + 90) * Math.PI) / 180),
      longitudinalPosition * Math.cos((bearing * Math.PI) / 180) + lateralPosition * Math.cos(((bearing + 90) * Math.PI) / 180),
    );
    const polygon = panelPolygon(candidate, bearing, length, width);
    return {
      candidate,
      polygon,
      row,
      column,
      valid: polygon.slice(0, -1).every((corner) => panelCornerFitsRing(corner, ring)),
    };
  });
}

function bestPanelLayout(ring) {
  const portrait = panelSlots(ring, "portrait");
  const landscape = panelSlots(ring, "landscape");
  const required = Math.max(0, Math.floor(state.panelCount));
  const validCount = (slots) => slots.filter((slot) => slot.valid).length;
  if (editorPanelLayoutIsManual) {
    const slots = editorPanelOrientation === "portrait" ? portrait : landscape;
    return { orientation: editorPanelOrientation, slots, validCount: validCount(slots), portrait, landscape };
  }
  const orientation = validCount(portrait) >= required || validCount(portrait) >= validCount(landscape) ? "portrait" : "landscape";
  const slots = orientation === "portrait" ? portrait : landscape;
  return { orientation, slots, validCount: validCount(slots), portrait, landscape };
}

function updateGeometricPanelCount() {
  if (panelCountIsManual || !state.selectedBuilding?.feature) return;
  const feature = state.selectedBuilding.feature;
  const footprint = feature.geometry.coordinates[0];
  const bearing = activePanelBearing();
  const roof = effectiveRoofRing(feature, bearing);
  const selectedPlane = clipRingToRoofPlane(roof, bearing);
  const inset = insetRing(selectedPlane);
  if (!inset) {
    state.panelCount = 0;
    return;
  }
  const innerPlane = developRoofRing(inset, bearing, footprintCenter(footprint));
  const capacityFor = (orientation) => {
    let capacity = 0;
    for (let count = 1; count <= maximumPanelCount; count += 1) {
      if (panelSlots(innerPlane, orientation, count).every((slot) => slot.valid)) capacity = count;
    }
    return capacity;
  };
  state.panelCount = Math.max(capacityFor("portrait"), capacityFor("landscape"));
}

function roofPlaneFeatures(ring, bearing) {
  if (state.roofType !== "double") return [{ type: "Feature", properties: { active: true }, geometry: { type: "Polygon", coordinates: [ring] } }];
  return [
    { type: "Feature", properties: { active: true }, geometry: { type: "Polygon", coordinates: [clipRingToRoofPlane(ring, bearing)] } },
    { type: "Feature", properties: { active: false }, geometry: { type: "Polygon", coordinates: [clipRingToRoofPlane(ring, (bearing + 180) % 360)] } },
  ];
}

function editorPanelFeatures(ring, layout) {
  const count = Math.max(0, Math.floor(state.panelCount));
  if (!count) return [];
  const origin = state.selectedBuilding ? footprintCenter(state.selectedBuilding.feature.geometry.coordinates[0]) : footprintCenter(ring);
  return layout.slots.map(({ polygon, valid, row, column }, index) => ({ type: "Feature", properties: { index: index + 1, valid, row: row + 1, column: column + 1 }, geometry: { type: "Polygon", coordinates: [projectRoofRing(polygon, activePanelBearing(), origin)] } }));
}

function validatedPanelPolygons(roofRing) {
  const bearing = activePanelBearing();
  const selectedPlane = clipRingToRoofPlane(roofRing, bearing);
  const inset = insetRing(selectedPlane);
  if (!inset) return [];
  const developed = developRoofRing(inset, bearing, footprintCenter(state.selectedBuilding.feature.geometry.coordinates[0]));
  return editorPanelFeatures(developed, bestPanelLayout(developed))
    .filter((panel) => panel.properties.valid)
    .map((panel) => panel.geometry.coordinates[0].map((coordinate) => [...coordinate]));
}

function allValidatedPanelPolygons(roofRing) {
  if (!hasSplitRoofPanels()) return validatedPanelPolygons(roofRing);
  return ["first", "second"].flatMap((panel) => withRoofPanel(panel, () => validatedPanelPolygons(roofRing)));
}

function selectedBuilding3dGeometryError() {
  const building = state.selectedBuilding;
  if (!building?.feature) return false;
  const roofRing = normalizeRing(building.feature.geometry.coordinates[0]);
  try {
    generateSolarProjectMesh({
      feature: cloneFeature(building.feature),
      roofRing,
      values: configurationValues(),
      panels: allValidatedPanelPolygons(roofRing),
    });
    return false;
  } catch (error) {
    if (error instanceof RangeError) return true;
    throw error;
  }
}

function hasSolar3dData(configuration) {
  return Boolean(!configuration?.invalid3d && configuration?.roofRing?.length >= 4 && configuration?.values);
}

function upgradeLegacySolar3dConfigurations() {
  let changed = false;
  buildingConfigurations = Object.fromEntries(Object.entries(buildingConfigurations).map(([id, configuration]) => {
    if (configuration?.invalid3d || hasSolar3dData(configuration) || !configuration?.feature?.geometry?.coordinates?.[0] || !configuration.values) return [id, configuration];
    try {
      const snapshot = withBuildingConfiguration(configuration, (feature) => {
        const roofRing = effectiveRoofRing(feature, roofLayoutBearing());
        return {
          roofRing: roofRing.map((coordinate) => [...coordinate]),
          panels: validatedPanelPolygons(roofRing),
        };
      });
      changed = true;
      return [id, { ...configuration, ...snapshot }];
    } catch (error) {
      console.warn("Unable to migrate saved 3D configuration", error);
      return [id, configuration];
    }
  }));
  if (changed) {
    try {
      window.localStorage.setItem(buildingConfigurationStorageKey, JSON.stringify(buildingConfigurations));
    } catch {
      // The migrated configuration remains usable for the current map session.
    }
  }
}

function upgradeSolar3dConfigurations() {
  upgradeLegacySolar3dConfigurations();
  const localFeatures = new Map(localBuildings.features.map((feature) => [localBuildingId(feature), feature]));
  let changed = false;
  buildingConfigurations = Object.fromEntries(Object.entries(buildingConfigurations).map(([id, configuration]) => {
    const feature = localFeatures.get(String(id));
    if (!feature || !configuration?.values || configuration.invalid3d) return [id, configuration];
    const normalizedFeature = cloneFeature(feature);
    const normalized = withBuildingConfiguration({ ...configuration, feature: normalizedFeature }, (activeFeature) => {
      const roofRing = normalizeRing(activeFeature.geometry.coordinates[0]);
      return {
        ...configuration,
        feature: normalizedFeature,
        roofRing,
        panels: validatedPanelPolygons(roofRing),
      };
    });
    changed ||= JSON.stringify(configuration.feature?.geometry) !== JSON.stringify(normalizedFeature.geometry)
      || JSON.stringify(configuration.roofRing) !== JSON.stringify(normalized.roofRing)
      || JSON.stringify(configuration.panels) !== JSON.stringify(normalized.panels);
    return [id, normalized];
  }));
  if (changed) localStorage.setItem(buildingConfigurationStorageKey, JSON.stringify(buildingConfigurations));
}

function withBuildingConfiguration(configuration, callback) {
  const savedValues = configurationValues();
  const savedBuilding = state.selectedBuilding;
  const savedPanelFields = roofPanelFields;
  const savedActiveRoofPanel = activeRoofPanel;
  const savedOrientation = editorPanelOrientation;
  const savedManualLayout = editorPanelLayoutIsManual;
  const savedHorizontalAlignment = editorPanelHorizontalAlignment;
  const savedVerticalAlignment = editorPanelVerticalAlignment;
  Object.assign(state, configuration.values);
  state.roofShape = configuration.values.roofShape ?? roofShapeForType(state.roofType);
  state.roofColor = configuration.values.roofColor ?? "#9b3e35";
  editorPanelOrientation = configuration.panelOrientation ?? "portrait";
  editorPanelLayoutIsManual = Boolean(configuration.panelLayoutManual);
  editorPanelHorizontalAlignment = configuration.panelHorizontalAlignment ?? "center";
  editorPanelVerticalAlignment = configuration.panelVerticalAlignment ?? "center";
  roofPanelFields = configuration.panelFields ? JSON.parse(JSON.stringify(configuration.panelFields)) : undefined;
  activeRoofPanel = configuration.activeRoofPanel === "second" && roofPanelFields?.second ? "second" : "first";
  if (roofPanelFields?.[activeRoofPanel]) applyPanelFieldSnapshot(roofPanelFields[activeRoofPanel]);
  const feature = cloneFeature(configuration.feature);
  state.selectedBuilding = {
    id: feature.id,
    feature,
    facades: facadeBearingsFromCoordinates(feature.geometry.coordinates[0]),
  };
  try {
    return callback(feature);
  } finally {
    Object.assign(state, savedValues);
    state.selectedBuilding = savedBuilding;
    roofPanelFields = savedPanelFields;
    activeRoofPanel = savedActiveRoofPanel;
    editorPanelOrientation = savedOrientation;
    editorPanelLayoutIsManual = savedManualLayout;
    editorPanelHorizontalAlignment = savedHorizontalAlignment;
    editorPanelVerticalAlignment = savedVerticalAlignment;
  }
}

function refreshSolarProject3d() {
  const projects = [];
  const hitboxes = [];
  let changed = false;
  Object.values(buildingConfigurations).forEach((configuration) => {
    if (!hasSolar3dData(configuration)) return;
    try {
      const footprint = normalizeRing(configuration.feature?.geometry?.coordinates?.[0] ?? configuration.roofRing);
      projects.push(generateSolarProjectMesh({ ...configuration, roofRing: footprint }));
      hitboxes.push({
        type: "Feature",
        id: configuration.feature.id,
        properties: { ...configuration.feature.properties, custom3d: true },
        geometry: { type: "Polygon", coordinates: [footprint] },
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      configuration.invalid3d = true;
      changed = true;
    }
  });
  if (changed) {
    try {
      window.localStorage.setItem(buildingConfigurationStorageKey, JSON.stringify(buildingConfigurations));
    } catch {
      // The fallback building remains visible for the current map session.
    }
    applyHiddenBuildings();
    updateLocalBuildingsSource();
  }
  solarProject3DLayer?.setProjects(projects);
  editorSourceData("solar-project-hitboxes", hitboxes);
  renderTotalEstimate();
}

function roofMetrics(ring, values) {
  const center = footprintCenter(ring);
  const bearing = Number(values.azimuth) || 0;
  const alongSlope = ring.slice(0, -1).map((point) => coordinateAlongBearing(center, point, bearing));
  const alongRidge = ring.slice(0, -1).map((point) => coordinateAlongBearing(center, point, (bearing + 90) % 360));
  const minimumSlope = Math.min(...alongSlope);
  const maximumSlope = Math.max(...alongSlope);
  const minimumRidge = Math.min(...alongRidge);
  const maximumRidge = Math.max(...alongRidge);
  const slopeSpan = maximumSlope - minimumSlope;
  const ridgeSpan = maximumRidge - minimumRidge;
  const shape = values.roofShape ?? roofShapeForType(values.roofType);
  const pitchRadians = Math.max(0, Number(values.pitch) || 0) * Math.PI / 180;
  const run = shape === "skillion" ? slopeSpan : shape === "gabled" ? slopeSpan / 2 : shape === "flat" ? 0 : Math.min(slopeSpan, ridgeSpan) / 2;
  const totalHeight = Math.max(0, Number(values.buildingHeight) || 0);
  const rise = Math.min(totalHeight * 0.8, Math.tan(pitchRadians) * run);
  return {
    center,
    bearing,
    shape,
    totalHeight,
    eaveHeight: Math.max(0, totalHeight - rise),
    rise,
    minimumSlope,
    maximumSlope,
    minimumRidge,
    maximumRidge,
    slopeSpan,
    ridgeSpan,
  };
}

function roofHeightAt(point, metrics) {
  if (metrics.shape === "flat" || !metrics.rise) return metrics.totalHeight;
  const pointCoordinate = moveCoordinate(metrics.center, point.x, point.y);
  const slope = coordinateAlongBearing(metrics.center, pointCoordinate, metrics.bearing);
  const ridge = coordinateAlongBearing(metrics.center, pointCoordinate, (metrics.bearing + 90) % 360);
  const halfSlope = Math.max(0.001, metrics.slopeSpan / 2);
  const halfRidge = Math.max(0.001, metrics.ridgeSpan / 2);
  const middleSlope = (metrics.minimumSlope + metrics.maximumSlope) / 2;
  const middleRidge = (metrics.minimumRidge + metrics.maximumRidge) / 2;
  if (metrics.shape === "skillion") {
    return metrics.eaveHeight + metrics.rise * (metrics.maximumSlope - slope) / Math.max(0.001, metrics.slopeSpan);
  }
  if (metrics.shape === "pyramidal") {
    return metrics.eaveHeight + metrics.rise * Math.max(0, 1 - Math.max(Math.abs(slope - middleSlope) / halfSlope, Math.abs(ridge - middleRidge) / halfRidge));
  }
  if (metrics.shape === "hipped") {
    const ridgeHalfLength = Math.max(0, halfRidge - halfSlope);
    return metrics.eaveHeight + metrics.rise * Math.max(0, 1 - Math.max(Math.abs(slope - middleSlope) / halfSlope, Math.max(0, Math.abs(ridge - middleRidge) - ridgeHalfLength) / halfSlope));
  }
  return metrics.eaveHeight + metrics.rise * Math.max(0, 1 - Math.abs(slope - middleSlope) / halfSlope);
}

function configurationWallHeight(configuration) {
  if (configuration.invalid3d) return Math.max(0, Number(configuration.values?.buildingHeight) || 0);
  return withBuildingConfiguration(configuration, (feature) => {
    const roof = effectiveRoofRing(feature, roofLayoutBearing());
    return roofMetrics(roof, state).eaveHeight;
  });
}

function refreshEditorVisuals() {
  if (!editorMode || !state.selectedBuilding?.feature) return;
  const feature = state.selectedBuilding.feature;
  const ring = feature.geometry.coordinates[0];
  const bearing = activePanelBearing();
  const roof = effectiveRoofRing(feature, bearing);
  const selectedPlane = clipRingToRoofPlane(roof, bearing);
  const innerRing = insetRing(selectedPlane);
  const developedInnerRing = innerRing && developRoofRing(innerRing, bearing, footprintCenter(ring));
  const layout = developedInnerRing ? bestPanelLayout(developedInnerRing) : null;
  if (layout) editorPanelOrientation = layout.orientation;
  editorSourceData("editor-roof-plane", roofPlaneFeatures(roof, bearing));
  editorSourceData("editor-setback", innerRing ? setbackFeatures(selectedPlane, innerRing) : []);
  editorSourceData("editor-margin", innerRing ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [innerRing] } }] : []);
  const ridgeFeatures = roofRidge(roof, roofLayoutBearing());
  if (hoveredEditorBuilding) {
    ridgeFeatures.push({
      type: "Feature",
      properties: { hoveredEdge: true },
      geometry: { type: "LineString", coordinates: roof },
    });
  } else if (hoveredEditorEdgeIndex !== null && hoveredEditorEdgeIndex !== undefined && roof[hoveredEditorEdgeIndex + 1]) {
    ridgeFeatures.push({
      type: "Feature",
      properties: { hoveredEdge: true },
      geometry: { type: "LineString", coordinates: [roof[hoveredEditorEdgeIndex], roof[hoveredEditorEdgeIndex + 1]] },
    });
  }
  editorSourceData("editor-ridge", ridgeFeatures);
  editorSourceData("editor-panels", layout ? editorPanelFeatures(developedInnerRing, layout) : []);
  const status = document.querySelector("#editor-status");
  if (status && layout) {
    const portrait = layout.portrait.filter((slot) => slot.valid).length;
    const landscape = layout.landscape.filter((slot) => slot.valid).length;
    status.textContent = `${layout.validCount}/${state.panelCount} modules - ${layout.orientation === "portrait" ? "portrait" : "paysage"} (portrait ${portrait} / paysage ${landscape})`;
  }
  const warning = document.querySelector("#layout-warning");
  if (warning) {
    const outside = layout ? state.panelCount - layout.validCount : state.panelCount;
    warning.hidden = Boolean(innerRing) && outside <= 0;
    warning.textContent = !innerRing ? "Les marges se croisent : aucun espace exploitable ne reste sur ce pan." : outside > 0 ? `${outside} panneau${outside > 1 ? "x" : ""} hors du pan ou des marges. Les modules rouges ne sont pas retenus dans la capacite.` : "";
  }
  document.querySelectorAll("[data-editor-layout]").forEach((button) => button.classList.toggle("is-selected", button.dataset.editorLayout === editorPanelOrientation));
  updatePanelAlignmentControls();
}

function syncEditedFootprint() {
  const feature = state.selectedBuilding?.feature;
  if (!feature) return;
  const ring = feature.geometry.coordinates[0];
  state.area = Number(footprintAreaSquareMeters(ring).toFixed(1));
  state.selectedBuilding.facades = facadeBearingsFromCoordinates(ring);
  panelCountIsManual = true;
  editorPanelLayoutIsManual = false;
  editorPanelOrientation = "portrait";
  updateDefaultPanelCount();
  updateGeometricPanelCount();
  if (feature.properties?.local) {
    localBuildings = {
      ...localBuildings,
      features: localBuildings.features.map((candidate) => localBuildingId(candidate) === String(state.selectedBuilding.id) ? cloneFeature(feature) : candidate),
    };
    updateLocalBuildingsSource();
  }
  updateCardinalEdgeValues();
  updateRotationControl();
  renderPanelValues();
  refreshEditorVisuals();
  saveSelectedBuildingConfiguration();
}

function enableFootprintEditing() {
  if (!editorMode || !state.selectedBuilding?.feature || editingFootprint) return;
  editingFootprint = true;
  const feature = state.selectedBuilding.feature;
  if (!feature.properties?.orthogonalized) {
    feature.geometry.coordinates = [rectangularRoofRing(feature.geometry.coordinates[0], roofLayoutBearing())];
    feature.properties = { ...feature.properties, orthogonalized: true };
    syncEditedFootprint();
  }
  let ring = feature.geometry.coordinates[0];
  ring.slice(0, 4).forEach((coordinate, index) => {
    const handle = document.createElement("div");
    handle.className = "editor-vertex";
    const marker = new maplibregl.Marker({ element: handle, draggable: true }).setLngLat(coordinate).addTo(map);
    marker.on("drag", () => {
      ring = feature.geometry.coordinates[0];
      const next = marker.getLngLat();
      const nextRing = ring.map((point) => [...point]);
      nextRing[index] = [next.lng, next.lat];
      nextRing[nextRing.length - 1] = [...nextRing[0]];
      if (!hasSimpleFootprint(nextRing) || footprintWinding(nextRing) * footprintWinding(ring) <= 0) {
        reportEditorConstraint("Ce sommet ne peut pas croiser une arete ni inverser le contour du batiment.");
        marker.setLngLat(ring[index]);
        return;
      }
      const previousFeature = cloneFeature(feature);
      feature.geometry.coordinates = [nextRing];
      feature.properties = { ...feature.properties, manualFootprint: true };
      if (selectedBuilding3dGeometryError()) {
        feature.geometry = previousFeature.geometry;
        feature.properties = previousFeature.properties;
        marker.setLngLat(ring[index]);
        show3dGeometryError(["buildingHeight"]);
        return;
      }
      clearEditorConstraint();
      refreshEditorVisuals();
    });
    marker.on("dragend", syncEditedFootprint);
    editorVertexMarkers.push(marker);
  });
}

function deleteEditorSelection() {
  deleteSelectedBuilding();
}

function deleteSelectedBuilding() {
  const building = state.selectedBuilding;
  if (!building) return;
  if (building.feature.properties?.local) {
    localBuildings = { ...localBuildings, features: localBuildings.features.filter((feature) => localBuildingId(feature) !== String(building.id)) };
    updateLocalBuildingsSource();
  } else if (building.id !== undefined && building.id !== null && !hiddenBuildingIds.includes(building.id)) {
    hiddenBuildingIds = [...hiddenBuildingIds, building.id];
    applyHiddenBuildings();
  }
  removeBuildingConfiguration(building.id);
  state.selectedBuilding = null;
  if (editorMode) exitEditor();
  else {
    clearOrientationRose();
    renderPanelValues();
  }
}

function cloneFeature(feature) {
  return JSON.parse(JSON.stringify(feature));
}

function resetFootprint() {
  const original = state.selectedBuilding?.originalFeature;
  if (!original) return;
  clearEditorVertices();
  state.selectedBuilding.feature = cloneFeature(original);
  syncEditedFootprint();
  enableFootprintEditing();
}

function completeNewFootprint(center) {
  if (!center) return;
  const ring = [
    moveCoordinate(center, -0.7, -1),
    moveCoordinate(center, 0.7, -1),
    moveCoordinate(center, 0.7, 1),
    moveCoordinate(center, -0.7, 1),
  ];
  ring.push([...ring[0]]);
  const id = createLocalBuildingId();
  state.buildingColor = "#cdd4d2";
  state.roofColor = "#9b3e35";
  state.roofType = "single";
  state.roofShape = roofShapeForType(state.roofType);
  state.pitch = 35;
  state.panelCount = 0;
  roofPanelFields = undefined;
  activeRoofPanel = "first";
  const feature = { type: "Feature", id, properties: { local: true, id, localId: id, height: 2, color: state.buildingColor, footprintRotation: 0 }, geometry: { type: "Polygon", coordinates: [ring] } };
  const facades = facadeBearingsFromCoordinates(ring);
  state.selectedBuilding = { id, facades, feature, originalFeature: cloneFeature(feature) };
  localBuildings = { ...localBuildings, features: [...localBuildings.features, cloneFeature(feature)] };
  updateLocalBuildingsSource();
  state.selectedPoint = { lng: footprintCenter(ring)[0], lat: footprintCenter(ring)[1] };
  state.area = Number(footprintAreaSquareMeters(ring).toFixed(1));
  state.buildingHeight = feature.properties.height;
  state.azimuth = 180;
  panelCountIsManual = true;
  editorPanelLayoutIsManual = false;
  editorPanelOrientation = "portrait";
  editorPanelHorizontalAlignment = "center";
  editorPanelVerticalAlignment = "center";
  updateDefaultPanelCount();
  updateGeometricPanelCount();
  showEditorLocalBuildings();
  renderPanelValues();
  saveSelectedBuildingConfiguration();
}

function editorBounds(feature) {
  const coordinates = feature.geometry.coordinates[0];
  return coordinates.reduce(
    (bounds, coordinate) => bounds.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
}

function showEditorLocalBuildings() {
  if (!map?.getLayer("local-buildings-3d")) return;
  const selectedId = state.selectedBuilding?.feature.properties?.local
    ? String(state.selectedBuilding.id)
    : null;
  map.setFilter("local-buildings-3d", selectedId
    ? ["all", ["!=", ["get", "custom3d"], true], ["!=", ["get", "localId"], selectedId]]
    : ["!=", ["get", "custom3d"], true]);
  map.setLayoutProperty("local-buildings-3d", "visibility", "visible");
}

function openRelevantEditorSection() {
  const sections = document.querySelectorAll("#editor-toolbar .editor-section");
  const [buildingSection, panelsSection] = sections;
  if (!buildingSection || !panelsSection) return;
  const configuration = buildingConfigurations[state.selectedBuilding?.id];
  const hasPanels = Array.isArray(configuration?.panels)
    ? configuration.panels.length > 0
    : state.panelCount > 0;
  buildingSection.open = !hasPanels;
  panelsSection.open = hasPanels;
}

function enterEditor() {
  const feature = state.selectedBuilding?.feature;
  if (!map || !feature || editorMode) return;
  editorMode = true;
  editorLayerVisibility = ["shadows", "display-buildings-3d", "local-buildings-3d"].reduce((visibility, layerId) => ({
    ...visibility,
    [layerId]: map.getLayoutProperty(layerId, "visibility") ?? "visible",
  }), {});
  clearOrientationRose();
  map.setLayoutProperty("shadows", "visibility", "none");
  map.setLayoutProperty("display-buildings-3d", "visibility", "none");
  solarProject3DLayer?.setVisible(false);
  showEditorLocalBuildings();
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.setPitch(0);
  map.setBearing(0);
  map.fitBounds(editorBounds(feature), { padding: 110, maxZoom: 22, duration: 700 });
  document.querySelector("#editor-toolbar").hidden = false;
  openRelevantEditorSection();
  refreshEditorVisuals();
  enableFootprintEditing();
}

function enterNewBuildingEditor(longitude, latitude) {
  if (!map || editorMode) return;
  state.selectedBuilding = null;
  state.selectedPoint = { lng: longitude, lat: latitude };
  editorMode = true;
  editorLayerVisibility = ["shadows", "display-buildings-3d", "local-buildings-3d"].reduce((visibility, layerId) => ({
    ...visibility,
    [layerId]: map.getLayoutProperty(layerId, "visibility") ?? "visible",
  }), {});
  clearOrientationRose();
  projectMarker?.remove();
  projectMarker = undefined;
  ["shadows", "display-buildings-3d"].forEach((layerId) => map.setLayoutProperty(layerId, "visibility", "none"));
  solarProject3DLayer?.setVisible(false);
  showEditorLocalBuildings();
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.easeTo({ center: [longitude, latitude], zoom: 21, pitch: 0, bearing: 0, duration: 700 });
  document.querySelector("#editor-toolbar").hidden = false;
  completeNewFootprint([longitude, latitude]);
  enableFootprintEditing();
}

function exitEditor(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (!map || !editorMode) return;
  saveBuildingHeight();
  endEditorEdgeDrag();
  endEditorBuildingDrag();
  hoveredEditorEdgeIndex = undefined;
  setHoveredEditorBuilding(false);
  setHoveredEditorVertex(null);
  map.getCanvas().classList.remove("editor-edge-hover");
  editorMode = false;
  clearEditorVertices();
  editorSourceData("editor-building", []);
  editorSourceData("editor-roof-plane", []);
  editorSourceData("editor-setback", []);
  editorSourceData("editor-margin", []);
  editorSourceData("editor-ridge", []);
  editorSourceData("editor-panels", []);
  map.setFilter("local-buildings-3d", ["!=", ["get", "custom3d"], true]);
  Object.entries(editorLayerVisibility ?? {}).forEach(([layerId, visibility]) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  });
  editorLayerVisibility = null;
  solarProject3DLayer?.setVisible(true);
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
  map.easeTo({ pitch: 55, bearing: -20, duration: 700 });
  document.querySelector("#editor-toolbar").hidden = true;
  if (state.selectedBuilding?.feature) drawOrientationRose(state.selectedBuilding.feature);
  refreshLayerControls();
}

function setProjectMarker(longitude, latitude, label, onEdit, showPopup = true) {
  projectMarker?.remove();
  const content = document.createElement("div");
  const text = document.createElement("p");
  text.textContent = label;
  content.append(text);
  if (onEdit) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "create-building-button";
    editButton.textContent = "Editer";
    editButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onEdit();
    });
    content.append(editButton);
  }
  projectMarker = new maplibregl.Marker({ color: "#e76436" })
    .setLngLat([longitude, latitude])
    .setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(content))
    .addTo(map);
  if (showPopup) projectMarker.togglePopup();
}

function centerOnLocation(latitude, longitude, label, { remember = false, showPopup = true } = {}) {
  clearOrientationRose();
  state.selectedPoint = { lat: latitude, lng: longitude };
  if (remember) saveStartLocation(latitude, longitude, label);
  showParcelBoundaries();
  map.flyTo({ center: [longitude, latitude], zoom: 18, essential: true });
  setProjectMarker(longitude, latitude, label, undefined, showPopup);
}

function setLocationMessage(message) {
  const results = document.querySelector("#location-results");
  results.textContent = message;
  correctFrenchText(results);
}

async function searchLocation(event) {
  event.preventDefault();
  const query = document.querySelector("#location-query").value.trim();
  if (!query) return setLocationMessage("Saisissez une ville ou une adresse.");
  locationRequest?.abort();
  locationRequest = new AbortController();
  setLocationMessage("Recherche en cours...");
  try {
    const parameters = new URLSearchParams({ format: "jsonv2", limit: "5", countrycodes: "fr", q: query });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${parameters}`, { signal: locationRequest.signal });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const results = await response.json();
    const container = document.querySelector("#location-results");
    container.replaceChildren();
    if (!results.length) return setLocationMessage("Aucun resultat trouve en France.");
    results.forEach((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = result.display_name;
      button.addEventListener("click", () => {
        centerOnLocation(Number(result.lat), Number(result.lon), result.display_name, { remember: true });
        container.replaceChildren();
        toggleSearchPopup(false);
      });
      container.append(button);
    });
  } catch (error) {
    if (error.name !== "AbortError") setLocationMessage("La recherche est indisponible. Reessayez dans quelques instants.");
  }
}

function locateUser() {
  if (!navigator.geolocation) return setLocationMessage("La geolocalisation n'est pas prise en charge par ce navigateur.");
  setLocationMessage("Localisation en cours...");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      centerOnLocation(coords.latitude, coords.longitude, "Votre position");
      document.querySelector("#location-results").replaceChildren();
      toggleSearchPopup(false);
    },
    () => setLocationMessage("Position indisponible. Autorisez la geolocalisation puis reessayez."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function locateInitialUser() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => centerOnLocation(coords.latitude, coords.longitude, "Votre position", { showPopup: false }),
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function renderPanelValues() {
  updateRotationControl();
  updateCardinalEdgeValues();
  const study = calculateStudy(studyInput());
  const buildingStudy = selectedBuildingStudy();
  const values = { ...state };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.querySelector(`#${id}`);
    if (input && typeof value === "number") input.value = String(value);
  });
  const direction = document.querySelector(".direction");
  const roofResult = document.querySelector("#roof-result");
  const roofOrientation = document.querySelector("#roof-orientation");
  const estimate = document.querySelector(".estimate");
  const coordinates = document.querySelector("#selected-coordinates");
  const surface = document.querySelector("#surface-summary");
  const rowSpacing = document.querySelector("#rowSpacing");
  const buildingHeight = document.querySelector("#buildingHeight");
  const pitchInput = document.querySelector("#pitch");
  if (direction) direction.textContent = state.roofType === "terrace" ? "Toiture horizontale : pas de bas de pente" : `${directionLabel(state.azimuth)} - ${state.azimuth} deg depuis le nord`;
  if (roofResult) roofResult.textContent = roofSurfaceDescription();
  document.querySelectorAll("[data-roof-type]").forEach((button) => {
    const selected = button.dataset.roofType === state.roofType;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-building-color]").forEach((button) => button.classList.toggle("is-selected", button.dataset.buildingColor === state.buildingColor.toLowerCase()));
  const customColor = document.querySelector("#custom-building-color");
  const colorPicker = document.querySelector("#building-color-picker");
  if (customColor) {
    const isCustom = !["#70757a", "#ddd0b4", "#b8d7be"].includes(state.buildingColor.toLowerCase());
    customColor.classList.toggle("is-selected", isCustom);
    customColor.style.setProperty("--custom-building-color", state.customBuildingColor);
    customColor.style.setProperty("--building-text-color", contrastingTextColor(state.customBuildingColor));
  }
  if (colorPicker) colorPicker.value = state.customBuildingColor;
  document.querySelectorAll("[data-roof-color]").forEach((button) => button.classList.toggle("is-selected", button.dataset.roofColor === state.roofColor.toLowerCase()));
  const customRoofColor = document.querySelector("#custom-roof-color");
  const roofColorPicker = document.querySelector("#roof-color-picker");
  if (customRoofColor) {
    const isCustom = !["#cdd4d2", "#9b3e35", "#465b73"].includes(state.roofColor.toLowerCase());
    customRoofColor.classList.toggle("is-selected", isCustom);
    customRoofColor.style.setProperty("--building-color", state.customRoofColor);
    customRoofColor.style.setProperty("--building-text-color", contrastingTextColor(state.customRoofColor));
  }
  if (roofColorPicker) roofColorPicker.value = state.customRoofColor;
  if (roofOrientation) {
    roofOrientation.disabled = state.roofType === "terrace" || !state.selectedBuilding;
    roofOrientation.innerHTML = facadeOptions();
    const roofField = roofOrientation.closest(".field");
    roofField?.querySelector(".roof-orientation-hint")?.remove();
    roofField?.querySelector(".roof-orientation-help")?.remove();
    if (roofField) {
      const message = state.roofType === "terrace"
        ? "Toiture horizontale : aucun bas de pente ne peut etre choisi."
        : "Le bas de pente est limite aux facades existantes de cette emprise.";
      roofField.querySelector("span")?.insertAdjacentHTML("beforeend", `<span class="roof-orientation-help">${infoTip(message)}</span>`);
      const tip = roofField.querySelector(".info-tip");
      if (tip) bindInfoTip(tip);
    }
  }
  if (coordinates) coordinates.textContent = selectedCoordinatesLabel();
  if (surface) surface.innerHTML = surfaceSummary(study);
  const totalPanelPower = document.querySelector("#total-panel-power");
  if (totalPanelPower) totalPanelPower.value = String(state.panelCount * state.panelPower);
  if (buildingHeight) buildingHeight.disabled = !state.selectedBuilding;
  if (pitchInput) {
    const isTerrace = state.roofType === "terrace";
    pitchInput.disabled = isTerrace || !state.selectedBuilding;
    if (!isTerrace && state.selectedBuilding) pitchInput.max = String(maximumRoofPitch());
    const pitchField = pitchInput.closest(".field");
    pitchField?.querySelector(".pitch-help")?.remove();
    if (pitchField) {
      const message = isTerrace
        ? "Une toiture terrasse est horizontale : son inclinaison est fixée à 0°"
        : state.selectedBuilding
          ? `L'inclinaison est limitée à ${formatNumber(maximumRoofPitch(), 1)}° par la hauteur du bâtiment, la forme du toit et la largeur du pan.`
          : "Sélectionnez un bâtiment pour calculer l'inclinaison maximale.";
      pitchField.querySelector("span")?.insertAdjacentHTML("beforeend", `<span class="pitch-help">${infoTip(message)}</span>`);
      const tip = pitchField.querySelector(".info-tip");
      if (tip) bindInfoTip(tip);
    }
  }
  if (estimate) {
    const balance = dailyEnergyBalance(buildingStudy.dailyProduction, state.dailyConsumption);
    const surplus = balance.surplusEnergy > 0 ? `<span class="daily-surplus">Surplus : ${formatNumber(balance.surplusPercent, 1)} % · ${formatNumber(balance.surplusEnergy, 1)} kWh/jour</span>` : "";
    estimate.innerHTML = `<span>Production indicative</span><strong>${formatNumber(buildingStudy.annualProduction)} <small>kWh/an</small></strong><span class="daily-production">${formatNumber(buildingStudy.dailyProduction, 1)} kWh/jour en moyenne</span><span class="daily-self-sufficiency">Autosuffisance journalière : ${formatNumber(balance.dailySelfSufficiency, 1)} %</span>${surplus}<div><b>${formatNumber(buildingStudy.panelCount)} panneaux</b><b>${formatNumber(buildingStudy.power, 2)} kWc</b><b>${hasSplitRoofPanels() ? "2 pans configurés" : `${formatNumber(study.systemLoss, 1)} % pertes système`}</b></div>`;
  }
  const roofPanelEstimates = document.querySelector(".roof-panel-estimates");
  if (roofPanelEstimates) roofPanelEstimates.innerHTML = roofPanelEstimatesMarkup();
  updateRoofPanelControls();
  const totalEstimate = document.querySelector(".total-estimate");
  if (totalEstimate) totalEstimate.innerHTML = totalEstimateMarkup();
  const dateInput = document.querySelector("#date-time");
  if (dateInput) dateInput.value = formatDateTime(state.date);
  const timeSlider = document.querySelector("#time-slider");
  if (timeSlider) timeSlider.value = String(minutesSinceMidnight(state.date));
  const timeValue = document.querySelector("#time-value");
  if (timeValue) timeValue.textContent = formatTime(state.date);
  updateSunReadout();
  refreshEditorVisuals();
  repositionEditorVertices();
  correctFrenchText();
}

function togglePanel() {
  const panel = document.querySelector("#study-panel");
  const isClosed = panel.classList.toggle("is-closed");
  document.querySelector("#toggle-panel").setAttribute("aria-expanded", String(!isClosed));
}

function updateSunReadout() {
  if (!map) return;
  const center = map.getCenter();
  const position = getPosition(state.date, center.lat, center.lng);
  const elevation = position ? Math.round(position.altitude) : null;
  const readout = document.querySelector(".sun-readout b");
  const shadowState = document.querySelector("#shadow-state");
  if (readout) readout.textContent = elevation === null ? "--" : `${elevation} deg`;
  if (shadowState) shadowState.textContent = elevation !== null && elevation <= 0 ? "Nuit" : "Ombres actives";
  const zoomReadout = document.querySelector("#zoom-readout");
  if (zoomReadout) zoomReadout.textContent = map.getZoom().toFixed(1);
}

function addZoomReadout() {
  const compass = map.getContainer().querySelector(".maplibregl-ctrl-compass");
  const group = compass?.closest(".maplibregl-ctrl-group");
  if (!group || group.querySelector("#zoom-readout")) return;
  const readout = document.createElement("div");
  readout.id = "zoom-readout";
  readout.className = "maplibregl-ctrl-zoom-readout";
  readout.setAttribute("aria-label", "Niveau de zoom");
  readout.textContent = map.getZoom().toFixed(1);
  group.append(readout);
}

function controlledLayerIds(name) {
  return {
    buildings: ["display-buildings-3d", "local-buildings-3d"],
    parcels: ["parcel-boundaries"],
    shadows: ["shadows"],
    satellite: ["satellite"],
  }[name] ?? [];
}

function layerIsVisible(name) {
  const layers = controlledLayerIds(name);
  return layers.some((layerId) => map?.getLayer(layerId) && map.getLayoutProperty(layerId, "visibility") !== "none");
}

function refreshLayerControls() {
  document.querySelectorAll("[data-map-layer]").forEach((button) => {
    const visible = layerIsVisible(button.dataset.mapLayer);
    button.classList.toggle("is-active", visible);
    button.setAttribute("aria-pressed", String(visible));
  });
}

function addLayerControls() {
  const compass = map.getContainer().querySelector(".maplibregl-ctrl-compass");
  const group = compass?.closest(".maplibregl-ctrl-group");
  if (!group || group.querySelector(".map-layer-controls")) return;
  const controls = document.createElement("div");
  controls.className = "map-layer-controls";
  controls.setAttribute("aria-label", "Calques de la carte");
  [
    ["buildings", "3D", "Afficher ou masquer les batiments 3D"],
    ["shadows", "O", "Afficher ou masquer les ombres"],
    ["parcels", "P", "Afficher ou masquer les parcelles cadastrales"],
    ["satellite", "SAT", "Afficher ou masquer la vue satellite"],
  ].forEach(([name, label, title]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mapLayer = name;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => {
      if (name === "parcels") ensureParcelsSource();
      const visible = !layerIsVisible(name);
      controlledLayerIds(name).forEach((layerId) => {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      });
      refreshLayerControls();
    });
    controls.append(button);
  });
  group.prepend(controls);
  refreshLayerControls();
}

function offsetCoordinate(coordinate, bearing, meters) {
  const radians = (bearing * Math.PI) / 180;
  const latitude = coordinate[1] + (Math.cos(radians) * meters) / 110540;
  const longitude = coordinate[0] + (Math.sin(radians) * meters) / (111320 * Math.cos((coordinate[1] * Math.PI) / 180));
  return [longitude, latitude];
}

function shadowHull(ring, bearing, distance) {
  const footprint = normalizeRing(ring).slice(0, -1);
  const points = [...footprint, ...footprint.map((coordinate) => offsetCoordinate(coordinate, bearing, distance))]
    .sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  const cross = (origin, first, second) => (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
  const lower = [];
  points.forEach((point) => {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper = [];
  points.reverse().forEach((point) => {
    while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  });
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length > 2 ? [...hull, hull[0]] : null;
}

function shadowCollection() {
  if (!map) return emptyCollection;
  const center = map.getCenter();
  const sun = getPosition(state.date, center.lat, center.lng);
  if (!sun || sun.altitude <= 0) return emptyCollection;
  const distanceForHeight = (height) => Math.min(height / Math.tan((sun.altitude * Math.PI) / 180), 500);
  // SunCalc returns the direction from the building towards the sun; shadows
  // therefore extend in the opposite direction.
  const bearing = (sun.azimuth + 180) % 360;
  const allBuildings = [...buildings.features, ...localBuildings.features];
  const features = allBuildings.filter((feature) => feature.properties?.local || !hiddenBuildingIds.includes(feature.id)).flatMap((feature) => {
    const configuration = buildingConfigurations[feature.id];
    const custom3d = hasSolar3dData(configuration);
    const ring = custom3d ? configuration.feature?.geometry?.coordinates?.[0] ?? feature.geometry.coordinates[0] : feature.geometry.coordinates[0];
    const configuredHeight = Number(configuration?.values?.buildingHeight);
    const height = custom3d && Number.isFinite(configuredHeight) ? configuredHeight : feature.properties?.height || 6;
    const distance = distanceForHeight(height);
    const hull = shadowHull(ring, bearing, distance);
    return hull ? [{ type: "Feature", properties: { id: feature.properties.id }, geometry: { type: "Polygon", coordinates: [hull] } }] : [];
  });
  return { type: "FeatureCollection", features };
}

function applySunPhase(position) {
  const phase = sunPhase(position?.altitude);
  app.dataset.sunPhase = phase.id;
  return phase;
}

function updateSun() {
  if (!map) return;
  const center = map.getCenter();
  const position = getPosition(state.date, center.lat, center.lng);
  applySunPhase(position);
  solarProject3DLayer?.setSunPosition(position);
  if (map?.getSource("shadows")) map.getSource("shadows").setData(shadowCollection());
  updateSunReadout(position);
}

function footprintCenter(coordinates) {
  const points = coordinates.slice(0, -1);
  return [
    points.reduce((total, point) => total + point[0], 0) / points.length,
    points.reduce((total, point) => total + point[1], 0) / points.length,
  ];
}

function buildingKey(feature, coordinates) {
  const [longitude, latitude] = footprintCenter(coordinates);
  const area = footprintAreaSquareMeters(coordinates);
  // Vector-tile rings may start on different vertices after a reload. A key
  // based on source id, centroid and area keeps local edits tied to the same
  // footprint rather than to that arbitrary first vertex.
  return `${feature.id ?? "building"}:${longitude.toFixed(6)}:${latitude.toFixed(6)}:${area.toFixed(1)}`;
}

function storedBuildingHeight(key, coordinates) {
  const directHeight = Number(buildingHeights[key]);
  if (Number.isFinite(directHeight)) return directHeight;

  // The vector service can slightly alter a footprint at a tile boundary. In
  // that case, recover the nearest persisted component with the same source id.
  const [longitude, latitude] = footprintCenter(coordinates);
  const keyParts = String(key).split(":");
  const sourceId = keyParts.slice(0, -3).join(":");
  let closest;
  Object.entries(buildingHeights).forEach(([candidateKey, value]) => {
    const height = Number(value);
    const candidateParts = candidateKey.split(":");
    if (!Number.isFinite(height) || candidateParts.slice(0, -3).join(":") !== sourceId) return;
    const candidateLongitude = Number(candidateParts.at(-3));
    const candidateLatitude = Number(candidateParts.at(-2));
    if (!Number.isFinite(candidateLongitude) || !Number.isFinite(candidateLatitude)) return;
    const east = (candidateLongitude - longitude) * 111320 * Math.cos((latitude * Math.PI) / 180);
    const north = (candidateLatitude - latitude) * 110540;
    const distance = Math.hypot(east, north);
    if (distance <= 5 && (!closest || distance < closest.distance)) closest = { height, distance };
  });
  return closest?.height;
}

function storedBuildingColor(key, coordinates) {
  const directColor = buildingColors[key];
  if (/^#[0-9a-f]{6}$/i.test(directColor)) return directColor;
  const [longitude, latitude] = footprintCenter(coordinates);
  const sourceId = String(key).split(":").slice(0, -3).join(":");
  let closest;
  Object.entries(buildingColors).forEach(([candidateKey, color]) => {
    if (!/^#[0-9a-f]{6}$/i.test(color) || candidateKey.split(":").slice(0, -3).join(":") !== sourceId) return;
    const parts = candidateKey.split(":");
    const candidateLongitude = Number(parts.at(-3));
    const candidateLatitude = Number(parts.at(-2));
    if (!Number.isFinite(candidateLongitude) || !Number.isFinite(candidateLatitude)) return;
    const east = (candidateLongitude - longitude) * 111320 * Math.cos((latitude * Math.PI) / 180);
    const north = (candidateLatitude - latitude) * 110540;
    const distance = Math.hypot(east, north);
    if (distance <= 5 && (!closest || distance < closest.distance)) closest = { color, distance };
  });
  return closest?.color;
}

function distanceToFootprint(coordinates, longitude, latitude) {
  const points = coordinates.slice(0, -1);
  const latitudeScale = Math.cos((latitude * Math.PI) / 180);
  let inside = false;
  let shortestDistance = Infinity;
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const startEast = (start[0] - longitude) * latitudeScale;
    const startNorth = start[1] - latitude;
    const endEast = (end[0] - longitude) * latitudeScale;
    const endNorth = end[1] - latitude;
    if ((startNorth > 0) !== (endNorth > 0) && 0 < ((endEast - startEast) * -startNorth) / (endNorth - startNorth) + startEast) inside = !inside;
    const east = endEast - startEast;
    const north = endNorth - startNorth;
    const lengthSquared = east * east + north * north;
    const position = lengthSquared ? Math.max(0, Math.min(1, -(startEast * east + startNorth * north) / lengthSquared)) : 0;
    shortestDistance = Math.min(shortestDistance, (startEast + position * east) ** 2 + (startNorth + position * north) ** 2);
  });
  return inside ? 0 : shortestDistance;
}

function drawOrientationRose(feature) {
  clearOrientationRose();
  const coordinates = feature.geometry.coordinates[0];
  const facades = facadeBearingsFromCoordinates(coordinates);
  if (!facades.length) return;
  const maximumLength = Math.max(...facades.map((facade) => facade.length));
  const visibleFacades = facades.filter((facade) => facade.length >= maximumLength * 0.12).slice(0, 12);
  const rays = visibleFacades.map((facade) => {
    const end = offsetCoordinate(facade.midpoint, facade.bearing, 8);
    const label = document.createElement("div");
    label.className = "orientation-label";
    label.innerHTML = `<span>${Math.round(facade.bearing) % 360} deg</span>`;
    orientationMarkers.push(new maplibregl.Marker({ element: label, anchor: "center" }).setLngLat(end).addTo(map));
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [facade.midpoint, end] } };
  });
  map.getSource("orientation-rays").setData({ type: "FeatureCollection", features: rays });
  map.getSource("orientation-center").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: footprintCenter(coordinates) } }] });
  const actions = document.createElement("div");
  actions.className = "building-actions";
  const editButton = document.createElement("button");
  editButton.className = "editor-entry";
  editButton.type = "button";
  editButton.textContent = "Editer";
  editButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    enterEditor();
  });
  actions.append(editButton);
  editorMarker = new maplibregl.Marker({ element: actions, anchor: "center" }).setLngLat(footprintCenter(coordinates)).addTo(map);
}

function selectBuilding(feature, longitude, latitude) {
  let coordinates = feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates[0]
    : feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates.map((polygon) => polygon[0]).sort((first, second) => distanceToFootprint(first, longitude, latitude) - distanceToFootprint(second, longitude, latitude))[0]
      : null;
  if (!coordinates?.length) return;
  // A queried MapLibre feature carries internal objects that cannot be sent
  // back into a GeoJSON source. Keep only serializable GeoJSON data.
  const selectedFeature = {
    type: "Feature",
    id: feature.properties?.localId ?? feature.properties?.id ?? feature.id,
    properties: { ...feature.properties },
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
  const savedHeight = storedBuildingHeight(selectedFeature.id, coordinates);
  if (savedHeight !== undefined) selectedFeature.properties.height = savedHeight;
  const savedColor = storedBuildingColor(selectedFeature.id, coordinates);
  if (savedColor !== undefined) selectedFeature.properties.color = savedColor;
  const configuration = buildingConfigurations[selectedFeature.id];
  if (configuration?.feature?.geometry?.type === "Polygon" && configuration?.values) {
    selectedFeature.geometry = cloneFeature(configuration.feature).geometry;
    selectedFeature.properties = { ...selectedFeature.properties, ...configuration.feature.properties };
    coordinates = selectedFeature.geometry.coordinates[0];
  }
  state.selectedPoint = { lng: longitude, lat: latitude };
  const facades = facadeBearingsFromCoordinates(coordinates);
  const defaultFacade = longestSouthFacingFacade(facades);
  state.area = Number(footprintAreaSquareMeters(coordinates).toFixed(1));
  const selectedHeight = Number(selectedFeature.properties.height);
  state.buildingHeight = Number.isFinite(selectedHeight) ? selectedHeight : 9;
  state.buildingColor = validBuildingColor(selectedFeature.properties.color);
  if (!["#70757a", "#ddd0b4", "#b8d7be"].includes(state.buildingColor.toLowerCase())) {
    state.customBuildingColor = state.buildingColor;
  }
  editorPanelLayoutIsManual = false;
  editorPanelOrientation = "portrait";
  editorPanelHorizontalAlignment = "center";
  editorPanelVerticalAlignment = "center";
  if (defaultFacade) state.azimuth = Math.round(defaultFacade.bearing);
  if (configuration?.values) {
    Object.assign(state, configuration.values);
    state.roofShape ??= roofShapeForType(state.roofType);
    state.roofColor = configuration.values.roofColor ?? "#9b3e35";
    editorPanelOrientation = configuration.panelOrientation ?? "portrait";
    editorPanelLayoutIsManual = Boolean(configuration.panelLayoutManual);
    editorPanelHorizontalAlignment = configuration.panelHorizontalAlignment ?? "center";
    editorPanelVerticalAlignment = configuration.panelVerticalAlignment ?? "center";
    roofPanelFields = configuration.panelFields ? JSON.parse(JSON.stringify(configuration.panelFields)) : undefined;
    activeRoofPanel = configuration.activeRoofPanel === "second" && roofPanelFields?.second ? "second" : "first";
    if (roofPanelFields?.[activeRoofPanel]) applyPanelFieldSnapshot(roofPanelFields[activeRoofPanel]);
  } else {
    state.roofColor = "#9b3e35";
    state.panelCount = 0;
    roofPanelFields = undefined;
    activeRoofPanel = "first";
  }
  panelCountIsManual = true;
  if (!["#cdd4d2", "#9b3e35", "#465b73"].includes(state.roofColor.toLowerCase())) {
    state.customRoofColor = state.roofColor;
  }
  // GeoJSON feature ids are coerced by the renderer, while the property keeps
  // the geometry-specific key needed to hide exactly the selected footprint.
  state.selectedBuilding = { id: selectedFeature.id, facades, feature: selectedFeature, originalFeature: cloneFeature(selectedFeature) };
  updateDefaultPanelCount();
  updateGeometricPanelCount();
  projectMarker?.remove();
  projectMarker = undefined;
  drawOrientationRose(selectedFeature);
  renderPanelValues();
}

function visibleBuildings() {
  if (!map || map.getZoom() < 15) return emptyCollection;
  const seen = new Set();
  const features = map.queryRenderedFeatures({ layers: ["buildings-3d"] }).flatMap((feature) => {
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.type === "MultiPolygon"
        ? feature.geometry.coordinates
        : [];
    return polygons.flatMap((coordinates) => {
      if (!coordinates[0]?.length) return [];
      const key = buildingKey(feature, coordinates[0]);
      if (seen.has(key)) return [];
      seen.add(key);
      const properties = feature.properties ?? {};
      return [{
        type: "Feature",
        id: key,
        properties: {
          id: key,
          height: Number.isFinite(storedBuildingHeight(key, coordinates[0]))
            ? storedBuildingHeight(key, coordinates[0])
            : Number(properties.render_height ?? properties.height) || 9,
          color: validBuildingColor(storedBuildingColor(key, coordinates[0])),
          minHeight: Number(properties.render_min_height ?? properties.min_height) || 0,
          shadowGroup: String(feature.id),
        },
        geometry: { type: "Polygon", coordinates },
      }];
    });
  });
  return { type: "FeatureCollection", features };
}

function loadBuildings() {
  if (!map || map.getZoom() < 15) {
    buildings = emptyCollection;
    updateSun();
    return;
  }
  buildings = visibleBuildings();
  applyHiddenBuildings();
  updateSun();
}

function scheduleBuildingLoad() {
  window.clearTimeout(buildingLoadTimer);
  buildingLoadTimer = window.setTimeout(loadBuildings, 150);
}

function mapStyle() {
  return {
    version: 8,
    sources: {
      carto: { type: "raster", tiles: [cartoTileUrl("voyager_nolabels")], tileSize: 256, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" },
      satellite: { type: "raster", tiles: [geopfSatelliteUrl], tileSize: 256, maxzoom: 19, attribution: "Orthophotos &copy; IGN" },
      labels: { type: "raster", tiles: [cartoTileUrl("light_only_labels")], tileSize: 256, attribution: "&copy; CARTO" },
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      "display-buildings": { type: "geojson", data: emptyCollection },
      shadows: { type: "geojson", data: emptyCollection },
      "orientation-rays": { type: "geojson", data: emptyCollection },
      "orientation-center": { type: "geojson", data: emptyCollection },
      "editor-building": { type: "geojson", data: emptyCollection },
      "editor-roof-plane": { type: "geojson", data: emptyCollection },
      "editor-setback": { type: "geojson", data: emptyCollection },
      "editor-margin": { type: "geojson", data: emptyCollection },
      "editor-ridge": { type: "geojson", data: emptyCollection },
      "editor-panels": { type: "geojson", data: emptyCollection },
      "solar-project-hitboxes": { type: "geojson", data: emptyCollection },
      "local-buildings": { type: "geojson", data: renderedLocalBuildings() },
    },
    layers: [
      { id: "carto", type: "raster", source: "carto" },
      { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
      { id: "shadows", type: "fill", source: "shadows", paint: { "fill-color": "#758378", "fill-opacity": 0.78 } },
      { id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 15, paint: { "fill-extrusion-opacity": 0 } },
      { id: "display-buildings-3d", type: "fill-extrusion", source: "display-buildings", minzoom: 15, filter: ["!=", ["get", "custom3d"], true], paint: { "fill-extrusion-color": ["coalesce", ["get", "color"], "#d8d1c2"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": ["get", "minHeight"], "fill-extrusion-opacity": 1 } },
      { id: "local-buildings-3d", type: "fill-extrusion", source: "local-buildings", minzoom: 15, filter: ["!=", ["get", "custom3d"], true], paint: { "fill-extrusion-color": ["coalesce", ["get", "color"], "#6592a7"], "fill-extrusion-height": ["coalesce", ["get", "height"], 6], "fill-extrusion-opacity": 1 } },
      { id: "solar-project-hitboxes", type: "fill", source: "solar-project-hitboxes", minzoom: 15, paint: { "fill-color": "#000000", "fill-opacity": 0.001 } },
      { id: "orientation-rays", type: "line", source: "orientation-rays", paint: { "line-color": "#e76436", "line-width": 2, "line-dasharray": [2, 2] } },
      { id: "orientation-center", type: "circle", source: "orientation-center", paint: { "circle-radius": 5, "circle-color": "#e76436", "circle-stroke-width": 2, "circle-stroke-color": "#fff9e9" } },
      { id: "labels", type: "raster", source: "labels" },
      { id: "editor-roof-plane", type: "fill", source: "editor-roof-plane", paint: { "fill-color": ["case", ["get", "active"], "#3c9ac7", "#a9d5df"], "fill-opacity": 0.5 } },
      { id: "editor-roof-outline", type: "line", source: "editor-roof-plane", paint: { "line-color": "#0c4f7d", "line-width": 3 } },
      { id: "editor-setback", type: "fill", source: "editor-setback", paint: { "fill-color": "#e58a2a", "fill-opacity": 0.55 } },
      { id: "editor-margin", type: "line", source: "editor-margin", paint: { "line-color": "#a94e14", "line-width": 2, "line-dasharray": [2, 2] } },
      { id: "editor-panels-fill", type: "fill", source: "editor-panels", paint: { "fill-color": ["case", ["get", "valid"], "#1a4f8c", "#bc3c2c"], "fill-opacity": 0.88 } },
      { id: "editor-panels-outline", type: "line", source: "editor-panels", paint: { "line-color": ["case", ["get", "valid"], "#c5ddf0", "#fff1e7"], "line-width": 0.75 } },
      { id: "editor-ridge", type: "line", source: "editor-ridge", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["==", ["get", "hoveredEdge"], true], "#f0b343", "#ab314d"], "line-width": ["case", ["==", ["get", "hoveredEdge"], true], 6, 4] } },
    ],
  };
}

function initMap() {
  const savedLocation = savedStartLocation();
  map = new maplibregl.Map({
    container: "map",
    style: mapStyle(),
    center: savedLocation ? [savedLocation.longitude, savedLocation.latitude] : fallbackMapCenter,
    zoom: savedLocation ? 18 : fallbackMapZoom,
    maxZoom: 22,
    pitch: 55,
    bearing: -20,
    maxPitch: 75,
    dragRotate: true,
    pitchWithRotate: true,
    touchPitch: true,
    attributionControl: true,
    transformRequest: alignSatelliteRequest,
  });
  if (import.meta.env.DEV) window.__helioMap = map;
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  addLayerControls();
  addZoomReadout();
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
  map.on("load", () => {
    updateSun();
    upgradeSolar3dConfigurations();
    applyHiddenBuildings();
    solarProject3DLayer = new SolarProject3DLayer();
    map.addLayer(solarProject3DLayer, "orientation-rays");
    refreshSolarProject3d();
    map.once("idle", loadBuildings);
    if (savedLocation) centerOnLocation(savedLocation.latitude, savedLocation.longitude, savedLocation.label, { showPopup: false });
    else locateInitialUser();
  });
  map.on("sourcedata", (event) => {
    if (event.sourceId === "openmaptiles" && event.isSourceLoaded) scheduleBuildingLoad();
  });
  map.on("moveend", () => {
    updateSun();
    scheduleBuildingLoad();
  });
  map.on("mousedown", (event) => {
    if (editorMode && editingFootprint && !startEditorEdgeDrag(event)) startEditorBuildingDrag(event);
  });
  map.on("mousemove", (event) => {
    if (editorEdgeDrag) {
      dragEditorEdge(event);
      return;
    }
    if (editorBuildingDrag) {
      dragEditorBuilding(event);
      return;
    }
    if (editorMode && editingFootprint) {
      const ring = state.selectedBuilding?.feature?.geometry.coordinates[0];
      setHoveredEditorBuilding(Boolean(ring && pointInsideRing([event.lngLat.lng, event.lngLat.lat], ring)));
      const vertexIndex = closestEditorVertex(event.point);
      setHoveredEditorVertex(vertexIndex);
      setHoveredEditorEdge(vertexIndex === null ? closestEditorEdge(event.point) : null);
    }
  });
  map.on("mouseup", () => {
    endEditorEdgeDrag();
    endEditorBuildingDrag();
  });
  map.on("mouseout", () => {
    if (!editorEdgeDrag && !editorBuildingDrag) {
      setHoveredEditorBuilding(false);
      setHoveredEditorVertex(null);
      setHoveredEditorEdge(null);
    }
  });
  map.on("click", (event) => {
    if (event.originalEvent.target?.closest?.(".editor-toolbar")) return;
    if (editorMode) {
      return;
    }
    const buildingLayers = ["solar-project-hitboxes", "local-buildings-3d", "display-buildings-3d"];
    const directFeature = map.queryRenderedFeatures(event.point, { layers: buildingLayers })[0];
    if (directFeature) return selectBuilding(directFeature, event.lngLat.lng, event.lngLat.lat);
    const tolerance = 8;
    const area = [
      [event.point.x - tolerance, event.point.y - tolerance],
      [event.point.x + tolerance, event.point.y + tolerance],
    ];
    // Query the extruded layer itself: its screen geometry follows the pitched
    // 3D camera, unlike an unextruded footprint drawn at map level.
    const feature = map.queryRenderedFeatures(area, { layers: buildingLayers })[0];
    if (feature) return selectBuilding(feature, event.lngLat.lng, event.lngLat.lat);
    clearOrientationRose();
    state.selectedBuilding = null;
    renderPanelValues();
    state.selectedPoint = { lng: event.lngLat.lng, lat: event.lngLat.lat };
    const { lng, lat } = event.lngLat;
    setProjectMarker(
      lng,
      lat,
      `Coordonnees : ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      () => enterNewBuildingEditor(lng, lat),
    );
  });
  map.on("mouseenter", "display-buildings-3d", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "display-buildings-3d", () => { map.getCanvas().style.cursor = ""; });
}

updateDefaultPanelCount();
render();
initMap();
