/**
 * Greedy meshing (malha gulosa) de um chunk.
 *
 * Ideia: desenhar um quadrado por face visível de cada bloco gera milhões de
 * triângulos. O greedy meshing junta faces vizinhas iguais (mesmo bloco, mesma
 * direção e mesma oclusão de ambiente) em retângulos grandes.
 * Um chão plano de 32×32 vira 1 retângulo em vez de 1024.
 *
 * Algoritmo (Mikola Lysenko, 2012), para cada um dos 3 eixos d:
 *   - percorre os "planos" entre as camadas x[d] e x[d]+1;
 *   - monta uma máscara 2D com as faces visíveis nesse plano;
 *   - varre a máscara crescendo retângulos: primeiro na largura, depois na altura.
 *
 * Oclusão de ambiente (AO) por vértice: cada canto da face olha os 3 blocos
 * vizinhos (2 laterais + diagonal) e fica mais escuro quanto mais cercado.
 * É o que dá aquela sombra suave nos cantos e embaixo das copas.
 */
import { Block, OPAQUE, faceColor } from './blocks';
import type { VoxelWorld } from './voxelWorld';

export interface MeshBuffers {
  positions: Float32Array;
  normals: Int8Array;
  colors: Uint8Array;
  indices: Uint32Array;
  /** 255 no topo de blocos de grama, 128 no fundo da água (o shader pinta grama comida e algas) */
  grass: Uint8Array;
  quads: number;
}

export type MeshPass = 'opaque' | 'water';

/** Brilho por nível de AO (0 = canto totalmente cercado, 3 = livre) */
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

/** Array tipado que cresce sozinho (bem mais rápido que number[] com push) */
class Grow<T extends Float32Array | Int8Array | Uint8Array | Uint32Array> {
  len = 0;
  constructor(public buf: T, private make: (n: number) => T) {}
  ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    const nb = this.make(Math.max(this.buf.length * 2, this.len + extra));
    nb.set(this.buf);
    this.buf = nb;
  }
  result(): T {
    return this.buf.slice(0, this.len) as T;
  }
}

interface Padded {
  pad: Uint8Array;
  dims: number[];
  PX: number;
  PZ: number;
  hasWater: boolean;
}

/**
 * Cópia do chunk + 1 bloco de borda em volta num array local ("padded").
 * Assim o laço interno lê com aritmética de índices, sem checar limites do mundo.
 */
function buildPadded(world: VoxelWorld, cx: number, cz: number): Padded | null {
  const CS = world.cfg.chunkSize;
  const ox = cx * CS, oz = cz * CS;
  // só percorre Y até logo acima do bloco mais alto do chunk
  const maxY = highestBlock(world, ox, oz, CS);
  if (maxY < 0) return null;
  const dims = [CS, Math.min(world.cfg.height, maxY + 2), CS];
  const PX = CS + 2, PZ = CS + 2, PY = dims[1] + 2;
  const pad = new Uint8Array(PX * PY * PZ);
  const WATER = Block.WATER;
  let hasWater = false;
  for (let y = -1; y <= dims[1]; y++)
    for (let z = -1; z <= CS; z++)
      for (let x = -1; x <= CS; x++) {
        const id = world.get(ox + x, y, oz + z);
        if (id === WATER) hasWater = true;
        pad[(x + 1) + PX * ((z + 1) + PZ * (y + 1))] = id;
      }
  return { pad, dims, PX, PZ, hasWater };
}

/** Gera as duas malhas do chunk (blocos opacos e água) compartilhando a mesma cópia local. */
export function meshChunkAll(world: VoxelWorld, cx: number, cz: number): { opaque: MeshBuffers | null; water: MeshBuffers | null } {
  const p = buildPadded(world, cx, cz);
  if (!p) return { opaque: null, water: null };
  return { opaque: meshPadded(p, 'opaque'), water: p.hasWater ? meshPadded(p, 'water') : null };
}

export function meshChunk(world: VoxelWorld, cx: number, cz: number, pass: MeshPass): MeshBuffers | null {
  const p = buildPadded(world, cx, cz);
  if (!p || (pass === 'water' && !p.hasWater)) return null;
  return meshPadded(p, pass);
}

