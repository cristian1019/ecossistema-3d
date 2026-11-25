/**
 * Testes da Fase 4: peixes (nado 3D, algas, peixe grande come pequeno) e
 * pássaros (voo, pouso, frutas, pesca, vulneráveis só quando pousados no chão).
 * Mundinho 64×64 de helpers.ts: o lago ocupa x, z de 2 a 7 (fundo y=8, água até y=10).
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { randomBrain } from '../src/sim/neural';
import { BRAIN_SHAPE, SPECIES, Species } from '../src/sim/species';
import type { Simulation } from '../src/sim/simulation';
import { add, fixedBrain, newSim, steps } from './helpers';

/** adiciona com um tamanho de corpo específico (a massa é calculada na criação) */
function addSized(sim: Simulation, species: Species, size: number, bias: Parameters<typeof fixedBrain>[0], x: number, z: number) {
  const genome = { genes: { ...SPECIES[species].genes, size }, brain: fixedBrain(bias) };
  const c = sim.addCreature(species, genome, x, z)!;
  c.age = c.maturity + 10;
  return c;
}

describe('peixes', () => {
  it('nasce dentro da água, entre o fundo e a superfície', () => {
    const sim = newSim();
    const f = add(sim, Species.FISH, fixedBrain({}), 4.5, 4.5);
    expect(f.y).toBeGreaterThan(9);
    expect(f.y).toBeLessThan(11);
  });

  it('come algas: ganha energia e as algas do lugar diminuem', () => {
    const sim = newSim();
    const f = add(sim, Species.FISH, fixedBrain({ eat: 5 }), 4.5, 4.5);
    const i = 4 + 4 * 64;
    sim.plants.algae[i] = 0.8;
    f.energy = f.maxEnergy * 0.3;
    const e0 = f.energy;
    steps(sim, 5);
    expect(f.energy).toBeGreaterThan(e0);
    expect(sim.plants.algae[i]).toBeLessThan(0.8);
  });

  it('nunca sai da água (bloqueia na margem)', () => {
    const sim = newSim();
    const f = add(sim, Species.FISH, fixedBrain({ speed: 5 }), 6.5, 4.5);
    f.yaw = 0; // nadando para +x, direto para a margem em x = 8
    steps(sim, 30);
    expect(f.x).toBeLessThan(8);
    expect(sim.world.isWater(sim.world.idx(f.x, f.z))).toBe(true);
  });

  it('a saída "subir/descer" leva o peixe à superfície ou ao fundo', () => {
    const sim = newSim();
    const up = add(sim, Species.FISH, fixedBrain({ vertical: 5 }), 3.5, 3.5);
    const down = add(sim, Species.FISH, fixedBrain({ vertical: -5 }), 5.5, 5.5);
    steps(sim, 10);
    const [lo, hi] = sim.world.swimRange(sim.world.idx(3.5, 3.5));
    expect(up.y).toBeCloseTo(hi, 5);
    expect(down.y).toBeCloseTo(lo, 5);
  });

  it('peixe grande com fome come peixe bem menor; do mesmo tamanho, não', () => {
    const sim = newSim();
    const big = addSized(sim, Species.FISH, 1.4, { eat: 5 }, 4.5, 4.5);
    const small = addSized(sim, Species.FISH, 0.6, {}, 5.2, 4.5);
    const twin = addSized(sim, Species.FISH, 1.4, {}, 3.8, 4.5);
    big.energy = big.maxEnergy * 0.3;
    for (const f of [small, twin]) f.y = big.y;
    sim.plants.algae.fill(0);
    for (let k = 0; k < 40 && small.alive; k++) sim.step();
    expect(small.cause).toBe('predação');
    expect(twin.alive).toBe(true);
  });
});

