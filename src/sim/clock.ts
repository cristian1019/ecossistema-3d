/**
 * Relógio da simulação. Um dia dura DAY_LENGTH segundos de simulação
 * (4 min na velocidade 1x). O tempo é sempre o da simulação, nunca o real:
 * a 100x um dia passa em 2,4 s.
 */
import { smoothstep } from '../core/math';

export const DAY_LENGTH = 240;
/** o relógio começa às 07:12 da manhã do dia 1 */
const START_TOD = 0.3;

/** hora do dia em [0, 1): 0 = meia-noite, 0,5 = meio-dia */
export function timeOfDay(time: number): number {
  return (time / DAY_LENGTH + START_TOD) % 1;
}

/** número do dia (começa em 1) */
export function dayNumber(time: number): number {
  return Math.floor(time / DAY_LENGTH + START_TOD) + 1;
}

/** um ano tem 4 estações de 5 dias (as estações em si chegam na Fase 6) */
export const YEAR_DAYS = 20;

/** "Ano 2, dia 7" para a linha do tempo */
export function dateLabel(time: number): string {
  const d = dayNumber(time) - 1;
  return `Ano ${Math.floor(d / YEAR_DAYS) + 1}, dia ${(d % YEAR_DAYS) + 1}`;
}

/** luz do dia: 0 = noite, 1 = dia pleno (a partir da altura do sol) */
export function daylightAt(time: number): number {
  const sunY = Math.sin((timeOfDay(time) - 0.25) * Math.PI * 2);
  return smoothstep(-0.12, 0.25, sunY);
}
