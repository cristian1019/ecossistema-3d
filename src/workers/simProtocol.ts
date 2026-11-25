/**
 * Mensagens entre a tela e o worker da simulação.
 *
 * As criaturas vão num Float32Array "achatado" (12 números por criatura),
 * transferido sem cópia ~20 vezes por segundo. Muito mais barato que mandar objetos.
 */
import type { Genes } from '../sim/genome';
import type { StatsSample } from '../sim/simulation';

/** layout de cada criatura no snapshot */
export const SNAP = {
  STRIDE: 12,
  ID: 0, X: 1, Y: 2, Z: 3, YAW: 4, SPECIES: 5, SCALE: 6, COLOR: 7, FLAGS: 8, SPEED: 9, AGE: 10,
} as const;

/** bits do campo FLAGS */
export const FLAG = {
  SLEEP: 1, EAT: 2, DRINK: 4, PREGNANT: 8, MALE: 16, YOUNG: 32, ATTACK: 64, NURSE: 128, FLY: 256,
} as const;

/** layout de cada arbusto: x, y, z, crescimento, frutas */
export const BUSH_STRIDE = 5;
/** layout de cada carcaça: x, y, z, fração de carne que sobra, espécie */
export const CARCASS_STRIDE = 5;

export interface SimSettings {
  repopulate: boolean;
  instincts: boolean;
  mutationRate: number;
}

export type ToSim =
  | { type: 'init'; seed: number; settings: SimSettings }
  | { type: 'speed'; speed: number }
  | { type: 'select'; id: number | null }
  | { type: 'settings'; settings: Partial<SimSettings> }
  | { type: 'reset' };

export interface CreatureDetail {
  id: number;
  species: number;
  sex: 0 | 1;
  alive: boolean;
  cause: string | null;
  age: number;
  maxAge: number;
  maturity: number;
  generation: number;
  mother: number;
  father: number;
  children: number;
  childIds: number[];
  genes: Genes;
  energy: number;
  maxEnergy: number;
  hydration: number;
  fatigue: number;
  coldStress: number;
  temp: number;
  /** camuflagem no lugar onde está (0..1) */
  camo: number;
  action: string;
  pregnantLeft: number | null;
  input: Float32Array;
  hidden: Float32Array;
  output: Float32Array;
  w1: Float32Array;
  w2: Float32Array;
}

export type FromSim =
  | { type: 'ready'; ms: number }
  | {
      type: 'frame';
      time: number;
      /** segundos de simulação por segundo real, medidos de verdade */
      realSpeed: number;
      count: number;
      creatures: Float32Array;
      stats: StatsSample[];
      events: { t: number; text: string }[];
    }
  | { type: 'plants'; bushes: Float32Array; grass: Uint8Array | null; carcasses: Float32Array }
  | { type: 'detail'; detail: CreatureDetail | null };
