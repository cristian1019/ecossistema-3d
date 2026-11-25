import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { crossoverBrain, forward, mutateBrain, randomBrain, weightCount, cloneBrain } from '../src/sim/neural';

const SHAPE = { inputs: 3, hidden: 2, outputs: 2 };

describe('rede neural', () => {
  it('conta os pesos: entradas×ocultos + saídas×(ocultos+viés)', () => {
    expect(weightCount(SHAPE)).toBe(3 * 2 + 2 * 3);
    expect(weightCount({ inputs: 23, hidden: 10, outputs: 6 })).toBe(296);
  });

  it('propagação para frente bate com a conta feita à mão', () => {
    const b = randomBrain(SHAPE, createRng(1));
    b.w1.set([1, 0, 0, /* oculto 1: */ 0, 2, -1]);
    // saída 0 = 1·h0 + 0·h1 + viés 0 ; saída 1 = 0·h0 - 1·h1 + viés 0,5
    b.w2.set([1, 0, 0, /* saída 1: */ 0, -1, 0.5]);
    const input = Float32Array.from([0.5, 1, 1]);
    const h = new Float32Array(2), o = new Float32Array(2);
    forward(b, input, h, o);
    const h0 = Math.tanh(0.5), h1 = Math.tanh(2 - 1);
    expect(h[0]).toBeCloseTo(h0, 5);
    expect(h[1]).toBeCloseTo(h1, 5);
    expect(o[0]).toBeCloseTo(Math.tanh(h0), 5);
    expect(o[1]).toBeCloseTo(Math.tanh(-h1 + 0.5), 5);
  });

  it('as saídas ficam sempre entre -1 e 1 (tanh)', () => {
    const b = randomBrain({ inputs: 23, hidden: 10, outputs: 6 }, createRng(2), 5);
    const rng = createRng(3);
    const input = new Float32Array(23), h = new Float32Array(10), o = new Float32Array(6);
    for (let t = 0; t < 50; t++) {
      for (let i = 0; i < 23; i++) input[i] = rng.range(-1, 1);
      forward(b, input, h, o);
      for (const v of o) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }
    }
  });

  it('crossover: cada neurônio oculto vem inteiro de UM dos pais', () => {
    const shape = { inputs: 5, hidden: 8, outputs: 3 };
    const a = randomBrain(shape, createRng(10));
    const b = randomBrain(shape, createRng(20));
    const c = crossoverBrain(a, b, createRng(30));
    let fromA = 0, fromB = 0;
    for (let j = 0; j < shape.hidden; j++) {
      const row = Array.from(c.w1.subarray(j * 5, j * 5 + 5));
      const rowA = Array.from(a.w1.subarray(j * 5, j * 5 + 5));
      const rowB = Array.from(b.w1.subarray(j * 5, j * 5 + 5));
      const isA = row.every((v, i) => v === rowA[i]);
      const isB = row.every((v, i) => v === rowB[i]);
      expect(isA || isB).toBe(true);
      // os pesos de SAÍDA desse neurônio vêm do mesmo pai que os de entrada
      for (let k = 0; k < shape.outputs; k++) {
        const out = c.w2[k * 9 + j];
        expect(out).toBe((isA ? a : b).w2[k * 9 + j]);
      }
      if (isA) fromA++; else fromB++;
    }
    expect(fromA).toBeGreaterThan(0);
    expect(fromB).toBeGreaterThan(0);
  });

  it('mutação com taxa 0 não muda nada; com taxa 1 muda quase tudo', () => {
    const b = randomBrain(SHAPE, createRng(4));
    const same = cloneBrain(b);
    mutateBrain(same, createRng(5), 0, 0.3);
    expect(same.w1).toEqual(b.w1);
    const changed = cloneBrain(b);
    mutateBrain(changed, createRng(5), 1, 0.3);
    let diff = 0;
    changed.w1.forEach((v, i) => { if (v !== b.w1[i]) diff++; });
    expect(diff).toBe(b.w1.length);
  });

  it('mutação nunca deixa um peso passar de ±6', () => {
    const b = randomBrain(SHAPE, createRng(6), 5.9);
    for (let t = 0; t < 200; t++) mutateBrain(b, createRng(t), 1, 3);
    for (const w of [...b.w1, ...b.w2]) expect(Math.abs(w)).toBeLessThanOrEqual(6);
  });
});
