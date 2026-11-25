/**
 * Tribos humanas: evolução CULTURAL (além da genética).
 *
 *  - Cada tribo tem um centro, um estoque de recursos (madeira, pedra, comida, fibra)
 *    e um nível de CONHECIMENTO, que cresce com o tempo de sobrevivência, o tamanho
 *    do grupo e as construções feitas. Filhos herdam a tribo, e com ela o conhecimento.
 *  - Cada nível desbloqueia uma construção. As construções são BLOCOS DE VERDADE
 *    colocados no mundo: a vila aparece crescendo no mapa.
 *
 * O cérebro (genético) decide QUANDO trabalhar (saídas "coletar" e "construir");
 * a cultura da tribo decide O QUE coletar e COMO construir.
 */
import { Block } from '../world/blocks';
import type { SimWorld } from './simWorld';

export type Resource = 'wood' | 'stone' | 'food' | 'fiber';
export const RESOURCES: Resource[] = ['wood', 'stone', 'food', 'fiber'];
export const RESOURCE_LABEL: Record<Resource, string> = { wood: 'madeira', stone: 'pedra', food: 'comida', fiber: 'fibra' };

export type BuildingKey = 'fogueira' | 'abrigo' | 'cerca' | 'plantacao' | 'cais' | 'casa' | 'torre';

export interface BuildingDef {
  key: BuildingKey;
  name: string;
  /** gênero da palavra, para os textos ("o primeiro abrigo", "a primeira cerca") */
  g: 'o' | 'a';
  level: number;
  cost: Partial<Record<Resource, number>>;
  effect: string;
}

/** O que cada nível de conhecimento desbloqueia, e quanto custa. */
export const BUILDINGS: BuildingDef[] = [
  { key: 'fogueira', name: 'Fogueira', g: 'a', level: 1, cost: { wood: 4, stone: 2 }, effect: 'aquece à noite e afasta predadores' },
  { key: 'abrigo', name: 'Abrigo de madeira', g: 'o', level: 2, cost: { wood: 14, fiber: 4 }, effect: 'dormir protegido' },
  { key: 'cerca', name: 'Cerca', g: 'a', level: 3, cost: { wood: 24 }, effect: 'animais não entram na área da tribo' },
  { key: 'plantacao', name: 'Plantação', g: 'a', level: 4, cost: { wood: 6, fiber: 8 }, effect: 'comida renovável perto da tribo' },
  { key: 'cais', name: 'Cais de pesca', g: 'o', level: 5, cost: { wood: 12, fiber: 4 }, effect: 'pescar na água próxima' },
  { key: 'casa', name: 'Casa de pedra', g: 'a', level: 6, cost: { stone: 24, wood: 8 }, effect: 'abrigo melhor' },
  { key: 'torre', name: 'Torre de vigia', g: 'a', level: 6, cost: { stone: 18, wood: 6 }, effect: 'enxerga predadores de longe' },
];

/** conhecimento necessário para cada nível (índice = nível) */
export const LEVEL_KNOWLEDGE = [0, 2, 5, 9, 14, 20, 27];

export const TRIBE_NAMES: { name: string; color: number }[] = [
  { name: 'Azul', color: 0x3d7fd9 }, { name: 'Vermelha', color: 0xd9483d }, { name: 'Amarela', color: 0xe0c040 },
  { name: 'Verde', color: 0x4caf50 }, { name: 'Roxa', color: 0x9c5bd6 }, { name: 'Laranja', color: 0xe8862e },
  { name: 'Branca', color: 0xe8e8e8 }, { name: 'Preta', color: 0x3a3a3a },
];

export interface Tribe {
  id: number;
  name: string;
  color: number;
  cx: number;
  cz: number;
  founded: number;
  knowledge: number;
  level: number;
  store: Record<Resource, number>;
  /** construções feitas, na ordem */
  built: BuildingKey[];
  alive: boolean;
  members: number;
  /** alvos de coleta perto do centro (índices de célula), calculados uma vez */
  trees: number[];
  stones: number[];
  /** célula de água mais próxima do centro (para o cais), ou -1 */
  water: number;
  // efeitos das construções
  fire: { x: number; z: number } | null;
  shelters: { x: number; z: number }[];
  dock: { x: number; z: number } | null;
  farms: number;
  tower: boolean;
  /** peixes disponíveis para pescar no cais (renova devagar: pesca demais esgota) */
  fish: number;
}

