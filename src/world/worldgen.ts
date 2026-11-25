/**
 * Geração procedural do mundo.
 *
 * Etapas (cada uma comentada abaixo):
 *  1. Mapa de altura e biomas a partir de ruído simplex: altura + umidade + temperatura.
 *  2. Distância até o oceano (BFS) para guiar os rios até o mar.
 *  3. Lagos em depressões suaves.
 *  4. Rios que nascem nas montanhas e descem até o mar.
 *  5. Preenchimento das colunas de voxels (pedra, terra, topo do bioma, água).
 *  6. Árvores e cactos conforme o bioma.
 *
 * Tudo usa o RNG com seed, então a mesma seed sempre gera o mesmo mundo.
 */
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { createRng, type Rng } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import { Block } from './blocks';
import { Biome, WaterKind } from './biomes';
import { DEFAULT_CONFIG, VoxelWorld, type WorldConfig } from './voxelWorld';

export interface TreeInfo {
  x: number;
  y: number; // y do primeiro bloco do tronco
  z: number;
  kind: 'carvalho' | 'pinheiro' | 'pantano' | 'cacto';
}

export interface GeneratedWorld {
  seed: number;
  cfg: WorldConfig;
  voxels: VoxelWorld;
  /** y do bloco sólido mais alto de cada coluna (índice x + z*sizeX) */
  height: Uint8Array;
  /** y da superfície da água em cada coluna (0 = sem água) */
  waterTop: Uint8Array;
  waterKind: Uint8Array;
  biome: Uint8Array;
  temperature: Float32Array;
  humidity: Float32Array;
  trees: TreeInfo[];
  rivers: number;
  lakes: number;
}

