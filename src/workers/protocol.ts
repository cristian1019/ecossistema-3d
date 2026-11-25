/**
 * Mensagens trocadas entre a thread principal e os workers do mundo.
 * Os buffers (Float32Array etc.) são "transferidos": mudam de dono sem cópia.
 */
import type { MeshBuffers } from '../world/mesher';
import type { WorldConfig } from '../world/voxelWorld';

export type ToWorldWorker =
  /** blocos colocados pelas construções: [x, y, z, bloco, ...] */
  | { type: 'edit'; edits: Int32Array }
  | {
      type: 'generate';
      seed: number;
      /** este worker gera as malhas dos chunks com (índice % workers === part) */
      part: number;
      workers: number;
      /** só um worker devolve os mapas 2D (altura, biomas...) */
      sendMeta: boolean;
    };

export interface WorldMeta {
  seed: number;
  cfg: WorldConfig;
  height: Uint8Array;
  waterTop: Uint8Array;
  waterKind: Uint8Array;
  biome: Uint8Array;
  rivers: number;
  lakes: number;
  trees: number;
  genMs: number;
}

export type FromWorldWorker =
  | { type: 'meta'; meta: WorldMeta }
  | { type: 'chunk'; cx: number; cz: number; opaque: MeshBuffers | null; water: MeshBuffers | null }
  | { type: 'done'; part: number; ms: number };