/** acima disso a tribo se divide: parte do grupo funda uma tribo nova longe dali */
export const SPLIT_SIZE = 30;
export const FISH_MAX = 40;

export function levelFor(knowledge: number): number {
  let lv = 0;
  while (lv + 1 < LEVEL_KNOWLEDGE.length && knowledge >= LEVEL_KNOWLEDGE[lv + 1]) lv++;
  return lv;
}

/** próxima construção que a tribo já sabe fazer e ainda não fez */
export function nextBuilding(t: Tribe): BuildingDef | null {
  for (const b of BUILDINGS) if (b.level <= t.level && !t.built.includes(b.key)) return b;
  return null;
}

export function canAfford(t: Tribe, b: BuildingDef): boolean {
  return RESOURCES.every((r) => t.store[r] >= (b.cost[r] ?? 0));
}

/** recurso que mais falta para a próxima construção (ou comida/madeira se não há nada a construir) */
export function neededResource(t: Tribe): Resource {
  const b = nextBuilding(t);
  if (t.store.food < 4) return 'food';
  if (b) {
    let best: Resource | null = null, gap = 0;
    for (const r of RESOURCES) {
      const g = (b.cost[r] ?? 0) - t.store[r];
      if (g > gap && (r !== 'stone' || t.stones.length > 0)) { gap = g; best = r; }
    }
    if (best) return best;
  }
  return t.store.food < 20 ? 'food' : 'wood';
}

// ------------------------------------------------------------------
// plantas das construções (em blocos)
// ------------------------------------------------------------------

export interface Plan {
  x: number;
  z: number;
  /** [x, y, z, bloco, ...] para colocar no mundo */
  edits: number[];
  /** células que viram obstáculo para todos (2) ou só para animais (1, cerca) */
  block: { i: number; kind: 1 | 2 }[];
}

/**
 * Procura um lugar plano perto do centro e monta a planta da construção.
 * `used` = células já ocupadas por outras construções.
 */
export function planBuilding(key: BuildingKey, t: Tribe, w: SimWorld, used: Set<number>): Plan | null {
  const h = w.maps.height;
  if (key === 'cerca') return planFence(t, w, used);
  if (key === 'cais') return planDock(t, w);

  const size = key === 'fogueira' ? 3 : key === 'abrigo' ? 4 : key === 'plantacao' ? 5 : key === 'casa' ? 5 : 3;
  const [rMin, rMax] = key === 'fogueira' ? [0, 8] : key === 'plantacao' ? [6, 16] : [4, 18];
  for (let r = rMin; r <= rMax; r++) {
    const steps = Math.max(1, r * 4);
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const sx = Math.round(t.cx + Math.cos(a) * r - size / 2), sz = Math.round(t.cz + Math.sin(a) * r - size / 2);
      const cells: number[] = [];
      let lo = 999, hi = -1, ok = true;
      for (let dz = 0; dz < size && ok; dz++) for (let dx = 0; dx < size; dx++) {
        const x = sx + dx, z = sz + dz;
        if (!w.inside(x, z)) { ok = false; break; }
        const i = w.idx(x, z);
        if (w.isWater(i) || used.has(i) || w.structure[i] !== 0) { ok = false; break; }
        lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]);
        cells.push(i);
      }
      if (!ok || hi - lo > 2) continue; // até 2 blocos de desnível (o chão é nivelado com terra)
      return buildTemplate(key, sx, sz, size, hi, w);
    }
  }
  return null;
}