/** Ruído fractal (fBm): soma de oitavas com frequência dobrando e amplitude caindo. */
function fbm(noise: NoiseFunction2D, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function generateWorld(seed: number, cfg: WorldConfig = DEFAULT_CONFIG): GeneratedWorld {
  const { sizeX: SX, sizeZ: SZ, seaLevel: SEA, height: H } = cfg;
  const N = SX * SZ;
  const rng = createRng(seed);
  // cada ruído recebe seu próprio fluxo do RNG (a ordem de criação é fixa → determinístico)
  const noise = () => createNoise2D(createRng(Math.floor(rng.next() * 2 ** 32)).next);
  const nCont = noise(), nHill = noise(), nRidge = noise(), nMount = noise();
  const nDetail = noise(), nTemp = noise(), nHum = noise(), nPond = noise(), nLake = noise(), nTree = noise();

  const height = new Float32Array(N);
  const biome = new Uint8Array(N);
  const temperature = new Float32Array(N);
  const humidity = new Float32Array(N);
  const mountainAmt = new Float32Array(N);

  // as faixas de borda escalam com o tamanho (permite mundos pequenos nos testes)
  const s = Math.min(SX, SZ) / 512;
  const edgeIn = 14 * s, edgeOut = 72 * s;

  // ---------- 1. altura, temperatura, umidade e bioma ----------
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      const i = x + z * SX;
      const edgeDist = Math.min(x, z, SX - 1 - x, SZ - 1 - z);
      // e = 0 na borda e 1 no interior → a borda vira sempre oceano profundo
      const e = smoothstep(edgeIn, edgeOut, edgeDist);

      const cont = fbm(nCont, x / 230, z / 230, 4);
      let land = cont * 0.6 + 0.3;
      land = land * e + -0.95 * (1 - e);
      let elev = land * 28; // blocos acima do nível do mar

      const landF = smoothstep(0, 8, elev);
      elev += fbm(nHill, x / 70, z / 70, 3) * 5 * smoothstep(-2, 6, elev);
      // montanhas: ruído "ridged" (1 - |n|) elevado ao cubo forma cristas pontudas
      const ridge = Math.pow(1 - Math.abs(fbm(nRidge, x / 140, z / 140, 4)), 3);
      const mMask = smoothstep(0.0, 0.4, fbm(nMount, x / 320, z / 320, 2));
      const mountain = ridge * mMask * 42 * landF;
      elev += mountain + fbm(nDetail, x / 18, z / 18, 2) * 1.2 * landF;
      // compressão suave dos picos para não "cortar" no teto do mundo
      if (elev > 34) elev = 34 + (elev - 34) * 0.55;

      // temperatura cai com a altitude; umidade é independente
      const t = 0.5 + 0.55 * fbm(nTemp, x / 400, z / 400, 3) - Math.max(0, elev) / 85;
      const hum = 0.5 + 0.55 * fbm(nHum, x / 300, z / 300, 3);

      let b: Biome;
      if (elev < 0) b = Biome.OCEAN;
      else if (hum > 0.66 && t > 0.35 && elev < 10 && mountain < 2) {
        b = Biome.SWAMP;
        // pântano é plano e encharcado, com poças no nível do mar
        elev = 0.8 + elev * 0.15 + fbm(nDetail, x / 18, z / 18, 2) * 0.4;
        if (fbm(nPond, x / 11, z / 11, 2) > 0.22) elev = -1;
      } else if (elev < 2.2) b = Biome.BEACH;
      else if (mountain > 9 || elev > 30) b = Biome.MOUNTAIN;
      else if (t - hum > 0.1 && t > 0.45) b = Biome.DESERT; // quente e seco
      else if (hum > 0.52) b = Biome.FOREST;
      else b = Biome.PLAINS;

      height[i] = clamp(Math.round(SEA + elev), 3, H - 14);
      biome[i] = b;
      temperature[i] = t;
      humidity[i] = hum;
      mountainAmt[i] = mountain;
    }
  }

  const h = new Int16Array(N);
  for (let i = 0; i < N; i++) h[i] = height[i];
  const hOrig = h.slice();
  const waterTop = new Uint8Array(N);
  const waterKind = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (h[i] < SEA) {
      waterTop[i] = SEA;
      waterKind[i] = WaterKind.OCEAN;
    }
  }

  // ---------- 2. distância até o oceano (busca em largura a partir de toda a água) ----------
  const distOcean = new Int32Array(N).fill(-1);
  {
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) if (waterKind[i] === WaterKind.OCEAN) { distOcean[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++];
      const x = i % SX, z = (i / SX) | 0;
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
        const j = nx + nz * SX;
        if (distOcean[j] < 0) { distOcean[j] = distOcean[i] + 1; queue[tail++] = j; }
      }
    }
  }

  // ---------- 3. lagos ----------
  const lakes = carveLakes(cfg, rng, nLake, h, biome, waterTop, waterKind);

  // ---------- 4. rios ----------
  const rivers = carveRivers(cfg, rng, h, hOrig, biome, distOcean, waterTop, waterKind);

  // ---------- 5. colunas de voxels ----------
  const voxels = new VoxelWorld(cfg);
  const B = voxels.blocks;
  const layer = SX * SZ;
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      const i = x + z * SX;
      const top = h[i];
      const wt = waterTop[i];
      const b = biome[i];
      const under = wt > top;

      // declive: diferença para o vizinho mais baixo → penhascos viram pedra
      let slope = 0;
      for (const [dx, dz] of DIR4) {
        const nx = clamp(x + dx, 0, SX - 1), nz = clamp(z + dz, 0, SZ - 1);
        slope = Math.max(slope, top - h[nx + nz * SX]);
      }

      let topB: number;
      let fill: number;
      if (under) {
        const k = waterKind[i];
        if (k === WaterKind.OCEAN) topB = top >= SEA - 5 ? Block.SAND : Block.GRAVEL;
        else if (b === Biome.SWAMP) topB = Block.MUD;
        else if (k === WaterKind.RIVER) topB = Block.GRAVEL;
        else topB = Block.SAND;
        fill = topB === Block.MUD ? Block.MUD : Block.SAND;
      } else {
        switch (b) {
          case Biome.BEACH:
          case Biome.DESERT:
          case Biome.OCEAN:
            topB = Block.SAND; fill = Block.SAND; break;
          case Biome.SWAMP:
            topB = Block.SWAMP_GRASS; fill = Block.MUD; break;
          case Biome.FOREST:
            topB = Block.FOREST_GRASS; fill = Block.DIRT; break;
          case Biome.MOUNTAIN: {
            const snowLine = SEA + 30 + (temperature[i] - 0.3) * 25 + fbm(nDetail, x / 9, z / 9, 1) * 3;
            if (top >= snowLine) { topB = Block.SNOW; fill = Block.STONE; }
            else if (top > SEA + 20 || slope > 2) { topB = Block.STONE; fill = Block.STONE; }
            else { topB = Block.GRASS; fill = Block.DIRT; }
            break;
          }
          default:
            topB = Block.GRASS; fill = Block.DIRT;
        }
        if (slope > 3 && topB !== Block.SNOW && topB !== Block.SAND) { topB = Block.STONE; fill = Block.STONE; }
      }

      for (let y = 0; y <= top; y++) {
        const d = top - y;
        B[i + layer * y] = d === 0 ? topB : d <= 3 ? fill : Block.STONE;
      }
      for (let y = top + 1; y <= wt; y++) B[i + layer * y] = Block.WATER;
    }
  }

  // ---------- 6. árvores ----------
  const trees = placeTrees(cfg, rng, nTree, voxels, h, waterTop, biome, temperature);

  const heightOut = new Uint8Array(N);
  for (let i = 0; i < N; i++) heightOut[i] = h[i];

  return {
    seed, cfg, voxels, height: heightOut, waterTop, waterKind, biome, temperature, humidity, trees, rivers, lakes,
  };
}

