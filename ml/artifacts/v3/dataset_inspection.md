# THERMOSHELTER V3 dataset audit

## Current source workbooks

The audit searched the project recursively for CSV and Excel tables containing all 21 model inputs and six targets. It selected a workbook only when exactly one sheet contained that full case-level schema.

| Filename | Full path | Type | Design rows | Columns | Prior V2 use |
|---|---|---:|---:|---:|---|
| `ladakh_shelter_1500_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_physics_informed_dataset.xlsx` | xlsx | 1,500 | 41 | NO |
| `ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx` | xlsx | 1,500 | 42 | NO |
| `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` | xlsx | 1,500 | 42 | YES |
| `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` | `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` | xlsx | 2,000 | 42 | YES |

### V2 history

V2 used 3,500 raw rows and 3,500 unique rows from 2 sources.
- `ladakh_shelter_1500_batch3_physics_informed_dataset.csv`: `D:\ANSYS\ladakh_shelter_1500_batch3_physics_informed_dataset.csv`, 1,500 rows.
- `ladakh_shelter_2000_batch4_physics_informed_dataset.csv`: `C:\Users\bhumi\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\8886714C6C449E311A8F343EEDD0B4D96C1CACE0\transfers\2026-39\ladakh_shelter_2000_batch4_physics_informed_dataset.csv`, 2,000 rows.
- Current `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx` matches the prior modeled records: 1,500/1,500 case IDs; modeled input/target cells equal: 40,500/40,500.
- Current `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx` matches the prior modeled records: 2,000/2,000 case IDs; modeled input/target cells equal: 54,000/54,000.

## Per-workbook data audit

### `ladakh_shelter_1500_physics_informed_dataset.xlsx`

Path: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_physics_informed_dataset.xlsx`  
Design sheet: `Design_Cases_1500`; 1,500 rows × 41 columns; 443,685 bytes.
Case_ID range: `CASE_00001`–`CASE_01500`; unique 1,500; duplicate IDs 0; duplicate full rows 0.
Dtypes: `{'float64': 30, 'str': 9, 'int64': 2}`. Missing feature cells 0; missing target cells 0; nonfinite numeric cells 0.
Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`. Provenance: `{'Data_Type': ['PHYSICS_INFORMED_ESTIMATE'], 'CFD_Reference': ['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)'], 'Climate_Data_Source': ['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)'], 'Material_Data_Source': ['Standard engineering material-property handbook ranges'], 'Surrogate_Method': ['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points']}`.
Materials: `['Aerated concrete / AAC', 'Aluminum', 'Brick', 'Composite insulated wall', 'Concrete', 'EPS insulation', 'Polyurethane foam (PU)', 'Rock wool / mineral wool', 'Wood / timber']`. Categories: `['Composite', 'Insulation', 'Masonry', 'Metal', 'Timber']`.
Main-sheet columns:

```text
Case_ID, Material, Material_Category, Thermal_Conductivity_W_mK, Density_kg_m3, Specific_Heat_J_kgK, Wall_Thickness_m, Shelter_Length_m, Shelter_Width_m, Shelter_Height_m, Opening_Area_m2, Window_Area_m2, Door_Area_m2, Orientation_deg, External_Temperature_C, Initial_Air_Temperature_C, Solar_Radiation_W_m2, Daily_Solar_Energy_kWh_m2, Wind_Speed_m_s, Relative_Humidity_percent, Simulation_Duration_h, Time_Step_min, Average_Air_Temperature_C, Minimum_Air_Temperature_C, Maximum_Air_Temperature_C, Average_Wall_Temperature_C, Minimum_Wall_Temperature_C, Maximum_Wall_Temperature_C, Heat_Transfer_Rate_W, Average_Heat_Flux_W_m2, Maximum_Heat_Flux_W_m2, Solar_Heat_Input_W, Total_Heat_Transferred_Wh, Indoor_Temperature_Rise_C, Thermal_Energy_Loss_Wh, Data_Type, CFD_Reference, Climate_Data_Source, Material_Data_Source, Surrogate_Method, Recommended_Split
```

Numeric ranges:

