/**
 * Plantas: a base da cadeia alimentar.
 *
 *  - Grama: um valor 0..1 por bloco de chão. Cresce de forma logística
 *    (rápido no meio, devagar quando está quase cheia), proporcional à fertilidade
 *    do lugar e à luz do dia. Comida "fraca", mas está em todo lugar.
 *  - Arbustos: plantas individuais que dão frutas (comida "forte") e espalham
 *    sementes em volta quando estão maduros. Morrem se forem comidos demais.
 */
import type { Rng } from '../core/rng';
import type { SimWorld } from './simWorld';

export interface Bush {
  id: number;
  x: number;
  z: number;
  i: number; // índice da célula
  growth: number; // 0..1
  fruit: number; // 0..MAX_FRUIT
  timer: number;
}

export const MAX_FRUIT = 4;
export const GRASS_ENERGY = 6; // energia de 1 unidade de grama (uma célula cheia)
export const FRUIT_ENERGY = 15;
export const BROWSE_ENERGY = 8; // folhas baixas das árvores (só cervos alcançam)
export const BROWSE_GROWTH = 0.008;
/** taxa de crescimento da grama por segundo (célula fértil, de dia) */
export const GRASS_GROWTH = 0.002;
export const MAX_BUSHES = 2000;
/** algas: crescem no fundo de água rasa (até 8 blocos de profundidade) */
export const ALGAE_ENERGY = 5;
export const ALGAE_GROWTH = 0.004;

export class Plants {
  readonly grass: Float32Array;
  /** folhas ao alcance em volta das árvores (0..1), comida exclusiva de quem alcança */
  readonly browse: Float32Array;
  readonly browseCells: Int32Array;
  /** algas (0..1) no fundo das células de água rasa; comida dos peixes */
  readonly algae: Float32Array;
  readonly algaeCells: Int32Array;
  /** só as células onde grama pode crescer (evita varrer o mapa todo) */
  readonly grassCells: Int32Array;
  bushes: Bush[] = [];
  private nextBushId = 1;
  /** grade espacial dos arbustos (células de 8×8) para buscas rápidas */
  private readonly bushGrid: Bush[][];
  private readonly gw: number;
  private readonly gh: number;
  /** multiplicador global do crescimento (modo deus, estações) */
  growthMul = 1;

