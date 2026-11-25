/** Mundinho sintético 64×64 e cérebros montados à mão, usados pelos testes da simulação. */
import { createRng } from '../src/core/rng';
import { randomBrain, type Brain } from '../src/sim/neural';
import { Simulation, type Creature } from '../src/sim/simulation';
import { BRAIN_SHAPE, SPECIES, Species } from '../src/sim/species';
import type { WorldMaps } from '../src/sim/simWorld';
import { Biome } from '../src/world/biomes';
import { Block } from '../src/world/blocks';

export const S = 64;

export function makeMaps(): WorldMaps {
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

export const OUT = { turn: 0, speed: 1, eat: 2, drink: 3, sleep: 4, mate: 5 };

/** cérebro sem pesos, só com os vieses das saídas: comportamento fixo */
export function fixedBrain(bias: Partial<Record<keyof typeof OUT, number>>): Brain {
  const b = randomBrain(BRAIN_SHAPE, createRng(1));
  b.w1.fill(0);
  b.w2.fill(0);
  const NH = BRAIN_SHAPE.hidden;
  const all = { turn: 0, speed: -5, eat: -5, drink: -5, sleep: -5, mate: -5, ...bias };
  for (const [k, v] of Object.entries(all)) b.w2[OUT[k as keyof typeof OUT] * (NH + 1) + NH] = v;
  return b;
}

export function newSim(): Simulation {
  const sim = new Simulation(makeMaps(), 42, { initialScale: 0, initialBushes: 0, repopulate: false });
  sim.plants.growthMul = 0; // a grama não rebrota durante os testes (contas mais claras)
  return sim;
}

export function add(sim: Simulation, species: Species, brain: Brain, x: number, z: number, extra: Partial<Creature> = {}): Creature {
  const genome = { genes: { ...SPECIES[species].genes }, brain };
  const c = sim.addCreature(species, genome, x, z)!;
  c.age = c.maturity + 10; // adulto
  Object.assign(c, extra);
  return c;
}

export const steps = (sim: Simulation, n: number) => { for (let i = 0; i < n; i++) sim.step(); };