| Column | Minimum | Maximum | IQR flags retained |
|---|---:|---:|---:|
| `Thermal_Conductivity_W_mK` | 0.0201 | 219.982 | 166 |
| `Density_kg_m3` | 15.3 | 2700 | 0 |
| `Specific_Heat_J_kgK` | 800 | 2499 | 53 |
| `Wall_Thickness_m` | 0.05 | 0.4 | 0 |
| `Shelter_Length_m` | 3 | 6 | 0 |
| `Shelter_Width_m` | 2.5 | 5 | 0 |
| `Shelter_Height_m` | 2.2 | 3.5 | 0 |
| `Opening_Area_m2` | 1.65 | 15.63 | 0 |
| `Window_Area_m2` | 0 | 13.6 | 0 |
| `Door_Area_m2` | 1.5 | 3 | 0 |
| `Orientation_deg` | 0 | 315 | 0 |
| `External_Temperature_C` | -19.99 | 39.97 | 0 |
| `Initial_Air_Temperature_C` | 5 | 25 | 0 |
| `Solar_Radiation_W_m2` | 333.6 | 1333.1 | 0 |
| `Daily_Solar_Energy_kWh_m2` | 2.002 | 7.998 | 0 |
| `Wind_Speed_m_s` | 0 | 12 | 0 |
| `Relative_Humidity_percent` | 10 | 80 | 0 |
| `Simulation_Duration_h` | 6 | 48 | 0 |
| `Time_Step_min` | 1 | 30 | 0 |
| `Average_Air_Temperature_C` | -7.213 | 32.733 | 0 |
| `Minimum_Air_Temperature_C` | -8.81 | 31.14 | 0 |
| `Maximum_Air_Temperature_C` | -5.62 | 35.13 | 0 |
| `Average_Wall_Temperature_C` | -19.694 | 39.762 | 0 |
| `Minimum_Wall_Temperature_C` | -22.01 | 37.56 | 0 |
| `Maximum_Wall_Temperature_C` | -16.22 | 43.24 | 0 |
| `Heat_Transfer_Rate_W` | -1057.61 | 714.587 | 88 |
| `Average_Heat_Flux_W_m2` | -15.117 | 10.594 | 70 |
| `Maximum_Heat_Flux_W_m2` | -17.671 | 12.319 | 68 |
| `Solar_Heat_Input_W` | 443.37 | 66382.8 | 34 |
| `Total_Heat_Transferred_Wh` | -41899.2 | 27297.2 | 157 |
| `Indoor_Temperature_Rise_C` | -25.07 | 17.84 | 0 |
| `Thermal_Energy_Loss_Wh` | 0 | 41899.2 | 120 |

Physical checks:

- positive material properties, dimensions, duration, and time step: 0 violations.
- nonnegative areas, solar inputs, and wind speed: 0 violations.
- relative humidity in 0–100 percent: 0 violations.
- orientation in 0–360 degrees: 0 violations.
- opening area equals window plus door area: 0 violations.
- minimum <= average <= maximum air temperature: 0 violations.
- minimum <= average <= maximum wall temperature: 0 violations.
- nonnegative solar heat input and thermal energy loss: 0 violations.
- `Transient_24h_Subset`: 1,440 hourly records for 60 cases, hours 0–23, {'24': 60} rows per case; used for V3 case-summary training: NO.

### `ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx`

Path: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_batch2_physics_informed_dataset.xlsx`  
Design sheet: `Design_Cases_Batch2_1500`; 1,500 rows × 42 columns; 449,576 bytes.
Case_ID range: `CASE_01501`–`CASE_03000`; unique 1,500; duplicate IDs 0; duplicate full rows 0.
Dtypes: `{'float64': 30, 'str': 10, 'int64': 2}`. Missing feature cells 0; missing target cells 0; nonfinite numeric cells 0.
Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`. Provenance: `{'Data_Type': ['PHYSICS_INFORMED_ESTIMATE'], 'CFD_Reference': ['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)'], 'Climate_Data_Source': ['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)'], 'Material_Data_Source': ['Standard engineering material-property handbook ranges'], 'Surrogate_Method': ['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points'], 'Batch': ['Batch_2']}`.
Materials: `['Aerated concrete / AAC', 'Aluminum', 'Brick', 'Composite insulated wall', 'Concrete', 'EPS insulation', 'Polyurethane foam (PU)', 'Rock wool / mineral wool', 'Wood / timber']`. Categories: `['Composite', 'Insulation', 'Masonry', 'Metal', 'Timber']`.
Main-sheet columns:

