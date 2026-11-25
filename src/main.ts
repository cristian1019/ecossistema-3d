/**
 * Ponto de entrada: cria a cena Three.js, dispara os workers que geram o mundo
 * e roda o laço de renderização.
 *
 * Arquitetura: a thread principal só DESENHA. Gerar terreno e montar malhas
 * acontece em Web Workers, então a tela nunca congela.
 */
import * as THREE from 'three';
import './ui/styles.css';
import { hashSeed } from './core/rng';
import { DEFAULT_CONFIG } from './world/voxelWorld';
import { BIOME_INFO } from './world/biomes';
import { ChunkRenderer } from './render/chunkRenderer';
import { DayNight } from './render/sky';
import { CameraRig } from './render/cameraRig';
import { AdaptiveResolution } from './render/adaptiveResolution';
import { Hud } from './ui/hud';
import type { FromWorldWorker, ToWorldWorker, WorldMeta } from './workers/protocol';

const cfg = DEFAULT_CONFIG;
/** duração de um dia completo em segundos, na velocidade 1x */
const DAY_SECONDS = 240;

// ---------- cena ----------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2200);
const chunks = new ChunkRenderer(cfg.chunkSize);
scene.add(chunks.group);
const sky = new DayNight(scene, renderer);
const adaptive = new AdaptiveResolution(renderer);
const rig = new CameraRig(camera, canvas, cfg.sizeX, cfg.sizeZ);

let meta: WorldMeta | null = null;
let timeOfDay = 0.36; // começa de manhã
let timeSpeed = 1;

// altura do chão/água usada pela câmera (interpolada para não dar "degraus")
rig.groundAt = (x, z) => {
  if (!meta) return cfg.seaLevel;
  const xi = THREE.MathUtils.clamp(Math.floor(x), 0, cfg.sizeX - 1);
  const zi = THREE.MathUtils.clamp(Math.floor(z), 0, cfg.sizeZ - 1);
  const i = xi + zi * cfg.sizeX;
  return Math.max(meta.height[i], meta.waterTop[i]) + 1;
};

// ---------- HUD ----------
const hud = new Hud(document.getElementById('hud')!, {
  onGenerate: (text) => generate(text),
  onCameraMode: (m) => rig.setMode(m),
  onTimeSpeed: (s) => (timeSpeed = s),
  onTimeSet: (t) => (timeOfDay = t),
});
rig.onModeChange = (m) => hud.setCameraMode(m);
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'KeyT') {
    timeSpeed = timeSpeed === 0 ? 1 : 0;
    hud.setTimeSpeed(timeSpeed);
  }
});

// ---------- geração com vários workers em paralelo ----------
let workers: Worker[] = [];

function generate(seedText: string): void {
  const text = seedText.trim() || 'ecossistema';
  const seed = hashSeed(text);
  hud.setSeed(text);
  const url = new URL(location.href);
  url.searchParams.set('seed', text);
  history.replaceState(null, '', url);

  workers.forEach((w) => w.terminate());
  chunks.clear();
  meta = null;
  hud.setLoading(0, 'terreno, biomas, rios e árvores');

  const total = Math.ceil(cfg.sizeX / cfg.chunkSize) * Math.ceil(cfg.sizeZ / cfg.chunkSize);
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const t0 = performance.now();
  let received = 0;
  let firstChunk = true;
  workers = Array.from({ length: n }, (_, part) => {
    const w = new Worker(new URL('./workers/world.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorldWorker>) => {
      const msg = e.data;
      if (msg.type === 'meta') {
        meta = msg.meta;
        rig.lookAt(cfg.sizeX / 2, cfg.sizeZ / 2, 330);
        hud.setWorldInfo(
          `seed <b>${seed}</b> · <b>${msg.meta.rivers}</b> rios · <b>${msg.meta.lakes}</b> lagos · <b>${msg.meta.trees.toLocaleString('pt-BR')}</b> árvores<br>` +
          biomeShares(msg.meta.biome),
        );
      } else if (msg.type === 'chunk') {
        chunks.setChunk(msg.cx, msg.cz, msg.opaque, msg.water);
        sky.invalidateShadow();
        received++;
        if (firstChunk) { firstChunk = false; hud.setLoading(null); }
        if (received === total) {
          const s = ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',');
          console.info(`Mundo pronto em ${s} s com ${n} workers`);
        }
      }
    };
    const msg: ToWorldWorker = { type: 'generate', seed, part, workers: n, sendMeta: part === 0 };
    w.postMessage(msg);
    return w;
  });
}

function biomeShares(biome: Uint8Array): string {
  const counts = new Array(BIOME_INFO.length).fill(0);
  for (const b of biome) counts[b]++;
  return counts
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c - a.c)
    .map(({ c, i }) => `<span class="swatch" style="background:${BIOME_INFO[i].color}"></span>${BIOME_INFO[i].name} ${Math.round((c / biome.length) * 100)}%`)
    .join(' · ');
}

// ---------- laço principal ----------
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
const focus = new THREE.Vector3();
let focusTimer = 0;

function loop(): void {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  adaptive.frame(timer.getDelta());
  timeOfDay = (timeOfDay + (dt * timeSpeed) / DAY_SECONDS) % 1;
  chunks.time.value += dt;

  rig.update(dt);
  rig.focus(focus);
  sky.update(timeOfDay, focus, camera.position, rig.viewDistance());
  renderer.render(scene, camera);

  hud.frame(dt, {
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    chunks: chunks.count,
    quads: chunks.quads,
    res: adaptive.scale,
  });
  hud.setTimeOfDay(timeOfDay);
  if ((focusTimer += dt) > 0.25 && meta) {
    focusTimer = 0;
    const xi = THREE.MathUtils.clamp(Math.floor(focus.x), 0, cfg.sizeX - 1);
    const zi = THREE.MathUtils.clamp(Math.floor(focus.z), 0, cfg.sizeZ - 1);
    const i = xi + zi * cfg.sizeX;
    hud.setFocus(meta.biome[i], focus.x, focus.z, meta.height[i], meta.waterTop[i] > meta.height[i]);
  }
  requestAnimationFrame(loop);
}

camera.position.set(cfg.sizeX / 2 + 180, 200, cfg.sizeZ / 2 + 180);
rig.orbit.target.set(cfg.sizeX / 2, cfg.seaLevel, cfg.sizeZ / 2);
generate(new URL(location.href).searchParams.get('seed') ?? 'ecossistema');
loop();

// acesso para depuração no console do navegador (só no modo desenvolvimento)
if (import.meta.env.DEV) Object.assign(window, { __eco: { renderer, scene, camera, sky, chunks, rig } });