function meshPadded(p: Padded, pass: MeshPass): MeshBuffers | null {
  const { pad, dims, PX, PZ } = p;
  // cópias locais: no laço quente é mais rápido do que acessar o import
  const OP = OPAQUE, WATER = Block.WATER, AIR = Block.AIR;

  // passo (stride) no array local para cada eixo: x, y, z
  const S = [1, PX * PZ, PX];

  const pos = new Grow(new Float32Array(4096), (n) => new Float32Array(n));
  const nor = new Grow(new Int8Array(4096), (n) => new Int8Array(n));
  const col = new Grow(new Uint8Array(4096), (n) => new Uint8Array(n));
  const idx = new Grow(new Uint32Array(4096), (n) => new Uint32Array(n));
  const grs = new Grow(new Uint8Array(1024), (n) => new Uint8Array(n));
  let quads = 0;

  const x = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const du = dims[u], dv = dims[v];
    const Sd = S[d], Su = S[u], Sv = S[v];
    const mask = new Int32Array(du * dv);

    // AO dos 4 cantos de uma face cujo "lado de fora" é a célula ci.
    // Cantos na ordem (-u,-v), (+u,-v), (+u,+v), (-u,+v) = mesma ordem dos vértices do quad.
    const aoAt = (ci: number): number => {
      const sU0 = OP[pad[ci - Su]], sU1 = OP[pad[ci + Su]];
      const sV0 = OP[pad[ci - Sv]], sV1 = OP[pad[ci + Sv]];
      const c00 = OP[pad[ci - Su - Sv]], c10 = OP[pad[ci + Su - Sv]];
      const c11 = OP[pad[ci + Su + Sv]], c01 = OP[pad[ci - Su + Sv]];
      const a0 = sU0 && sV0 ? 0 : 3 - (sU0 + sV0 + c00);
      const a1 = sU1 && sV0 ? 0 : 3 - (sU1 + sV0 + c10);
      const a2 = sU1 && sV1 ? 0 : 3 - (sU1 + sV1 + c11);
      const a3 = sU0 && sV1 ? 0 : 3 - (sU0 + sV1 + c01);
      return a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
    };

    for (let layer = -1; layer < dims[d]; layer++) {
      // ---- 1) máscara do plano entre a camada "layer" e "layer+1" ----
      const aInside = layer >= 0, bInside = layer + 1 < dims[d];
      let n = 0;
      for (let j = 0; j < dv; j++) {
        // índice local da célula a = (layer, i, j) nos eixos (d, u, v), com +1 da borda
        let ia = (layer + 1) * Sd + (j + 1) * Sv + Su;
        for (let i = 0; i < du; i++, n++, ia += Su) {
          const a = pad[ia], b = pad[ia + Sd];
          let val = 0;
          if (pass === 'opaque') {
            const sa = OP[a], sb = OP[b];
            if (sa !== sb) {
              // bit 17: a face encosta na água (fundo de rio/lago/mar: onde crescem algas)
              if (sa && aInside) val = a | (1 << 8) | (aoAt(ia + Sd) << 9) | (b === WATER ? 1 << 17 : 0);
              else if (sb && bInside) val = b | (aoAt(ia) << 9) | (a === WATER ? 1 << 17 : 0);
            }
          } else {
            // água: só as faces que encostam no ar (a superfície e as quedas d'água)
            if (aInside && a === WATER && b === AIR) val = a | (1 << 8) | (0xff << 9);
            else if (bInside && b === WATER && a === AIR) val = b | (0xff << 9);
          }
          mask[n] = val;
        }
      }

      // ---- 2) varre a máscara juntando retângulos ----
      n = 0;
      for (let j = 0; j < dv; j++) {
        for (let i = 0; i < du;) {
          const m = mask[n];
          if (m === 0) { i++; n++; continue; }
          let w = 1;
          while (i + w < du && mask[n + w] === m) w++;
          let hgt = 1;
          grow: while (j + hgt < dv) {
            for (let k = 0; k < w; k++) if (mask[n + k + hgt * du] !== m) break grow;
            hgt++;
          }

          // ---- 3) emite o retângulo (4 vértices, 2 triângulos) ----
          const id = m & 0xff;
          const front = (m >> 8) & 1;
          const ao = (m >> 9) & 0xff;
          const sign = front ? 1 : -1;
          x[d] = layer + 1; x[u] = i; x[v] = j;
          const face: 0 | 1 | 2 = d === 1 ? (front ? 0 : 2) : 1;
          const rgb = faceColor(id, face);
          const aoV0 = ao & 3, aoV1 = (ao >> 2) & 3, aoV2 = (ao >> 4) & 3, aoV3 = (ao >> 6) & 3;
          const base = pos.len / 3;

          pos.ensure(12); nor.ensure(12); col.ensure(12); idx.ensure(6); grs.ensure(4);
          // 255 = topo de grama, 128 = topo debaixo d'água (algas), 0 = nada
          const wet = (m >> 17) & 1;
          const grassTop = face !== 0 ? 0 : wet ? 128 : (id === Block.GRASS || id === Block.FOREST_GRASS || id === Block.SWAMP_GRASS) ? 255 : 0;
          for (let k = 0; k < 4; k++) {
            // canto k: deslocamento (0|w) em u e (0|h) em v
            const ou = k === 1 || k === 2 ? w : 0;
            const ovv = k >= 2 ? hgt : 0;
            const p = pos.len;
            pos.buf[p] = x[0]; pos.buf[p + 1] = x[1]; pos.buf[p + 2] = x[2];
            pos.buf[p + u] += ou; pos.buf[p + v] += ovv;
            pos.len += 3;
            nor.buf[nor.len] = 0; nor.buf[nor.len + 1] = 0; nor.buf[nor.len + 2] = 0;
            nor.buf[nor.len + d] = sign * 127;
            nor.len += 3;
            const f = AO_CURVE[k === 0 ? aoV0 : k === 1 ? aoV1 : k === 2 ? aoV2 : aoV3];
            col.buf[col.len] = Math.round(rgb[0] * f);
            col.buf[col.len + 1] = Math.round(rgb[1] * f);
            col.buf[col.len + 2] = Math.round(rgb[2] * f);
            col.len += 3;
            grs.buf[grs.len++] = grassTop;
          }
          // troca a diagonal quando a escuridão está nela (evita "listras" de AO)
          const flip = aoV0 + aoV2 < aoV1 + aoV3;
          const I = idx.buf, L = idx.len;
          if (sign > 0) {
            if (flip) { I[L] = base; I[L + 1] = base + 1; I[L + 2] = base + 3; I[L + 3] = base + 1; I[L + 4] = base + 2; I[L + 5] = base + 3; }
            else { I[L] = base; I[L + 1] = base + 1; I[L + 2] = base + 2; I[L + 3] = base; I[L + 4] = base + 2; I[L + 5] = base + 3; }
          } else {
            if (flip) { I[L] = base; I[L + 1] = base + 3; I[L + 2] = base + 1; I[L + 3] = base + 1; I[L + 4] = base + 3; I[L + 5] = base + 2; }
            else { I[L] = base; I[L + 1] = base + 2; I[L + 2] = base + 1; I[L + 3] = base; I[L + 4] = base + 3; I[L + 5] = base + 2; }
          }
          idx.len += 6;
          quads++;

          for (let l = 0; l < hgt; l++) for (let k = 0; k < w; k++) mask[n + k + l * du] = 0;
          i += w; n += w;
        }
      }
    }
  }

  if (quads === 0) return null;
  return { positions: pos.result(), normals: nor.result(), colors: col.result(), indices: idx.result(), grass: grs.result(), quads };
}

function highestBlock(world: VoxelWorld, ox: number, oz: number, CS: number): number {
  let best = -1;
  for (let z = oz; z < oz + CS; z++) {
    for (let x = ox; x < ox + CS; x++) {
      for (let y = world.cfg.height - 1; y > best; y--) {
        if (world.get(x, y, z) !== Block.AIR) { best = y; break; }
      }
    }
  }
  return best;
}

/** Lista de buffers para transferir do worker sem copiar */
export function transferables(m: MeshBuffers | null): ArrayBuffer[] {
  if (!m) return [];
  return [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer, m.grass.buffer] as ArrayBuffer[];
}