```text
Case_ID, Material, Material_Category, Thermal_Conductivity_W_mK, Density_kg_m3, Specific_Heat_J_kgK, Wall_Thickness_m, Shelter_Length_m, Shelter_Width_m, Shelter_Height_m, Opening_Area_m2, Window_Area_m2, Door_Area_m2, Orientation_deg, External_Temperature_C, Initial_Air_Temperature_C, Solar_Radiation_W_m2, Daily_Solar_Energy_kWh_m2, Wind_Speed_m_s, Relative_Humidity_percent, Simulation_Duration_h, Time_Step_min, Average_Air_Temperature_C, Minimum_Air_Temperature_C, Maximum_Air_Temperature_C, Average_Wall_Temperature_C, Minimum_Wall_Temperature_C, Maximum_Wall_Temperature_C, Heat_Transfer_Rate_W, Average_Heat_Flux_W_m2, Maximum_Heat_Flux_W_m2, Solar_Heat_Input_W, Total_Heat_Transferred_Wh, Indoor_Temperature_Rise_C, Thermal_Energy_Loss_Wh, Data_Type, CFD_Reference, Climate_Data_Source, Material_Data_Source, Surrogate_Method, Batch, Recommended_Split
```

Numeric ranges:

| Column | Minimum | Maximum | IQR flags retained |
|---|---:|---:|---:|
| `Thermal_Conductivity_W_mK` | 0.02 | 219.939 | 174 |
| `Density_kg_m3` | 15 | 2700 | 0 |
| `Specific_Heat_J_kgK` | 801.1 | 2499.2 | 52 |
| `Wall_Thickness_m` | 0.05 | 0.4 | 0 |
| `Shelter_Length_m` | 3 | 6 | 0 |
| `Shelter_Width_m` | 2.5 | 5 | 0 |
| `Shelter_Height_m` | 2.2 | 3.5 | 0 |
| `Opening_Area_m2` | 1.57 | 15.45 | 0 |
| `Window_Area_m2` | 0 | 13.44 | 0 |
| `Door_Area_m2` | 1.5 | 3 | 0 |
| `Orientation_deg` | 0 | 315 | 0 |
| `External_Temperature_C` | -19.99 | 40 | 0 |
| `Initial_Air_Temperature_C` | 5.01 | 25 | 0 |
| `Solar_Radiation_W_m2` | 333.7 | 1332.9 | 0 |
| `Daily_Solar_Energy_kWh_m2` | 2.002 | 7.997 | 0 |
| `Wind_Speed_m_s` | 0 | 12 | 0 |
| `Relative_Humidity_percent` | 10 | 80 | 0 |
| `Simulation_Duration_h` | 6 | 48 | 0 |
| `Time_Step_min` | 1 | 30 | 0 |
| `Average_Air_Temperature_C` | -7.999 | 32.633 | 0 |
| `Minimum_Air_Temperature_C` | -9.6 | 31.39 | 0 |
| `Maximum_Air_Temperature_C` | -5.6 | 35.03 | 0 |
| `Average_Wall_Temperature_C` | -19.975 | 39.251 | 0 |
| `Minimum_Wall_Temperature_C` | -22.29 | 37.18 | 0 |
| `Maximum_Wall_Temperature_C` | -16.5 | 42.47 | 0 |
| `Heat_Transfer_Rate_W` | -956.152 | 713.367 | 82 |
| `Average_Heat_Flux_W_m2` | -14.765 | 10.616 | 58 |
| `Maximum_Heat_Flux_W_m2` | -16.98 | 12.209 | 58 |
| `Solar_Heat_Input_W` | 540.94 | 63295.1 | 31 |
| `Total_Heat_Transferred_Wh` | -37358.5 | 26224.1 | 145 |
| `Indoor_Temperature_Rise_C` | -24.2 | 17.19 | 0 |
| `Thermal_Energy_Loss_Wh` | 0 | 37358.5 | 109 |

Physical checks:

- positive material properties, dimensions, duration, and time step: 0 violations.
- nonnegative areas, solar inputs, and wind speed: 0 violations.
- relative humidity in 0–100 percent: 0 violations.
- orientation in 0–360 degrees: 0 violations.
- opening area equals window plus door area: 0 violations.
- minimum <= average <= maximum air temperature: 0 violations.
- minimum <= average <= maximum wall temperature: 0 violations.
- nonnegative solar heat input and thermal energy loss: 0 violations.
- `Transient_24h_Subset`: 1,440 hourly records for 60 cases, hours 0–23, {'24': 60} rows per case; used for V3 case-summary training: NO.

### `ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx`

