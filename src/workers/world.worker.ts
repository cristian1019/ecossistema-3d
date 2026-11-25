/**
 * Worker do mundo: gera o terreno a partir da seed e monta as malhas dos chunks.
 *
 * Truque de paralelismo: como a geração é determinística, vários workers podem
 * gerar o MESMO mundo ao mesmo tempo, cada um a partir da seed, e cada um faz a
 * malha de uma parte dos chunks. Não é preciso mandar 25 MB de voxels entre threads.
 * (O worker da simulação faz o mesmo: recria o mundo pela seed.)
 *
 * Depois de pronto, o worker continua com os voxels na memória: quando os humanos
 * constroem algo, ele recebe os blocos novos, aplica e refaz a malha só dos chunks tocados.
 */
import { generateWorld, type GeneratedWorld } from '../world/worldgen';
import { meshChunkAll, transferables } from '../world/mesher';
import type { FromWorldWorker, ToWorldWorker } from './protocol';

const post = (msg: FromWorldWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

let world: GeneratedWorld | null = null;

function sendChunk(cx: number, cz: number): void {
  const { opaque, water } = meshChunkAll(world!.voxels, cx, cz);
  post({ type: 'chunk', cx, cz, opaque, water }, [...transferables(opaque), ...transferables(water)]);
}

self.onmessage = (e: MessageEvent<ToWorldWorker>) => {
  const msg = e.data;
  if (msg.type === 'edit') {
    if (!world) return;
    // aplica os blocos e anota quais chunks mudaram (e os vizinhos, se o bloco está na borda:
    // a face que encosta nele pode ter aparecido ou sumido)
    const CS = world.cfg.chunkSize;
    const touched = new Set<string>();
    const e4 = msg.edits;
    for (let k = 0; k < e4.length; k += 4) {
      const x = e4[k], y = e4[k + 1], z = e4[k + 2];
      world.voxels.set(x, y, z, e4[k + 3]);
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = Math.floor((x + dx) / CS), cz = Math.floor((z + dz) / CS);
        if (cx >= 0 && cz >= 0 && cx < world.voxels.chunksX && cz < world.voxels.chunksZ) touched.add(`${cx},${cz}`);
      }
    }
    for (const key of touched) {
      const [cx, cz] = key.split(',').map(Number);
      sendChunk(cx, cz);
    }
    return;
  }
  if (msg.type !== 'generate') return;
  const t0 = performance.now();
  const g = generateWorld(msg.seed);
  world = g;
  const genMs = performance.now() - t0;

  if (msg.sendMeta) {
    post({
      type: 'meta',
      meta: {
        seed: g.seed, cfg: g.cfg, height: g.height, waterTop: g.waterTop, waterKind: g.waterKind,
        biome: g.biome, rivers: g.rivers, lakes: g.lakes, trees: g.trees.length, genMs,
      },
    });
  }

  // chunks do centro para fora: o mundo "aparece" a partir do meio
  const { chunksX, chunksZ } = g.voxels;
  const order: [number, number][] = [];
  for (let cz = 0; cz < chunksZ; cz++) for (let cx = 0; cx < chunksX; cx++) order.push([cx, cz]);
  const mx = chunksX / 2 - 0.5, mz = chunksZ / 2 - 0.5;
  order.sort((a, b) => Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(b[0] - mx, b[1] - mz));

  order.forEach(([cx, cz], i) => {
    if (i % msg.workers !== msg.part) return;
    sendChunk(cx, cz);
  });
  post({ type: 'done', part: msg.part, ms: performance.now() - t0 });
};
