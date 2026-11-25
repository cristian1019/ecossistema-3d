/**
 * Ponto de entrada: cria a cena, dispara os workers e roda o laço de desenho.
 *
 * Três tipos de thread trabalham juntos:
 *  - workers do MUNDO (vários, em paralelo): geram o terreno e as malhas dos chunks;
 *  - worker da SIMULAÇÃO: plantas, criaturas, cérebros e evolução;
 *  - thread PRINCIPAL (esta): só desenha e cuida da interface.
 * Os dois tipos de worker recriam o mesmo mundo a partir da seed.
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
import { CreatureRenderer } from './render/creatureRenderer';
import { PlantRenderer } from './render/plantRenderer';
import { Hud } from './ui/hud';
import { PopulationChart } from './ui/charts';
import { CreaturePanel } from './ui/creaturePanel';
import { dayNumber, timeOfDay } from './sim/clock';
import type { FromWorldWorker, ToWorldWorker, WorldMeta } from './workers/protocol';
import type { FromSim, SimSettings, ToSim } from './workers/simProtocol';

const cfg = DEFAULT_CONFIG;

// ---------- cena ----------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2200);
const chunks = new ChunkRenderer(cfg.chunkSize, cfg.sizeX, cfg.sizeZ);
const creatures = new CreatureRenderer();
const plants = new PlantRenderer();
scene.add(chunks.group, creatures.group, plants.group);
const sky = new DayNight(scene, renderer);
const adaptive = new AdaptiveResolution(renderer);
const rig = new CameraRig(camera, canvas, cfg.sizeX, cfg.sizeZ);

let meta: WorldMeta | null = null;

rig.groundAt = (x, z) => {
  if (!meta) return cfg.seaLevel;
  const xi = THREE.MathUtils.clamp(Math.floor(x), 0, cfg.sizeX - 1);
  const zi = THREE.MathUtils.clamp(Math.floor(z), 0, cfg.sizeZ - 1);
  const i = xi + zi * cfg.sizeX;
  return Math.max(meta.height[i], meta.waterTop[i]) + 1;
};

// ---------- estado da simulação vista daqui ----------
const settings: SimSettings = { repopulate: true, instincts: true, mutationRate: 1 };
let speed = 1;
let simTime = 0; // tempo de simulação do último quadro recebido
let simTimeAt = performance.now(); // quando ele chegou
let realSpeed = 0;
let selectedId: number | null = null;
let following = true;
let eyes = false;
let lastCounts: number[] = [];
let lastBushes = 0;
let lastGrass = 0;

// ---------- interface ----------
const hudRoot = document.getElementById('hud')!;
const hud = new Hud(hudRoot, {
  onGenerate: (text) => generate(text),
  onCameraMode: (m) => { exitEyes(); rig.setMode(m); },
  onSpeed: (s) => setSpeed(s),
  onSettings: (s) => {
    Object.assign(settings, s);
    simPost({ type: 'settings', settings: s });
  },
  onReset: () => {
    simPost({ type: 'settings', settings });
    simPost({ type: 'reset' });
    chart.reset();
    select(null);
  },
});
const chart = new PopulationChart(hudRoot);
const panel = new CreaturePanel(hudRoot, {
  onClose: () => select(null),
  onFollow: (on) => (following = on),
  onEyes: () => (eyes ? exitEyes() : enterEyes()),
  onSelect: (id) => select(id),
});
rig.onModeChange = (m) => hud.setCameraMode(m);

function setSpeed(s: number): void {
  speed = s;
  hud.setSpeed(s);
  simPost({ type: 'speed', speed: s });
  // nas velocidades altas a sombra muda a todo instante: atualiza menos vezes
  sky.shadowInterval = s >= 20 ? 20 : 3;
}

function select(id: number | null): void {
  selectedId = id;
  simPost({ type: 'select', id });
  if (id === null) {
    panel.hide();
    exitEyes();
  }
}

function enterEyes(): void {
  if (selectedId === null) return;
  eyes = true;
  rig.setMode('orbit');
  rig.setExternal(true);
  hud.setCameraMode('eyes');
  panel.setEyes(true);
}

function exitEyes(): void {
  if (!eyes) return;
  eyes = false;
  const t = creatures.tracked;
  rig.setExternal(false, new THREE.Vector3(t.x, t.y, t.z));
  hud.setCameraMode(rig.mode);
  panel.setEyes(false);
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'KeyT') setSpeed(speed === 0 ? 1 : 0);
  if (e.code === 'Escape') { if (eyes) exitEyes(); else select(null); }
});

// clique (sem arrastar) seleciona a criatura sob o mouse
const raycaster = new THREE.Raycaster();
let downX = 0, downY = 0;
canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || Math.hypot(e.clientX - downX, e.clientY - downY) > 5 || eyes) return;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const id = creatures.pick(raycaster);
  if (id !== null) select(id);
});

// ---------- workers ----------
let worldWorkers: Worker[] = [];
let simWorker: Worker | null = null;

function simPost(msg: ToSim): void {
  simWorker?.postMessage(msg);
}

function generate(seedText: string): void {
  const text = seedText.trim() || 'ecossistema';
  const seed = hashSeed(text);
  hud.setSeed(text);
  const url = new URL(location.href);
  url.searchParams.set('seed', text);
  history.replaceState(null, '', url);

  worldWorkers.forEach((w) => w.terminate());
  simWorker?.terminate();
  chunks.clear();
  meta = null;
  select(null);
  chart.reset();
  hud.setLoading(0, 'terreno, biomas, rios e árvores');

  // 1) workers do mundo, em paralelo
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  let firstChunk = true;
  worldWorkers = Array.from({ length: n }, (_, part) => {
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
        if (firstChunk) { firstChunk = false; hud.setLoading(null); }
      }
    };
    const msg: ToWorldWorker = { type: 'generate', seed, part, workers: n, sendMeta: part === 0 };
    w.postMessage(msg);
    return w;
  });

  // 2) worker da simulação
  simWorker = new Worker(new URL('./workers/sim.worker.ts', import.meta.url), { type: 'module' });
  simWorker.onmessage = (e: MessageEvent<FromSim>) => onSim(e.data);
  simPost({ type: 'init', seed, settings });
  simPost({ type: 'speed', speed });
}

function onSim(msg: FromSim): void {
  const now = performance.now();
  switch (msg.type) {
    case 'ready':
      console.info(`Simulação pronta em ${(msg.ms / 1000).toFixed(1)} s`);
      break;
    case 'frame': {
      creatures.pushFrame(msg.creatures, msg.count, now);
      simTime = msg.time;
      simTimeAt = now;
      realSpeed = msg.realSpeed;
      chart.add(msg.stats);
      const last = msg.stats[msg.stats.length - 1];
      if (last) { lastCounts = last.pop; lastBushes = last.bushes; lastGrass = last.grass; }
      for (const ev of msg.events) hud.showEvent(`Dia ${dayNumber(ev.t)}: ${ev.text}`);
      // a criatura selecionada sumiu do quadro (morreu): sai dos olhos dela
      if (selectedId !== null && eyes && !creatures.has(selectedId)) exitEyes();
      break;
    }
    case 'plants':
      plants.set(msg.bushes);
      if (msg.grass) chunks.setGrass(msg.grass);
      break;
    case 'detail':
      if (selectedId === null) break;
      if (msg.detail) panel.show(msg.detail);
      else panel.showMissing(selectedId);
      break;
  }
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
let uiTimer = 0;
let animTime = 0;

function loop(): void {
  timer.update();
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.1);
  adaptive.frame(rawDt);
  chunks.time.value += dt;
  animTime += speed === 0 ? 0 : dt;

  // tempo de simulação "agora": último quadro + o que passou desde então
  const now = performance.now();
  const estTime = simTime + (speed > 0 ? Math.min(0.25, (now - simTimeAt) / 1000) * realSpeed : 0);

  // criaturas: nas velocidades altas, sem interpolação nem animação (simplifica)
  const fast = speed >= 20;
  creatures.update(now, animTime, !fast, !fast && speed > 0, selectedId, eyes ? selectedId : null, camera);

  if (eyes && creatures.trackedVisible) {
    // olhos do bicho: câmera na cabeça, olhando para onde ele anda
    const t = creatures.tracked;
    const headY = t.species === 0 ? 0.75 : 1.85;
    camera.position.set(t.x + Math.cos(t.yaw) * 0.45 * t.scale, t.y + headY * t.scale, t.z + Math.sin(t.yaw) * 0.45 * t.scale);
    camera.lookAt(camera.position.x + Math.cos(t.yaw), camera.position.y - 0.08, camera.position.z + Math.sin(t.yaw));
  } else {
    if (selectedId !== null && following && creatures.trackedVisible) {
      const t = creatures.tracked;
      rig.follow(t.x, t.y, t.z, dt);
    }
    rig.update(dt);
  }

  rig.focus(focus);
  sky.update(timeOfDay(estTime), focus, camera.position, eyes ? 80 : rig.viewDistance());
  chart.flush();
  renderer.render(scene, camera);

  hud.frame(dt, {
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    chunks: chunks.count,
    quads: chunks.quads,
    res: adaptive.scale,
  });
  if ((uiTimer += dt) > 0.25) {
    uiTimer = 0;
    hud.setClock(dayNumber(estTime), timeOfDay(estTime), realSpeed, speed);
    hud.setPopulations(lastCounts, lastBushes, lastGrass);
    if (meta) {
      const xi = THREE.MathUtils.clamp(Math.floor(focus.x), 0, cfg.sizeX - 1);
      const zi = THREE.MathUtils.clamp(Math.floor(focus.z), 0, cfg.sizeZ - 1);
      const i = xi + zi * cfg.sizeX;
      hud.setFocus(meta.biome[i], focus.x, focus.z, meta.height[i], meta.waterTop[i] > meta.height[i]);
    }
  }
  requestAnimationFrame(loop);
}

camera.position.set(cfg.sizeX / 2 + 180, 200, cfg.sizeZ / 2 + 180);
rig.orbit.target.set(cfg.sizeX / 2, cfg.seaLevel, cfg.sizeZ / 2);
generate(new URL(location.href).searchParams.get('seed') ?? 'ecossistema');
loop();

// acesso para depuração no console do navegador (só no modo desenvolvimento)
if (import.meta.env.DEV) Object.assign(window, { __eco: { renderer, scene, camera, sky, chunks, rig, creatures, select } });
