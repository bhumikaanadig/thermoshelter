# THERMOSHELTER dataset inspection

Original files were read only.

## ladakh_shelter_1500_batch3_physics_informed_dataset.csv

- Rows / columns: 1,500 / 41
- Exact duplicate rows: 0
- Duplicate Case_ID values: 0
- Unique Case_ID count: 1500
- Unique materials: ['Aerated concrete / AAC', 'Aluminum', 'Brick', 'Composite insulated wall', 'Concrete', 'EPS insulation', 'Polyurethane foam (PU)', 'Rock wool / mineral wool', 'Wood / timber']
- Inputs present: ['Material', 'Material_Category', 'Thermal_Conductivity_W_mK', 'Density_kg_m3', 'Specific_Heat_J_kgK', 'Wall_Thickness_m', 'Shelter_Length_m', 'Shelter_Width_m', 'Shelter_Height_m', 'Opening_Area_m2', 'Window_Area_m2', 'Door_Area_m2', 'Orientation_deg', 'External_Temperature_C', 'Initial_Air_Temperature_C', 'Solar_Radiation_W_m2', 'Daily_Solar_Energy_kWh_m2', 'Wind_Speed_m_s', 'Relative_Humidity_percent', 'Simulation_Duration_h', 'Time_Step_min']
- Outputs present: ['Average_Air_Temperature_C', 'Minimum_Air_Temperature_C', 'Maximum_Air_Temperature_C', 'Solar_Heat_Input_W', 'Heat_Transfer_Rate_W', 'Thermal_Energy_Loss_Wh', 'Average_Wall_Temperature_C', 'Average_Heat_Flux_W_m2', 'Maximum_Heat_Flux_W_m2', 'Total_Heat_Transferred_Wh', 'Indoor_Temperature_Rise_C']
- Other columns (including provenance and extra inputs/outputs): ['Case_ID', 'Minimum_Wall_Temperature_C', 'Maximum_Wall_Temperature_C', 'Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method', 'Batch']
- Missing values by column: {'Case_ID': 0, 'Material': 0, 'Material_Category': 0, 'Thermal_Conductivity_W_mK': 0, 'Density_kg_m3': 0, 'Specific_Heat_J_kgK': 0, 'Wall_Thickness_m': 0, 'Shelter_Length_m': 0, 'Shelter_Width_m': 0, 'Shelter_Height_m': 0, 'Opening_Area_m2': 0, 'Window_Area_m2': 0, 'Door_Area_m2': 0, 'Orientation_deg': 0, 'External_Temperature_C': 0, 'Initial_Air_Temperature_C': 0, 'Solar_Radiation_W_m2': 0, 'Daily_Solar_Energy_kWh_m2': 0, 'Wind_Speed_m_s': 0, 'Relative_Humidity_percent': 0, 'Simulation_Duration_h': 0, 'Time_Step_min': 0, 'Average_Air_Temperature_C': 0, 'Minimum_Air_Temperature_C': 0, 'Maximum_Air_Temperature_C': 0, 'Average_Wall_Temperature_C': 0, 'Minimum_Wall_Temperature_C': 0, 'Maximum_Wall_Temperature_C': 0, 'Heat_Transfer_Rate_W': 0, 'Average_Heat_Flux_W_m2': 0, 'Maximum_Heat_Flux_W_m2': 0, 'Solar_Heat_Input_W': 0, 'Total_Heat_Transferred_Wh': 0, 'Indoor_Temperature_Rise_C': 0, 'Thermal_Energy_Loss_Wh': 0, 'Data_Type': 0, 'CFD_Reference': 0, 'Climate_Data_Source': 0, 'Material_Data_Source': 0, 'Surrogate_Method': 0, 'Batch': 0}
- Constant columns: ['Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method', 'Batch']
- Highly correlated numeric feature pairs (|r| >= 0.98): [{'left': 'Solar_Radiation_W_m2', 'right': 'Daily_Solar_Energy_kWh_m2', 'pearson_r': 0.9999999818674329}, {'left': 'Opening_Area_m2', 'right': 'Window_Area_m2', 'pearson_r': 0.9889316597938163}]
- Provenance values: {'Data_Type': ['PHYSICS_INFORMED_ESTIMATE'], 'CFD_Reference': ['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)'], 'Climate_Data_Source': ['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)'], 'Material_Data_Source': ['Standard engineering material-property handbook ranges'], 'Surrogate_Method': ['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points'], 'Batch': ['Batch_3']}

### Columns and ranges

