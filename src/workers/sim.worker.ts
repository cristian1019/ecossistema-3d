/**
 * Worker da simulação: dono do estado do ecossistema.
 *
 * Recria o mundo pela seed (determinístico, igual ao que a tela desenha), roda
 * os passos da simulação na velocidade pedida e manda para a tela:
 *  - ~20×/s: posições das criaturas (Float32Array transferido)
 *  - 1×/s: arbustos; a cada 2 s: textura da grama
 *  - 5×/s: ficha completa da criatura selecionada (com o cérebro)
 *
 * Como está fora da thread principal, acelerar o tempo não trava a tela.
 * Se o computador não aguentar a velocidade pedida, a simulação roda o máximo
 * que der e a tela mostra a velocidade real alcançada.
 */
import { generateWorld } from '../world/worldgen';
import { mapsFromWorld, type WorldMaps } from '../sim/simWorld';
import { DT, Simulation, type Creature } from '../sim/simulation';
import { FLAG, SNAP, BUSH_STRIDE, CARCASS_STRIDE, type CreatureDetail, type FromSim, type SimSettings, type ToSim } from './simProtocol';

let sim: Simulation | null = null;
let maps: WorldMaps | null = null;
let seed = 0;
let settings: SimSettings = { repopulate: true, instincts: true, mutationRate: 1 };
let speed = 1;
let selected: Creature | null = null;
let selectedId: number | null = null;

let owed = 0; // passos devidos (acumula tempo real × velocidade)
let lastLoop = performance.now();
let lastFrame = 0, lastPlants = 0, lastGrass = 0, lastDetail = 0;
let statsSent = 0, eventsSent = 0;
// medição da velocidade real
let speedWindowStart = performance.now(), speedWindowSim = 0, realSpeed = 0;

const post = (msg: FromSim, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

function start(): void {
  if (!maps) return;
  sim = new Simulation(maps, seed, { ...settings });
  selected = null;
  statsSent = 0;
  eventsSent = 0;
  sendPlants(true);
}

self.onmessage = (e: MessageEvent<ToSim>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      const t0 = performance.now();
      seed = m.seed;
      settings = m.settings;
      maps = mapsFromWorld(generateWorld(seed));
      start();
      post({ type: 'ready', ms: performance.now() - t0 });
      break;
    }
    case 'speed':
      speed = m.speed;
      break;
    case 'select':
      selectedId = m.id;
      selected = m.id !== null && sim ? sim.byId.get(m.id) ?? null : null;
      lastDetail = 0;
      break;
    case 'settings':
      settings = { ...settings, ...m.settings };
      if (sim) {
        sim.opts.repopulate = settings.repopulate;
        sim.opts.mutationRate = settings.mutationRate;
      }
      break;
    case 'reset':
      start();
      break;
  }
};

function loop(): void {
  const now = performance.now();
  const realDt = Math.min(0.25, (now - lastLoop) / 1000);
  lastLoop = now;

  if (sim && speed > 0) {
    owed += (realDt * speed) / DT;
    // roda passos por no máximo ~12 ms e devolve o controle (para receber mensagens)
    const budgetEnd = now + 12;
    let done = 0;
    while (owed >= 1 && performance.now() < budgetEnd) {
      sim.step();
      owed--;
      done++;
    }
    // não aguentou: descarta o atraso em vez de acumular para sempre
    if (owed > 10) owed = 0;
    speedWindowSim += done * DT;
  }
  if (now - speedWindowStart >= 1000) {
    realSpeed = speedWindowSim / ((now - speedWindowStart) / 1000);
    speedWindowStart = now;
    speedWindowSim = 0;
  }

  if (sim) {
    if (now - lastFrame >= 50) { lastFrame = now; sendFrame(); }
    if (now - lastPlants >= 1000) { lastPlants = now; sendPlants(now - lastGrass >= 2000); }
    if (selectedId !== null && now - lastDetail >= 200) { lastDetail = now; sendDetail(); }
  }
  // na velocidade 1x há poucos passos: dorme um pouco em vez de girar em falso
  setTimeout(loop, speed >= 20 ? 0 : 8);
}

