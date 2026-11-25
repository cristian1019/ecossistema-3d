/**
 * Gráficos de laboratório (uPlot: leve e rápido para séries longas).
 *  - "População": uma linha por espécie (dá para ver os ciclos predador-presa) + grama média.
 *  - Genes: a média de um gene escolhido em cada espécie ao longo do tempo
 *    (ex.: a velocidade dos coelhos subindo quando os predadores aparecem).
 * Eixo X em dias de simulação.
 */
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { DAY_LENGTH } from '../sim/clock';
import { SPECIES } from '../sim/species';
import type { GeneAverages, StatsSample } from '../sim/simulation';

const MAX_POINTS = 1500;

type Mode = 'pop' | keyof GeneAverages;
const MODES: { id: Mode; label: string; unit?: string }[] = [
  { id: 'pop', label: 'População' },
  { id: 'speed', label: 'Velocidade média', unit: 'b/s' },
  { id: 'size', label: 'Tamanho médio' },
  { id: 'vision', label: 'Visão média', unit: 'blocos' },
  { id: 'camo', label: 'Camuflagem média', unit: '%' },
  { id: 'fur', label: 'Resistência ao frio', unit: '%' },
  { id: 'metabolism', label: 'Metabolismo médio' },
  { id: 'litter', label: 'Ninhada média' },
];

interface Point {
  day: number;
  pop: number[];
  grass: number;
  genes: GeneAverages[];
}

export class PopulationChart {
  private plot: uPlot | null = null;
  private readonly points: Point[] = [];
  private readonly box: HTMLElement;
  private readonly select: HTMLSelectElement;
  private mode: Mode = 'pop';
  private dirty = false;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', /* html */ `
      <section class="chartPanel" aria-label="Gráficos">
        <div class="chartHead">
          <select id="chartMode" aria-label="O que mostrar no gráfico">
            ${MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}
          </select>
          <span class="info">por dia</span>
        </div>
        <div id="popChart"></div>
      </section>`);
    this.box = root.querySelector('#popChart')!;
    this.select = root.querySelector('#chartMode')!;
    this.select.addEventListener('change', () => {
      this.mode = this.select.value as Mode;
      this.build();
    });
    this.build();
    new ResizeObserver(() => this.plot?.setSize({ width: Math.max(200, this.box.clientWidth), height: 150 })).observe(this.box);
  }

  reset(): void {
    this.points.length = 0;
    this.build();
  }

  add(samples: StatsSample[]): void {
    for (const s of samples) {
      this.points.push({ day: +(s.t / DAY_LENGTH).toFixed(2), pop: s.pop, grass: s.grass, genes: s.genes });
    }
    // histórico longo: descarta 1 a cada 2 pontos antigos (mantém a forma geral)
    if (this.points.length > MAX_POINTS) {
      const kept = this.points.filter((_, i) => i % 2 === 0 || i > this.points.length - 200);
      this.points.length = 0;
      this.points.push(...kept);
    }
    if (samples.length) this.dirty = true;
  }

  /** redesenha no máximo 1× por quadro */
  flush(): void {
    if (!this.dirty || !this.plot) return;
    this.dirty = false;
    this.plot.setData(this.data());
  }

  private data(): uPlot.AlignedData {
    const x = this.points.map((p) => p.day);
    if (this.mode === 'pop') {
      return [x, ...SPECIES.map((_, k) => this.points.map((p) => p.pop[k] ?? 0)), this.points.map((p) => Math.round(p.grass * 100))];
    }
    const key = this.mode;
    const scale = key === 'camo' || key === 'fur' ? 100 : 1;
    // espécie sem ninguém vivo naquele momento: buraco na linha (null)
    return [x, ...SPECIES.map((_, k) => this.points.map((p) => (p.pop[k] > 0 && p.genes[k] ? +(p.genes[k][key] * scale).toFixed(2) : null)))] as uPlot.AlignedData;
  }

  private build(): void {
    this.plot?.destroy();
    const css = getComputedStyle(document.documentElement);
    const axis = { stroke: css.getPropertyValue('--mut') || '#a8b8b1', grid: { stroke: 'rgba(255,255,255,0.07)' }, ticks: { show: false }, font: '11px Inter, sans-serif' };
    const species = SPECIES.map((s) => ({ label: s.plural, stroke: s.chart, width: 2, spanGaps: false }));
    const pop = this.mode === 'pop';
    this.plot = new uPlot({
      width: Math.max(200, this.box.clientWidth),
      height: 150,
      legend: { show: true, live: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, g: { range: [0, 100] } },
      axes: pop
        ? [axis, { ...axis, size: 40 }, { ...axis, scale: 'g', side: 1, size: 34, grid: { show: false }, values: (_u, v) => v.map((d) => `${d}%`) }]
        : [axis, { ...axis, size: 40 }],
      series: pop
        ? [{ label: 'dia' }, ...species, { label: 'Grama', stroke: '#9cc65a', width: 1, dash: [4, 4], scale: 'g' }]
        : [{ label: 'dia' }, ...species],
    }, this.data(), this.box);
  }
}