function buildTemplate(key: BuildingKey, sx: number, sz: number, size: number, base: number, w: SimWorld): Plan {
  const edits: number[] = [];
  const block: Plan['block'] = [];
  const put = (x: number, y: number, z: number, id: number) => edits.push(x, y, z, id);
  const edge = (dx: number, dz: number) => dx === 0 || dz === 0 || dx === size - 1 || dz === size - 1;
  const door = (dx: number, dz: number) => dz === 0 && dx === Math.floor(size / 2);
  for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) {
    const x = sx + dx, z = sz + dz, i = w.idx(x, z);
    // derruba o que estiver em cima (árvores, folhas) e nivela o chão da construção
    for (let y = w.maps.height[i] + 1; y <= base + 12; y++) put(x, y, z, Block.AIR);
    for (let y = w.maps.height[i] + 1; y <= base; y++) put(x, y, z, Block.DIRT);
    switch (key) {
      case 'fogueira':
        // anel de pedras com o fogo no meio
        if (dx === 1 && dz === 1) { put(x, base + 1, z, Block.CAMPFIRE); block.push({ i, kind: 2 }); }
        else put(x, base + 1, z, Block.COBBLE);
        break;
      case 'abrigo':
        if (edge(dx, dz) && !door(dx, dz)) {
          put(x, base + 1, z, Block.PLANK); put(x, base + 2, z, Block.PLANK);
          block.push({ i, kind: 2 });
        }
        put(x, base + 3, z, Block.THATCH);
        break;
      case 'plantacao':
        put(x, base, z, edge(dx, dz) ? Block.PLANK : Block.FARMLAND);
        if (!edge(dx, dz)) put(x, base + 1, z, Block.CROP);
        break;
      case 'casa':
        if (edge(dx, dz) && !door(dx, dz)) {
          for (let y = 1; y <= 3; y++) put(x, base + y, z, Block.COBBLE);
          block.push({ i, kind: 2 });
        }
        put(x, base + 4, z, Block.PLANK);
        break;
      case 'torre':
        for (let y = 1; y <= 7; y++) put(x, base + y, z, Block.COBBLE);
        if (edge(dx, dz) && (dx + dz) % 2 === 0) put(x, base + 8, z, Block.FENCE);
        block.push({ i, kind: 2 });
        break;
    }
  }
  return { x: sx + size / 2, z: sz + size / 2, edits, block };
}

/** cerca: anel de raio 11 em volta do centro, com dois portões (leste e oeste) */
function planFence(t: Tribe, w: SimWorld, used: Set<number>): Plan {
  const edits: number[] = [];
  const block: Plan['block'] = [];
  const seen = new Set<number>();
  for (let k = 0; k < 140; k++) {
    const a = (k / 140) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.12) continue; // portões
    const x = Math.round(t.cx + Math.cos(a) * 11), z = Math.round(t.cz + Math.sin(a) * 11);
    if (!w.inside(x, z)) continue;
    const i = w.idx(x, z);
    if (seen.has(i) || w.isWater(i) || used.has(i)) continue;
    seen.add(i);
    for (let y = w.maps.height[i] + 1; y <= w.maps.height[i] + 12; y++) edits.push(x, y, z, Block.AIR); // abre caminho
    edits.push(x, w.maps.height[i] + 1, z, Block.FENCE);
    block.push({ i, kind: 1 });
  }
  return { x: t.cx, z: t.cz, edits, block };
}

/** cais: tábuas saindo da margem mais próxima, 4 blocos água adentro */
function planDock(t: Tribe, w: SimWorld): Plan | null {
  if (t.water < 0) return null;
  const wx = t.water % w.sx, wz = (t.water / w.sx) | 0;
  const dx = wx - t.cx, dz = wz - t.cz;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const edits: number[] = [];
  for (let s = -1; s < 4; s++) {
    const x = Math.round(wx + ux * s), z = Math.round(wz + uz * s);
    if (!w.inside(x, z)) continue;
    const i = w.idx(x, z);
    const y = w.isWater(i) ? w.maps.waterTop[i] : w.maps.height[i] + 1;
    edits.push(x, y, z, Block.PLANK);
  }
  return { x: wx, z: wz, edits, block: [] };
}