describe('pássaros', () => {
  it('decola, voa e pousa de novo conforme a saída "subir/descer"', () => {
    const sim = newSim();
    const b = add(sim, Species.BIRD, fixedBrain({ vertical: 5 }), 30.5, 30.5);
    expect(b.landed).toBe(true);
    steps(sim, 10);
    expect(b.landed).toBe(false);
    expect(b.y).toBeGreaterThan(sim.world.perchY(sim.world.idx(b.x, b.z)) + 3);
    // agora manda descer
    b.genome.brain = fixedBrain({ vertical: -5 });
    steps(sim, 60);
    expect(b.landed).toBe(true);
  });

  it('pousa no alto da árvore (na copa), não no chão embaixo dela', () => {
    const sim = newSim();
    const b = add(sim, Species.BIRD, fixedBrain({}), 50.5, 50.5);
    expect(b.y).toBe(sim.world.maps.canopy[50 + 50 * 64] + 1);
    expect(b.y).toBeGreaterThan(sim.world.groundY(50.5, 50.5) + 3);
  });

  it('só come fruta pousado', () => {
    const sim = newSim();
    const bush = sim.plants.addBush(20 + 20 * 64, createRng(1))!;
    bush.growth = 1;
    bush.fruit = 4;
    const flying = add(sim, Species.BIRD, fixedBrain({ eat: 5, vertical: 5 }), 20.5, 21);
    steps(sim, 3); // decolou
    flying.energy = flying.maxEnergy * 0.3;
    flying.genome.brain = fixedBrain({ eat: 5, vertical: 0.1 });
    flying.targets.bush = bush;
    const e0 = flying.energy;
    steps(sim, 10);
    expect(flying.landed).toBe(false);
    expect(bush.fruit).toBe(4);
    expect(flying.energy).toBeLessThan(e0);

    const perched = add(sim, Species.BIRD, fixedBrain({ eat: 5 }), 20.5, 21.2);
    perched.energy = perched.maxEnergy * 0.3;
    steps(sim, 40);
    expect(bush.fruit).toBeLessThan(4);
  });

  it('pesca um peixe perto da superfície', () => {
    const sim = newSim();
    const fish = add(sim, Species.FISH, fixedBrain({ vertical: 5 }), 4.5, 4.5);
    steps(sim, 5); // o peixe sobe até a superfície
    const bird = add(sim, Species.BIRD, fixedBrain({ eat: 5, vertical: 0 }), 5.2, 4.5);
    bird.landed = false;
    bird.y = sim.world.perchY(sim.world.idx(5.2, 4.5)) + 0.3;
    bird.energy = bird.maxEnergy * 0.3;
    for (let k = 0; k < 40 && fish.alive; k++) sim.step();
    expect(fish.cause).toBe('predação');
  });

  it('raposa pega pássaro pousado no chão, mas não um pássaro voando', () => {
    const sim = newSim();
    const fox = add(sim, Species.FOX, fixedBrain({ eat: 5 }), 30.5, 30.5);
    fox.energy = fox.maxEnergy * 0.3;
    const flyer = add(sim, Species.BIRD, fixedBrain({ vertical: 0.2 }), 31.2, 30.5);
    flyer.landed = false;
    flyer.y += 6;
    steps(sim, 6);
    expect(fox.targets.prey).not.toBe(flyer);
    expect(flyer.alive).toBe(true);

    const onGround = add(sim, Species.BIRD, fixedBrain({ sleep: 5 }), 29.8, 30.5, { fatigue: 0.9, sleeping: true });
    for (let k = 0; k < 40 && onGround.alive; k++) sim.step();
    expect(onGround.cause).toBe('predação');
  });

  it('o cérebro tem 9 saídas e 14 ocultos para todas as espécies', () => {
    const b = randomBrain(BRAIN_SHAPE, createRng(1));
    expect(BRAIN_SHAPE.outputs).toBe(9);
    expect(b.w1.length).toBe(23 * 14);
    expect(b.w2.length).toBe(9 * 15);
  });
});
