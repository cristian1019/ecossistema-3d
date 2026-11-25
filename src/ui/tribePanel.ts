/**
 * Painel das tribos (membros, nível de conhecimento, construções, recursos)
 * e a linha do tempo de eventos ("Ano 1, dia 4: tribo Azul construiu a primeira fogueira").
 * Fica dentro do painel da esquerda, em seções que abrem e fecham.
 */
import { dateLabel } from '../sim/clock';
import { RESOURCE_LABEL, type Resource } from '../sim/tribes';
import type { TribeInfo } from '../workers/simProtocol';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const MAX_EVENTS = 60;

export class TribePanel {
  private readonly list: HTMLElement;
  private readonly timeline: HTMLElement;
  private readonly events: { t: number; text: string }[] = [];

  constructor(panel: HTMLElement, onFocus: (x: number, z: number) => void) {
    panel.querySelector('details')!.insertAdjacentHTML('beforebegin', /* html */ `
      <details open class="tribesBox">
        <summary>Tribos</summary>
        <div class="tribes" id="tribeList"><div class="info">Nenhuma tribo ainda.</div></div>
      </details>
      <details class="timelineBox">
        <summary>Linha do tempo</summary>
        <ol class="timeline" id="timeline"></ol>
      </details>`);
    this.list = panel.querySelector('#tribeList')!;
    this.timeline = panel.querySelector('#timeline')!;
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cx]');
      if (b) onFocus(Number(b.dataset.cx), Number(b.dataset.cz));
    });
  }

  reset(): void {
    this.events.length = 0;
    this.timeline.innerHTML = '';
    this.list.innerHTML = '<div class="info">Nenhuma tribo ainda.</div>';
  }

  setTribes(tribes: TribeInfo[]): void {
    const alive = tribes.filter((t) => t.alive);
    if (!alive.length) {
      this.list.innerHTML = `<div class="info">${tribes.length ? 'Todas as tribos desapareceram.' : 'Nenhuma tribo ainda.'}</div>`;
      return;
    }
    this.list.innerHTML = alive.map((t) => {
      const missing = Object.entries(t.nextCost)
        .map(([r, v]) => [r, Math.max(0, v - (t.store[r] ?? 0))] as const)
        .filter(([, v]) => v > 0)
        .map(([r, v]) => `${Math.ceil(v)} de ${RESOURCE_LABEL[r as Resource]}`);
      const next = t.next ? `Próxima: <b>${t.next}</b>${missing.length ? ` (falta ${missing.join(', ')})` : ' (pronta para construir)'}` : 'Construiu tudo o que sabe';
      const store = (['wood', 'stone', 'food', 'fiber'] as Resource[])
        .map((r) => `<span>${RESOURCE_LABEL[r]} <b>${Math.floor(t.store[r] ?? 0)}</b></span>`).join('');
      return /* html */ `
        <div class="tribe">
          <div class="tribeHead">
            <span class="swatch" style="background:${hex(t.color)}"></span>
            <b>${t.name}</b><span class="info">${t.members} membros · nível ${t.level}</span>
            <button class="chip" data-cx="${t.cx}" data-cz="${t.cz}" title="Mostrar no mapa">ver</button>
          </div>
          <div class="kbar" title="conhecimento: ${t.knowledge.toFixed(1)}"><i style="width:${Math.round(t.progress * 100)}%;background:${hex(t.color)}"></i></div>
          <div class="info">${next}</div>
          <div class="store">${store}</div>
          ${t.built.length ? `<div class="info">Construções: ${t.built.join(', ')}</div>` : ''}
        </div>`;
    }).join('');
  }

  addEvents(events: { t: number; text: string }[]): void {
    if (!events.length) return;
    this.events.push(...events);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.timeline.innerHTML = [...this.events].reverse()
      .map((e) => `<li><span class="info">${dateLabel(e.t)}</span> ${e.text}</li>`).join('');
  }
}