| column | dtype | missing | unique | min | median | max | iqr_outliers | value_counts |
|---|---|---|---|---|---|---|---|---|
| Case_ID | str | 0 | 1500 |  |  |  |  | omitted for high-cardinality column (1500 unique values) |
| Material | str | 0 | 9 |  |  |  |  | {'Aerated concrete / AAC': 180, 'Wood / timber': 180, 'Polyurethane foam (PU)': 180, 'Brick': 180, 'Rock wool / mineral wool': 180, 'Composite insulated wall': 180, 'Aluminum': 140, 'EPS insulation': 140, 'Concrete': 140} |
| Material_Category | str | 0 | 5 |  |  |  |  | {'Masonry': 500, 'Insulation': 500, 'Timber': 180, 'Composite': 180, 'Metal': 140} |
| Thermal_Conductivity_W_mK | float64 | 0 | 1181 | 0.0201 | 0.12890000000000001 | 219.9915 | 170 |  |
| Density_kg_m3 | float64 | 0 | 1181 | 15.1 | 547.95 | 2700.0 | 0 |  |
| Specific_Heat_J_kgK | float64 | 0 | 1294 | 800.2 | 971.75 | 2496.7 | 43 |  |
| Wall_Thickness_m | float64 | 0 | 351 | 0.05 | 0.225 | 0.4 | 0 |  |
| Shelter_Length_m | float64 | 0 | 301 | 3.0 | 4.5 | 6.0 | 0 |  |
| Shelter_Width_m | float64 | 0 | 251 | 2.5 | 3.75 | 5.0 | 0 |  |
| Shelter_Height_m | float64 | 0 | 131 | 2.2 | 2.85 | 3.5 | 0 |  |
| Opening_Area_m2 | float64 | 0 | 821 | 1.55 | 6.71 | 16.47 | 2 |  |
| Window_Area_m2 | float64 | 0 | 806 | 0.0 | 4.495 | 14.19 | 1 |  |
| Door_Area_m2 | float64 | 0 | 151 | 1.5 | 2.25 | 3.0 | 0 |  |
| Orientation_deg | int64 | 0 | 8 | 0.0 | 157.5 | 315.0 | 0 |  |
| External_Temperature_C | float64 | 0 | 1468 | -20.0 | 4.99 | 39.94 | 0 |  |
| Initial_Air_Temperature_C | float64 | 0 | 1360 | 5.01 | 15.004999999999999 | 24.99 | 0 |  |
| Solar_Radiation_W_m2 | float64 | 0 | 1492 | 334.0 | 833.3 | 1333.0 | 0 |  |
| Daily_Solar_Energy_kWh_m2 | float64 | 0 | 1472 | 2.004 | 5.0 | 7.998 | 0 |  |
| Wind_Speed_m_s | float64 | 0 | 1108 | 0.0 | 5.995 | 12.0 | 0 |  |
| Relative_Humidity_percent | float64 | 0 | 701 | 10.0 | 45.0 | 80.0 | 0 |  |
| Simulation_Duration_h | float64 | 0 | 421 | 6.0 | 27.0 | 48.0 | 0 |  |
| Time_Step_min | int64 | 0 | 6 | 1.0 | 5.0 | 30.0 | 0 |  |
| Average_Air_Temperature_C | float64 | 0 | 1467 | -7.959 | 10.1415 | 31.481 | 0 |  |
| Minimum_Air_Temperature_C | float64 | 0 | 1207 | -9.35 | 9.245 | 30.79 | 0 |  |
| Maximum_Air_Temperature_C | float64 | 0 | 1222 | -5.87 | 11.47 | 33.5 | 0 |  |
| Average_Wall_Temperature_C | float64 | 0 | 1481 | -19.689 | 5.9795 | 39.728 | 0 |  |
| Minimum_Wall_Temperature_C | float64 | 0 | 1320 | -22.01 | 4.6850000000000005 | 37.62 | 0 |  |
| Maximum_Wall_Temperature_C | float64 | 0 | 1304 | -16.23 | 8.024999999999999 | 43.21 | 0 |  |
| Heat_Transfer_Rate_W | float64 | 0 | 1500 | -885.7904 | -66.9785 | 782.7685 | 67 |  |
| Average_Heat_Flux_W_m2 | float64 | 0 | 1420 | -13.491 | -1.1564999999999999 | 11.192 | 63 |  |
| Maximum_Heat_Flux_W_m2 | float64 | 0 | 1426 | -15.515 | -1.33 | 12.871 | 63 |  |
| Solar_Heat_Input_W | float64 | 0 | 1500 | 437.57 | 9548.150000000001 | 56979.57 | 19 |  |
| Total_Heat_Transferred_Wh | float64 | 0 | 1494 | -40519.1 | -1368.4 | 22157.9 | 157 |  |
| Indoor_Temperature_Rise_C | float64 | 0 | 1193 | -23.59 | -4.9350000000000005 | 18.41 | 0 |  |
| Thermal_Energy_Loss_Wh | float64 | 0 | 1018 | 0.0 | 1368.4 | 40519.1 | 121 |  |
| Data_Type | str | 0 | 1 |  |  |  |  | {'PHYSICS_INFORMED_ESTIMATE': 1500} |
| CFD_Reference | str | 0 | 1 |  |  |  |  | {'Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)': 1500} |
| Climate_Data_Source | str | 0 | 1 |  |  |  |  | {'Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)': 1500} |
| Material_Data_Source | str | 0 | 1 |  |  |  |  | {'Standard engineering material-property handbook ranges': 1500} |
| Surrogate_Method | str | 0 | 1 |  |  |  |  | {'Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points': 1500} |
| Batch | str | 0 | 1 |  |  |  |  | {'Batch_3': 1500} |

