import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../src/core/rng';

describe('RNG com seed', () => {
  it('a mesma seed gera exatamente a mesma sequência', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('seeds diferentes geram sequências diferentes', () => {
    const a = createRng(1), b = createRng(2);
    const sa = Array.from({ length: 10 }, a.next);
    const sb = Array.from({ length: 10 }, b.next);
    expect(sa).not.toEqual(sb);
  });

  it('next() fica em [0, 1) e tem média próxima de 0,5', () => {
    const r = createRng(7);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });

  it('int() respeita os limites inclusivos', () => {
    const r = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('hashSeed converte texto de forma estável e aceita números', () => {
    expect(hashSeed('ilha-azul')).toBe(hashSeed('ilha-azul'));
    expect(hashSeed('ilha-azul')).not.toBe(hashSeed('ilha-verde'));
    expect(hashSeed('1234')).toBe(1234);
  });
});