const DIR4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Lagos: regiões conexas onde um ruído de baixa frequência passa de um limiar,
 * em terreno pouco acidentado. O nível da água é a menor altura da região;
 * o fundo é escavado e as margens mais baixas que o nível são elevadas (dique),
 * para a água nunca "flutuar" sem parede.
 */
function carveLakes(
  cfg: WorldConfig, _rng: Rng, nLake: NoiseFunction2D,
  h: Int16Array, biome: Uint8Array, waterTop: Uint8Array, waterKind: Uint8Array,
): number {
  const { sizeX: SX, sizeZ: SZ, seaLevel: SEA } = cfg;
  const N = SX * SZ;
  const TH = 0.5;
  const val = new Float32Array(N);
  const ok = new Uint8Array(N);
  for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
    const i = x + z * SX;
    const b = biome[i];
    val[i] = fbm(nLake, x / 80, z / 80, 3);
    ok[i] = val[i] > TH && (b === Biome.PLAINS || b === Biome.FOREST) && h[i] >= SEA + 3 && h[i] <= SEA + 24 ? 1 : 0;
  }
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < N; start++) {
    if (!ok[start] || seen[start]) continue;
    // flood fill da região
    const comp: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % SX, z = (i / SX) | 0;
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
        const j = nx + nz * SX;
        if (ok[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (comp.length < 16 || comp.length > 4000) continue;
    let lo = Infinity, hi = -Infinity;
    for (const i of comp) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
    if (hi - lo > 7) continue;
    const level = lo;
    const inComp = new Set(comp);
    for (const i of comp) {
      const depth = clamp(1 + Math.floor((val[i] - TH) * 30), 1, 5);
      h[i] = level - depth;
      waterTop[i] = level;
      waterKind[i] = WaterKind.LAKE;
      const x = i % SX, z = (i / SX) | 0;
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
        const j = nx + nz * SX;
        if (!inComp.has(j) && h[j] < level && waterTop[j] === 0) h[j] = level; // dique
      }
    }
    count++;
  }
  return count;
}

/**
 * Rios: nascem em pontos altos das montanhas e descem escolhendo, a cada passo,
 * o vizinho de menor custo = altura + distância até o oceano (+ um pouco de acaso
 * para formar curvas). O nível da água só pode descer; quando o caminho sobe,
 * o terreno é escavado (forma um cânion). A largura cresce ao longo do percurso.
 */
function carveRivers(
  cfg: WorldConfig, rng: Rng, h: Int16Array, hOrig: Int16Array, biome: Uint8Array,
  distOcean: Int32Array, waterTop: Uint8Array, waterKind: Uint8Array,
): number {
  const { sizeX: SX, sizeZ: SZ, seaLevel: SEA } = cfg;
  const N = SX * SZ;
  const target = Math.max(1, Math.round((N / (512 * 512)) * 14));
  const sources: number[] = [];
  for (let tries = 0; tries < 6000 && sources.length < target; tries++) {
    const x = rng.int(0, SX - 1), z = rng.int(0, SZ - 1);
    const i = x + z * SX;
    if (biome[i] !== Biome.MOUNTAIN || hOrig[i] < SEA + 12 || hOrig[i] > SEA + 34) continue;
    const minDist = 60 * Math.min(SX, SZ) / 512;
    if (sources.some((s) => Math.hypot((s % SX) - x, ((s / SX) | 0) - z) < minDist)) continue;
    sources.push(i);
  }

  const visited = new Int32Array(N).fill(-1);
  let made = 0;
  sources.forEach((src, rid) => {
    const path: number[] = [];
    let cur = src;
    for (let step = 0; step < 4000; step++) {
      path.push(cur);
      visited[cur] = rid;
      if (hOrig[cur] < SEA || waterKind[cur] === WaterKind.OCEAN) break; // chegou ao mar
      const x = cur % SX, z = (cur / SX) | 0;
      let best = -1, bestCost = Infinity;
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
        const j = nx + nz * SX;
        if (visited[j] === rid) continue;
        const cost = hOrig[j] + distOcean[j] * 0.3 + rng.next() * 1.2;
        if (cost < bestCost) { bestCost = cost; best = j; }
      }
      if (best < 0) break;
      // encontrou outro rio: desemboca nele
      if (waterKind[best] === WaterKind.RIVER) { path.push(best); break; }
      cur = best;
    }
    if (path.length < 25) return;

    let level = hOrig[path[0]] - 1;
    for (let p = 0; p < path.length; p++) {
      const c = path[p];
      level = Math.max(SEA, Math.min(level, hOrig[c] - 1));
      const radius = Math.min(2.6, 0.7 + p / 110);
      const r = Math.ceil(radius);
      const cx = c % SX, cz = (c / SX) | 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
        const j = nx + nz * SX;
        if (waterKind[j] === WaterKind.OCEAN) continue;
        const bed = level - (d < radius - 1 ? 2 : 1);
        if (h[j] > bed) h[j] = bed;
        if (waterTop[j] < level) waterTop[j] = level;
        if (waterKind[j] !== WaterKind.LAKE) waterKind[j] = WaterKind.RIVER;
      }
    }
    made++;
  });
  return made;
}

