/** Original material property values already used by the THERMOSHELTER model. */
export const FALLBACK_MATERIALS = {
  stone: { name: 'Stone', category: 'Massive', k: 1.70, rho: 2200, cp: 840, t: 0.30, alpha: 0.65 },
  brick: { name: 'Brick', category: 'Masonry', k: 0.72, rho: 1800, cp: 840, t: 0.20, alpha: 0.55 },
  concrete: { name: 'Concrete', category: 'Structural', k: 1.40, rho: 2300, cp: 880, t: 0.10, alpha: 0.60 },
  adobe: { name: 'Adobe', category: 'Earth', k: 0.43, rho: 1600, cp: 900, t: 0.30, alpha: 0.70 },
  rammed: { name: 'Rammed Earth', category: 'Earth', k: 0.80, rho: 2000, cp: 900, t: 0.30, alpha: 0.65 },
  timber: { name: 'Timber', category: 'Bio-based', k: 0.13, rho: 550, cp: 1600, t: 0.10, alpha: 0.55 },
  insulation: { name: 'Insulation', category: 'Insulation', k: 0.035, rho: 40, cp: 1400, t: 0.05, alpha: 0.20 },
};
