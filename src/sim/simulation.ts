/**
 * O coração da simulação. Roda dentro de um Web Worker (ou nos testes),
 * sem nada de DOM ou Three.js.
 *
 * A cada passo (tick) de DT segundos, cada criatura:
 *   1. SENTE o mundo (comida, água, parceiros, grupo, fome, sede, frio...)
 *   2. PENSA: as entradas passam pela rede neural
 *   3. AGE conforme as saídas: vira, anda, come, bebe, dorme, quer acasalar
 *   4. GASTA energia: custo ∝ massa (tamanho³) e ∝ velocidade², mais o cérebro
 *   5. pode ACASALAR, PARIR ou MORRER (fome, sede, frio, velhice, predação)
 *
 * Predadores (lobo, raposa) usam o mesmo cérebro: para eles "comida" é a presa
 * mais próxima que conseguem ENXERGAR (a camuflagem atrapalha) e "comer" é atacar.
 */
import { createRng, type Rng } from '../core/rng';
import { clamp } from '../core/math';
import { daylightAt } from './clock';
import { forward, randomBrain } from './neural';
import { instinctBrain } from './instincts';
import { makeChild, mutateGenes, mutatedCopy, type Genes, type Genome } from './genome';
import { BRAIN_SHAPE, SPECIES, SPECIES_COUNT, type Species, type SpeciesConfig } from './species';
import { ALGAE_ENERGY, BROWSE_ENERGY, FRUIT_ENERGY, GRASS_ENERGY, Plants, type Bush } from './plants';
import { SimWorld, type WorldMaps } from './simWorld';

/** duração de um passo de simulação (s). 5 passos por segundo de simulação. */
export const DT = 0.2;
export const MAX_CREATURES = 3000;
const TURN_RATE = 3; // rad/s com a saída "virar" no máximo
/** o chamado de acasalamento é ouvido a MATE_CALL × visão */
const MATE_CALL = 3;
const STATS_EVERY = 10; // s de simulação entre amostras dos gráficos

/** HUNTS[a][b] = a espécie a caça a espécie b */
const HUNTS: boolean[][] = SPECIES.map((p) => SPECIES.map((q) => p.prey.includes(q.id)));

// ---- números da caça (ver README: "Números do equilíbrio") ----
/** chance base de um ataque dar certo (por tentativa) */
const ATTACK_BASE = 0.4;
/** bônus por companheiro de alcateia atacando junto (até 3) */
const PACK_BONUS = 0.15;
/** tempo entre tentativas de ataque (s) */
const ATTACK_COOLDOWN = 1.2;
/** energia de carne na carcaça por unidade de massa da presa (carne rende mais que planta por quilo) */
const MEAT_PER_MASS = 400;
/** a carcaça apodrece em CARCASS_LIFE segundos */
const CARCASS_LIFE = 150;
/** quanto a camuflagem reduz a distância em que alguém é notado (60% no máximo) */
const CAMO_STRENGTH = 0.6;

export interface Carcass {
  id: number;
  x: number;
  z: number;
  y: number;
  species: Species;
  /** energia de carne que ainda sobra */
  meat: number;
  max: number;
}

export type DeathCause = 'fome' | 'sede' | 'frio' | 'velhice' | 'predação';

export interface Pregnancy {
  father: Genome;
  fatherId: number;
  fatherGen: number;
  timer: number;
}

export interface Creature {
  id: number;
  species: Species;
  cfg: SpeciesConfig;
  sex: 0 | 1; // 0 = fêmea, 1 = macho
  genome: Genome;
  x: number;
  z: number;
  y: number;
  yaw: number;
  v: number;
  /** massa = massa da espécie × tamanho³ */
  mass: number;
  energy: number;
  maxEnergy: number;
  hydration: number;
  fatigue: number;
  coldStress: number;
  temp: number;
  age: number;
  maturity: number;
  generation: number;
  mother: number;
  father: number;
  children: number;
  childIds: number[];
  sleeping: boolean;
  eating: boolean;
  drinking: boolean;
  wantsMate: boolean;
  /** indo encontrar um parceiro */
  courting: boolean;
  /** tentou atacar neste passo (para a animação) */
  attacking: boolean;
  /** mamando (filhote recebendo energia da mãe) */
  nursing: boolean;
  /** (pássaros) pousado num galho ou no chão; voando = false */
  landed: boolean;
  attackCd: number;
  /** camuflagem atual (cor do corpo contra o chão onde está), 0..1 */
  camo: number;
  pregnant: Pregnancy | null;
  cooldown: number;
  alive: boolean;
  cause: DeathCause | null;
  input: Float32Array;
  hidden: Float32Array;
  output: Float32Array;
  /** alvos encontrados na última busca (ver scan) */
  targets: Targets;
}

export interface Targets {
  foodOk: boolean; foodX: number; foodZ: number;
  waterOk: boolean; waterX: number; waterZ: number;
  mate: Creature | null;
  friend: Creature | null;
  /** arbusto com fruta mais próximo achado na busca (comer usa ele direto) */
  bush: Bush | null;
  /** (predadores) presa visível mais próxima e carcaça mais próxima */
  prey: Creature | null;
  carcass: Carcass | null;
  /** (presas) predador visível mais próximo */
  pred: Creature | null;
}

export interface StatsSample {
  t: number;
  pop: number[];
  bushes: number;
  grass: number;
  /** nascimentos por espécie desde a amostra anterior */
  births: number[];
  /** mortes por causa, por espécie, desde a amostra anterior */
  deaths: Record<DeathCause, number>[];
  /** média de alguns genes por espécie (para os gráficos de evolução) */
  genes: GeneAverages[];
  maxGen: number[];
}

export interface GeneAverages {
  speed: number; size: number; vision: number; fur: number; metabolism: number; litter: number;
  /** camuflagem média no lugar onde cada um está agora */
  camo: number;
}

export interface HallEntry {
  genome: Genome;
  fitness: number;
  generation: number;
}

export interface SimOptions {
  repopulate: boolean;
  mutationRate: number;
  /** população inicial (multiplicador; os testes usam 0) */
  initialScale: number;
  initialBushes: number;
  /** primeira geração com "instinto" simples (true) ou cérebros 100% aleatórios (false) */
  instincts: boolean;
}

const DEFAULT_OPTIONS: SimOptions = { repopulate: true, mutationRate: 1, initialScale: 1, initialBushes: 1800, instincts: true };

/** 8 direções para "farejar" grama em volta */
const DIRX = Array.from({ length: 8 }, (_, k) => Math.cos((k * Math.PI) / 4));
const DIRZ = Array.from({ length: 8 }, (_, k) => Math.sin((k * Math.PI) / 4));