Path: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_1500_batch3_physics_informed_dataset.xlsx`  
Design sheet: `Design_Cases_Batch3_1500`; 1,500 rows × 42 columns; 449,903 bytes.
Case_ID range: `CASE_03001`–`CASE_04500`; unique 1,500; duplicate IDs 0; duplicate full rows 0.
Dtypes: `{'float64': 30, 'str': 10, 'int64': 2}`. Missing feature cells 0; missing target cells 0; nonfinite numeric cells 0.
Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`. Provenance: `{'Data_Type': ['PHYSICS_INFORMED_ESTIMATE'], 'CFD_Reference': ['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)'], 'Climate_Data_Source': ['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)'], 'Material_Data_Source': ['Standard engineering material-property handbook ranges'], 'Surrogate_Method': ['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points'], 'Batch': ['Batch_3']}`.
Materials: `['Aerated concrete / AAC', 'Aluminum', 'Brick', 'Composite insulated wall', 'Concrete', 'EPS insulation', 'Polyurethane foam (PU)', 'Rock wool / mineral wool', 'Wood / timber']`. Categories: `['Composite', 'Insulation', 'Masonry', 'Metal', 'Timber']`.
Main-sheet columns:

```text
Case_ID, Material, Material_Category, Thermal_Conductivity_W_mK, Density_kg_m3, Specific_Heat_J_kgK, Wall_Thickness_m, Shelter_Length_m, Shelter_Width_m, Shelter_Height_m, Opening_Area_m2, Window_Area_m2, Door_Area_m2, Orientation_deg, External_Temperature_C, Initial_Air_Temperature_C, Solar_Radiation_W_m2, Daily_Solar_Energy_kWh_m2, Wind_Speed_m_s, Relative_Humidity_percent, Simulation_Duration_h, Time_Step_min, Average_Air_Temperature_C, Minimum_Air_Temperature_C, Maximum_Air_Temperature_C, Average_Wall_Temperature_C, Minimum_Wall_Temperature_C, Maximum_Wall_Temperature_C, Heat_Transfer_Rate_W, Average_Heat_Flux_W_m2, Maximum_Heat_Flux_W_m2, Solar_Heat_Input_W, Total_Heat_Transferred_Wh, Indoor_Temperature_Rise_C, Thermal_Energy_Loss_Wh, Data_Type, CFD_Reference, Climate_Data_Source, Material_Data_Source, Surrogate_Method, Batch, Recommended_Split
```

Numeric ranges:

| Column | Minimum | Maximum | IQR flags retained |
|---|---:|---:|---:|
| `Thermal_Conductivity_W_mK` | 0.0201 | 219.992 | 170 |
| `Density_kg_m3` | 15.1 | 2700 | 0 |
| `Specific_Heat_J_kgK` | 800.2 | 2496.7 | 43 |
| `Wall_Thickness_m` | 0.05 | 0.4 | 0 |
| `Shelter_Length_m` | 3 | 6 | 0 |
| `Shelter_Width_m` | 2.5 | 5 | 0 |
| `Shelter_Height_m` | 2.2 | 3.5 | 0 |
| `Opening_Area_m2` | 1.55 | 16.47 | 2 |
| `Window_Area_m2` | 0 | 14.19 | 1 |
| `Door_Area_m2` | 1.5 | 3 | 0 |
| `Orientation_deg` | 0 | 315 | 0 |
| `External_Temperature_C` | -20 | 39.94 | 0 |
| `Initial_Air_Temperature_C` | 5.01 | 24.99 | 0 |
| `Solar_Radiation_W_m2` | 334 | 1333 | 0 |
| `Daily_Solar_Energy_kWh_m2` | 2.004 | 7.998 | 0 |
| `Wind_Speed_m_s` | 0 | 12 | 0 |
| `Relative_Humidity_percent` | 10 | 80 | 0 |
| `Simulation_Duration_h` | 6 | 48 | 0 |
| `Time_Step_min` | 1 | 30 | 0 |
| `Average_Air_Temperature_C` | -7.959 | 31.481 | 0 |
| `Minimum_Air_Temperature_C` | -9.35 | 30.79 | 0 |
| `Maximum_Air_Temperature_C` | -5.87 | 33.5 | 0 |
| `Average_Wall_Temperature_C` | -19.689 | 39.728 | 0 |
| `Minimum_Wall_Temperature_C` | -22.01 | 37.62 | 0 |
| `Maximum_Wall_Temperature_C` | -16.23 | 43.21 | 0 |
| `Heat_Transfer_Rate_W` | -885.79 | 782.769 | 67 |
| `Average_Heat_Flux_W_m2` | -13.491 | 11.192 | 63 |
| `Maximum_Heat_Flux_W_m2` | -15.515 | 12.871 | 63 |
| `Solar_Heat_Input_W` | 437.57 | 56979.6 | 19 |
| `Total_Heat_Transferred_Wh` | -40519.1 | 22157.9 | 157 |
| `Indoor_Temperature_Rise_C` | -23.59 | 18.41 | 0 |
| `Thermal_Energy_Loss_Wh` | 0 | 40519.1 | 121 |

