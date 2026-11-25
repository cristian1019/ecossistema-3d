/**
 * Ficha da criatura selecionada: espécie, idade, geração, família, necessidades
 * em barras, genes e a rede neural desenhada ao vivo.
 */
import { DAY_LENGTH } from '../sim/clock';
import { GENE_DEFS, GENE_KEYS } from '../sim/genome';
import { OUTPUT_LABELS, SPECIES } from '../sim/species';
import type { CreatureDetail } from '../workers/simProtocol';
import { drawBrain } from './brainView';

export interface PanelCallbacks {
  onClose(): void;
  onFollow(on: boolean): void;
  onEyes(): void;
  onSelect(id: number): void;
}

const days = (s: number) => (s / DAY_LENGTH).toFixed(1).replace('.', ',');
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

export class CreaturePanel {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private following = true;
  private lastId = -1;

  constructor(parent: HTMLElement, cb: PanelCallbacks) {
    parent.insertAdjacentHTML('beforeend', /* html */ `
      <section class="card" id="card" hidden aria-label="Ficha da criatura">
        <div class="cardHead">
          <div><h2 id="cTitle">–</h2><div class="sub" id="cSub"></div></div>
          <button class="x" id="cClose" aria-label="Fechar ficha">×</button>
        </div>
        <div class="row">
          <button id="cFollow" aria-pressed="true">Seguir</button>
          <button id="cEyes">Olhos do bicho</button>
        </div>
        <div class="status" id="cStatus"></div>
        <div class="bars" id="cBars"></div>
        <div>
          <div class="cap">Cérebro ao vivo</div>
          <svg id="cBrain" class="brain" aria-label="Rede neural da criatura"></svg>
          <div class="outs" id="cOuts"></div>
        </div>
        <div>
          <div class="cap">Família</div>
          <div class="info" id="cFamily"></div>
        </div>
        <div>
          <div class="cap">Genes</div>
          <div class="genes" id="cGenes"></div>
        </div>
      </section>`);
    this.root = parent.querySelector('#card')!;
    this.root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.el[e.id] = e));
    this.el.cClose.addEventListener('click', () => cb.onClose());
    this.el.cFollow.addEventListener('click', () => {
      this.following = !this.following;
      this.el.cFollow.setAttribute('aria-pressed', String(this.following));
      cb.onFollow(this.following);
    });
    this.el.cEyes.addEventListener('click', () => cb.onEyes());
    // clicar num parente seleciona ele
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (t) cb.onSelect(Number(t.dataset.id));
    });
  }

  /** marca o botão "Olhos do bicho" como ligado/desligado */
  setEyes(on: boolean): void {
    this.el.cEyes.setAttribute('aria-pressed', String(on));
    this.el.cEyes.textContent = on ? 'Sair dos olhos (Esc)' : 'Olhos do bicho';
  }

  get isFollowing(): boolean {
    return this.following;
  }

  hide(): void {
    this.root.hidden = true;
    this.lastId = -1;
  }

  /** a criatura pedida não existe mais (morreu antes de chegar a ficha) */
  showMissing(id: number): void {
    this.root.hidden = false;
    this.el.cTitle.textContent = `#${id}`;
    this.el.cSub.textContent = '';
    this.el.cStatus.innerHTML = '<b>Não está mais viva.</b>';
    for (const k of ['cBars', 'cOuts', 'cFamily', 'cGenes']) this.el[k].innerHTML = '';
    (this.el.cBrain as unknown as SVGSVGElement).innerHTML = '';
  }

  show(d: CreatureDetail): void {
    this.root.hidden = false;
    const sp = SPECIES[d.species];
    if (d.id !== this.lastId) {
      this.lastId = d.id;
      this.following = true;
      this.el.cFollow.setAttribute('aria-pressed', 'true');
    }
    this.el.cTitle.innerHTML = `${sp.name} <span class="muted">#${d.id}</span> <span class="sex">${d.sex === 1 ? '♂' : '♀'}</span>`;
    const young = d.age < d.maturity;
    this.el.cSub.textContent = `${d.sex === 1 ? 'macho' : 'fêmea'}${young ? ' jovem' : ''} · geração ${d.generation} · ${days(d.age)} de ${days(d.maxAge)} dias`;

    let status = d.alive ? `Agora: <b>${d.action}</b>` : `<b>Morreu de ${d.cause}.</b>`;
    if (d.pregnantLeft !== null) status += ` · grávida, nasce em ${Math.ceil(d.pregnantLeft)} s`;
    status += ` · ${d.temp.toFixed(0)} °C`;
    this.el.cStatus.innerHTML = status;

    const bar = (label: string, v: number, color: string) =>
      `<div class="bar2"><span>${label}</span><i><b style="width:${pct(v)};background:${color}"></b></i><em>${pct(v)}</em></div>`;
    this.el.cBars.innerHTML =
      bar('Energia', d.energy / d.maxEnergy, '#9be15d') +
      bar('Fome', 1 - d.energy / d.maxEnergy, '#f0a050') +
      bar('Sede', 1 - d.hydration, '#58a6e8') +
      bar('Cansaço', d.fatigue, '#b48ae0') +
      bar('Frio', Math.min(1, d.coldStress), '#7fd3e8');

    drawBrain(this.el.cBrain as unknown as SVGSVGElement, d.w1, d.w2, d.input, d.hidden, d.output);
    const o = d.output;
    this.el.cOuts.innerHTML = OUTPUT_LABELS.map((l, k) => {
      let txt: string;
      if (k === 0) txt = Math.abs(o[0]) < 0.1 ? 'reto' : `${o[0] > 0 ? 'direita' : 'esquerda'} ${Math.round(Math.abs(o[0]) * 100)}%`;
      else if (k === 1) txt = `${Math.round(((o[1] + 1) / 2) * 100)}%`;
      else txt = o[k] > 0 ? 'sim' : 'não';
      return `<span>${l}: <b>${txt}</b></span>`;
    }).join('');

    const link = (id: number) => (id > 0 ? `<button class="chip" data-id="${id}">#${id}</button>` : '<span class="muted">primeira geração</span>');
    const kids = d.childIds.slice(-8).map((id) => `<button class="chip" data-id="${id}">#${id}</button>`).join('');
    this.el.cFamily.innerHTML =
      `Mãe ${link(d.mother)} · Pai ${d.father > 0 ? link(d.father) : ''}<br>` +
      `Filhos: <b>${d.children}</b> ${kids}`;

    const g = d.genes;
    const color = `rgb(${Math.round(g.r * 255)},${Math.round(g.g * 255)},${Math.round(g.b * 255)})`;
    this.el.cGenes.innerHTML = GENE_KEYS.filter((k) => k !== 'r' && k !== 'g' && k !== 'b')
      .map((k) => `<span>${GENE_DEFS[k].label}</span><b>${GENE_DEFS[k].fmt(g[k])}</b>`).join('') +
      `<span>Cor</span><b><i class="swatch" style="background:${color}"></i>${color.replace('rgb', '')}</b>`;
  }
}