const emptyDeaths = (): Record<DeathCause, number>[] =>
  Array.from({ length: SPECIES_COUNT }, () => ({ fome: 0, sede: 0, frio: 0, velhice: 0, predação: 0 }));


export class Simulation {
  readonly world: SimWorld;
  readonly plants: Plants;
  readonly rng: Rng;
  readonly opts: SimOptions;
  creatures: Creature[] = [];
  readonly byId = new Map<number, Creature>();
  time = 0;
  tick = 0;
  private nextId = 1;
  /** os melhores genomas já vistos de cada espécie (para repovoar) */
  readonly hall: HallEntry[][] = Array.from({ length: SPECIES_COUNT }, () => []);
  readonly stats: StatsSample[] = [];
  private births: number[] = new Array(SPECIES_COUNT).fill(0);
  private deaths = emptyDeaths();
  private grassTimer = 0;
  private bushTimer = 0;
  private repopTimer = 0;
  private statsTimer = 0;
  /** eventos para a linha do tempo (ex.: "repovoamento dos cervos") */
  readonly events: { t: number; text: string }[] = [];
  carcasses: Carcass[] = [];
  private nextCarcassId = 1;
  /** espécies extintas no momento (para avisar só uma vez) */
  private extinct = new Array(SPECIES_COUNT).fill(false);
  /** total de caçadas bem-sucedidas por espécie de predador */
  readonly kills = new Array(SPECIES_COUNT).fill(0);

  // grade espacial das criaturas (células de 8×8 blocos), lista ligada em arrays
  private readonly GRID = 8;
  private readonly gx: number;
  private readonly gz: number;
  private readonly head: Int32Array;
  private next = new Int32Array(MAX_CREATURES * 2);

  constructor(maps: WorldMaps, seed: number, opts: Partial<SimOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.rng = createRng(seed ^ 0x5eed);
    this.world = new SimWorld(maps);
    this.plants = new Plants(this.world, this.rng, this.opts.initialBushes);
    this.gx = Math.ceil(this.world.sx / this.GRID);
    this.gz = Math.ceil(this.world.sz / this.GRID);
    this.head = new Int32Array(this.gx * this.gz);
    for (const cfg of SPECIES) {
      let n = Math.round(cfg.initialCount * this.opts.initialScale);
      while (n > 0) {
        const size = Math.min(n, cfg.groupSize);
        this.spawnGroup(cfg.id, size, () => null);
        n -= size;
      }
    }
    this.recordStats();
  }

  // ------------------------------------------------------------------
  // criação de criaturas
  // ------------------------------------------------------------------

  /** genoma "de fábrica" da espécie, com variação e cérebro aleatório */
  randomGenome(species: Species): Genome {
    const genes: Genes = { ...SPECIES[species].genes };
    mutateGenes(genes, this.rng, 2);
    const brain = this.opts.instincts ? instinctBrain(BRAIN_SHAPE, this.rng, SPECIES[species].diet) : randomBrain(BRAIN_SHAPE, this.rng);
    return { genes, brain };
  }

