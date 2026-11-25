/**
 * Testes da simulação num mundinho sintético de 64×64: planície plana com um lago
 * e uma árvore. Os cérebros são montados à mão (só vieses) para forçar um
 * comportamento: "fique parado e coma", "beba", "acasale"...
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { randomBrain, type Brain } from '../src/sim/neural';
import { Simulation, DT, type Creature } from '../src/sim/simulation';
import { HERBIVORE_BRAIN, SPECIES, Species } from '../src/sim/species';
import type { WorldMaps } from '../src/sim/simWorld';
import { Biome } from '../src/world/biomes';
import { Block } from '../src/world/blocks';

const S = 64;

function makeMaps(): WorldMaps {
  const N = S * S;
  const height = new Uint8Array(N).fill(10);
  const waterTop = new Uint8Array(N);
  // lago 6×6 no canto (x, z de 2 a 7)
  for (let z = 2; z < 8; z++) for (let x = 2; x < 8; x++) { height[x + z * S] = 8; waterTop[x + z * S] = 10; }
  return {
    sizeX: S, sizeZ: S, seaLevel: 5, height, waterTop,
    biome: new Uint8Array(N).fill(Biome.PLAINS),
    temperature: new Float32Array(N).fill(0.6), // ~17 °C de dia
    humidity: new Float32Array(N).fill(0.6),
    topBlock: new Uint8Array(N).fill(Block.GRASS),
    trees: [{ x: 50, z: 50 }],
  };
}

const OUT = { turn: 0, speed: 1, eat: 2, drink: 3, sleep: 4, mate: 5 };

/** cérebro sem pesos, só com os vieses das saídas: comportamento fixo */
function fixedBrain(bias: Partial<Record<keyof typeof OUT, number>>): Brain {
  const b = randomBrain(HERBIVORE_BRAIN, createRng(1));
  b.w1.fill(0);
  b.w2.fill(0);
  const NH = HERBIVORE_BRAIN.hidden;
  const all = { turn: 0, speed: -5, eat: -5, drink: -5, sleep: -5, mate: -5, ...bias };
  for (const [k, v] of Object.entries(all)) b.w2[OUT[k as keyof typeof OUT] * (NH + 1) + NH] = v;
  return b;
}

function newSim(): Simulation {
  const sim = new Simulation(makeMaps(), 42, { initialScale: 0, initialBushes: 0, repopulate: false });
  sim.plants.growthMul = 0; // a grama não rebrota durante os testes (contas mais claras)
  return sim;
}

function add(sim: Simulation, species: Species, brain: Brain, x: number, z: number, extra: Partial<Creature> = {}): Creature {
  const genome = { genes: { ...SPECIES[species].genes }, brain };
  const c = sim.addCreature(species, genome, x, z)!;
  c.age = c.maturity + 10; // adulto
  Object.assign(c, extra);
  return c;
}

const steps = (sim: Simulation, n: number) => { for (let i = 0; i < n; i++) sim.step(); };

describe('cadeia alimentar', () => {
  it('coelho parado comendo: ganha energia e a grama do lugar diminui', () => {
    const sim = newSim();
    const c = add(sim, Species.RABBIT, fixedBrain({ eat: 5 }), 30.5, 30.5);
    c.energy = c.maxEnergy * 0.3;
    const i = 30 + 30 * S;
    sim.plants.grass[i] = 0.8;
    const e0 = c.energy;
    steps(sim, 5);
    expect(c.energy).toBeGreaterThan(e0);
    expect(sim.plants.grass[i]).toBeLessThan(0.8);
    expect(c.eating).toBe(true);
  });

  it('sem comida, morre de fome', () => {
    const sim = newSim();
    sim.plants.grass.fill(0);
    const c = add(sim, Species.RABBIT, fixedBrain({ eat: 5, drink: 5 }), 30.5, 30.5);
    c.energy = 2;
    steps(sim, 50);
    expect(c.alive).toBe(false);
    expect(c.cause).toBe('fome');
    expect(sim.creatures).not.toContain(c);
  });

  it('cervo come folhas das árvores; coelho não alcança', () => {
    const sim = newSim();
    sim.plants.grass.fill(0);
    const deer = add(sim, Species.DEER, fixedBrain({ eat: 5 }), 51.5, 50.5);
    const rabbit = add(sim, Species.RABBIT, fixedBrain({ eat: 5 }), 49.5, 50.5);
    deer.energy = deer.maxEnergy * 0.3;
    rabbit.energy = rabbit.maxEnergy * 0.3;
    const ed = deer.energy, er = rabbit.energy;
    steps(sim, 3);
    expect(deer.energy).toBeGreaterThan(ed); // comeu folhas
    expect(rabbit.energy).toBeLessThan(er); // só gastou
  });

  it('arbusto com fruta alimenta e a fruta some', () => {
    const sim = newSim();
    sim.plants.grass.fill(0);
    const bush = sim.plants.addBush(20 + 20 * S, createRng(1))!;
    bush.growth = 1;
    bush.fruit = 4;
    const c = add(sim, Species.RABBIT, fixedBrain({ eat: 5 }), 20.5, 21.2);
    c.energy = c.maxEnergy * 0.3;
    const e0 = c.energy;
    steps(sim, 40);
    expect(bush.fruit).toBeLessThan(4);
    expect(c.energy).toBeGreaterThan(e0);
  });
});