  constructor(readonly world: SimWorld, rng: Rng, initialBushes = 1800) {
    const N = world.sx * world.sz;
    this.gw = Math.ceil(world.sx / 8);
    this.gh = Math.ceil(world.sz / 8);
    this.bushGrid = Array.from({ length: this.gw * this.gh }, () => []);
    this.grass = new Float32Array(N);
    const cells: number[] = [];
    for (let i = 0; i < N; i++) {
      if (world.fertility[i] > 0) {
        cells.push(i);
        this.grass[i] = world.fertility[i] * (0.35 + 0.3 * rng.next());
      }
    }
    this.grassCells = Int32Array.from(cells);

    // folhas: células num raio de 4 blocos em volta de cada tronco
    this.browse = new Float32Array(N);
    const bc = new Set<number>();
    for (const t of world.maps.trees) {
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dz * dz > 16 || !world.inside(t.x + dx, t.z + dz)) continue;
        const i = world.idx(t.x + dx, t.z + dz);
        if (!world.isWater(i)) bc.add(i);
      }
    }
    this.browseCells = Int32Array.from(bc);
    for (const i of this.browseCells) this.browse[i] = 0.6 + 0.4 * rng.next();

    // algas: água com 1 a 8 blocos de profundidade (luz chega no fundo)
    this.algae = new Float32Array(N);
    const ac: number[] = [];
    for (let i = 0; i < N; i++) {
      const depth = world.maps.waterTop[i] - world.maps.height[i];
      if (depth >= 1 && depth <= 8) { ac.push(i); this.algae[i] = 0.4 + 0.4 * rng.next(); }
    }
    this.algaeCells = Int32Array.from(ac);

    // arbustos iniciais em lugares bem férteis
    let tries = 0;
    while (this.bushes.length < initialBushes && tries++ < initialBushes * 20) {
      const i = this.grassCells[rng.int(0, this.grassCells.length - 1)];
      if (world.fertility[i] < 0.5) continue;
      const b = this.addBush(i, rng);
      if (b) { b.growth = 0.5 + 0.5 * rng.next(); b.fruit = rng.int(0, MAX_FRUIT); }
    }
  }

  /** Atualiza a grama (chamar a cada poucos segundos com o dt acumulado). */
  updateGrass(dt: number, daylight: number): void {
    const g = this.grass, f = this.world.fertility, cells = this.grassCells;
    const k = GRASS_GROWTH * dt * (0.25 + 0.75 * daylight) * this.growthMul;
    for (let n = 0; n < cells.length; n++) {
      const i = cells[n];
      const cap = f[i] > 1 ? 1 : f[i];
      const v = g[i];
      // logística com um "piso" (raízes): grama comida até o fim ainda rebrota
      const nv = v + k * f[i] * (v + 0.15) * (1 - v / cap);
      g[i] = nv > cap ? cap : nv;
    }
    // algas: logística, mais rápidas na água mais rasa (mais luz)
    const a = this.algae, ka = ALGAE_GROWTH * dt * (0.2 + 0.8 * daylight) * this.growthMul;
    for (let n = 0; n < this.algaeCells.length; n++) {
      const i = this.algaeCells[n];
      const v = a[i];
      a[i] = Math.min(1, v + ka * (v + 0.1) * (1 - v));
    }
    // folhas das árvores: mesma ideia, sem depender da fertilidade do chão
    const b = this.browse, kb = BROWSE_GROWTH * dt * (0.25 + 0.75 * daylight) * this.growthMul;
    for (let n = 0; n < this.browseCells.length; n++) {
      const i = this.browseCells[n];
      const v = b[i];
      b[i] = Math.min(1, v + kb * (v + 0.15) * (1 - v));
    }
  }

  /** Come até `amount` de algas da célula i; devolve quanto comeu. */
  eatAlgae(i: number, amount: number): number {
    const got = Math.min(this.algae[i], amount);
    this.algae[i] -= got;
    return got;
  }

  /** Come até `amount` de folhas da célula i; devolve quanto comeu. */
  eatBrowse(i: number, amount: number): number {
    const got = Math.min(this.browse[i], amount);
    this.browse[i] -= got;
    return got;
  }

  /** Arbustos: frutificam, espalham sementes e morrem se forem muito comidos. */
  updateBushes(dt: number, rng: Rng): void {
    const born: number[] = [];
    for (const b of this.bushes) {
      const fert = this.world.fertility[b.i];
      if (b.growth < 1) b.growth = Math.min(1, b.growth + dt * 0.004 * fert * this.growthMul);
      b.timer -= dt;
      if (b.timer > 0) continue;
      b.timer = 90 + rng.next() * 60;
      if (b.growth >= 0.8 && b.fruit < MAX_FRUIT && rng.next() < fert * this.growthMul) b.fruit++;
      // semente: cai a até 7 blocos de distância
      if (b.growth >= 1 && rng.next() < 0.06 * this.growthMul) {
        const x = b.x + rng.int(-7, 7), z = b.z + rng.int(-7, 7);
        if (this.world.inside(x, z)) born.push(this.world.idx(x, z));
      }
    }
    for (const i of born) if (this.world.fertility[i] > 0.3) this.addBush(i, rng);
    if (this.bushes.some((b) => b.growth <= 0)) {
      for (const b of this.bushes) if (b.growth <= 0) this.removeFromGrid(b);
      this.bushes = this.bushes.filter((b) => b.growth > 0);
    }
  }

  addBush(i: number, rng: Rng): Bush | null {
    if (this.bushes.length >= MAX_BUSHES) return null;
    const x = i % this.world.sx, z = (i / this.world.sx) | 0;
    // não nasce colado em outro arbusto
    if (this.nearestBush(x + 0.5, z + 0.5, 2.5, false)) return null;
    const b: Bush = { id: this.nextBushId++, x, z, i, growth: 0.05, fruit: 0, timer: rng.next() * 30 };
    this.bushes.push(b);
    this.bushGrid[this.gridKey(x, z)].push(b);
    return b;
  }

  private gridKey(x: number, z: number): number {
    return (x >> 3) + (z >> 3) * this.gw;
  }

  private removeFromGrid(b: Bush): void {
    const list = this.bushGrid[this.gridKey(b.x, b.z)];
    const k = list.indexOf(b);
    if (k >= 0) list.splice(k, 1);
  }

  /** Arbusto mais próximo (opcionalmente só os que têm fruta) dentro do raio r. */
  nearestBush(x: number, z: number, r: number, withFruit: boolean): { bush: Bush; d: number } | null {
    let best: Bush | null = null, bd = r * r;
    const x0 = Math.max(0, Math.floor((x - r) / 8)), x1 = Math.min(this.gw - 1, Math.floor((x + r) / 8));
    const z0 = Math.max(0, Math.floor((z - r) / 8)), z1 = Math.min(this.gh - 1, Math.floor((z + r) / 8));
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const list = this.bushGrid[gx + gz * this.gw];
      for (let n = 0; n < list.length; n++) {
        const b = list[n];
        if (withFruit && b.fruit < 1) continue;
        const dx = b.x + 0.5 - x, dz = b.z + 0.5 - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best ? { bush: best, d: Math.sqrt(bd) } : null;
  }

  /** Come até `amount` de grama da célula i; devolve quanto comeu. */
  eatGrass(i: number, amount: number): number {
    const got = Math.min(this.grass[i], amount);
    this.grass[i] -= got;
    return got;
  }

  /**
   * Textura das plantas do chão, 2 bytes por bloco: R = grama (0..255), G = algas (0..255).
   * O shader do terreno usa R no topo dos blocos de grama e G no fundo da água.
   */
  grassBytes(): Uint8Array {
    const out = new Uint8Array(this.grass.length * 2);
    for (let n = 0; n < this.grassCells.length; n++) {
      const i = this.grassCells[n];
      const f = Math.min(1, this.world.fertility[i]);
      out[i * 2] = Math.round(Math.min(1, this.grass[i] / Math.max(0.2, f)) * 255);
    }
    for (let n = 0; n < this.algaeCells.length; n++) {
      const i = this.algaeCells[n];
      out[i * 2 + 1] = Math.round(this.algae[i] * 255);
    }
    return out;
  }

  totalGrass(): number {
    let s = 0;
    for (let n = 0; n < this.grassCells.length; n++) s += this.grass[this.grassCells[n]];
    return s;
  }
}
