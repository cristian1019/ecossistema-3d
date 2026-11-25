/**
 * "Instinto" inicial: o cérebro da primeira geração.
 *
 * Com pesos 100% aleatórios a maioria dos bichos gira em círculos e morre, e
 * espécies de reprodução lenta (cervos) não têm tempo de evoluir. Então,
 * opcionalmente, a geração inicial nasce de um "ancestral primitivo": algumas
 * ligações simples escritas à mão + ruído aleatório em todos os pesos.
 * Para predadores, as mesmas ligações viram "presa de um lado → vire" e
 * "com fome e presa perto → atacar" (a entrada "comida" de um predador é a presa).
 *
 * Isso NÃO é treinar a rede. Depois da primeira geração tudo é seleção natural:
 * os pesos mudam por crossover e mutação, e as ligações podem ser apagadas,
 * reforçadas ou trocadas se outra estratégia funcionar melhor.
 */
import type { Rng } from '../core/rng';
import { randomBrain, type Brain, type BrainShape } from './neural';

// índices das entradas (ver INPUT_LABELS em species.ts)
const I = {
  foodSide: 0, foodNear: 2, waterSide: 3, waterNear: 5, groupSide: 12, groupNear: 14,
  predSide: 6, predNear: 8, mateSide: 9, mateNear: 11,
  hunger: 15, thirst: 16, fatigue: 17, night: 19, height: 20, blocked: 21, bias: 22,
};
// índices das saídas (OUTPUT_LABELS)
const O = { turn: 0, speed: 1, eat: 2, drink: 3, sleep: 4, mate: 5, vertical: 6, collect: 7, build: 8 };

export function instinctBrain(shape: BrainShape, rng: Rng, diet: 'plants' | 'meat' = 'plants'): Brain {
  // ruído pequeno em todos os pesos: cada indivíduo é um pouco diferente
  const b = randomBrain(shape, rng, 0.3);
  const NI = shape.inputs, NH = shape.hidden;
  const w1 = (j: number, i: number, v: number) => { b.w1[j * NI + i] += v; };
  const w2 = (k: number, j: number, v: number) => { b.w2[k * (NH + 1) + j] += v; };

  // neurônio 0: comida de um lado → vira para esse lado
  w1(0, I.foodSide, 1.5); w2(O.turn, 0, 1.2);
  // neurônio 1: água de um lado → vira (mais fraco que a comida)
  w1(1, I.waterSide, 1.5); w2(O.turn, 1, 0.7);
  // neurônio 2: com fome e com comida perto → comer
  w1(2, I.hunger, 2); w1(2, I.foodNear, 1.5); w1(2, I.bias, -1.2); w2(O.eat, 2, 2);
  // neurônio 3: com sede e com água perto → beber
  w1(3, I.thirst, 2); w1(3, I.waterNear, 2); w1(3, I.bias, -1.5); w2(O.drink, 3, 2);
  // neurônio 4: cansado e de noite → dormir
  w1(4, I.fatigue, 3); w1(4, I.night, 1.5); w1(4, I.bias, -2.5); w2(O.sleep, 4, 2.5);
  // neurônio 5: parceiro de um lado → vira
  w1(5, I.mateSide, 1.5); w2(O.turn, 5, 1.0);
  // neurônio 6: parceiro perto e sem fome → acasalar
  // (predadores vivem com ~50% de energia entre caçadas: a fome pesa bem menos para eles)
  w1(6, I.mateNear, 2); w1(6, I.hunger, diet === 'meat' ? -0.4 : -1.5); w1(6, I.bias, 0.3); w2(O.mate, 6, 2);
  // neurônio 7: caminho bloqueado → vira e desacelera
  w1(7, I.blocked, 2); w2(O.turn, 7, 1.5); w2(O.speed, 7, -0.8);
  // neurônio 8: bando de um lado → vira um pouco para ele (andar em grupo)
  w1(8, I.groupSide, 1.5); w1(8, I.groupNear, -0.8); w2(O.turn, 8, 0.6);
  // neurônio 9: predador de um lado → vira para o lado OPOSTO
  w1(9, I.predSide, 2); w2(O.turn, 9, -2.2);
  // neurônio 10: predador perto → corre e acorda (para predadores esta entrada
  // é a "ameaça", que começa sempre em zero, então o neurônio fica quieto)
  // (sem viés: com a entrada em zero, tanh(0) = 0 e o neurônio não interfere em nada)
  w1(10, I.predNear, 3); w2(O.speed, 10, 2.5); w2(O.sleep, 10, -2.5); w2(O.eat, 10, -1.5); w2(O.vertical, 10, 2);
  if (diet === 'meat') {
    // neurônio 11 (só predadores): presa perto e com fome → PERSEGUIR (correr)
    w1(11, I.foodNear, 2.5); w1(11, I.hunger, 1); w1(11, I.bias, -0.8); w2(O.speed, 11, 3);
  }
  // (nos herbívoros o neurônio 11 fica livre, só ruído, para a evolução usar)

  // neurônio 12 (quem nada ou voa): fica no meio da faixa de altura
  // (alto demais → desce, baixo demais → sobe). Em quem anda, a saída "subir/descer" é ignorada.
  w1(12, I.height, -2); w2(O.vertical, 12, 2);
  // neurônio 13: comida perto, cansaço ou noite → descer (pássaro pousa para comer e dormir)
  w1(13, I.foodNear, 2); w1(13, I.fatigue, 2); w1(13, I.night, 1); w1(13, I.bias, -2); w2(O.vertical, 13, -3);

  // (só humanos usam) coletar e construir quando não há urgência:
  // fome (neurônio 2), perigo (10) ou sono (4) desligam o trabalho
  w2(O.collect, NH, 0.8); w2(O.build, NH, 0.8);
  w2(O.collect, 2, -1.2); w2(O.collect, 10, -2); w2(O.collect, 4, -1);

  // vieses das saídas: anda em velocidade média, evita dormir à toa
  w2(O.speed, NH, 0.3);
  w2(O.sleep, NH, -0.5);
  return b;
}
