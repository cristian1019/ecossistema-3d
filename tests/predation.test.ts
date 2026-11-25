/**
 * Testes da Fase 3: caça, carcaças, camuflagem, fuga e amamentação,
 * no mundinho sintético 64×64 (planície de grama, ver helpers.ts).
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { instinctBrain } from '../src/sim/instincts';
import { BRAIN_SHAPE, Species } from '../src/sim/species';
import { add, fixedBrain, newSim, steps } from './helpers';

/** cor exata do topo do bloco de grama (é o chão do mundinho) */
const GRASS = { r: 0x7f / 255, g: 0xba / 255, b: 0x52 / 255 };

describe('caça', () => {
  it('lobo ataca um coelho dormindo: o coelho morre de predação e vira carcaça', () => {
    const sim = newSim();
    const wolf = add(sim, Species.WOLF, fixedBrain({ eat: 5 }), 30.5, 30.5);
    const rabbit = add(sim, Species.RABBIT, fixedBrain({ sleep: 5 }), 31.5, 30.5, { fatigue: 0.9, sleeping: true });
    wolf.energy = wolf.maxEnergy * 0.4;
    for (let i = 0; i < 40 && rabbit.alive; i++) sim.step();
    expect(rabbit.alive).toBe(false);
    expect(rabbit.cause).toBe('predação');
    expect(sim.kills[Species.WOLF]).toBe(1);
    expect(sim.carcasses.length).toBe(1);
  });

  it('predador come a carcaça e ganha energia; a carne diminui', () => {
    const sim = newSim();
    const wolf = add(sim, Species.WOLF, fixedBrain({ eat: 5 }), 30.5, 30.5);
    const rabbit = add(sim, Species.RABBIT, fixedBrain({ sleep: 5 }), 31.5, 30.5, { fatigue: 0.9, sleeping: true });
    wolf.energy = wolf.maxEnergy * 0.3;
    for (let i = 0; i < 40 && rabbit.alive; i++) sim.step();
    const carcass = sim.carcasses[0];
    const meat0 = carcass.meat, e0 = wolf.energy;
    steps(sim, 6);
    expect(wolf.energy).toBeGreaterThan(e0);
    expect(carcass.meat).toBeLessThan(meat0);
  });

  it('carcaça apodrece e some com o tempo', () => {
    const sim = newSim();
    const rabbit = add(sim, Species.RABBIT, fixedBrain({}), 31.5, 30.5);
    sim.kill(rabbit, 'predação');
    sim.carcasses.push({ id: 1, x: 30, z: 30, y: 11, species: Species.RABBIT, meat: 100, max: 100 });
    steps(sim, Math.ceil(160 / 0.2));
    expect(sim.carcasses.length).toBe(0);
  });

  it('predador não come planta (fica com fome num campo cheio de grama)', () => {
    const sim = newSim();
    const fox = add(sim, Species.FOX, fixedBrain({ eat: 5 }), 30.5, 30.5);
    sim.plants.grass.fill(1);
    fox.energy = fox.maxEnergy * 0.5;
    steps(sim, 20);
    expect(fox.energy).toBeLessThan(fox.maxEnergy * 0.5);
  });

  it('raposa não caça cervo (não está na dieta dela)', () => {
    const sim = newSim();
    const fox = add(sim, Species.FOX, fixedBrain({ eat: 5 }), 30.5, 30.5);
    const deer = add(sim, Species.DEER, fixedBrain({ sleep: 5 }), 31.5, 30.5, { fatigue: 0.9, sleeping: true });
    fox.energy = fox.maxEnergy * 0.3;
    steps(sim, 30);
    expect(deer.alive).toBe(true);
    expect(fox.targets.prey).toBeNull();
  });
});

describe('camuflagem', () => {
  /** raposa parada, coelho parado a 14 blocos; devolve se a raposa notou o coelho */
  function foxSees(color: { r: number; g: number; b: number }): boolean {
    const sim = newSim();
    const fox = add(sim, Species.FOX, fixedBrain({}), 20.5, 30.5);
    const rabbit = add(sim, Species.RABBIT, fixedBrain({}), 34.5, 30.5);
    Object.assign(rabbit.genome.genes, color);
    steps(sim, 4); // a busca roda a cada 3 passos
    return fox.targets.prey === rabbit;
  }

  it('coelho da cor do chão (parado) não é notado de longe; coelho contrastante é', () => {
    expect(foxSees({ r: 0.95, g: 0.95, b: 0.95 })).toBe(true); // branco no gramado: aparece
    expect(foxSees(GRASS)).toBe(false); // verde-grama: camuflado
  });

  it('a camuflagem é 1 para cor idêntica ao chão e 0 para cor muito diferente', () => {
    const sim = newSim();
    const i = 30 + 30 * 64;
    expect(sim.world.camo(GRASS.r, GRASS.g, GRASS.b, i)).toBeCloseTo(1, 5);
    expect(sim.world.camo(1, 1, 1, i)).toBe(0);
  });
});

describe('fuga e cuidado com os filhotes', () => {
  it('coelho com instinto foge de um predador parado (a distância aumenta)', () => {
    const sim = newSim();
    const fox = add(sim, Species.FOX, fixedBrain({}), 30.5, 30.5);
    const rabbit = add(sim, Species.RABBIT, instinctBrain(BRAIN_SHAPE, createRng(5)), 36.5, 30.5);
    rabbit.yaw = Math.PI; // de frente para a raposa
    const d0 = Math.hypot(rabbit.x - fox.x, rabbit.z - fox.z);
    steps(sim, 1);
    expect(rabbit.input[8]).toBeGreaterThan(0); // percebe o predador (entrada "predador: perto")
    steps(sim, 24);
    expect(Math.hypot(rabbit.x - fox.x, rabbit.z - fox.z)).toBeGreaterThan(d0 + 3);
  });

  it('filhote perto da mãe mama: ele ganha energia e ela paga', () => {
    const sim = newSim();
    const mom = add(sim, Species.WOLF, fixedBrain({}), 30.5, 30.5, { sex: 0 });
    mom.energy = mom.maxEnergy * 0.9;
    const pup = add(sim, Species.WOLF, fixedBrain({}), 31.5, 30.5, { mother: mom.id });
    pup.age = 1;
    pup.energy = pup.maxEnergy * 0.05;
    const p0 = pup.energy, m0 = mom.energy;
    steps(sim, 5);
    expect(pup.nursing).toBe(true);
    expect(pup.energy).toBeGreaterThan(p0);
    expect(mom.energy).toBeLessThan(m0);
  });

  it('mãe fraca (abaixo de 30%) não amamenta', () => {
    const sim = newSim();
    const mom = add(sim, Species.WOLF, fixedBrain({}), 30.5, 30.5, { sex: 0 });
    mom.energy = mom.maxEnergy * 0.2;
    const pup = add(sim, Species.WOLF, fixedBrain({}), 31.5, 30.5, { mother: mom.id });
    pup.age = 1;
    pup.energy = pup.maxEnergy * 0.05;
    steps(sim, 3);
    expect(pup.nursing).toBe(false);
  });
});
