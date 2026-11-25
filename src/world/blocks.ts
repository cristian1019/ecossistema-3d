/**
 * Tipos de bloco. Cada voxel do mundo guarda 1 byte com um destes IDs.
 * As cores são da paleta original do projeto (sem texturas: a "textura"
 * é feita no shader com variação por bloco e contorno leve).
 */
export const enum Block {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  SAND = 3,
  STONE = 4,
  SNOW = 5,
  WATER = 6,
  WOOD = 7,
  LEAVES = 8,
  PINE_LEAVES = 9,
  FOREST_GRASS = 10,
  SWAMP_GRASS = 11,
  MUD = 12,
  GRAVEL = 13,
  CACTUS = 14,
  SWAMP_LEAVES = 15,
  // 16+ reservado para os blocos construídos pelos humanos (Fase 5)
}

export const BLOCK_COUNT = 32;

export const BLOCK_NAMES: Record<number, string> = {
  [Block.AIR]: 'ar',
  [Block.GRASS]: 'grama',
  [Block.DIRT]: 'terra',
  [Block.SAND]: 'areia',
  [Block.STONE]: 'pedra',
  [Block.SNOW]: 'neve',
  [Block.WATER]: 'água',
  [Block.WOOD]: 'madeira',
  [Block.LEAVES]: 'folhas',
  [Block.PINE_LEAVES]: 'folhas de pinheiro',
  [Block.FOREST_GRASS]: 'grama da floresta',
  [Block.SWAMP_GRASS]: 'grama do pântano',
  [Block.MUD]: 'lama',
  [Block.GRAVEL]: 'cascalho',
  [Block.CACTUS]: 'cacto',
  [Block.SWAMP_LEAVES]: 'folhas do pântano',
};

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Cor de cada face: [topo, lados, base], em sRGB 0..255 */
const FACE_COLORS: Record<number, [RGB, RGB, RGB]> = {
  [Block.GRASS]: [hex(0x7fba52), hex(0x7f8a4c), hex(0x7a5a3a)],
  [Block.FOREST_GRASS]: [hex(0x5c9a3e), hex(0x6c7a40), hex(0x6e5236)],
  [Block.SWAMP_GRASS]: [hex(0x6a7f3f), hex(0x5f633a), hex(0x54452f)],
  [Block.DIRT]: [hex(0x7f5d3c), hex(0x7a5a3a), hex(0x6f5235)],
  [Block.SAND]: [hex(0xe6d49a), hex(0xd9c68b), hex(0xcdb97f)],
  [Block.STONE]: [hex(0x92959a), hex(0x85888d), hex(0x7a7d82)],
  [Block.SNOW]: [hex(0xf4f7fa), hex(0xdfe6ec), hex(0xc9d1d8)],
  [Block.WATER]: [hex(0x3f86c8), hex(0x3a78b8), hex(0x336aa5)],
  [Block.WOOD]: [hex(0xa98454), hex(0x6e4c2c), hex(0xa98454)],
  [Block.LEAVES]: [hex(0x4c9a3c), hex(0x438a35), hex(0x3b7a2f)],
  [Block.PINE_LEAVES]: [hex(0x2f6e48), hex(0x2a6341), hex(0x24563a)],
  [Block.SWAMP_LEAVES]: [hex(0x5a7a34), hex(0x506d2f), hex(0x46602a)],
  [Block.MUD]: [hex(0x5e4b35), hex(0x574531), hex(0x4f3f2d)],
  [Block.GRAVEL]: [hex(0x8f8a82), hex(0x86817a), hex(0x7d7871)],
  [Block.CACTUS]: [hex(0x7cb35c), hex(0x4f9a4a), hex(0x4f9a4a)],
};

const MAGENTA: [RGB, RGB, RGB] = [hex(0xff00ff), hex(0xff00ff), hex(0xff00ff)];

/** face: 0 = topo, 1 = lado, 2 = base */
export function faceColor(id: number, face: 0 | 1 | 2): RGB {
  return (FACE_COLORS[id] ?? MAGENTA)[face];
}

/** Tabela rápida: o bloco é opaco (esconde a face do vizinho)? */
export const OPAQUE = new Uint8Array(BLOCK_COUNT);
for (let i = 1; i < BLOCK_COUNT; i++) OPAQUE[i] = i === Block.WATER ? 0 : 1;
