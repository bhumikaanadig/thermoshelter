# THERMOSHELTER — React

SIH26051: Software Based Model Development for Design of Area Specific Shelter for Thermal Comfort Maintenance.

## Run in VS Code

1. Extract this ZIP.
2. Open the extracted `THERMOSHELTER` folder in VS Code.
3. Open Terminal in that folder.
4. Run:

```bash
npm install
npm run dev
```

5. Open the localhost URL shown by Vite.

## Included

- React + Vite single web application
- Interactive 3D shelter model with Three.js / React Three Fiber
- Shelter configuration workflow
- Reference climate profiles
- Material library
- Browser thermal-analysis prototype
- 24-hour thermal response visualization
- Design comparison
- Parametric optimization and recommendation
- ANSYS deployment / validation workflow page
- Engineering report / print view

## ANSYS status

The application is structured so ANSYS can be connected as the high-fidelity simulation/validation environment. The current browser calculation is a prototype model and does not claim to be a live ANSYS run. Real ANSYS geometry, mesh, temperature contour, heat-flux and validation datasets can be added under `public/ansys/` and connected to the backend/simulation manager in the next integration stage.