### Physical consistency checks

| check | violations | interpretation |
|---|---|---|
| Thermal_Conductivity_W_mK > 0 | 0 | Flag only; review against the source model and units. |
| Density_kg_m3 > 0 | 0 | Flag only; review against the source model and units. |
| Specific_Heat_J_kgK > 0 | 0 | Flag only; review against the source model and units. |
| Wall_Thickness_m > 0 | 0 | Flag only; review against the source model and units. |
| Shelter_Length_m > 0 | 0 | Flag only; review against the source model and units. |
| Shelter_Width_m > 0 | 0 | Flag only; review against the source model and units. |
| Shelter_Height_m > 0 | 0 | Flag only; review against the source model and units. |
| Simulation_Duration_h > 0 | 0 | Flag only; review against the source model and units. |
| Time_Step_min > 0 | 0 | Flag only; review against the source model and units. |
| Opening_Area_m2 >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Window_Area_m2 >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Door_Area_m2 >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Solar_Radiation_W_m2 >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Daily_Solar_Energy_kWh_m2 >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Wind_Speed_m_s >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Solar_Heat_Input_W >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Thermal_Energy_Loss_Wh >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Relative_Humidity_percent in [0, 100] | 0 | Outside conventional percentage bounds. |
| Orientation_deg in [0, 360] | 0 | Outside the stated compass-angle range. |
| minimum <= average <= maximum air temperature | 0 | Checks internal consistency of temperature summaries. |
| opening area equals window area + door area | 0 | Potential deterministic relationship/redundant inputs; values retained. |

## ladakh_shelter_ml_dataset_63_cases.csv

- Rows / columns: 63 / 11
- Exact duplicate rows: 0
- Duplicate Case_ID values: None
- Unique Case_ID count: None
- Unique materials: ['Aluminum', 'Concrete', 'EPS']
- Inputs present: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C', 'Wind_Speed_m_s']
- Outputs present: ['Average_Air_Temperature_C', 'Minimum_Air_Temperature_C', 'Maximum_Air_Temperature_C', 'Heat_Transfer_Rate_W', 'Average_Wall_Temperature_C']
- Other columns (including provenance and extra inputs/outputs): ['Solar_Radiation_kWh_m2_year']
- Missing values by column: {'Material': 0, 'Wall_Thickness_m': 0, 'External_Temperature_C': 0, 'Initial_Air_Temperature_C': 0, 'Solar_Radiation_kWh_m2_year': 0, 'Wind_Speed_m_s': 0, 'Average_Air_Temperature_C': 0, 'Minimum_Air_Temperature_C': 0, 'Maximum_Air_Temperature_C': 0, 'Average_Wall_Temperature_C': 0, 'Heat_Transfer_Rate_W': 0}
- Constant columns: ['Initial_Air_Temperature_C', 'Solar_Radiation_kWh_m2_year', 'Wind_Speed_m_s']
- Highly correlated numeric feature pairs (|r| >= 0.98): []
- Provenance values: {}

### Columns and ranges

