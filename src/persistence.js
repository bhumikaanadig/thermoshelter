import {
  requestDesignHistory,
  requestLoadDesign,
  requestMaterials,
  requestSaveDesign,
  requestSaveOptimizationRun,
  requestSavePrediction,
  requestSavedDesigns,
} from './api.js';
import { FALLBACK_MATERIALS } from './materials.js';

const MATERIAL_NUMBER_FIELDS = ['k', 'rho', 'cp', 't', 'alpha'];

export function normalizeMaterialLibrary(response) {
  const source = response?.materials;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('The material API response did not contain a material catalog.');
  }
  const rows = Object.entries(source);
  if (rows.length === 0) throw new Error('The material catalog is empty.');
  for (const [id, material] of rows) {
    if (!id || !material || typeof material.name !== 'string' || !material.name.trim()) {
      throw new Error('The material catalog contains an invalid material name.');
    }
    if (material.category !== undefined && typeof material.category !== 'string') {
      throw new Error(`Material ${id} has an invalid category.`);
    }
    for (const field of MATERIAL_NUMBER_FIELDS) {
      if (typeof material[field] !== 'number' || !Number.isFinite(material[field])) {
        throw new Error(`Material ${id} has an invalid ${field} property.`);
      }
    }
    if (material.k <= 0 || material.rho <= 0 || material.cp <= 0 || material.t <= 0) {
      throw new Error(`Material ${id} has a non-positive physical property.`);
    }
    if (material.alpha < 0 || material.alpha > 1) {
      throw new Error(`Material ${id} has an invalid absorptance value.`);
    }
  }
  return Object.fromEntries(rows.map(([id, material]) => [id, {
    ...material,
    id,
    category: material.category || 'Uncategorized',
  }]));
}

export function buildDesignSnapshot(design, climate, materials, weatherProfile = null) {
  const materialSnapshot = Object.fromEntries(
    [...new Set(design.layers || [])]
      .filter((materialId) => materials[materialId])
      .map((materialId) => [materialId, { ...materials[materialId] }]),
  );
  return {
    design: { ...design, geometry: { ...design.geometry }, layers: [...design.layers] },
    climate: { ...climate },
    materials: materialSnapshot,
    weather_profile: weatherProfile,
  };
}

export function restoreSavedDesign(record, currentMaterials, validLocationIds = null) {
  const snapshot = record?.design;
  const design = snapshot?.inputs;
  if (!design || typeof design !== 'object' || Array.isArray(design)) {
    throw new Error('This saved record does not contain a valid design.');
  }
  const geometry = design.geometry;
  if (!geometry || typeof geometry !== 'object'
    || !['length', 'width', 'height', 'windowArea', 'doorArea'].every((key) => Number.isFinite(geometry[key]))
    || geometry.length <= 0 || geometry.width <= 0 || geometry.height <= 0
    || geometry.windowArea < 0 || geometry.doorArea < 0
    || !['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(geometry.orientation)
    || !Array.isArray(design.layers) || design.layers.length === 0
    || design.layers.some((id) => typeof id !== 'string' || !currentMaterials[id])
    || typeof design.location !== 'string'
    || (Array.isArray(validLocationIds) && !validLocationIds.includes(design.location))
    || typeof design.occupants !== 'number' || !Number.isFinite(design.occupants)
    || typeof design.target !== 'number' || !Number.isFinite(design.target)) {
    throw new Error('This saved design is incomplete or refers to unavailable materials.');
  }
  if (design.layerThicknesses !== null && design.layerThicknesses !== undefined
    && (!Array.isArray(design.layerThicknesses)
      || design.layerThicknesses.length !== design.layers.length
      || design.layerThicknesses.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0))) {
    throw new Error('This saved design has invalid layer thickness values.');
  }
  return { design: { ...design, geometry: { ...geometry }, layers: [...design.layers] }, designId: record.id };
}

export function latestHistoricalSummary(history) {
  const record = (history?.predictions || []).find((entry) =>
    entry?.prediction_kind === 'summary' && entry?.model_version === 'V3'
      && entry?.result?.predictions && typeof entry.result.predictions === 'object');
  return record ? { ...record, prediction: record.result } : null;
}

export function latestHistoricalHourly(history) {
  const record = (history?.hourly_predictions || []).find((entry) =>
    entry?.model_version === 'V3-Hourly-v1'
      && Array.isArray(entry?.result?.predicted_indoor_temperature_C)
      && entry.result.predicted_indoor_temperature_C.length === 24);
  return record ? { ...record, prediction: record.result } : null;
}

export function createPersistenceClient() {
  return {
    getMaterials: requestMaterials,
    listDesigns: requestSavedDesigns,
    saveDesign: requestSaveDesign,
    loadDesign: requestLoadDesign,
    getDesignHistory: requestDesignHistory,
    savePrediction: requestSavePrediction,
    saveOptimizationRun: requestSaveOptimizationRun,
  };
}

export { FALLBACK_MATERIALS };
