/**
 * Painel da esquerda (HUD): simulação (relógio, velocidade, populações, opções),
 * câmera, mundo (seed) e desempenho (FPS).
 */
import { BIOME_INFO } from '../world/biomes';
import { SPECIES } from '../sim/species';

export interface HudCallbacks {
  onGenerate(seedText: string): void;
  onCameraMode(mode: 'orbit' | 'fly'): void;
  onSpeed(speed: number): void;
  onSettings(s: { repopulate?: boolean; instincts?: boolean }): void;
  onReset(): void;
}

export const SPEEDS = [0, 1, 5, 20, 100];

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private frames = 0;
  private acc = 0;
  private worst = 0;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    root.insertAdjacentHTML('beforeend', /* html */ `
      <section class="panel" aria-label="Painel de controle">
        <div class="titlebar">
          <div>
            <h1>Ecossistema 3D</h1>
            <div class="sub">Fase 4 · água e ar: peixes e pássaros</div>
          </div>
          <div class="fps" title="quadros por segundo"><b id="fps">–</b><small>FPS</small></div>
        </div>

        <div>
          <div class="row" style="justify-content:space-between;margin-bottom:6px">
            <span class="clock" id="clock">Dia 1 · 07:12</span>
            <span class="info" id="realSpeed"></span>
          </div>
          <div class="seg" role="group" aria-label="Velocidade da simulação">
            ${SPEEDS.map((s) => `<button data-sp="${s}" aria-pressed="${s === 1}">${s === 0 ? 'Pausa' : s + 'x'}</button>`).join('')}
          </div>
        </div>

        <div class="pops" id="pops"></div>

        <div class="opts">
          <label class="chk"><input type="checkbox" id="optRepop" checked> Repovoar espécie quase extinta</label>
          <label class="chk"><input type="checkbox" id="optInst" checked> Instinto na 1ª geração <span class="info">(ao reiniciar)</span></label>
          <button id="reset">Reiniciar simulação</button>
        </div>

        <div>
          <div class="cap">Câmera <span style="text-transform:none;font-weight:500">(tecla F)</span></div>
          <div class="seg" role="group" aria-label="Modo de câmera">
            <button data-cam="orbit" aria-pressed="true">Órbita</button>
            <button data-cam="fly" aria-pressed="false">Voo livre</button>
          </div>
        </div>

        <details>
          <summary>Mundo e desempenho</summary>
          <div class="row" style="margin-top:8px">
            <input type="text" id="seed" aria-label="Seed do mundo" spellcheck="false" />
            <button class="pri" id="gen">Gerar</button>
            <button id="rand" title="Seed aleatória">Sortear</button>
          </div>
          <div class="info" id="worldInfo" style="margin-top:6px"></div>
          <div class="grid2" style="margin-top:8px">
            <span>Pior quadro <b id="ms">–</b></span>
            <span>Resolução <b id="res">–</b></span>
            <span>Chamadas <b id="calls">–</b></span>
            <span>Triângulos <b id="tris">–</b></span>
            <span>Chunks <b id="chunks">0</b></span>
            <span>Retângulos <b id="quads">–</b></span>
          </div>
        </details>
        <div class="info" id="focus">–</div>
        <div class="info event" id="event"></div>
      </section>
      <div class="help" id="help"></div>
      <div class="crosshair" id="cross"></div>
      <div class="loading" id="loading">
        <p>Gerando o mundo…</p>
        <div class="bar"><i id="bar"></i></div>
        <small id="loadTxt">terreno, biomas, rios e árvores</small>
      </div>`);
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
    root.querySelectorAll<HTMLButtonElement>('[data-sp]').forEach((b) =>
      b.addEventListener('click', () => {
        cb.onSpeed(Number(b.dataset.sp));
        this.setSpeed(Number(b.dataset.sp));
      }));
    this.el.optRepop.addEventListener('change', (e) => cb.onSettings({ repopulate: (e.target as HTMLInputElement).checked }));
    this.el.optInst.addEventListener('change', (e) => cb.onSettings({ instincts: (e.target as HTMLInputElement).checked }));
    this.el.reset.addEventListener('click', () => cb.onReset());
    this.setCameraMode('orbit');
  }

  setSeed(text: string): void {
    (this.el.seed as HTMLInputElement).value = text;
  }

  setCameraMode(mode: 'orbit' | 'fly' | 'eyes'): void {
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === mode)));
    this.el.cross.classList.toggle('on', mode === 'fly');
    this.el.help.innerHTML = mode === 'orbit'
      ? 'Clique num bicho para ver a ficha · arraste para <kbd>girar</kbd> · botão direito <kbd>move</kbd> · roda <kbd>zoom</kbd> · <kbd>W A S D</kbd> anda · <kbd>F</kbd> voo · <kbd>T</kbd> pausa'
      : mode === 'fly'
        ? 'Arraste para <kbd>olhar</kbd> · <kbd>W A S D</kbd> voar · <kbd>Espaço</kbd>/<kbd>Q</kbd> subir/descer · <kbd>Shift</kbd> rápido · <kbd>F</kbd> órbita'
        : 'Olhos do bicho · <kbd>Esc</kbd> para sair';
  }

  setSpeed(s: number): void {
    document.querySelectorAll<HTMLButtonElement>('[data-sp]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.sp) === s)));
  }

  setLoading(progress: number | null, text?: string): void {
    this.el.loading.classList.toggle('hide', progress === null);
    if (progress !== null) (this.el.bar as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    if (text) this.el.loadTxt.textContent = text;
  }

  setWorldInfo(html: string): void {
    this.el.worldInfo.innerHTML = html;
  }

  setClock(day: number, tod: number, realSpeed: number, requested: number): void {
    const mins = Math.floor(tod * 24 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    this.el.clock.textContent = `Dia ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const r = this.el.realSpeed;
    if (requested === 0) r.textContent = 'pausado';
    else {
      r.textContent = `real ${Math.round(realSpeed)}x`;
      // avisa quando o computador não consegue a velocidade pedida
      r.classList.toggle('warn', realSpeed < requested * 0.85);
    }
  }

  setPopulations(counts: number[], bushes: number, grass: number): void {
    this.el.pops.innerHTML =
      SPECIES.map((s, k) => `<span><i style="background:${s.chart}"></i>${s.plural} <b>${counts[k] ?? 0}</b></span>`).join('') +
      `<span><i style="background:#4c9a3c"></i>Arbustos <b>${bushes}</b></span>` +
      `<span><i style="background:#9cc65a"></i>Grama <b>${Math.round(grass * 100)}%</b></span>`;
  }

  showEvent(text: string): void {
    this.el.event.textContent = text;
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
    this.el.ms.textContent = `${(this.worst * 1000).toFixed(0)} ms`;
    this.el.calls.textContent = String(info.calls);
    this.el.tris.textContent = fmt(info.tris);
    this.el.chunks.textContent = String(info.chunks);
    this.el.quads.textContent = fmt(info.quads);
    this.el.res.textContent = `${Math.round(info.res * 100)}%`;
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
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