  /** Cria uma criatura nova no mundo. */
  addCreature(species: Species, genome: Genome, x: number, z: number, opts: Partial<Creature> = {}): Creature | null {
    if (this.creatures.length >= MAX_CREATURES) return null;
    const cfg = SPECIES[species];
    const g = genome.genes;
    const mass = cfg.mass * g.size ** 3;
    // reserva de energia: um adulto parado aguenta ~1,5 dia sem comer
    const maxEnergy = 300 * mass;
    const c: Creature = {
      id: this.nextId++, species, cfg, sex: this.rng.next() < 0.5 ? 0 : 1, genome,
      x, z, y: this.world.groundY(x, z), yaw: this.rng.next() * Math.PI * 2, v: 0,
      mass, energy: maxEnergy * 0.5, maxEnergy, hydration: 0.8, fatigue: 0, coldStress: 0, temp: 15,
      age: 0,
      // amadurecer: 15% da vida; metabolismo alto acelera
      maturity: (0.15 * g.maxAge) / Math.sqrt(g.metabolism),
      generation: 1, mother: 0, father: 0, children: 0, childIds: [],
      sleeping: false, eating: false, drinking: false, wantsMate: false, courting: false, attacking: false, nursing: false, landed: false, attackCd: 0, camo: 0,
      pregnant: null, cooldown: 0,
      alive: true, cause: null,
      input: new Float32Array(BRAIN_SHAPE.inputs),
      hidden: new Float32Array(BRAIN_SHAPE.hidden),
      output: new Float32Array(BRAIN_SHAPE.outputs),
      targets: {
        foodOk: false, foodX: 0, foodZ: 0, waterOk: false, waterX: 0, waterZ: 0,
        mate: null, friend: null, bush: null, prey: null, carcass: null, pred: null,
      },
      ...opts,
    };
    this.placeVertically(c);
    this.creatures.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  /** Ajusta a altura inicial conforme o meio: peixe no meio da água, pássaro pousado. */
  private placeVertically(c: Creature): void {
    const i = this.world.idx(c.x, c.z);
    if (c.cfg.medium === 'water') {
      const [lo, hi] = this.world.swimRange(i);
      c.y = (lo + hi) / 2;
    } else if (c.cfg.medium === 'air') {
      c.y = this.world.perchY(i);
      c.landed = true;
    }
  }

  /** Sorteia uma célula de chão com grama dentro de um dos biomas preferidos da espécie. */
  private homeCell(species: Species): number {
    const cfg = SPECIES[species];
    // peixes nascem em água rasa com algas
    if (cfg.medium === 'water') {
      const ac = this.plants.algaeCells;
      return ac.length ? ac[this.rng.int(0, ac.length - 1)] : -1;
    }
    const cells = this.plants.grassCells;
    for (let t = 0; t < 400 && cells.length > 0; t++) {
      const i = cells[this.rng.int(0, cells.length - 1)];
      if (cfg.homes.includes(this.world.maps.biome[i])) return i;
    }
    return -1;
  }

  /**
   * Solta um BANDO de `n` adultos perto um do outro (colônia de coelhos, manada de cervos).
   * Espalhados pelo mapa, eles quase nunca se encontrariam para acasalar.
   * `genome(k)` devolve o genoma do k-ésimo (null = aleatório).
   */
  spawnGroup(species: Species, n: number, genome: (k: number) => Genome | null): Creature[] {
    const center = this.homeCell(species);
    const out: Creature[] = [];
    if (center < 0) return out;
    const w = this.world;
    const cx = center % w.sx, cz = (center / w.sx) | 0;
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < 30; t++) {
        const x = cx + this.rng.gauss() * 4 + 0.5, z = cz + this.rng.gauss() * 4 + 0.5;
        const aquatic = SPECIES[species].medium === 'water';
        if (!w.inside(x, z) || w.isWater(w.idx(x, z)) !== aquatic) continue;
        const c = this.addCreature(species, genome(k) ?? this.randomGenome(species), x, z);
        if (!c) return out;
        c.age = c.maturity + this.rng.next() * (c.genome.genes.maxAge * 0.4);
        c.energy = c.maxEnergy * 0.7;
        c.fatigue = this.rng.next() * 0.3;
        out.push(c);
        break;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // passo da simulação
  // ------------------------------------------------------------------

  step(): void {
    const dt = DT;
    this.time += dt;
    this.tick++;
    const daylight = daylightAt(this.time);
    const night = 1 - daylight;

    this.buildGrid();
    const born: Creature[] = [];
    for (const c of this.creatures) if (c.alive) this.updateCreature(c, dt, night, born);

    // remove os mortos (guardando os melhores genomas no "hall da fama")
    if (this.creatures.some((c) => !c.alive)) {
      for (const c of this.creatures) if (!c.alive) this.onDeath(c);
      this.creatures = this.creatures.filter((c) => c.alive);
    }

    // carcaças apodrecem
    if (this.carcasses.length) {
      for (const k of this.carcasses) k.meat -= (k.max / CARCASS_LIFE) * dt;
      this.carcasses = this.carcasses.filter((k) => k.meat > 0);
    }

    if ((this.grassTimer += dt) >= 5) {
      this.plants.updateGrass(this.grassTimer, daylight);
      this.grassTimer = 0;
    }
    if ((this.bushTimer += dt) >= 1) {
      this.plants.updateBushes(this.bushTimer, this.rng);
      this.bushTimer = 0;
    }
    if ((this.repopTimer += dt) >= 5) {
      this.repopTimer = 0;
      if (this.opts.repopulate) this.repopulate();
    }
    if ((this.statsTimer += dt) >= STATS_EVERY) {
      this.statsTimer = 0;
      this.recordStats();
      this.checkExtinctions();
    }
  }

  private updateCreature(c: Creature, dt: number, night: number, born: Creature[]): void {
    const g = c.genome.genes;
    const w = this.world;
    const i = w.idx(c.x, c.z);
    c.age += dt;

    // ---- temperatura e conforto térmico ----
    // pelagem grossa e corpo grande aguentam mais frio; pelagem grossa sofre no calor
    const medium = c.cfg.medium;
    // na água a temperatura varia bem menos que no ar
    const T = medium === 'water' ? 0.5 * w.airTemp(i, night) + 7 : w.airTemp(i, night);
    c.temp = T;
    // regra de Bergmann: corpo pequeno tem mais superfície por volume e perde mais calor
    const comfortMin = 14 - 26 * g.fur - 8 * (g.size - 1);
    // e corpo grande demora a perder calor: sofre mais no calor
    const comfortMax = 30 - 12 * g.fur - 6 * (g.size - 1);
    c.coldStress = clamp((comfortMin - T) / 10, 0, 2);
    const heat = clamp((T - comfortMax) / 10, 0, 2);

    // camuflagem: cor do corpo contra a cor do chão onde está agora
    c.camo = w.camo(g.r, g.g, g.b, i);

    // ---- 1 e 2: sentir e pensar ----
    // busca cara a cada 3 passos (escalonada pelo id); filhote recém-nascido busca já
    if ((this.tick + c.id) % 3 === 0 || c.age <= DT) this.scan(c, i, night);
    this.sense(c, i, night);
    forward(c.genome.brain, c.input, c.hidden, c.output);
    const out = c.output;

    // ---- 3: agir ----
    // dormir é um estado: entra se a rede quiser e estiver cansado (ou se esgotar)
    if (c.sleeping) {
      // acorda se descansou, ou se a rede mandar (com predador perto, acorda mesmo cansado)
      const danger = c.input[8] > 0.3;
      if ((out[4] < -0.3 && (c.fatigue < 0.6 || danger)) || c.fatigue <= 0) c.sleeping = false;
    } else if ((out[4] > 0.3 && c.fatigue > 0.25) || c.fatigue >= 1) {
      c.sleeping = true;
    }
    c.wantsMate = out[5] > 0;
    c.eating = false;
    c.drinking = false;
    c.attacking = false;
    if (c.attackCd > 0) c.attackCd -= dt;
    let v = 0;
    if (!c.sleeping) {
      // pernas maiores = passada maior: corpo pequeno corre um pouco menos
      let sp = g.speed * g.size ** 0.35 * (out[1] + 1) / 2;
      const m = c.targets.mate;
      c.courting = c.wantsMate && m !== null && m.alive && m.wantsMate && this.ready(c) && this.ready(m);
      if (c.courting) {
        // CORTE: o cérebro decidiu "quero acasalar" e ouviu um parceiro pronto;
        // vai até ele (reflexo inato). Escolher a hora certa é com a evolução:
        // cortejar com fome ou sede pode custar caro.
        const want = Math.atan2(m!.z - c.z, m!.x - c.x);
        const diff = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
        c.yaw += clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
        sp = Math.max(sp, g.speed * 0.6);
      } else if (c.age < c.maturity * 0.5 && this.followMother(c, dt)) {
        // filhote pequeno longe da mãe vai atrás dela (reflexo inato)
        sp = Math.max(sp, g.speed * 0.9);
      } else {
        c.yaw += out[0] * TURN_RATE * dt;
      }
      if (c.age < c.maturity) sp *= 0.8;
      if (c.fatigue > 0.9) sp *= 0.5;
      if (out[2] > 0) {
        if (c.cfg.diet === 'meat') this.tryHunt(c, dt);
        else this.tryEat(c, i, dt);
      }
      if (out[3] > 0 && medium !== 'water') this.tryDrink(c, i, dt);
      if ((c.eating || c.drinking) && !c.attacking) sp *= 0.2;
      v = this.moveBy(c, i, sp, out[6], dt);
    } else if (medium === 'air' && !c.landed) {
      // dormiu voando: plana para baixo até pousar
      v = this.moveBy(c, i, 1, -1, dt);
    }
    c.v = v;

    // ---- 4: gastar energia ----
    const m = c.mass;
    // lei de Kleiber: metabolismo basal ∝ massa^0,75 (bicho grande gasta menos por quilo);
    // normalizado pela massa da espécie para manter os números de cada uma
    const kleiber = c.cfg.mass * (m / c.cfg.mass) ** 0.75;
    let burn = 0.25 * c.cfg.basal * kleiber * g.metabolism * (1 + 0.6 * g.fur * g.fur) * (1 + 1.5 * c.coldStress);
    if (c.sleeping) burn *= 0.6;
    // filhote: corpo bem menor (recém-nascido gasta 30% de um adulto; jovem, 60%)
    if (c.age < c.maturity) burn *= c.age < c.maturity * 0.5 ? 0.3 : 0.6;
    burn += 0.25 * m * (v / 5) ** 2; // movimento: ∝ massa × velocidade² (correr no máximo custa caro)
    // cérebro e olhos têm custo FIXO por indivíduo (não diminuem com o corpo);
    // sem isso a evolução encolhe os bichos sem limite (nanismo)
    burn += 0.1 + 0.004 * g.vision;
    // bater asas custa caro: voar gasta mais que andar
    if (medium === 'air' && !c.landed) burn += 0.35 * m;
    c.energy -= burn * dt;
    if (medium === 'water') c.hydration = 1; // peixe não passa sede
    else c.hydration -= (dt / 600) * (1 + heat) * (v > 0.5 ? 1.2 : 1);
    if (c.sleeping) c.fatigue -= (dt / 170) * g.metabolism;
    else c.fatigue += (dt / 650) * (1 + (0.5 * v) / g.speed) * (1 + 0.4 * night);
    c.fatigue = clamp(c.fatigue, 0, 1);
    if (c.cooldown > 0) c.cooldown -= dt;

    // ---- amamentação: filhote pequeno perto da mãe recebe energia dela ----
    c.nursing = false;
    // (peixes nascem de ovos e se viram sozinhos; pássaros alimentam os filhotes no ninho)
    if (medium !== 'water' && c.age < c.maturity * 0.5 && c.energy < c.maxEnergy * 0.35) this.nurse(c, dt);

    // ---- 5: reprodução ----
    if (c.pregnant) {
      c.pregnant.timer -= dt;
      if (c.pregnant.timer <= 0) this.giveBirth(c, born);
    } else if (c.sex === 0 && c.wantsMate && this.ready(c)) {
      this.tryMate(c);
    }

    // ---- morte ----
    if (c.energy <= 0) this.kill(c, c.coldStress > 0.4 ? 'frio' : 'fome');
    else if (c.hydration <= 0) this.kill(c, 'sede');
    else if (c.age >= g.maxAge) this.kill(c, 'velhice');
  }

  /** valor de comida de uma célula PARA ESTA espécie (coelho não alcança folhas de árvore) */
  private foodAt(c: Creature, j: number): number {
    if (c.cfg.diet === 'meat') return 0;
    const grass = Math.max(0, this.plants.grass[j] - c.cfg.grazeMin);
    return grass * c.cfg.grassEff + this.plants.browse[j] * c.cfg.browseEff + this.plants.algae[j] * c.cfg.algaeEff;
  }

  /**
   * BUSCA de alvos (a parte cara): comida, água, parceiro e grupo.
   * Roda a cada 3 passos por criatura (escalonado pelo id, para dividir o trabalho).
   * Os alvos ficam guardados; as entradas da rede são recalculadas todo passo a
   * partir deles (barato), então a direção continua certa enquanto o bicho vira.
   */
  private scan(c: Creature, i: number, night: number): void {
    const g = c.genome.genes;
    const w = this.world;
    // à noite enxerga metade; dormindo, quase nada (só o que está bem perto)
    const vision = g.vision * (1 - 0.5 * night) * (c.sleeping ? 0.3 : 1);
    const t = c.targets;
    const carnivore = c.cfg.diet === 'meat';

    // --- comida (herbívoros): farejada em 8 direções × 3 distâncias, ou arbusto com fruta ---
    let best = 0, tx = 0, tz = 0, found = false;
    for (let k = 0; k < (carnivore ? 0 : 8); k++) {
      for (let s = 0; s < 3; s++) {
        const dist = s === 0 ? 2 : s === 1 ? vision * 0.5 : vision;
        const px = c.x + DIRX[k] * dist, pz = c.z + DIRZ[k] * dist;
        if (!w.inside(px, pz)) continue;
        const val = this.foodAt(c, w.idx(px, pz));
        if (val < 0.25) continue;
        const score = val / (1 + dist * 0.15);
        if (score > best) { best = score; tx = px; tz = pz; found = true; }
      }
    }
    if (c.cfg.fruitEff > 0) {
      const bush = this.plants.nearestBush(c.x, c.z, vision, true);
      t.bush = bush ? bush.bush : null;
      if (bush && (!found || 1.5 / (1 + bush.d * 0.15) > best)) {
        tx = bush.bush.x + 0.5; tz = bush.bush.z + 0.5; found = true;
      }
    }
    // --- carcaça (predadores): comida parada, ninguém precisa caçar ---
    t.carcass = null;
    if (carnivore) {
      let cd = vision * vision;
      for (const k of this.carcasses) {
        if (!HUNTS[c.species][k.species]) continue;
        const d = (k.x - c.x) ** 2 + (k.z - c.z) ** 2;
        if (d < cd) { cd = d; t.carcass = k; }
      }
    }
    t.foodOk = found; t.foodX = tx; t.foodZ = tz;

    // --- água mais próxima (campo pré-calculado) ---
    const wi = w.nearestWater[i];
    t.waterOk = wi >= 0;
    if (wi >= 0) { t.waterX = (wi % w.sx) + 0.5; t.waterZ = ((wi / w.sx) | 0) + 0.5; }

    // --- parceiro, grupo, presa e predador: varre a grade espacial em volta (sem closure: é o laço mais quente) ---
    // parceiro é percebido de 2× mais longe (chamados de acasalamento, cheiro);
    // sem isso, populações ralas não se encontram e somem (efeito Allee)
    const adult = c.age >= c.maturity;
    const mateRange = adult ? vision * MATE_CALL : 0;
    let mate: Creature | null = null, md = mateRange * mateRange;
    let friend: Creature | null = null, fd = vision * vision;
    let prey: Creature | null = null, pd = Infinity;
    let pred: Creature | null = null, qd = Infinity;
    const hunts = HUNTS[c.species];
    const r = Math.max(vision, mateRange);
    const G = this.GRID;
    const x0 = clamp(Math.floor((c.x - r) / G), 0, this.gx - 1), x1 = clamp(Math.floor((c.x + r) / G), 0, this.gx - 1);
    const z0 = clamp(Math.floor((c.z - r) / G), 0, this.gz - 1), z1 = clamp(Math.floor((c.z + r) / G), 0, this.gz - 1);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        for (let k = this.head[gx + gz * this.gx]; k >= 0; k = this.next[k]) {
          const o = this.creatures[k];
          if (o === c || !o.alive) continue;
          const dx = o.x - c.x, dz = o.z - c.z, d = dx * dx + dz * dz;
          if (o.species !== c.species) {
            // outra espécie: presa (se eu caço ela) ou predador (se ela me caça).
            // CAMUFLAGEM: quem tem a cor parecida com o chão só é notado mais de perto;
            // andar rápido denuncia (a camuflagem vale menos em movimento)
            const isPrey = hunts[o.species] && this.canReach(c, o), isPred = HUNTS[o.species][c.species] && this.canReach(o, c);
            if (!isPrey && !isPred) continue;
            const hidden = o.camo * (o.v > 1.5 ? 0.4 : 1);
            const seen = vision * (1 - CAMO_STRENGTH * hidden);
            if (d > seen * seen) continue;
            if (isPrey && d < pd) { pd = d; prey = o; }
            if (isPred && d < qd) { qd = d; pred = o; }
            continue;
          }
          // mesma espécie e canibal (peixe): o bem menor é presa; o bem maior é predador
          if (c.cfg.cannibal && d <= vision * vision) {
            const so = o.genome.genes.size, sc = c.genome.genes.size;
            if (so < sc * 0.7 && d < pd) { pd = d; prey = o; }
            else if (sc < so * 0.7 && d < qd) { qd = d; pred = o; }
          }
          if (d < fd) { fd = d; friend = o; }
          // parceiro só conta se estiver PRONTO (senão a fêmea mira um macho que não pode acasalar)
          if (adult && o.sex !== c.sex && this.ready(o)) {
            // seleção sexual: a fêmea "mede" o macho pela distância dividida pelo tamanho²
            // (um macho 40% maior vale tanto quanto um normal que está a metade da distância)
            const score = c.sex === 0 ? d / (o.genome.genes.size ** 4) : d;
            if (score < md && d <= mateRange * mateRange) { md = score; mate = o; }
          }
        }
      }
    }
    t.mate = mate;
    t.friend = friend;
    t.prey = prey;
    t.pred = pred;
  }

