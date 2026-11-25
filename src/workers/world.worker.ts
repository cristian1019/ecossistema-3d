/**
 * Worker do mundo: gera o terreno a partir da seed e monta as malhas dos chunks.
 *
 * Truque de paralelismo: como a geração é determinística, vários workers podem
 * gerar o MESMO mundo ao mesmo tempo, cada um a partir da seed, e cada um faz a
 * malha de uma parte dos chunks. Não é preciso mandar 25 MB de voxels entre threads.
 * (O worker da simulação, na Fase 2, vai fazer o mesmo: recriar o mundo pela seed.)
 */
import { generateWorld } from '../world/worldgen';
import { meshChunkAll, transferables } from '../world/mesher';
import type { FromWorldWorker, ToWorldWorker } from './protocol';

const post = (msg: FromWorldWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ToWorldWorker>) => {
  const msg = e.data;
  if (msg.type !== 'generate') return;
  const t0 = performance.now();
  const g = generateWorld(msg.seed);
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
    const { opaque, water } = meshChunkAll(g.voxels, cx, cz);
    post({ type: 'chunk', cx, cz, opaque, water }, [...transferables(opaque), ...transferables(water)]);
  });
  post({ type: 'done', part: msg.part, ms: performance.now() - t0 });
};
