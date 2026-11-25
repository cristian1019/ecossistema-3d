import { Block } from './blocks';

export interface WorldConfig {
  sizeX: number;
  sizeZ: number;
  /** altura máxima (número de camadas em Y) */
  height: number;
  /** Y da superfície do mar (último bloco de água do oceano) */
  seaLevel: number;
  chunkSize: number;
}

/** Mundo padrão: 512×512 blocos, 96 de altura, chunks 32×32 → 16×16 = 256 chunks */
export const DEFAULT_CONFIG: WorldConfig = {
  sizeX: 512,
  sizeZ: 512,
  height: 96,
  seaLevel: 34,
  chunkSize: 32,
};

/**
 * Grade de voxels: 1 byte por bloco num único Uint8Array.
 * Índice = x + sizeX * (z + sizeZ * y)  → camadas horizontais contíguas.
 * 512 × 512 × 96 ≈ 25 MB, cabe tranquilo na memória e é rápido de percorrer.
 */
export class VoxelWorld {
  readonly cfg: WorldConfig;
  readonly blocks: Uint8Array;
  private readonly layer: number;

  constructor(cfg: WorldConfig, blocks?: Uint8Array) {
    this.cfg = cfg;
    this.layer = cfg.sizeX * cfg.sizeZ;
    this.blocks = blocks ?? new Uint8Array(this.layer * cfg.height);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && z >= 0 && y >= 0 && x < this.cfg.sizeX && z < this.cfg.sizeZ && y < this.cfg.height;
  }

  /**
   * Lê um bloco. Fora do mundo: abaixo de y=0 é "pedra" (nunca desenhamos o fundo),
   * acima do teto e nas laterais é ar (o mundo aparece como uma maquete recortada).
   */
  get(x: number, y: number, z: number): number {
    if (y < 0) return Block.STONE;
    if (y >= this.cfg.height || x < 0 || z < 0 || x >= this.cfg.sizeX || z >= this.cfg.sizeZ) return Block.AIR;
    return this.blocks[x + this.cfg.sizeX * (z + this.cfg.sizeZ * y)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[x + this.cfg.sizeX * (z + this.cfg.sizeZ * y)] = id;
  }

  get chunksX(): number {
    return Math.ceil(this.cfg.sizeX / this.cfg.chunkSize);
  }
  get chunksZ(): number {
    return Math.ceil(this.cfg.sizeZ / this.cfg.chunkSize);
  }
}