Physical checks:

- positive material properties, dimensions, duration, and time step: 0 violations.
- nonnegative areas, solar inputs, and wind speed: 0 violations.
- relative humidity in 0–100 percent: 0 violations.
- orientation in 0–360 degrees: 0 violations.
- opening area equals window plus door area: 0 violations.
- minimum <= average <= maximum air temperature: 0 violations.
- minimum <= average <= maximum wall temperature: 0 violations.
- nonnegative solar heat input and thermal energy loss: 0 violations.
- `Transient_24h_Subset`: 1,440 hourly records for 60 cases, hours 0–23, {'24': 60} rows per case; used for V3 case-summary training: NO.

### `ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx`

Path: `D:\THERMOSHELTER-final(2)\THERMOSHELTER\ladakh_shelter_2000_batch4_physics_informed_dataset.xlsx`  
Design sheet: `Design_Cases_Batch4_2000`; 2,000 rows × 42 columns; 598,177 bytes.
Case_ID range: `CASE_04501`–`CASE_06500`; unique 2,000; duplicate IDs 0; duplicate full rows 0.
Dtypes: `{'float64': 30, 'str': 10, 'int64': 2}`. Missing feature cells 0; missing target cells 0; nonfinite numeric cells 0.
Data_Type: `['PHYSICS_INFORMED_ESTIMATE']`. Provenance: `{'Data_Type': ['PHYSICS_INFORMED_ESTIMATE'], 'CFD_Reference': ['Calibrated against 3 ANSYS Fluent validation cases (Aluminum/Concrete/EPS, 0.20 m, Text=35C, Tinit=20C)'], 'Climate_Data_Source': ['Representative high-altitude cold-desert climate ranges for Ladakh (not a direct NASA POWER data pull)'], 'Material_Data_Source': ['Standard engineering material-property handbook ranges'], 'Surrogate_Method': ['Physics-informed R=L/k+R_film network, log(k)-interpolated correction anchored to 3 Fluent points'], 'Batch': ['Batch_4']}`.
Materials: `['Aerated concrete / AAC', 'Aluminum', 'Brick', 'Composite insulated wall', 'Concrete', 'EPS insulation', 'Polyurethane foam (PU)', 'Rock wool / mineral wool', 'Wood / timber']`. Categories: `['Composite', 'Insulation', 'Masonry', 'Metal', 'Timber']`.
Main-sheet columns:

```text
Case_ID, Material, Material_Category, Thermal_Conductivity_W_mK, Density_kg_m3, Specific_Heat_J_kgK, Wall_Thickness_m, Shelter_Length_m, Shelter_Width_m, Shelter_Height_m, Opening_Area_m2, Window_Area_m2, Door_Area_m2, Orientation_deg, External_Temperature_C, Initial_Air_Temperature_C, Solar_Radiation_W_m2, Daily_Solar_Energy_kWh_m2, Wind_Speed_m_s, Relative_Humidity_percent, Simulation_Duration_h, Time_Step_min, Average_Air_Temperature_C, Minimum_Air_Temperature_C, Maximum_Air_Temperature_C, Average_Wall_Temperature_C, Minimum_Wall_Temperature_C, Maximum_Wall_Temperature_C, Heat_Transfer_Rate_W, Average_Heat_Flux_W_m2, Maximum_Heat_Flux_W_m2, Solar_Heat_Input_W, Total_Heat_Transferred_Wh, Indoor_Temperature_Rise_C, Thermal_Energy_Loss_Wh, Data_Type, CFD_Reference, Climate_Data_Source, Material_Data_Source, Surrogate_Method, Batch, Recommended_Split
```

Numeric ranges:

