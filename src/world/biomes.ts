export const enum Biome {
  OCEAN = 0,
  BEACH = 1,
  PLAINS = 2,
  FOREST = 3,
  MOUNTAIN = 4,
  DESERT = 5,
  SWAMP = 6,
}

export const BIOME_COUNT = 7;

export const BIOME_INFO: { name: string; color: string }[] = [
  { name: 'Oceano', color: '#2f6fae' },
  { name: 'Praia', color: '#e6d49a' },
  { name: 'Planície', color: '#8cc35c' },
  { name: 'Floresta', color: '#3f7f34' },
  { name: 'Montanha', color: '#9a9ca0' },
  { name: 'Deserto', color: '#e0b863' },
  { name: 'Pântano', color: '#5f6d3a' },
];

/** Tipo de água de uma coluna do mapa */
export const enum WaterKind {
  NONE = 0,
  OCEAN = 1,
  RIVER = 2,
  LAKE = 3,
}
