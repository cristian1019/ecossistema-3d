import { describe, expect, it } from 'vitest';
import { meshChunk, meshChunkAll, type MeshBuffers } from '../src/world/mesher';
import { VoxelWorld, type WorldConfig } from '../src/world/voxelWorld';
import { Block, OPAQUE } from '../src/world/blocks';
import { generateWorld } from '../src/world/worldgen';

const CFG: WorldConfig = { sizeX: 32, sizeZ: 32, height: 32, seaLevel: 8, chunkSize: 32 };

/** soma das áreas dos retângulos (em faces de bloco) */
function area(m: MeshBuffers | null): number {
  if (!m) return 0;
  let total = 0;
  for (let q = 0; q < m.quads; q++) {
    const p = m.positions;
    const b = q * 12;
    const ax = p[b + 3] - p[b], ay = p[b + 4] - p[b + 1], az = p[b + 5] - p[b + 2];
    const bx = p[b + 9] - p[b], by = p[b + 10] - p[b + 1], bz = p[b + 11] - p[b + 2];
    total += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  }
  return total;
}

/** contagem "ingênua": quantas faces de bloco opaco encostam num bloco não opaco */
function naiveFaces(w: VoxelWorld): number {
  let n = 0;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let y = 0; y < w.cfg.height; y++)
    for (let z = 0; z < w.cfg.sizeZ; z++)
      for (let x = 0; x < w.cfg.sizeX; x++) {
        if (!OPAQUE[w.get(x, y, z)]) continue;
        for (const [dx, dy, dz] of dirs) if (!OPAQUE[w.get(x + dx, y + dy, z + dz)]) n++;
      }
  return n;
}

describe('greedy meshing', () => {
  it('um bloco sozinho vira 6 retângulos (um por face)', () => {
    const w = new VoxelWorld(CFG);
    w.set(5, 5, 5, Block.STONE);
    const m = meshChunk(w, 0, 0, 'opaque')!;
    expect(m.quads).toBe(6);
    expect(m.indices.length).toBe(36);
  });

  it('um cubo 4×4×4 também vira só 6 retângulos', () => {
    const w = new VoxelWorld(CFG);
    for (let y = 4; y < 8; y++) for (let z = 4; z < 8; z++) for (let x = 4; x < 8; x++) w.set(x, y, z, Block.STONE);
    const m = meshChunk(w, 0, 0, 'opaque')!;
    expect(m.quads).toBe(6);
    expect(area(m)).toBe(6 * 16);
  });

  it('um chão plano 32×32 vira 6 retângulos em vez de milhares de faces', () => {
    const w = new VoxelWorld(CFG);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) w.set(x, 3, z, Block.GRASS);
    const m = meshChunk(w, 0, 0, 'opaque')!;
    expect(naiveFaces(w)).toBe(32 * 32 * 2 + 32 * 4);
    expect(m.quads).toBe(6);
  });

  it('blocos diferentes não são fundidos', () => {
    const w = new VoxelWorld(CFG);
    w.set(5, 5, 5, Block.STONE);
    w.set(6, 5, 5, Block.SAND);
    const m = meshChunk(w, 0, 0, 'opaque')!;
    // topo, base, frente e trás: 2 cada (pedra + areia); as pontas: 1 cada
    expect(m.quads).toBe(10);
  });

  it('não deixa buracos: a área total é igual à contagem ingênua de faces', () => {
    const g = generateWorld(99, { sizeX: 32, sizeZ: 32, height: 48, seaLevel: 16, chunkSize: 32 });
    const m = meshChunk(g.voxels, 0, 0, 'opaque');
    expect(area(m)).toBe(naiveFaces(g.voxels));
  });

  it('em terreno real o greedy reduz bastante o número de retângulos', () => {
    const g = generateWorld(5, { sizeX: 64, sizeZ: 64, height: 64, seaLevel: 20, chunkSize: 32 });
    let quads = 0, faces = 0;
    for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 2; cx++) {
      const m = meshChunk(g.voxels, cx, cz, 'opaque');
      quads += m?.quads ?? 0;
      faces += area(m);
    }
    expect(faces).toBe(naiveFaces(g.voxels));
    expect(quads).toBeLessThan(faces * 0.6);
  });

  it('água: só gera as faces que encostam no ar', () => {
    const w = new VoxelWorld(CFG);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      w.set(x, 0, z, Block.SAND);
      w.set(x, 1, z, Block.WATER);
      w.set(x, 2, z, Block.WATER);
    }
    const { opaque, water } = meshChunkAll(w, 0, 0);
    // topo 1 + 4 laterais (bordas do mundo, 2 camadas de altura cada = 1 retângulo)
    expect(water!.quads).toBe(5);
    // a areia embaixo da água: só o fundo do mundo é escondido; a face de cima toca a água → desenhada
    expect(opaque!.quads).toBe(5);
  });

  it('cantos encostados em outros blocos ficam mais escuros (oclusão de ambiente)', () => {
    const w = new VoxelWorld(CFG);
    w.set(5, 5, 5, Block.STONE);
    w.set(6, 6, 5, Block.STONE); // bloco na diagonal acima → escurece dois cantos do topo do primeiro
    const m = meshChunk(w, 0, 0, 'opaque')!;
    // olha só os vértices do TOPO do bloco de baixo (normal +Y, altura 6, x entre 5 e 6)
    const topRed: number[] = [];
    for (let v = 0; v < m.positions.length / 3; v++) {
      const isTop = m.normals[v * 3 + 1] === 127 && m.positions[v * 3 + 1] === 6 && m.positions[v * 3] <= 6;
      if (isTop) topRed.push(m.colors[v * 3]);
    }
    expect(topRed.length).toBe(4);
    const lit = 0x92; // cor do topo da pedra sem sombra
    expect(topRed.filter((r) => r === lit).length).toBe(2); // cantos longe do vizinho
    expect(topRed.filter((r) => r < lit).length).toBe(2); // cantos encostados: mais escuros
  });
});
