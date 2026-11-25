import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { crossoverGenes, GENE_DEFS, GENE_KEYS, makeChild, mutateGenes, mutatedCopy, type Genes } from '../src/sim/genome';
import { randomBrain } from '../src/sim/neural';
import { SPECIES } from '../src/sim/species';

const rabbit = (): Genes => ({ ...SPECIES[0].genes });
const deerish = (): Genes => ({ ...SPECIES[1].genes });

describe('genes: crossover e mutação', () => {
  it('crossover: cada gene vem do pai, da mãe ou é a média dos dois', () => {
    const a = rabbit(), b = deerish();
    for (let s = 0; s < 30; s++) {
      const c = crossoverGenes(a, b, createRng(s));
      for (const k of GENE_KEYS) expect([a[k], b[k], (a[k] + b[k]) / 2]).toContain(c[k]);
    }
  });

  it('mutação mantém todos os genes dentro dos limites', () => {
    const g = rabbit();
    const rng = createRng(1);
    for (let t = 0; t < 2000; t++) mutateGenes(g, rng, 5);
    for (const k of GENE_KEYS) {
      expect(g[k]).toBeGreaterThanOrEqual(GENE_DEFS[k].min);
      expect(g[k]).toBeLessThanOrEqual(GENE_DEFS[k].max);
    }
  });

  it('mutação muda os genes só um pouco (pequenas variações)', () => {
    const g = rabbit();
    mutateGenes(g, createRng(2), 1);
    expect(g.speed).not.toBe(SPECIES[0].genes.speed);
    expect(Math.abs(g.speed / SPECIES[0].genes.speed - 1)).toBeLessThan(0.3);
  });

  it('filho é determinístico dada a mesma seed, e não altera os pais', () => {
    const shape = { inputs: 4, hidden: 3, outputs: 2 };
    const mom = { genes: rabbit(), brain: randomBrain(shape, createRng(1)) };
    const dad = { genes: rabbit(), brain: randomBrain(shape, createRng(2)) };
    dad.genes.speed = 9;
    const momBefore = mom.brain.w1.slice();
    const c1 = makeChild(mom, dad, createRng(7));
    const c2 = makeChild(mom, dad, createRng(7));
    expect(c1.genes).toEqual(c2.genes);
    expect(c1.brain.w1).toEqual(c2.brain.w1);
    expect(mom.brain.w1).toEqual(momBefore);
  });

  it('a evolução funciona: selecionar os mais rápidos aumenta a velocidade média', () => {
    // mini "seleção artificial" só com o genoma: a cada geração, os 20% mais rápidos se reproduzem
    const rng = createRng(3);
    const shape = { inputs: 2, hidden: 2, outputs: 1 };
    let pop = Array.from({ length: 60 }, () => ({ genes: rabbit(), brain: randomBrain(shape, rng) }));
    pop.forEach((p) => mutateGenes(p.genes, rng, 2));
    const avg = () => pop.reduce((s, p) => s + p.genes.speed, 0) / pop.length;
    const start = avg();
    for (let gen = 0; gen < 25; gen++) {
      const best = [...pop].sort((a, b) => b.genes.speed - a.genes.speed).slice(0, 12);
      pop = Array.from({ length: 60 }, () => makeChild(best[rng.int(0, 11)], best[rng.int(0, 11)], rng));
    }
    expect(avg()).toBeGreaterThan(start * 1.5);
  });

  it('cópia mutada (repovoamento) não altera o genoma guardado', () => {
    const src = { genes: rabbit(), brain: randomBrain({ inputs: 3, hidden: 2, outputs: 1 }, createRng(1)) };
    const before = { ...src.genes };
    const w = src.brain.w1.slice();
    mutatedCopy(src, createRng(9));
    expect(src.genes).toEqual(before);
    expect(src.brain.w1).toEqual(w);
  });
});