function sendFrame(): void {
  const s = sim!;
  const n = s.creatures.length;
  const buf = new Float32Array(n * SNAP.STRIDE);
  for (let k = 0; k < n; k++) {
    const c = s.creatures[k], o = k * SNAP.STRIDE, g = c.genome.genes;
    buf[o + SNAP.ID] = c.id;
    buf[o + SNAP.X] = c.x;
    buf[o + SNAP.Y] = c.y;
    buf[o + SNAP.Z] = c.z;
    buf[o + SNAP.YAW] = c.yaw;
    buf[o + SNAP.SPECIES] = c.species;
    // filhote nasce com 55% do tamanho e cresce até virar adulto
    const grow = Math.min(1, c.age / c.maturity);
    buf[o + SNAP.SCALE] = g.size * (0.55 + 0.45 * grow);
    buf[o + SNAP.COLOR] = (Math.round(g.r * 255) << 16) | (Math.round(g.g * 255) << 8) | Math.round(g.b * 255);
    buf[o + SNAP.FLAGS] = (c.sleeping ? FLAG.SLEEP : 0) | (c.eating ? FLAG.EAT : 0) | (c.drinking ? FLAG.DRINK : 0) |
      (c.pregnant ? FLAG.PREGNANT : 0) | (c.sex === 1 ? FLAG.MALE : 0) | (grow < 1 ? FLAG.YOUNG : 0) |
      (c.attacking ? FLAG.ATTACK : 0) | (c.nursing ? FLAG.NURSE : 0);
    buf[o + SNAP.SPEED] = c.v;
    buf[o + SNAP.AGE] = c.age / g.maxAge;
  }
  const stats = s.stats.slice(statsSent);
  statsSent = s.stats.length;
  const events = s.events.slice(eventsSent);
  eventsSent = s.events.length;
  post({ type: 'frame', time: s.time, realSpeed: speed > 0 ? realSpeed : 0, count: n, creatures: buf, stats, events }, [buf.buffer]);
}

function sendPlants(withGrass: boolean): void {
  const s = sim!;
  const bushes = new Float32Array(s.plants.bushes.length * BUSH_STRIDE);
  s.plants.bushes.forEach((b, k) => {
    const o = k * BUSH_STRIDE;
    bushes[o] = b.x;
    bushes[o + 1] = maps!.height[b.i] + 1;
    bushes[o + 2] = b.z;
    bushes[o + 3] = b.growth;
    bushes[o + 4] = b.fruit;
  });
  let grass: Uint8Array | null = null;
  if (withGrass) {
    grass = s.plants.grassBytes();
    lastGrass = performance.now();
  }
  const carcasses = new Float32Array(s.carcasses.length * CARCASS_STRIDE);
  s.carcasses.forEach((k, n) => {
    const o = n * CARCASS_STRIDE;
    carcasses[o] = k.x; carcasses[o + 1] = k.y; carcasses[o + 2] = k.z;
    carcasses[o + 3] = k.meat / k.max; carcasses[o + 4] = k.species;
  });
  const transfer: Transferable[] = [bushes.buffer, carcasses.buffer];
  if (grass) transfer.push(grass.buffer);
  post({ type: 'plants', bushes, grass, carcasses }, transfer);
}

function actionOf(c: Creature): string {
  if (!c.alive) return 'morto';
  if (c.sleeping) return 'dormindo';
  if (c.nursing) return 'mamando';
  if (c.attacking) return 'atacando!';
  if (c.drinking) return 'bebendo';
  if (c.eating) return c.cfg.diet === 'meat' && c.targets.carcass ? 'comendo carne' : 'comendo';
  if (c.targets.pred && c.targets.pred.alive && c.v > 3) return 'fugindo';
  if (c.cfg.diet === 'meat' && c.targets.prey && c.output[2] > 0 && c.v > 3) return 'perseguindo uma presa';
  if (c.courting) return 'indo encontrar um parceiro';
  if (c.v > 0.5) return 'andando';
  return 'parado';
}

function sendDetail(): void {
  const c = selected;
  if (!c) { post({ type: 'detail', detail: null }); return; }
  const d: CreatureDetail = {
    id: c.id, species: c.species, sex: c.sex, alive: c.alive, cause: c.cause,
    age: c.age, maxAge: c.genome.genes.maxAge, maturity: c.maturity, generation: c.generation,
    mother: c.mother, father: c.father, children: c.children, childIds: [...c.childIds],
    genes: { ...c.genome.genes },
    energy: c.energy, maxEnergy: c.maxEnergy, hydration: c.hydration, fatigue: c.fatigue,
    coldStress: c.coldStress, temp: c.temp, camo: c.camo, action: actionOf(c),
    pregnantLeft: c.pregnant ? c.pregnant.timer : null,
    input: c.input.slice(), hidden: c.hidden.slice(), output: c.output.slice(),
    w1: c.genome.brain.w1.slice(), w2: c.genome.brain.w2.slice(),
  };
  post({ type: 'detail', detail: d });
}

loop();