| column | dtype | missing | unique | min | median | max | iqr_outliers | value_counts |
|---|---|---|---|---|---|---|---|---|
| Material | str | 0 | 3 |  |  |  |  | {'Aluminum': 21, 'Concrete': 21, 'EPS': 21} |
| Wall_Thickness_m | float64 | 0 | 3 | 0.1 | 0.2 | 0.3 | 0 |  |
| External_Temperature_C | float64 | 0 | 7 | 25.0 | 32.5 | 40.0 | 0 |  |
| Initial_Air_Temperature_C | float64 | 0 | 1 | 20.0 | 20.0 | 20.0 | 0 |  |
| Solar_Radiation_kWh_m2_year | float64 | 0 | 1 | 2000.0 | 2000.0 | 2000.0 | 0 |  |
| Wind_Speed_m_s | float64 | 0 | 1 | 5.0 | 5.0 | 5.0 | 0 |  |
| Average_Air_Temperature_C | float64 | 0 | 63 | 21.4902 | 25.9693 | 31.0263 | 0 |  |
| Minimum_Air_Temperature_C | float64 | 0 | 63 | 21.2902 | 25.7693 | 30.8263 | 0 |  |
| Maximum_Air_Temperature_C | float64 | 0 | 63 | 21.6902 | 26.1693 | 31.2263 | 0 |  |
| Average_Wall_Temperature_C | float64 | 0 | 63 | 22.9938 | 31.1588 | 39.9091 | 0 |  |
| Heat_Transfer_Rate_W | float64 | 0 | 63 | 12.8261 | 128.0922 | 290.5778 | 0 |  |

### Physical consistency checks

| check | violations | interpretation |
|---|---|---|
| Wall_Thickness_m > 0 | 0 | Flag only; review against the source model and units. |
| Solar_Radiation_kWh_m2_year >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Wind_Speed_m_s >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| minimum <= average <= maximum air temperature | 0 | Checks internal consistency of temperature summaries. |

## ladakh_shelter_ml_dataset_updated (1).csv

- Rows / columns: 36 / 11
- Exact duplicate rows: 0
- Duplicate Case_ID values: None
- Unique Case_ID count: None
- Unique materials: ['Aluminum', 'Concrete', 'EPS']
- Inputs present: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C', 'Wind_Speed_m_s']
- Outputs present: ['Average_Air_Temperature_C', 'Minimum_Air_Temperature_C', 'Maximum_Air_Temperature_C', 'Heat_Transfer_Rate_W', 'Average_Wall_Temperature_C']
- Other columns (including provenance and extra inputs/outputs): ['Solar_Radiation_kWh_m2_year']
- Missing values by column: {'Material': 0, 'Wall_Thickness_m': 0, 'External_Temperature_C': 0, 'Initial_Air_Temperature_C': 0, 'Solar_Radiation_kWh_m2_year': 0, 'Wind_Speed_m_s': 0, 'Average_Air_Temperature_C': 0, 'Minimum_Air_Temperature_C': 0, 'Maximum_Air_Temperature_C': 0, 'Average_Wall_Temperature_C': 0, 'Heat_Transfer_Rate_W': 0}
- Constant columns: ['Initial_Air_Temperature_C', 'Solar_Radiation_kWh_m2_year', 'Wind_Speed_m_s']
- Highly correlated numeric feature pairs (|r| >= 0.98): []
- Provenance values: {}

### Columns and ranges

| column | dtype | missing | unique | min | median | max | iqr_outliers | value_counts |
|---|---|---|---|---|---|---|---|---|
| Material | str | 0 | 3 |  |  |  |  | {'Aluminum': 12, 'Concrete': 12, 'EPS': 12} |
| Wall_Thickness_m | float64 | 0 | 3 | 0.1 | 0.2 | 0.3 | 0 |  |
| External_Temperature_C | int64 | 0 | 4 | 25.0 | 32.5 | 40.0 | 0 |  |
| Initial_Air_Temperature_C | int64 | 0 | 1 | 20.0 | 20.0 | 20.0 | 0 |  |
| Solar_Radiation_kWh_m2_year | int64 | 0 | 1 | 2000.0 | 2000.0 | 2000.0 | 0 |  |
| Wind_Speed_m_s | int64 | 0 | 1 | 5.0 | 5.0 | 5.0 | 0 |  |
| Average_Air_Temperature_C | float64 | 0 | 36 | 21.4902 | 25.79845 | 31.0263 | 0 |  |
| Minimum_Air_Temperature_C | float64 | 0 | 36 | 21.2902 | 25.59845 | 30.8263 | 0 |  |
| Maximum_Air_Temperature_C | float64 | 0 | 36 | 21.6902 | 25.99845 | 31.2263 | 0 |  |
| Average_Wall_Temperature_C | float64 | 0 | 36 | 22.9938 | 30.0868 | 39.9091 | 0 |  |
| Heat_Transfer_Rate_W | float64 | 0 | 36 | 12.8261 | 145.69275 | 290.5778 | 0 |  |

### Physical consistency checks

