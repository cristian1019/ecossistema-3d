import { beforeAll, describe, expect, it } from 'vitest';
import { generateWorld, type GeneratedWorld } from '../src/world/worldgen';
import { Biome, WaterKind } from '../src/world/biomes';
import { Block } from '../src/world/blocks';
import { DEFAULT_CONFIG, type WorldConfig } from '../src/world/voxelWorld';

const SMALL: WorldConfig = { sizeX: 128, sizeZ: 128, height: 64, seaLevel: 24, chunkSize: 32 };

describe('geração do mundo (mundo pequeno 128×128)', () => {
  it('a mesma seed gera exatamente o mesmo mundo', () => {
    const a = generateWorld(1234, SMALL);
    const b = generateWorld(1234, SMALL);
    expect(a.voxels.blocks).toEqual(b.voxels.blocks);
    expect(a.biome).toEqual(b.biome);
    expect(a.trees.length).toBe(b.trees.length);
  });

  it('seeds diferentes geram mundos diferentes', () => {
    const a = generateWorld(1, SMALL);
    const b = generateWorld(2, SMALL);
    expect(a.height).not.toEqual(b.height);
  });

  it('o mapa de altura bate com os voxels (topo sólido e ar/água acima)', () => {
    const g = generateWorld(7, SMALL);
    for (let i = 0; i < 300; i++) {
      const x = (i * 37) % SMALL.sizeX, z = (i * 91) % SMALL.sizeZ;
      const h = g.height[x + z * SMALL.sizeX];
      const top = g.voxels.get(x, h, z);
      expect(top).not.toBe(Block.AIR);
      expect(top).not.toBe(Block.WATER);
      const above = g.voxels.get(x, h + 1, z);
      expect([Block.AIR, Block.WATER, Block.WOOD, Block.CACTUS]).toContain(above);
    }
  });
});

describe('geração do mundo (tamanho real 512×512)', () => {
  let g: GeneratedWorld;
  beforeAll(() => {
    g = generateWorld(42, DEFAULT_CONFIG);
  });

  it('a borda do mapa é oceano profundo', () => {
    const { sizeX: SX, sizeZ: SZ, seaLevel: SEA } = DEFAULT_CONFIG;
    for (let k = 0; k < SX; k++) {
      for (const [x, z] of [[k, 0], [k, SZ - 1], [0, k], [SX - 1, k]]) {
        const i = x + z * SX;
        expect(g.waterKind[i]).toBe(WaterKind.OCEAN);
        expect(g.height[i]).toBeLessThanOrEqual(SEA - 10);
      }
    }
  });

  it('tem todos os 7 biomas', () => {
    const present = new Set(g.biome);
    for (const b of [Biome.OCEAN, Biome.BEACH, Biome.PLAINS, Biome.FOREST, Biome.MOUNTAIN, Biome.DESERT, Biome.SWAMP]) {
      expect(present.has(b)).toBe(true);
    }
  });

  it('tem rios e lagos com água doce acima do nível do mar', () => {
    expect(g.rivers).toBeGreaterThan(0);
    expect(g.lakes).toBeGreaterThan(0);
    let fresh = 0;
    for (let i = 0; i < g.waterKind.length; i++) {
      if (g.waterKind[i] === WaterKind.RIVER && g.waterTop[i] > DEFAULT_CONFIG.seaLevel) fresh++;
    }
    expect(fresh).toBeGreaterThan(100);
  });

  it('rios e lagos têm o leito escavado abaixo da superfície da água', () => {
    let checked = 0;
    for (let i = 0; i < g.waterKind.length; i++) {
      const k = g.waterKind[i];
      if (k === WaterKind.RIVER || k === WaterKind.LAKE) {
        expect(g.waterTop[i]).toBeGreaterThan(g.height[i]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('as árvores ficam sobre o chão e não dentro da água', () => {
    expect(g.trees.length).toBeGreaterThan(500);
    for (const t of g.trees.slice(0, 200)) {
      const below = g.voxels.get(t.x, t.y - 1, t.z);
      expect(below).not.toBe(Block.WATER);
      expect(below).not.toBe(Block.AIR);
      expect([Block.WOOD, Block.CACTUS]).toContain(g.voxels.get(t.x, t.y, t.z));
    }
  });
});