function placeTrees(
  cfg: WorldConfig, rng: Rng, nTree: NoiseFunction2D, w: VoxelWorld,
  h: Int16Array, waterTop: Uint8Array, biome: Uint8Array, temperature: Float32Array,
): TreeInfo[] {
  const { sizeX: SX, sizeZ: SZ, height: H } = cfg;
  const trees: TreeInfo[] = [];
  const occupied = new Uint8Array(SX * SZ);
  for (let z = 2; z < SZ - 2; z++) {
    for (let x = 2; x < SX - 2; x++) {
      const i = x + z * SX;
      if (waterTop[i] > h[i]) continue;
      const top = w.get(x, h[i], z);
      const cluster = 0.5 + 0.5 * nTree(x / 40, z / 40); // bosques e clareiras
      let p = 0;
      let kind: TreeInfo['kind'] = 'carvalho';
      switch (biome[i]) {
        case Biome.FOREST: p = 0.07 * cluster + 0.01; kind = temperature[i] < 0.35 ? 'pinheiro' : 'carvalho'; break;
        case Biome.PLAINS: p = 0.006 * cluster; break;
        case Biome.SWAMP: p = 0.025; kind = 'pantano'; break;
        case Biome.MOUNTAIN: p = top === Block.GRASS ? 0.03 : 0; kind = 'pinheiro'; break;
        case Biome.DESERT: p = 0.004; kind = 'cacto'; break;
      }
      if (p === 0 || rng.next() >= p) continue;
      if (kind === 'cacto' ? top !== Block.SAND : top === Block.SAND || top === Block.STONE || top === Block.SNOW) continue;
      // espaçamento mínimo entre árvores
      const gap = kind === 'cacto' ? 3 : 2;
      let blocked = false;
      for (let dz = -gap; dz <= gap && !blocked; dz++) for (let dx = -gap; dx <= gap; dx++) {
        if (occupied[(x + dx) + (z + dz) * SX]) { blocked = true; break; }
      }
      if (blocked) continue;
      const y0 = h[i] + 1;
      if (y0 + 12 >= H) continue;
      occupied[i] = 1;
      buildTree(w, rng, x, y0, z, kind);
      trees.push({ x, y: y0, z, kind });
    }
  }
  return trees;
}

function setIfAir(w: VoxelWorld, x: number, y: number, z: number, id: number): void {
  if (w.get(x, y, z) === Block.AIR) w.set(x, y, z, id);
}

function buildTree(w: VoxelWorld, rng: Rng, x: number, y: number, z: number, kind: TreeInfo['kind']): void {
  if (kind === 'cacto') {
    const t = rng.int(2, 4);
    for (let k = 0; k < t; k++) w.set(x, y + k, z, Block.CACTUS);
    return;
  }
  if (kind === 'pinheiro') {
    const t = rng.int(6, 9);
    for (let k = 0; k < t; k++) w.set(x, y + k, z, Block.WOOD);
    // cone de folhas: raio diminui de baixo para cima
    for (let k = 2; k <= t + 1; k++) {
      const r = Math.max(0, Math.round(((t + 1 - k) / (t - 1)) * 2.4));
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
        setIfAir(w, x + dx, y + k, z + dz, Block.PINE_LEAVES);
      }
    }
    return;
  }
  if (kind === 'pantano') {
    const t = rng.int(3, 4);
    for (let k = 0; k < t; k++) w.set(x, y + k, z, Block.WOOD);
    for (let k = t - 1; k <= t; k++) {
      const r = k === t ? 2 : 3;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        if (r === 3 && rng.next() < 0.25) continue;
        setIfAir(w, x + dx, y + k, z + dz, Block.SWAMP_LEAVES);
      }
    }
    return;
  }
  // carvalho: tronco + copa arredondada com cantos irregulares
  const t = rng.int(4, 6);
  for (let k = 0; k < t; k++) w.set(x, y + k, z, Block.WOOD);
  const cy = y + t - 1;
  for (let dy = -1; dy <= 2; dy++) {
    const r = dy === 2 ? 1 : 2;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const corner = Math.abs(dx) === r && Math.abs(dz) === r;
      if (corner && (dy === 2 || rng.next() < 0.6)) continue;
      setIfAir(w, x + dx, cy + dy, z + dz, Block.LEAVES);
    }
  }
}