| check | violations | interpretation |
|---|---|---|
| Wall_Thickness_m > 0 | 0 | Flag only; review against the source model and units. |
| Solar_Radiation_kWh_m2_year >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| Wind_Speed_m_s >= 0 | 0 | Flag only; signed heat-flow rate is allowed and is not checked here. |
| minimum <= average <= maximum air temperature | 0 | Checks internal consistency of temperature summaries. |

## Pairwise comparisons

### ladakh_shelter_1500_batch3_physics_informed_dataset.csv vs ladakh_shelter_ml_dataset_63_cases.csv

- Identical schemas: False
- Shared output columns: ['Average_Air_Temperature_C', 'Minimum_Air_Temperature_C', 'Maximum_Air_Temperature_C', 'Heat_Transfer_Rate_W', 'Average_Wall_Temperature_C']
- Shared required input columns: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C', 'Wind_Speed_m_s']
- Left-only columns: ['Case_ID', 'Material_Category', 'Thermal_Conductivity_W_mK', 'Density_kg_m3', 'Specific_Heat_J_kgK', 'Shelter_Length_m', 'Shelter_Width_m', 'Shelter_Height_m', 'Opening_Area_m2', 'Window_Area_m2', 'Door_Area_m2', 'Orientation_deg', 'Solar_Radiation_W_m2', 'Daily_Solar_Energy_kWh_m2', 'Relative_Humidity_percent', 'Simulation_Duration_h', 'Time_Step_min', 'Minimum_Wall_Temperature_C', 'Maximum_Wall_Temperature_C', 'Average_Heat_Flux_W_m2', 'Maximum_Heat_Flux_W_m2', 'Solar_Heat_Input_W', 'Total_Heat_Transferred_Wh', 'Indoor_Temperature_Rise_C', 'Thermal_Energy_Loss_Wh', 'Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method', 'Batch']
- Right-only columns: ['Solar_Radiation_kWh_m2_year']
- Exact row overlap: None
- Shared condition keys: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C']
- Shared condition tuple overlap: 0
- Case_ID overlap: None
- Material-name intersection: ['Aluminum', 'Concrete']

### ladakh_shelter_1500_batch3_physics_informed_dataset.csv vs ladakh_shelter_ml_dataset_updated (1).csv

- Identical schemas: False
- Shared output columns: ['Average_Air_Temperature_C', 'Minimum_Air_Temperature_C', 'Maximum_Air_Temperature_C', 'Heat_Transfer_Rate_W', 'Average_Wall_Temperature_C']
- Shared required input columns: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C', 'Wind_Speed_m_s']
- Left-only columns: ['Case_ID', 'Material_Category', 'Thermal_Conductivity_W_mK', 'Density_kg_m3', 'Specific_Heat_J_kgK', 'Shelter_Length_m', 'Shelter_Width_m', 'Shelter_Height_m', 'Opening_Area_m2', 'Window_Area_m2', 'Door_Area_m2', 'Orientation_deg', 'Solar_Radiation_W_m2', 'Daily_Solar_Energy_kWh_m2', 'Relative_Humidity_percent', 'Simulation_Duration_h', 'Time_Step_min', 'Minimum_Wall_Temperature_C', 'Maximum_Wall_Temperature_C', 'Average_Heat_Flux_W_m2', 'Maximum_Heat_Flux_W_m2', 'Solar_Heat_Input_W', 'Total_Heat_Transferred_Wh', 'Indoor_Temperature_Rise_C', 'Thermal_Energy_Loss_Wh', 'Data_Type', 'CFD_Reference', 'Climate_Data_Source', 'Material_Data_Source', 'Surrogate_Method', 'Batch']
- Right-only columns: ['Solar_Radiation_kWh_m2_year']
- Exact row overlap: None
- Shared condition keys: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C']
- Shared condition tuple overlap: 0
- Case_ID overlap: None
- Material-name intersection: ['Aluminum', 'Concrete']

### ladakh_shelter_ml_dataset_63_cases.csv vs ladakh_shelter_ml_dataset_updated (1).csv

- Identical schemas: True
- Shared output columns: ['Average_Air_Temperature_C', 'Minimum_Air_Temperature_C', 'Maximum_Air_Temperature_C', 'Heat_Transfer_Rate_W', 'Average_Wall_Temperature_C']
- Shared required input columns: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C', 'Wind_Speed_m_s']
- Left-only columns: []
- Right-only columns: []
- Exact row overlap: 36
- Shared condition keys: ['Material', 'Wall_Thickness_m', 'External_Temperature_C', 'Initial_Air_Temperature_C']
- Shared condition tuple overlap: 36
- Case_ID overlap: None
- Material-name intersection: ['Aluminum', 'Concrete', 'EPS']
