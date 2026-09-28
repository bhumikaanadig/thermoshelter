// Numeric limits and category values copied from ml/artifacts/v3/model_metadata.json.
// Keep these aligned with the V3 training metadata; inputs are validated, never clamped.
export const V3_NUMERIC_RANGES = {
  Thermal_Conductivity_W_mK: { min: 0.02, max: 219.9816 },
  Density_kg_m3: { min: 15, max: 2700 },
  Specific_Heat_J_kgK: { min: 800, max: 2499.2 },
  Wall_Thickness_m: { min: 0.05, max: 0.4 },
  Shelter_Length_m: { min: 3, max: 6 },
  Shelter_Width_m: { min: 2.5, max: 5 },
  Shelter_Height_m: { min: 2.2, max: 3.5 },
  Opening_Area_m2: { min: 1.55, max: 16.61 },
  Window_Area_m2: { min: 0, max: 13.98 },
  Door_Area_m2: { min: 1.5, max: 3 },
  Orientation_deg: { min: 0, max: 315 },
  External_Temperature_C: { min: -20, max: 40 },
  Initial_Air_Temperature_C: { min: 5.01, max: 25 },
  Solar_Radiation_W_m2: { min: 333.6, max: 1333.1 },
  Daily_Solar_Energy_kWh_m2: { min: 2.002, max: 7.998 },
  Wind_Speed_m_s: { min: 0, max: 12 },
  Relative_Humidity_percent: { min: 10, max: 80 },
  Simulation_Duration_h: { min: 6, max: 48 },
  Time_Step_min: { min: 1, max: 30 },
};

export const V3_CATEGORICAL_VALUES = {
  Material: [
    'Aerated concrete / AAC',
    'Aluminum',
    'Brick',
    'Composite insulated wall',
    'Concrete',
    'EPS insulation',
    'Polyurethane foam (PU)',
    'Rock wool / mineral wool',
    'Wood / timber',
  ],
  Material_Category: ['Composite', 'Insulation', 'Masonry', 'Metal', 'Timber'],
};
