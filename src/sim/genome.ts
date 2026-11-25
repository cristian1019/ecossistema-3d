/**
 * Genoma = genes de corpo + pesos do cérebro.
 *
 * Cada gene tem limites (min/max) iguais para todas as espécies; o que muda
 * entre espécies é o valor inicial (ver species.ts) e o que o gene "custa".
 */
import type { Rng } from '../core/rng';
import { crossoverBrain, mutateBrain, cloneBrain, type Brain } from './neural';

export const GENE_KEYS = [
  'size', 'speed', 'vision', 'metabolism', 'fur', 'maxAge', 'litter', 'r', 'g', 'b',
] as const;
export type GeneKey = (typeof GENE_KEYS)[number];
export type Genes = Record<GeneKey, number>;

export interface GeneDef {
  label: string;
  min: number;
  max: number;
  /** formato para mostrar na ficha */
  fmt: (v: number) => string;
  /** mutação relativa (multiplica) ou absoluta (soma) */
  mode: 'rel' | 'abs';
}

const f1 = (v: number) => v.toFixed(1).replace('.', ',');
const f2 = (v: number) => v.toFixed(2).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)}%`;

export const GENE_DEFS: Record<GeneKey, GeneDef> = {
  size: { label: 'Tamanho', min: 0.4, max: 2.5, fmt: f2, mode: 'rel' },
  speed: { label: 'Velocidade', min: 0.5, max: 14, fmt: (v) => `${f1(v)} b/s`, mode: 'rel' },
  vision: { label: 'Visão', min: 3, max: 40, fmt: (v) => `${Math.round(v)} blocos`, mode: 'rel' },
  metabolism: { label: 'Metabolismo', min: 0.4, max: 2.5, fmt: f2, mode: 'rel' },
  fur: { label: 'Resistência ao frio', min: 0, max: 1, fmt: pct, mode: 'abs' },
  maxAge: { label: 'Idade máxima', min: 200, max: 12000, fmt: (v) => `${(v / 240).toFixed(1).replace('.', ',')} dias`, mode: 'rel' },
  litter: { label: 'Ninhada', min: 1, max: 8, fmt: f1, mode: 'rel' },
  r: { label: 'Cor (vermelho)', min: 0, max: 1, fmt: pct, mode: 'abs' },
  g: { label: 'Cor (verde)', min: 0, max: 1, fmt: pct, mode: 'abs' },
  b: { label: 'Cor (azul)', min: 0, max: 1, fmt: pct, mode: 'abs' },
};

export interface Genome {
  genes: Genes;
  brain: Brain;
}

const clampGene = (k: GeneKey, v: number) => Math.min(GENE_DEFS[k].max, Math.max(GENE_DEFS[k].min, v));

/**
 * Crossover dos genes de corpo: cada gene vem de um dos pais, ou (30% das vezes)
 * é a média dos dois — herança "misturada", como altura em humanos.
 */
export function crossoverGenes(a: Genes, b: Genes, rng: Rng): Genes {
  const out = {} as Genes;
  for (const k of GENE_KEYS) {
    const r = rng.next();
    out[k] = r < 0.35 ? a[k] : r < 0.7 ? b[k] : (a[k] + b[k]) / 2;
  }
  return out;
}

/** Mutação gaussiana: genes relativos variam em %, os absolutos (cor, pelagem) somam um pouco. */
export function mutateGenes(g: Genes, rng: Rng, rate: number): void {
  for (const k of GENE_KEYS) {
    const d = GENE_DEFS[k];
    if (d.mode === 'rel') g[k] = clampGene(k, g[k] * (1 + rng.gauss() * 0.06 * rate));
    else g[k] = clampGene(k, g[k] + rng.gauss() * 0.04 * rate);
  }
}

/** Filho = crossover(pai, mãe) + mutação. `rate` = multiplicador da taxa de mutação (1 = normal). */
export function makeChild(mother: Genome, father: Genome, rng: Rng, rate = 1): Genome {
  const genes = crossoverGenes(mother.genes, father.genes, rng);
  mutateGenes(genes, rng, rate);
  const brain = crossoverBrain(mother.brain, father.brain, rng);
  mutateBrain(brain, rng, 0.1 * rate, 0.3);
  return { genes, brain };
}

/** Cópia com mutação (usada para repovoar a partir dos melhores genomas guardados). */
export function mutatedCopy(src: Genome, rng: Rng, rate = 1): Genome {
  const genes = { ...src.genes };
  mutateGenes(genes, rng, rate);
  const brain = cloneBrain(src.brain);
  mutateBrain(brain, rng, 0.1 * rate, 0.3);
  return { genes, brain };
}
