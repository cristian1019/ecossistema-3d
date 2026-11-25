/**
 * Testes da Fase 5: tribos, conhecimento, coleta, construções (que viram blocos)
 * e efeitos (cerca bloqueia animais). Mundinho 64×64 de helpers.ts.
 */
import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import {
  BUILDINGS, LEVEL_KNOWLEDGE, canAfford, levelFor, nextBuilding, neededResource, planBuilding, type Tribe,
} from '../src/sim/tribes';
import { DT, type Simulation } from '../src/sim/simulation';
import { SPECIES, Species } from '../src/sim/species';
import { add, fixedBrain, newSim, steps } from './helpers';

function tribeOf(sim: Simulation): Tribe {
  const t = sim.foundTribe(4, () => null)!;
  expect(t).not.toBeNull();
  return t;
}

/** chama um método privado da simulação (só nos testes) */
const call = (sim: Simulation, name: string, ...args: unknown[]) => (sim as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);

describe('conhecimento e catálogo de construções', () => {
  it('cada nível exige mais conhecimento e libera construções em ordem', () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(LEVEL_KNOWLEDGE[1])).toBe(1);
    expect(levelFor(LEVEL_KNOWLEDGE[3] + 0.1)).toBe(3);
    expect(levelFor(1e9)).toBe(LEVEL_KNOWLEDGE.length - 1);
    const levels = BUILDINGS.map((b) => b.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it('próxima construção, custo e recurso que mais falta', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    expect(nextBuilding(t)).toBeNull(); // nível 0: não sabe construir nada
    t.level = 1;
    expect(nextBuilding(t)!.key).toBe('fogueira');
    t.store = { wood: 0, stone: 0, food: 20, fiber: 0 };
    expect(canAfford(t, nextBuilding(t)!)).toBe(false);
    expect(neededResource(t)).toBe('wood'); // fogueira: 4 de madeira, 2 de pedra → falta mais madeira
    t.store.food = 0;
    expect(neededResource(t)).toBe('food'); // sem comida, comida vem primeiro
  });

  it('o conhecimento cresce com o tempo e a tribo sobe de nível (com evento na linha do tempo)', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    // simula 5 minutos de vida da tribo de uma vez (1 passo de tribo = 300 s)
    call(sim, 'updateTribes', 300);
    expect(t.knowledge).toBeGreaterThan(0);
    expect(t.level).toBeGreaterThanOrEqual(1);
    expect(sim.events.some((e) => e.text.includes('chegou ao nível 1'))).toBe(true);
  });
});

describe('construções', () => {
  it('a planta da fogueira tem o fogo no meio e marca o centro como obstáculo', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    const plan = planBuilding('fogueira', t, sim.world, new Set())!;
    const ids: number[] = [];
    for (let k = 3; k < plan.edits.length; k += 4) ids.push(plan.edits[k]);
    expect(ids).toContain(Block.CAMPFIRE);
    expect(ids.filter((b) => b === Block.COBBLE).length).toBe(8);
    expect(plan.block.some((b) => b.kind === 2)).toBe(true);
  });

  it('construir gasta recursos, coloca blocos no mundo e registra o evento', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    t.level = 1;
    t.store = { wood: 10, stone: 5, food: 20, fiber: 0 };
    call(sim, 'tryBuild', t);
    expect(t.built).toEqual(['fogueira']);
    expect(t.store.wood).toBe(6);
    expect(t.store.stone).toBe(3);
    expect(t.fire).not.toBeNull();
    const placed: number[] = [];
    for (let k = 3; k < sim.pendingEdits.length; k += 4) placed.push(sim.pendingEdits[k]);
    expect(placed).toContain(Block.CAMPFIRE);
    expect(sim.events.some((e) => e.text.includes('construiu a primeira fogueira'))).toBe(true);
  });

  it('sem recursos suficientes não constrói nada', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    t.level = 1;
    t.store = { wood: 1, stone: 0, food: 20, fiber: 0 };
    call(sim, 'tryBuild', t);
    expect(t.built).toEqual([]);
    expect(sim.pendingEdits.length).toBe(0);
  });

  it('a cerca bloqueia animais, mas humanos passam', () => {
    const sim = newSim();
    // uma "parede" de cerca em x = 33
    for (let z = 0; z < 64; z++) sim.world.structure[33 + z * 64] = 1;
    const rabbit = add(sim, Species.RABBIT, fixedBrain({ speed: 5 }), 31.5, 20.5);
    const human = add(sim, Species.HUMAN, fixedBrain({ speed: 5, collect: -5 }), 31.5, 40.5);
    rabbit.yaw = 0;
    human.yaw = 0;
    steps(sim, 20);
    expect(rabbit.x).toBeLessThan(33);
    expect(human.x).toBeGreaterThan(34);
  });
});

describe('trabalho dos humanos', () => {
  it('humano coleta madeira numa árvore e leva para o estoque da tribo', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    t.store = { wood: 0, stone: 0, food: 30, fiber: 0 }; // comida sobrando → a tribo precisa de madeira
    t.trees = [50 + 50 * 64];
    // troca os membros aleatórios por um humano que só quer trabalhar
    const h = add(sim, Species.HUMAN, fixedBrain({ collect: 5, build: -5 }), t.cx + 0.5, t.cz + 0.5, { tribe: t.id });
    for (const c of sim.creatures) if (c !== h) sim.kill(c, 'velhice');
    h.energy = h.maxEnergy;
    for (let k = 0; k < 4000 && t.store.wood === 0; k++) {
      sim.step();
      h.energy = h.maxEnergy; // sem fome, para o teste focar no trabalho
      h.hydration = 1;
    }
    expect(t.store.wood).toBeGreaterThanOrEqual(5); // levou uma trouxa cheia
  });

  it('filho de humano herda a tribo da mãe', () => {
    const sim = newSim();
    const t = tribeOf(sim);
    const brain = fixedBrain({ mate: 5, collect: -5 });
    const f = add(sim, Species.HUMAN, brain, 30.5, 30.5, { sex: 0, tribe: t.id });
    const m = add(sim, Species.HUMAN, brain, 31.5, 30.5, { sex: 1, tribe: t.id });
    for (const c of sim.creatures) if (c !== f && c !== m) sim.kill(c, 'velhice');
    for (const c of [f, m]) { c.energy = c.maxEnergy; c.hydration = 1; }
    steps(sim, Math.ceil(SPECIES[Species.HUMAN].gestation / DT) + 10);
    const kids = sim.creatures.filter((c) => c.mother === f.id);
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) expect(k.tribe).toBe(t.id);
  });
});
