/**
 * Desenho da rede neural em SVG (mesma linguagem visual do protótipo 2D):
 *  - bolinhas da esquerda = sentidos, do meio = neurônios ocultos, da direita = decisões;
 *  - linha verde reforça, laranja inibe; mais grossa = peso mais forte;
 *  - as bolinhas acendem (verde positivo, laranja negativo) conforme o bicho pensa.
 */

const POS = '#5fb03a';
const NEG = '#e0663d';

function fill(v: number | null): string {
  if (v === null) return 'var(--bg2)';
  const a = (0.15 + 0.85 * Math.min(1, Math.abs(v))).toFixed(2);
  return v >= 0 ? `rgba(155,225,93,${a})` : `rgba(224,102,61,${a})`;
}

export function drawBrain(
  svg: SVGSVGElement,
  w1: Float32Array, w2: Float32Array,
  input: Float32Array | null, hidden: Float32Array | null, output: Float32Array | null,
  inLabels: string[], outLabels: string[],
): void {
  const NI = inLabels.length, NH = w1.length / NI, NO = outLabels.length;
  const W = 330, H = Math.max(NI, NH, NO) * 15 + 20;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.height = `${H}px`;
  const L = 118, R = 66, xs = [L, L + (W - L - R) / 2, W - R];
  const ny = (n: number) => Array.from({ length: n }, (_, i) => ((i + 1) * H) / (n + 1));
  const yi = ny(NI), yh = ny(NH), yo = ny(NO);

  let out = '';
  const edge = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    const a = Math.abs(w);
    if (a < 0.25) return; // pesos fraquinhos poluem o desenho
    out += `<line x1="${x1}" y1="${y1.toFixed(1)}" x2="${x2}" y2="${y2.toFixed(1)}" stroke="${w > 0 ? POS : NEG}" stroke-opacity="${(0.12 + Math.min(1, a / 3) * 0.6).toFixed(2)}" stroke-width="${(0.4 + Math.min(2.5, a * 0.7)).toFixed(1)}"/>`;
  };
  for (let j = 0; j < NH; j++) for (let i = 0; i < NI; i++) edge(xs[0], yi[i], xs[1], yh[j], w1[j * NI + i]);
  for (let k = 0; k < NO; k++) for (let j = 0; j < NH; j++) edge(xs[1], yh[j], xs[2], yo[k], w2[k * (NH + 1) + j]);

  const node = (x: number, y: number, v: number | null, r: number) =>
    `<circle cx="${x}" cy="${y.toFixed(1)}" r="${r}" fill="${fill(v)}" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/>`;
  for (let i = 0; i < NI; i++) {
    out += node(xs[0], yi[i], input ? input[i] : null, 5);
    out += `<text x="${xs[0] - 9}" y="${(yi[i] + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="currentColor" opacity=".85">${inLabels[i]}</text>`;
  }
  for (let j = 0; j < NH; j++) out += node(xs[1], yh[j], hidden ? hidden[j] : null, 6.5);
  for (let k = 0; k < NO; k++) {
    out += node(xs[2], yo[k], output ? output[k] : null, 8);
    out += `<text x="${xs[2] + 13}" y="${(yo[k] + 3.5).toFixed(1)}" font-size="11" font-weight="600" fill="currentColor">${outLabels[k]}</text>`;
  }
  svg.innerHTML = out;
}
