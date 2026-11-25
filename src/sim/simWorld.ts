/**
 * Visão 2D do mundo que a simulação precisa: altura, água, bioma, temperatura.
 * Também pré-calcula o "campo da água mais próxima" com uma busca em largura,
 * para cada criatura saber em O(1) para que lado fica a água.
 */
import { Biome } from '../world/biomes';
import { Block, faceColor } from '../world/blocks';
import type { GeneratedWorld } from '../world/worldgen';

export interface WorldMaps {
  sizeX: number;
  sizeZ: number;
  seaLevel: number;
  height: Uint8Array;
  waterTop: Uint8Array;
  biome: Uint8Array;
  /** 0..1 aproximadamente (pode ser negativo nos picos) */
  temperature: Float32Array;
  humidity: Float32Array;
  /** bloco do topo de cada coluna */
  topBlock: Uint8Array;
  /** posição das árvores (troncos), para as folhas que os cervos comem */
  trees: { x: number; z: number }[];
  /** y do bloco sólido mais alto de cada coluna CONTANDO as copas (onde um pássaro pousa) */
  canopy: Uint8Array;
}

export function mapsFromWorld(g: GeneratedWorld): WorldMaps {
  const { sizeX, sizeZ, seaLevel } = g.cfg;
  const topBlock = new Uint8Array(sizeX * sizeZ);
  const canopy = new Uint8Array(sizeX * sizeZ);
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++) {
      const i = x + z * sizeX;
      let y = g.height[i] + 14; // árvores não passam de ~12 blocos acima do chão
      while (y > g.height[i] && (g.voxels.get(x, y, z) === Block.AIR || g.voxels.get(x, y, z) === Block.WATER)) y--;
      canopy[i] = y;
    }
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++) topBlock[x + z * sizeX] = g.voxels.get(x, g.height[x + z * sizeX], z);
  return {
    sizeX, sizeZ, seaLevel, height: g.height, waterTop: g.waterTop, biome: g.biome,
    temperature: g.temperature, humidity: g.humidity, topBlock,
    canopy,
    trees: g.trees.filter((t) => t.kind !== 'cacto').map((t) => ({ x: t.x, z: t.z })),
  };
}

export class SimWorld {
  readonly sx: number;
  readonly sz: number;
  /** índice da célula de água mais próxima (-1 se não houver) */
  readonly nearestWater: Int32Array;
  /** quão boa a célula é para grama crescer (0 = nada cresce) */
  readonly fertility: Float32Array;
  /** construções: 0 = livre, 1 = cerca (bloqueia animais), 2 = parede (bloqueia todos) */
  readonly structure: Uint8Array;
  /** células com pedra exposta (onde humanos tiram pedra) */
  readonly stoneCells: Int32Array;
  /** cor do chão de cada célula (r, g, b em 0..1): é contra ela que a camuflagem funciona */
  readonly ground: Float32Array;

  constructor(readonly maps: WorldMaps) {
    this.sx = maps.sizeX;
    this.sz = maps.sizeZ;
    this.nearestWater = this.computeNearestWater();
    this.fertility = this.computeFertility();
    this.structure = new Uint8Array(this.sx * this.sz);
    const stones: number[] = [];
    for (let i = 0; i < this.sx * this.sz; i++) if (!this.isWater(i) && maps.topBlock[i] === Block.STONE) stones.push(i);
    this.stoneCells = Int32Array.from(stones);
    this.ground = new Float32Array(this.sx * this.sz * 3);
    for (let i = 0; i < this.sx * this.sz; i++) {
      const rgb = faceColor(this.isWater(i) ? Block.WATER : maps.topBlock[i], 0);
      this.ground[i * 3] = rgb[0] / 255;
      this.ground[i * 3 + 1] = rgb[1] / 255;
      this.ground[i * 3 + 2] = rgb[2] / 255;
    }
  }

  /**
   * Camuflagem (0..1) de uma cor contra o chão da célula i:
   * 1 = idêntica ao chão, 0 = diferença de cor ≥ 0,5 (distância RGB).
   */
  camo(r: number, g: number, b: number, i: number): number {
    const dr = r - this.ground[i * 3], dg = g - this.ground[i * 3 + 1], db = b - this.ground[i * 3 + 2];
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    return d >= 0.5 ? 0 : 1 - d / 0.5;
  }

  idx(x: number, z: number): number {
    return Math.floor(x) + Math.floor(z) * this.sx;
  }

  inside(x: number, z: number): boolean {
    return x >= 1 && z >= 1 && x < this.sx - 1 && z < this.sz - 1;
  }

  isWater(i: number): boolean {
    return this.maps.waterTop[i] > this.maps.height[i];
  }

  /** onde um pássaro pousa (topo da copa ou do chão); sobre a água devolve a superfície */
  perchY(i: number): number {
    return Math.max(this.maps.canopy[i], this.maps.waterTop[i]) + 1;
  }

  /** faixa onde um peixe pode nadar na coluna i: [fundo, superfície] */
  swimRange(i: number): [number, number] {
    return [this.maps.height[i] + 1.25, this.maps.waterTop[i] + 0.75];
  }

  /** altura onde a criatura pisa (topo do bloco sólido) */
  groundY(x: number, z: number): number {
    return this.maps.height[this.idx(x, z)] + 1;
  }

  /** Temperatura do ar em °C: mapa do mundo, mais frio à noite. */
  airTemp(i: number, night: number): number {
    return -8 + 42 * this.maps.temperature[i] - 6 * night;
  }

  private computeNearestWater(): Int32Array {
    const N = this.sx * this.sz;
    const near = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) if (this.isWater(i)) { near[i] = i; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++];
      const x = i % this.sx, z = (i / this.sx) | 0;
      const src = near[i];
      if (x > 0 && near[i - 1] < 0) { near[i - 1] = src; queue[tail++] = i - 1; }
      if (x < this.sx - 1 && near[i + 1] < 0) { near[i + 1] = src; queue[tail++] = i + 1; }
      if (z > 0 && near[i - this.sx] < 0) { near[i - this.sx] = src; queue[tail++] = i - this.sx; }
      if (z < this.sz - 1 && near[i + this.sx] < 0) { near[i + this.sx] = src; queue[tail++] = i + this.sx; }
    }
    return near;
  }

  private computeFertility(): Float32Array {
    const N = this.sx * this.sz;
    const f = new Float32Array(N);
    const { topBlock, biome, humidity } = this.maps;
    for (let i = 0; i < N; i++) {
      if (this.isWater(i)) continue;
      const t = topBlock[i];
      let base = 0;
      if (t === Block.GRASS) base = biome[i] === Biome.MOUNTAIN ? 0.55 : 0.9;
      else if (t === Block.FOREST_GRASS) base = 1;
      else if (t === Block.SWAMP_GRASS) base = 0.85;
      else if (t === Block.SAND && biome[i] === Biome.DESERT) base = 0.06;
      if (base === 0) continue;
      // umidade e água por perto ajudam
      const w = this.nearestWater[i];
      const dw = w < 0 ? 99 : Math.hypot((w % this.sx) - (i % this.sx), ((w / this.sx) | 0) - ((i / this.sx) | 0));
      f[i] = base * (0.65 + 0.35 * Math.min(1, humidity[i])) * (dw < 8 ? 1.25 : 1);
    }
    return f;
  }
}