  /** Preenche as entradas da rede neural a partir dos alvos guardados. Ver INPUT_LABELS. */
  private sense(c: Creature, i: number, night: number): void {
    const inp = c.input;
    inp.fill(0);
    const w = this.world;
    const vision = c.genome.genes.vision * (1 - 0.5 * night);
    const t = c.targets;

    if (c.cfg.diet === 'meat') {
      // predador: a "comida" é a carcaça (se estiver perto) ou a presa visível mais próxima
      const k = t.carcass, p = t.prey;
      const kd = k && k.meat > 0 ? (k.x - c.x) ** 2 + (k.z - c.z) ** 2 : Infinity;
      const pd = p && p.alive ? (p.x - c.x) ** 2 + (p.z - c.z) ** 2 : Infinity;
      if (kd < 2.5) { inp[1] = 1; inp[2] = 1; }
      else if (kd <= pd && k) this.dirInput(c, 0, k.x, k.z, vision);
      else if (p && p.alive) this.dirInput(c, 0, p.x, p.z, vision);
      else if (t.foodOk) this.dirInput(c, 0, t.foodX, t.foodZ, vision); // onívoro: frutas
    } else if (this.foodAt(c, i) > 0.2) {
      // comida sob os pés: "está aqui, à frente, pertíssimo"
      inp[1] = 1; inp[2] = 1;
    } else if (t.foodOk) this.dirInput(c, 0, t.foodX, t.foodZ, vision);
    if (t.waterOk) this.dirInput(c, 3, t.waterX, t.waterZ, vision * 1.5);
    // predador visível mais próximo (presas fogem dele)
    if (t.pred && t.pred.alive) this.dirInput(c, 6, t.pred.x, t.pred.z, vision);
    if (t.mate && t.mate.alive) this.dirInput(c, 9, t.mate.x, t.mate.z, vision * MATE_CALL);
    if (t.friend && t.friend.alive) this.dirInput(c, 12, t.friend.x, t.friend.z, vision);

    // --- estado interno ---
    inp[15] = 1 - c.energy / c.maxEnergy; // fome
    inp[16] = 1 - c.hydration; // sede
    inp[17] = c.fatigue;
    inp[18] = Math.min(1, c.coldStress);
    inp[19] = night;

    // --- terreno à frente (ou altura, para quem nada/voa) ---
    const ax = c.x + Math.cos(c.yaw) * 1.5, az = c.z + Math.sin(c.yaw) * 1.5;
    if (c.cfg.medium === 'water') {
      // altura na coluna de água: -1 no fundo, +1 na superfície
      const [lo, hi] = w.swimRange(i);
      inp[20] = hi > lo ? clamp(((c.y - lo) / (hi - lo)) * 2 - 1, -1, 1) : 0;
      inp[21] = !w.inside(ax, az) || !w.isWater(w.idx(ax, az)) ? 1 : 0; // margem à frente
    } else if (c.cfg.medium === 'air') {
      // altura de voo: -1 pousado, 0 a 10 blocos, +1 a 20 blocos ou mais
      inp[20] = c.landed ? -1 : clamp((c.y - w.perchY(i)) / 10 - 1, -1, 1);
    } else if (w.inside(ax, az)) {
      const ai = w.idx(ax, az);
      const dh = w.maps.height[ai] - w.maps.height[i];
      inp[20] = clamp(dh / 2, -1, 1);
      inp[21] = w.isWater(ai) || dh > c.cfg.maxStep || dh < -3 ? 1 : 0;
    } else inp[21] = 1;
    inp[22] = 1; // constante (viés)
  }

