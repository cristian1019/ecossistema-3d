/**
 * Gerador de números aleatórios com semente (seed).
 *
 * Math.random() não pode ser "repetido": cada execução dá números diferentes.
 * Para que um mundo possa ser recriado exatamente igual, toda a aleatoriedade
 * do projeto passa por este gerador determinístico: mesma seed → mesma sequência.
 *
 * Algoritmo: mulberry32 (32 bits de estado, rápido e com boa distribuição
 * para simulação; não serve para criptografia).
 */

export interface Rng {
  /** Número em [0, 1) */
  next(): number;
  /** Inteiro em [min, max] (inclusivo) */
  int(min: number, max: number): number;
  /** Número em [min, max) */
  range(min: number, max: number): number;
  /** Aproximação de normal padrão (média 0, desvio ~1) */
  gauss(): number;
  /** Estado interno atual (para salvar/restaurar) */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    // soma de 3 uniformes: barata e suficiente (mesma ideia do protótipo 2D)
    gauss: () => (next() + next() + next() - 1.5) * 2,
    state: () => s,
  };
}

/**
 * Converte qualquer texto (ex.: "ilha-azul") num inteiro de 32 bits.
 * Hash FNV-1a seguido de uma mistura final para espalhar os bits.
 */
export function hashSeed(text: string): number {
  // se o usuário digitou um número, usa o próprio número
  if (/^\d+$/.test(text.trim())) return Number(text.trim()) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}
