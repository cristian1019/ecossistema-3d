/**
 * Rede neural pequena e rápida: entradas → 1 camada oculta (tanh) → saídas (tanh).
 *
 * Não existe treino por gradiente. Os pesos são GENES: nascem do cruzamento dos
 * pais, sofrem mutação, e só os cérebros que fazem a criatura sobreviver e se
 * reproduzir vão parar na próxima geração (neuroevolução).
 *
 * Layout dos pesos (Float32Array, mais rápido que arrays de objetos):
 *   w1[j * inputs + i]        : entrada i → neurônio oculto j
 *   w2[k * (hidden + 1) + j]  : oculto j → saída k   (coluna "hidden" = viés da saída)
 * O viés dos neurônios ocultos vem de uma entrada constante = 1 (a última entrada).
 */
import type { Rng } from '../core/rng';

export interface BrainShape {
  inputs: number;
  hidden: number;
  outputs: number;
}

export interface Brain {
  shape: BrainShape;
  w1: Float32Array;
  w2: Float32Array;
}

export function weightCount(s: BrainShape): number {
  return s.hidden * s.inputs + s.outputs * (s.hidden + 1);
}

export function randomBrain(shape: BrainShape, rng: Rng, scale = 0.9): Brain {
  const w1 = new Float32Array(shape.hidden * shape.inputs);
  const w2 = new Float32Array(shape.outputs * (shape.hidden + 1));
  for (let i = 0; i < w1.length; i++) w1[i] = rng.gauss() * scale;
  for (let i = 0; i < w2.length; i++) w2[i] = rng.gauss() * scale;
  return { shape, w1, w2 };
}

/**
 * Propagação para frente. Escreve as ativações em `hidden` e `out`
 * (guardamos as ativações para desenhar o cérebro "acendendo" na tela).
 */
export function forward(b: Brain, input: Float32Array, hidden: Float32Array, out: Float32Array): void {
  const { inputs: NI, hidden: NH, outputs: NO } = b.shape;
  const w1 = b.w1, w2 = b.w2;
  for (let j = 0; j < NH; j++) {
    let s = 0;
    const row = j * NI;
    for (let i = 0; i < NI; i++) s += w1[row + i] * input[i];
    hidden[j] = Math.tanh(s);
  }
  for (let k = 0; k < NO; k++) {
    const row = k * (NH + 1);
    let s = w2[row + NH]; // viés
    for (let j = 0; j < NH; j++) s += w2[row + j] * hidden[j];
    out[k] = Math.tanh(s);
  }
}

/**
 * Cruzamento (crossover) por neurônio: para cada neurônio oculto, o filho herda
 * de UM dos pais o conjunto inteiro de pesos que entram e saem dele.
 * Assim um "detector" que funciona (ex.: "comida à esquerda → vire à esquerda")
 * passa inteiro para o filho, em vez de ser misturado e quebrado.
 */
export function crossoverBrain(a: Brain, b: Brain, rng: Rng): Brain {
  const s = a.shape;
  const w1 = new Float32Array(a.w1.length);
  const w2 = new Float32Array(a.w2.length);
  for (let j = 0; j < s.hidden; j++) {
    const p = rng.next() < 0.5 ? a : b;
    w1.set(p.w1.subarray(j * s.inputs, (j + 1) * s.inputs), j * s.inputs);
    for (let k = 0; k < s.outputs; k++) w2[k * (s.hidden + 1) + j] = p.w2[k * (s.hidden + 1) + j];
  }
  for (let k = 0; k < s.outputs; k++) {
    const p = rng.next() < 0.5 ? a : b;
    w2[k * (s.hidden + 1) + s.hidden] = p.w2[k * (s.hidden + 1) + s.hidden];
  }
  return { shape: s, w1, w2 };
}

/**
 * Mutação: cada peso tem chance `rate` de levar um empurrão gaussiano de
 * tamanho `strength`; com chance bem menor, é sorteado do zero.
 * Altera o cérebro no lugar (use num cérebro recém-criado).
 */
export function mutateBrain(b: Brain, rng: Rng, rate: number, strength: number): void {
  for (const w of [b.w1, b.w2]) {
    for (let i = 0; i < w.length; i++) {
      if (rng.next() < rate) w[i] += rng.gauss() * strength;
      if (rng.next() < rate * 0.04) w[i] = rng.gauss() * 0.9;
      if (w[i] > 6) w[i] = 6;
      else if (w[i] < -6) w[i] = -6;
    }
  }
}

export function cloneBrain(b: Brain): Brain {
  return { shape: b.shape, w1: b.w1.slice(), w2: b.w2.slice() };
}