  /** escreve [lado, frente, perto] de um alvo nas entradas base..base+2 (fora do alcance = zeros) */
  private dirInput(c: Creature, base: number, tx: number, tz: number, range: number): void {
    const dx = tx - c.x, dz = tz - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > range) return;
    const rel = Math.atan2(dz, dx) - c.yaw;
    c.input[base] = Math.sin(rel);
    c.input[base + 1] = Math.cos(rel);
    c.input[base + 2] = 1 - d / range;
  }

  /** come fruta do arbusto-alvo se ele estiver ao alcance; devolve true se estava */
  private eatFruit(c: Creature, dt: number): boolean {
    if (c.cfg.medium === 'air' && !c.landed) return false; // pássaro precisa pousar para comer
    const reach = 1.3 + c.genome.genes.size * 0.3;
    const b = c.targets.bush;
    if (!b || b.fruit < 1 || (b.x + 0.5 - c.x) ** 2 + (b.z + 0.5 - c.z) ** 2 > reach * reach) return false;
    c.eating = true;
    // ~1 fruta a cada 0,7 s
    if (this.rng.next() < dt * 1.4) {
      b.fruit--;
      c.energy = Math.min(c.maxEnergy, c.energy + FRUIT_ENERGY * c.cfg.fruitEff);
      c.hydration = Math.min(1, c.hydration + 0.06); // fruta tem água
    }
    return true;
  }

  private tryEat(c: Creature, i: number, dt: number): void {
    if (c.energy >= c.maxEnergy * 0.98) return;
    const g = c.genome.genes;
    if (this.eatFruit(c, dt)) return;
    // peixe grande com fome come peixe pequeno ao alcance
    if (c.cfg.cannibal && c.energy < c.maxEnergy * 0.7 && this.attack(c)) return;
    // mordida ∝ massa (bicho grande come mais por bocada), digestão ∝ √metabolismo
    const bite = 0.5 * c.mass * Math.sqrt(g.metabolism) * dt;
    if (c.cfg.algaeEff > 0) {
      const got = this.plants.eatAlgae(i, bite);
      if (got > 0.001) {
        c.eating = true;
        c.energy = Math.min(c.maxEnergy, c.energy + got * ALGAE_ENERGY * c.cfg.algaeEff);
      }
      return;
    }
    // come o que render mais nesta célula: grama ou folhas de árvore
    const p = this.plants;
    // grama abaixo da altura mínima de pastejo da espécie não dá para morder
    const tall = Math.max(0, p.grass[i] - c.cfg.grazeMin);
    const useBrowse = c.cfg.browseEff * p.browse[i] > c.cfg.grassEff * tall;
    const got = useBrowse ? p.eatBrowse(i, bite) : p.eatGrass(i, Math.min(bite, tall));
    if (got > 0.001) {
      c.eating = true;
      const energy = useBrowse ? got * BROWSE_ENERGY * c.cfg.browseEff : got * GRASS_ENERGY * c.cfg.grassEff;
      c.energy = Math.min(c.maxEnergy, c.energy + energy);
      c.hydration = Math.min(1, c.hydration + got * 0.03); // folhas também hidratam um pouco
    }
  }

  /**
   * Predador quer "comer": se há carcaça ao alcance, come; senão, ataca a presa ao alcance.
   * Chance de o ataque dar certo:
   *   base × √(massa do predador / massa da presa)   (presa grande se defende)
   *   + 15% por companheiro de alcateia atacando junto (caça em grupo, até 3)
   *   + 40% se a presa está dormindo
   */
  private tryHunt(c: Creature, dt: number): void {
    const t = c.targets;
    const reach = 1.2 + c.genome.genes.size * 0.5;
    const k = t.carcass;
    if (k && k.meat > 0 && (k.x - c.x) ** 2 + (k.z - c.z) ** 2 <= reach * reach) {
      if (c.energy >= c.maxEnergy * 0.98) return;
      // mordida de carne ∝ massa, digestão ∝ √metabolismo
      const want = Math.min(k.meat, 25 * c.mass * Math.sqrt(c.genome.genes.metabolism) * dt, c.maxEnergy - c.energy);
      k.meat -= want;
      c.energy += want;
      c.hydration = Math.min(1, c.hydration + want * 0.0005); // carne tem água
      c.eating = true;
      return;
    }
    if (this.attack(c)) return;
    // onívoro (raposa, pássaro): sem presa ao alcance, come frutas
    // (a raposa só com fome de verdade: para ela a fruta é o "plano B")
    if (c.cfg.fruitEff > 0 && c.energy < c.maxEnergy * c.cfg.fruitHunger) this.eatFruit(c, dt);
  }

  /**
   * Tenta atacar a presa-alvo. Devolve false se não havia presa ao alcance.
   * Em 3D (peixes, pássaros) a distância vertical também conta.
   */
  private attack(c: Creature): boolean {
    const p = c.targets.prey;
    if (!p || !p.alive || c.attackCd > 0) return false;
    const r = 1.2 + c.genome.genes.size * 0.5 + p.genome.genes.size * 0.4;
    const dy = c.cfg.medium === 'land' && p.cfg.medium === 'land' ? 0 : p.y - c.y;
    if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 + dy * dy > r * r) return false;
    c.attacking = true;
    c.attackCd = ATTACK_COOLDOWN;
    c.energy -= c.maxEnergy * 0.01; // o bote cansa
    let pack = 0;
    this.forNear(c.x, c.z, 5, (o) => {
      if (o !== c && o.species === c.species && o.alive && !o.sleeping && o.output[2] > 0 &&
          (o.x - c.x) ** 2 + (o.z - c.z) ** 2 <= 25) pack++;
    });
    let chance = ATTACK_BASE * Math.sqrt(c.mass / p.mass) + PACK_BONUS * Math.min(3, pack);
    if (p.sleeping) chance += 0.4;
    if (this.rng.next() >= Math.min(0.95, chance)) return true;
    this.kill(p, 'predação');
    this.kills[c.species]++;
    if (c.cfg.medium !== 'land') {
      // peixe e pássaro engolem a presa inteira (não sobra carcaça)
      c.energy = Math.min(c.maxEnergy, c.energy + p.mass * MEAT_PER_MASS * 0.6);
      c.eating = true;
      return true;
    }
    // pegou: a presa morre e vira carcaça (que a alcateia pode dividir)
    this.carcasses.push({
      id: this.nextCarcassId++, x: p.x, z: p.z, y: p.y, species: p.species,
      meat: p.mass * MEAT_PER_MASS, max: p.mass * MEAT_PER_MASS,
    });
    return true;
  }

  /**
   * O predador consegue alcançar a presa pelo meio em que cada um está?
   *  - bicho de terra só pega pássaro POUSADO no chão (não no alto da árvore);
   *  - pássaro só pega peixe perto da superfície (até 1,5 bloco de profundidade).
   */
  private canReach(pred: Creature, prey: Creature): boolean {
    const pm = pred.cfg.medium, qm = prey.cfg.medium;
    if (qm === 'air' && pm === 'land') return prey.landed && prey.y - this.world.groundY(prey.x, prey.z) < 1.5;
    if (qm === 'water' && pm === 'air') {
      const top = this.world.maps.waterTop[this.world.idx(prey.x, prey.z)] + 1;
      return prey.y > top - 1.5;
    }
    return pm === qm || (pm === 'land' && qm === 'land');
  }

  /** vira o filhote na direção da mãe se ela estiver a mais de 3 blocos; true se virou */
  private followMother(c: Creature, dt: number): boolean {
    const m = this.byId.get(c.mother);
    if (!m || !m.alive) return false;
    const dx = m.x - c.x, dz = m.z - c.z;
    if (dx * dx + dz * dz < 9) return false;
    const diff = Math.atan2(Math.sin(Math.atan2(dz, dx) - c.yaw), Math.cos(Math.atan2(dz, dx) - c.yaw));
    c.yaw += clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
    return true;
  }

  /**
   * Amamentação: na primeira metade da infância, o filhote a menos de 8 blocos da mãe
   * recebe até 0,5% da energia máxima DELA por segundo, até ficar com 35% (filhote é pequeno).
   * A mãe paga, e para se cair abaixo de 30% (senão a ninhada a mata de fome).
   * Sem isso, filhotes de predador, que ainda não sabem caçar, morrem de fome.
   */
  private nurse(c: Creature, dt: number): void {
    const m = this.byId.get(c.mother);
    if (!m || !m.alive || m.energy < m.maxEnergy * 0.3) return;
    if ((m.x - c.x) ** 2 + (m.z - c.z) ** 2 > 64) return;
    const give = Math.min(c.maxEnergy * 0.35 - c.energy, m.maxEnergy * 0.005 * dt);
    if (give <= 0) return;
    m.energy -= give;
    c.energy += give * 0.9; // 10% se perde na conversão
    c.nursing = true;
  }

  private tryDrink(c: Creature, i: number, dt: number): void {
    if (c.hydration >= 0.99) return;
    const w = this.world;
    const wi = w.nearestWater[i];
    if (wi < 0) return;
    const dx = (wi % w.sx) + 0.5 - c.x, dz = ((wi / w.sx) | 0) + 0.5 - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1.7) return;
    c.drinking = true;
    c.hydration = Math.min(1, c.hydration + 0.35 * dt);
  }

  /**
   * Move conforme o meio e devolve a velocidade horizontal efetiva.
   * @param vert saída "subir/descer" do cérebro (-1..1), usada por quem nada ou voa
   */
  private moveBy(c: Creature, i: number, speed: number, vert: number, dt: number): number {
    const medium = c.cfg.medium;
    if (medium === 'land') { this.move(c, i, speed * dt); return speed; }
    const w = this.world;
    if (medium === 'water') {
      // nada em 3D, mas nunca sai da água (bloqueia na margem)
      const nx = c.x + Math.cos(c.yaw) * speed * dt, nz = c.z + Math.sin(c.yaw) * speed * dt;
      let ni = i;
      if (w.inside(nx, nz) && w.isWater(w.idx(nx, nz))) { c.x = nx; c.z = nz; ni = w.idx(nx, nz); } else speed = 0;
      const [lo, hi] = w.swimRange(ni);
      c.y = clamp(c.y + vert * 2 * dt, lo, Math.max(lo, hi));
      return speed;
    }
    // ar: pousado, só decola se o cérebro mandar subir; voando, sobe/desce e pousa ao tocar a copa/chão
    if (c.landed) {
      if (vert > 0.3 && !c.sleeping) { c.landed = false; c.y += 0.5; return speed; }
      // pousado: anda devagar pelo chão (pulinhos)
      const nx = c.x + Math.cos(c.yaw) * speed * 0.2 * dt, nz = c.z + Math.sin(c.yaw) * speed * 0.2 * dt;
      if (w.inside(nx, nz) && !w.isWater(w.idx(nx, nz))) { c.x = nx; c.z = nz; c.y = w.perchY(w.idx(nx, nz)); }
      return speed * 0.2;
    }
    const nx = c.x + Math.cos(c.yaw) * speed * dt, nz = c.z + Math.sin(c.yaw) * speed * dt;
    if (w.inside(nx, nz)) { c.x = nx; c.z = nz; }
    const ni = w.idx(c.x, c.z);
    const floor = w.perchY(ni);
    c.y = Math.min(floor + 25, c.y + vert * 4 * dt); // teto de voo: 25 blocos acima da copa/chão
    if (c.y <= floor) {
      if (w.isWater(ni)) c.y = floor + 0.3; // não pousa na água
      else { c.y = floor; c.landed = true; }
    }
    return speed;
  }

  /** Anda `dist` blocos para a frente, se o caminho não for água nem degrau alto demais. */
  private move(c: Creature, i: number, dist: number): void {
    if (dist <= 0) return;
    const w = this.world;
    const nx = c.x + Math.cos(c.yaw) * dist, nz = c.z + Math.sin(c.yaw) * dist;
    if (!w.inside(nx, nz)) return;
    const ni = w.idx(nx, nz);
    if (ni !== i) {
      if (w.isWater(ni)) return;
      const dh = w.maps.height[ni] - w.maps.height[i];
      if (dh > c.cfg.maxStep || dh < -3) return;
    }
    c.x = nx;
    c.z = nz;
    c.y = w.maps.height[ni] + 1;
  }

  private ready(c: Creature): boolean {
    return c.alive && !c.sleeping && !c.pregnant && c.cooldown <= 0 && c.age >= c.maturity &&
      c.energy >= c.maxEnergy * c.cfg.readyEnergy && c.hydration >= 0.3;
  }

  /** Reprodução sexuada: fêmea pronta encontra um macho pronto colado nela. */
  private tryMate(f: Creature): void {
    // entre os machos prontos por perto, ela escolhe o MAIOR (seleção sexual)
    let partner: Creature | null = null;
    this.forNear(f.x, f.z, 4, (o) => {
      if (o.species !== f.species || o.sex !== 1 || !o.wantsMate || !this.ready(o)) return;
      if ((o.x - f.x) ** 2 + (o.z - f.z) ** 2 > 16) return;
      if (!partner || o.genome.genes.size > partner.genome.genes.size) partner = o;
    });
    if (!partner) return;
    const m = partner as Creature;
    f.pregnant = { father: m.genome, fatherId: m.id, fatherGen: m.generation, timer: f.cfg.gestation };
    f.cooldown = f.pregnant.timer + 20;
    m.cooldown = 20;
    m.energy -= m.maxEnergy * 0.05;
  }

  private giveBirth(mother: Creature, born: Creature[]): void {
    const p = mother.pregnant!;
    mother.pregnant = null;
    const g = mother.genome.genes;
    const n = clamp(Math.round(g.litter + this.rng.gauss() * 0.4), 1, 8);
    // a mãe investe parte da energia (50% herbívoros, 30% predadores), dividida entre os filhotes:
    // ninhada grande = muitos filhotes fracos; pequena = poucos fortes
    const invest = mother.energy * mother.cfg.invest;
    mother.energy -= invest;
    const father = this.byId.get(p.fatherId);
    for (let k = 0; k < n; k++) {
      const genome = makeChild(mother.genome, p.father, this.rng, this.opts.mutationRate);
      const child = this.addCreature(mother.species, genome,
        clamp(mother.x + this.rng.gauss() * 0.6, 1, this.world.sx - 2),
        clamp(mother.z + this.rng.gauss() * 0.6, 1, this.world.sz - 2), {
          generation: Math.max(mother.generation, p.fatherGen) + 1,
          mother: mother.id, father: p.fatherId,
        });
      if (!child) break;
      child.energy = Math.min(child.maxEnergy, invest / n);
      child.hydration = 0.9;
      // nasce perto da mãe; se caiu no meio errado (terra/água), fica no lugar da mãe
      const aquatic = mother.cfg.medium === 'water';
      if (this.world.isWater(this.world.idx(child.x, child.z)) !== aquatic) { child.x = mother.x; child.z = mother.z; }
      if (mother.cfg.medium === 'land') child.y = this.world.groundY(child.x, child.z);
      else if (aquatic) child.y = mother.y;
      else { child.y = this.world.perchY(this.world.idx(child.x, child.z)); child.landed = true; }
      born.push(child);
      this.births[mother.species]++;
      for (const parent of [mother, father]) {
        if (!parent) continue;
        parent.children++;
        parent.childIds.push(child.id);
        if (parent.childIds.length > 30) parent.childIds.shift();
      }
    }
  }

  kill(c: Creature, cause: DeathCause): void {
    if (!c.alive) return;
    c.alive = false;
    c.cause = cause;
    this.deaths[c.species][cause]++;
  }

  private onDeath(c: Creature): void {
    this.byId.delete(c.id);
    // "aptidão" só para escolher quem guardar: filhos deixados + quanto da vida viveu
    const fitness = c.children + (0.5 * c.age) / c.genome.genes.maxAge;
    const hall = this.hall[c.species];
    if (hall.length < 16 || fitness > hall[hall.length - 1].fitness) {
      hall.push({ genome: c.genome, fitness, generation: c.generation });
      hall.sort((a, b) => b.fitness - a.fitness);
      if (hall.length > 16) hall.pop();
    }
  }

  /** Se uma espécie quase sumiu, solta novos indivíduos feitos dos melhores genomas. */
  private repopulate(): void {
    for (const cfg of SPECIES) {
      const count = this.creatures.reduce((n, c) => n + (c.species === cfg.id ? 1 : 0), 0);
      if (count >= 6) continue;
      // 2 bandos de 8: 6 de cada bando vêm dos melhores genomas guardados, 2 são aleatórios (diversidade)
      const hall = this.hall[cfg.id];
      for (let grp = 0; grp < 2; grp++) {
        const made = this.spawnGroup(cfg.id, 8, (k) =>
          hall.length > 0 && k < 6 ? mutatedCopy(hall[(k + grp * 6) % hall.length].genome, this.rng, this.opts.mutationRate) : null);
        made.forEach((c, k) => { if (hall.length > 0 && k < 6) c.generation = hall[(k + grp * 6) % hall.length].generation + 1; });
      }
      this.events.push({ t: this.time, text: `Repovoamento: ${cfg.plural.toLowerCase()} quase extintos` });
    }
  }

  // ------------------------------------------------------------------
  // grade espacial
  // ------------------------------------------------------------------

  private buildGrid(): void {
    this.head.fill(-1);
    if (this.next.length < this.creatures.length) this.next = new Int32Array(this.creatures.length * 2);
    for (let k = 0; k < this.creatures.length; k++) {
      const c = this.creatures[k];
      const cell = clamp(Math.floor(c.x / this.GRID), 0, this.gx - 1) + clamp(Math.floor(c.z / this.GRID), 0, this.gz - 1) * this.gx;
      this.next[k] = this.head[cell];
      this.head[cell] = k;
    }
  }

  /** chama fn para cada criatura nas células que cobrem o raio r (filtrar a distância é com quem chama) */
  forNear(x: number, z: number, r: number, fn: (c: Creature) => void): void {
    const x0 = clamp(Math.floor((x - r) / this.GRID), 0, this.gx - 1), x1 = clamp(Math.floor((x + r) / this.GRID), 0, this.gx - 1);
    const z0 = clamp(Math.floor((z - r) / this.GRID), 0, this.gz - 1), z1 = clamp(Math.floor((z + r) / this.GRID), 0, this.gz - 1);
    for (let gz = z0; gz <= z1; gz++)
      for (let gx = x0; gx <= x1; gx++)
        for (let k = this.head[gx + gz * this.gx]; k >= 0; k = this.next[k]) {
          const c = this.creatures[k];
          if (c) fn(c);
        }
  }

  // ------------------------------------------------------------------
  // estatísticas e dados para a tela
  // ------------------------------------------------------------------

  count(species: Species): number {
    let n = 0;
    for (const c of this.creatures) if (c.species === species) n++;
    return n;
  }

  /** avisa na linha do tempo quando uma espécie some (ou volta) */
  private checkExtinctions(): void {
    for (const cfg of SPECIES) {
      const n = this.count(cfg.id);
      if (n === 0 && !this.extinct[cfg.id]) {
        this.extinct[cfg.id] = true;
        this.events.push({ t: this.time, text: `Extinção: ${cfg.plural.toLowerCase()} desapareceram` });
      } else if (n > 0 && this.extinct[cfg.id]) this.extinct[cfg.id] = false;
    }
  }

  private recordStats(): void {
    const pop = new Array(SPECIES_COUNT).fill(0);
    const sums = Array.from({ length: SPECIES_COUNT }, () => ({ speed: 0, size: 0, vision: 0, fur: 0, metabolism: 0, litter: 0, camo: 0 }));
    const maxGen = new Array(SPECIES_COUNT).fill(0);
    for (const c of this.creatures) {
      pop[c.species]++;
      const s = sums[c.species], g = c.genome.genes;
      s.speed += g.speed; s.size += g.size; s.vision += g.vision; s.fur += g.fur; s.metabolism += g.metabolism; s.litter += g.litter; s.camo += c.camo;
      maxGen[c.species] = Math.max(maxGen[c.species], c.generation);
    }
    const genes = sums.map((s, k) => {
      const n = Math.max(1, pop[k]);
      return { speed: s.speed / n, size: s.size / n, vision: s.vision / n, fur: s.fur / n, metabolism: s.metabolism / n, litter: s.litter / n, camo: s.camo / n };
    });
    this.stats.push({
      t: this.time, pop, bushes: this.plants.bushes.length,
      grass: this.plants.totalGrass() / Math.max(1, this.plants.grassCells.length),
      births: this.births, deaths: this.deaths, genes, maxGen,
    });
    this.births = new Array(SPECIES_COUNT).fill(0);
    this.deaths = emptyDeaths();
  }
}