| Column | Minimum | Maximum | IQR flags retained |
|---|---:|---:|---:|
| `Thermal_Conductivity_W_mK` | 0.02 | 219.811 | 217 |
| `Density_kg_m3` | 15.2 | 2700 | 0 |
| `Specific_Heat_J_kgK` | 800.3 | 2487.2 | 72 |
| `Wall_Thickness_m` | 0.05 | 0.4 | 0 |
| `Shelter_Length_m` | 3 | 6 | 0 |
| `Shelter_Width_m` | 2.5 | 5 | 0 |
| `Shelter_Height_m` | 2.2 | 3.5 | 0 |
| `Opening_Area_m2` | 1.67 | 16.61 | 2 |
| `Window_Area_m2` | 0 | 13.98 | 1 |
| `Door_Area_m2` | 1.5 | 3 | 0 |
| `Orientation_deg` | 0 | 315 | 0 |
| `External_Temperature_C` | -19.98 | 39.98 | 0 |
| `Initial_Air_Temperature_C` | 5.01 | 24.99 | 0 |
| `Solar_Radiation_W_m2` | 333.8 | 1332.9 | 0 |
| `Daily_Solar_Energy_kWh_m2` | 2.003 | 7.997 | 0 |
| `Wind_Speed_m_s` | 0 | 12 | 0 |
| `Relative_Humidity_percent` | 10 | 80 | 0 |
| `Simulation_Duration_h` | 6 | 48 | 0 |
| `Time_Step_min` | 1 | 30 | 0 |
| `Average_Air_Temperature_C` | -7.725 | 32.892 | 0 |
| `Minimum_Air_Temperature_C` | -9.32 | 31.65 | 0 |
| `Maximum_Air_Temperature_C` | -5.65 | 34.75 | 0 |
| `Average_Wall_Temperature_C` | -19.515 | 39.616 | 0 |
| `Minimum_Wall_Temperature_C` | -21.83 | 37.76 | 0 |
| `Maximum_Wall_Temperature_C` | -16.26 | 42.94 | 0 |
| `Heat_Transfer_Rate_W` | -1152.22 | 794.991 | 132 |
| `Average_Heat_Flux_W_m2` | -13.817 | 11.02 | 110 |
| `Maximum_Heat_Flux_W_m2` | -15.89 | 12.673 | 110 |
| `Solar_Heat_Input_W` | 415.26 | 58072.1 | 38 |
| `Total_Heat_Transferred_Wh` | -40001.2 | 23929.2 | 198 |
| `Indoor_Temperature_Rise_C` | -24.54 | 18.51 | 0 |
| `Thermal_Energy_Loss_Wh` | 0 | 40001.2 | 157 |

Physical checks:

- positive material properties, dimensions, duration, and time step: 0 violations.
- nonnegative areas, solar inputs, and wind speed: 0 violations.
- relative humidity in 0–100 percent: 0 violations.
- orientation in 0–360 degrees: 0 violations.
- opening area equals window plus door area: 0 violations.
- minimum <= average <= maximum air temperature: 0 violations.
- minimum <= average <= maximum wall temperature: 0 violations.
- nonnegative solar heat input and thermal energy loss: 0 violations.
- `Transient_24h_Subset`: 1,920 hourly records for 80 cases, hours 0–23, {'24': 80} rows per case; used for V3 case-summary training: NO.

## Compatibility and combined checks

Compatibility decision: **True**. Required inputs and targets are present in all four sources. The only main-sheet column difference is optional `Batch` metadata, absent from the first 1,500-row workbook. All required feature and target dtypes match.
Raw total 6,500; unique Case_IDs 6,500; duplicate IDs 0; duplicate full rows 0; exact duplicate modeled cases 0; input signatures duplicated after 0.01 rounding 0.
Missing required feature cells 0; missing required target cells 0; nonfinite numeric cells 0. Missing nonmodel metadata cells: `{'Batch': 1500}`.
High input correlations at |r| ≥ 0.98: `[{'left': 'Opening_Area_m2', 'right': 'Window_Area_m2', 'abs_pearson_r': 0.9891827152727921}, {'left': 'Solar_Radiation_W_m2', 'right': 'Daily_Solar_Energy_kWh_m2', 'abs_pearson_r': 0.9999999819302587}]`. IQR flags are retained, not automatically discarded.

## Important provenance and scope

All four design sheets label their rows `PHYSICS_INFORMED_ESTIMATE`. Their stated climate source is representative Ladakh ranges, not a direct NASA POWER pull; material inputs use handbook ranges; the stated CFD reference is calibration against three ANSYS Fluent cases. These are not 6,500 independent ANSYS simulations or field validations.
The workbooks contain 24-hour records for sampled configurations. V3 uses only the case-level design sheets for its six summary targets; its inference helper will not return hourly temperatures.
The old 63-row and 36-row files were not present as full-feature project sources and are not included in the V3 source list.
