/**
 * Gráfico de população ao longo do tempo (uPlot: leve e rápido para séries longas).
 * Eixo X em dias; populações à esquerda; grama média (%) à direita.
 */
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { DAY_LENGTH } from '../sim/clock';
import { SPECIES } from '../sim/species';
import type { StatsSample } from '../sim/simulation';

const MAX_POINTS = 1500;

export class PopulationChart {
  private plot: uPlot | null = null;
  private readonly data: number[][] = [];
  private readonly box: HTMLElement;
  private dirty = false;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', /* html */ `
      <section class="chartPanel" aria-label="Gráfico de população">
        <div class="chartHead"><b>População</b><span class="info">por dia de simulação</span></div>
        <div id="popChart"></div>
      </section>`);
    this.box = root.querySelector('#popChart')!;
    this.reset();
    new ResizeObserver(() => this.resize()).observe(this.box);
  }

  reset(): void {
    this.data.length = 0;
    this.data.push([], ...SPECIES.map(() => []), []);
    this.plot?.destroy();
    const css = getComputedStyle(document.documentElement);
    const axis = { stroke: css.getPropertyValue('--mut') || '#a8b8b1', grid: { stroke: 'rgba(255,255,255,0.07)' }, ticks: { show: false }, font: '11px Inter, sans-serif' };
    this.plot = new uPlot({
      width: Math.max(200, this.box.clientWidth),
      height: 150,
      legend: { show: true, live: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, g: { range: [0, 100] } },
      axes: [
        { ...axis, values: (_u, v) => v.map((d) => `${d}`) },
        { ...axis, size: 40 },
        { ...axis, scale: 'g', side: 1, size: 34, grid: { show: false }, values: (_u, v) => v.map((d) => `${d}%`) },
      ],
      series: [
        { label: 'dia' },
        ...SPECIES.map((s) => ({ label: s.plural, stroke: s.chart, width: 2 })),
        { label: 'Grama', stroke: '#9cc65a', width: 1, dash: [4, 4], scale: 'g' },
      ],
    }, this.data as uPlot.AlignedData, this.box);
  }

  add(samples: StatsSample[]): void {
    for (const s of samples) {
      this.data[0].push(+(s.t / DAY_LENGTH).toFixed(2));
      SPECIES.forEach((_, k) => this.data[k + 1].push(s.pop[k]));
      this.data[SPECIES.length + 1].push(Math.round(s.grass * 100));
    }
    // histórico longo: descarta 1 a cada 2 pontos antigos (mantém a forma geral)
    if (this.data[0].length > MAX_POINTS) {
      for (const arr of this.data) {
        const kept = arr.filter((_, i) => i % 2 === 0 || i > arr.length - 200);
        arr.length = 0;
        arr.push(...kept);
      }
    }
    if (samples.length) this.dirty = true;
  }

  /** redesenha no máximo 1× por quadro */
  flush(): void {
    if (!this.dirty || !this.plot) return;
    this.dirty = false;
    this.plot.setData(this.data as uPlot.AlignedData);
  }

  private resize(): void {
    this.plot?.setSize({ width: Math.max(200, this.box.clientWidth), height: 150 });
  }
}
