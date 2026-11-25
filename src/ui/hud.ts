/**
 * Painel na tela (HUD): FPS e estatísticas de render, seed do mundo,
 * modo de câmera, controle da hora do dia e informações do ponto em foco.
 */
import { BIOME_INFO } from '../world/biomes';

export interface HudCallbacks {
  onGenerate(seedText: string): void;
  onCameraMode(mode: 'orbit' | 'fly'): void;
  onTimeSpeed(speed: number): void;
  onTimeSet(t: number): void;
}

export const TIME_SPEEDS = [0, 1, 10, 60];

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private frames = 0;
  private acc = 0;
  private worst = 0;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    root.innerHTML = /* html */ `
      <section class="panel" aria-label="Painel de controle">
        <div>
          <h1>Ecossistema 3D</h1>
          <div class="sub">Fase 1 · o mundo, ainda sem criaturas</div>
        </div>
        <div>
          <div class="fps"><b id="fps">–</b><small>FPS</small><small id="ms"></small></div>
          <div class="grid2" style="margin-top:6px">
            <span>Chamadas <b id="calls">–</b></span>
            <span>Triângulos <b id="tris">–</b></span>
            <span>Chunks <b id="chunks">0</b></span>
            <span>Retângulos <b id="quads">–</b></span>
            <span>Resolução <b id="res">–</b></span>
            <span>Sombras <b>em cache</b></span>
          </div>
        </div>
        <div>
          <div class="cap">Mundo</div>
          <div class="row">
            <input type="text" id="seed" aria-label="Seed do mundo" spellcheck="false" />
            <button class="pri" id="gen">Gerar</button>
            <button id="rand" title="Seed aleatória">Sortear</button>
          </div>
          <div class="info" id="worldInfo" style="margin-top:6px"></div>
        </div>
        <div>
          <div class="cap">Câmera <span style="text-transform:none;font-weight:500">(tecla F)</span></div>
          <div class="seg" role="group" aria-label="Modo de câmera">
            <button data-cam="orbit" aria-pressed="true">Órbita</button>
            <button data-cam="fly" aria-pressed="false">Voo livre</button>
          </div>
        </div>
        <div>
          <div class="cap">Hora do dia</div>
          <div class="row" style="margin-bottom:6px">
            <span class="clock" id="clock">12:00</span>
            <div class="seg" role="group" aria-label="Velocidade do tempo" style="margin-left:auto;flex:0 0 auto">
              ${TIME_SPEEDS.map((s) => `<button data-ts="${s}" aria-pressed="${s === 1}">${s === 0 ? 'Pausa' : s + 'x'}</button>`).join('')}
            </div>
          </div>
          <input type="range" id="tod" min="0" max="1" step="0.001" aria-label="Hora do dia" />
        </div>
        <div class="info" id="focus">–</div>
      </section>
      <div class="help" id="help"></div>
      <div class="crosshair" id="cross"></div>
      <div class="loading" id="loading">
        <p>Gerando o mundo…</p>
        <div class="bar"><i id="bar"></i></div>
        <small id="loadTxt">terreno, biomas, rios e árvores</small>
      </div>`;
    root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.el[e.id] = e));

    const seed = this.el.seed as HTMLInputElement;
    this.el.gen.addEventListener('click', () => cb.onGenerate(seed.value));
    seed.addEventListener('keydown', (e) => { if (e.key === 'Enter') cb.onGenerate(seed.value); });
    this.el.rand.addEventListener('click', () => {
      seed.value = randomSeedName();
      cb.onGenerate(seed.value);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', () => cb.onCameraMode(b.dataset.cam as 'orbit' | 'fly')));
    root.querySelectorAll<HTMLButtonElement>('[data-ts]').forEach((b) =>
      b.addEventListener('click', () => {
        cb.onTimeSpeed(Number(b.dataset.ts));
        this.setTimeSpeed(Number(b.dataset.ts));
      }));
    this.el.tod.addEventListener('input', () => cb.onTimeSet(Number((this.el.tod as HTMLInputElement).value)));
    this.setCameraMode('orbit');
  }

  setSeed(text: string): void {
    (this.el.seed as HTMLInputElement).value = text;
  }

  setCameraMode(mode: 'orbit' | 'fly'): void {
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === mode)));
    this.el.cross.classList.toggle('on', mode === 'fly');
    this.el.help.innerHTML = mode === 'orbit'
      ? 'Arraste para <kbd>girar</kbd> · botão direito para <kbd>mover</kbd> · roda para <kbd>zoom</kbd> · <kbd>W A S D</kbd> anda pelo mapa · <kbd>F</kbd> voo livre'
      : 'Arraste para <kbd>olhar</kbd> · <kbd>W A S D</kbd> voar · <kbd>Espaço</kbd>/<kbd>Q</kbd> subir/descer · <kbd>Shift</kbd> rápido · roda muda a velocidade · <kbd>F</kbd> órbita';
  }

  setTimeSpeed(s: number): void {
    document.querySelectorAll<HTMLButtonElement>('[data-ts]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.ts) === s)));
  }

  setLoading(progress: number | null, text?: string): void {
    this.el.loading.classList.toggle('hide', progress === null);
    if (progress !== null) (this.el.bar as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    if (text) this.el.loadTxt.textContent = text;
  }

  setWorldInfo(html: string): void {
    this.el.worldInfo.innerHTML = html;
  }

  /** chamado a cada quadro; atualiza os números 2× por segundo */
  frame(dt: number, info: { calls: number; tris: number; chunks: number; quads: number; res: number }): void {
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.5) return;
    const fps = this.frames / this.acc;
    const f = this.el.fps;
    f.textContent = String(Math.round(fps));
    f.className = fps >= 55 ? '' : fps >= 30 ? 'warn' : 'bad';
    this.el.ms.textContent = `· pior quadro ${(this.worst * 1000).toFixed(0)} ms`;
    this.el.calls.textContent = String(info.calls);
    this.el.tris.textContent = fmt(info.tris);
    this.el.chunks.textContent = String(info.chunks);
    this.el.quads.textContent = fmt(info.quads);
    this.el.res.textContent = `${Math.round(info.res * 100)}%`;
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
  }

  setTimeOfDay(t: number): void {
    const mins = Math.floor(t * 24 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    const phase = t < 0.22 || t > 0.8 ? 'Noite' : t < 0.3 ? 'Manhã' : t > 0.72 ? 'Tarde' : 'Dia';
    this.el.clock.textContent = `${phase} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const r = this.el.tod as HTMLInputElement;
    if (document.activeElement !== r) r.value = String(t);
  }

  setFocus(biome: number, x: number, z: number, y: number, water: boolean): void {
    const b = BIOME_INFO[biome];
    this.el.focus.innerHTML = b
      ? `Foco: <span class="swatch" style="background:${b.color}"></span><b>${b.name}</b>${water ? ' (água)' : ''} · x ${Math.round(x)} · z ${Math.round(z)} · altura ${y}`
      : '–';
  }
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

const NAMES = ['vale', 'ilha', 'serra', 'baia', 'lago', 'mata', 'duna', 'rio', 'pico', 'brejo'];
const ADJ = ['azul', 'verde', 'alto', 'antigo', 'dourado', 'calmo', 'selvagem', 'nevado', 'perdido', 'sereno'];
function randomSeedName(): string {
  const r = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${r(NAMES)}-${r(ADJ)}-${Math.floor(Math.random() * 1000)}`;
}