describe('necessidades', () => {
  it('bebe água quando está na margem do lago', () => {
    const sim = newSim();
    const c = add(sim, Species.RABBIT, fixedBrain({ drink: 5 }), 8.5, 4.5);
    c.hydration = 0.3;
    steps(sim, 5);
    expect(c.hydration).toBeGreaterThan(0.3);
    expect(c.drinking).toBe(true);
  });

  it('longe da água e sem beber, morre de sede', () => {
    const sim = newSim();
    const c = add(sim, Species.RABBIT, fixedBrain({ eat: 5 }), 40.5, 40.5);
    sim.plants.grass.fill(0); // sem folhas, sem a água que vem da comida
    c.hydration = 0.005;
    steps(sim, 20);
    expect(c.cause).toBe('sede');
  });

  it('morre de velhice ao passar da idade máxima', () => {
    const sim = newSim();
    const c = add(sim, Species.RABBIT, fixedBrain({ eat: 5 }), 30.5, 30.5);
    c.age = c.genome.genes.maxAge - DT / 2;
    steps(sim, 2);
    expect(c.cause).toBe('velhice');
  });

  it('não anda para dentro da água', () => {
    const sim = newSim();
    const c = add(sim, Species.RABBIT, fixedBrain({ speed: 5 }), 9.5, 4.5);
    c.yaw = Math.PI; // virado para -x, direto para o lago
    steps(sim, 20);
    expect(c.x).toBeGreaterThanOrEqual(8);
  });
});

describe('reprodução sexuada', () => {
  function couple(sim: Simulation) {
    const brain = fixedBrain({ mate: 5, eat: 5 });
    const f = add(sim, Species.RABBIT, brain, 30.5, 30.5, { sex: 0, generation: 3 });
    const m = add(sim, Species.RABBIT, brain, 31.5, 30.5, { sex: 1, generation: 5 });
    for (const c of [f, m]) { c.energy = c.maxEnergy * 0.9; c.hydration = 1; }
    return { f, m };
  }

  it('casal pronto: fêmea engravida, e após a gestação nascem filhotes', () => {
    const sim = newSim();
    const { f, m } = couple(sim);
    steps(sim, 3);
    expect(f.pregnant).not.toBeNull();
    expect(f.pregnant!.fatherId).toBe(m.id);
    const before = sim.creatures.length;
    steps(sim, Math.ceil(SPECIES[0].gestation / DT) + 2);
    const kids = sim.creatures.filter((c) => c.mother === f.id);
    expect(kids.length).toBeGreaterThan(0);
    expect(sim.creatures.length).toBe(before + kids.length);
    for (const k of kids) {
      expect(k.father).toBe(m.id);
      expect(k.generation).toBe(6); // max(geração dos pais) + 1
      expect(k.age).toBeLessThan(k.maturity);
    }
    expect(f.children).toBe(kids.length);
    expect(m.children).toBe(kids.length);
    expect(f.childIds).toEqual(kids.map((k) => k.id));
  });

  it('dois machos não se reproduzem', () => {
    const sim = newSim();
    const { f } = couple(sim);
    f.sex = 1;
    steps(sim, 20);
    expect(sim.creatures.every((c) => !c.pregnant)).toBe(true);
  });

  it('espécies diferentes não cruzam', () => {
    const sim = newSim();
    const brain = fixedBrain({ mate: 5 });
    const f = add(sim, Species.RABBIT, brain, 30.5, 30.5, { sex: 0 });
    const m = add(sim, Species.DEER, brain, 31.5, 30.5, { sex: 1 });
    for (const c of [f, m]) { c.energy = c.maxEnergy; c.hydration = 1; }
    steps(sim, 20);
    expect(f.pregnant).toBeNull();
  });

  it('jovens e famintos não se reproduzem', () => {
    const sim = newSim();
    const { f, m } = couple(sim);
    f.age = 0; // jovem
    m.energy = m.maxEnergy * 0.1; // faminto
    steps(sim, 20);
    expect(f.pregnant).toBeNull();
  });
});

describe('determinismo', () => {
  it('mesma seed e mesmas condições → exatamente o mesmo resultado', () => {
    const run = () => {
      const sim = new Simulation(makeMaps(), 7, { initialScale: 0, initialBushes: 20, repopulate: false });
      for (let k = 0; k < 6; k++) sim.spawnGroup(Species.RABBIT, 5, () => null);
      steps(sim, 300);
      return sim.creatures.map((c) => [c.id, c.x.toFixed(4), c.z.toFixed(4), c.energy.toFixed(3)]);
    };
    expect(run()).toEqual(run());
  });
});
