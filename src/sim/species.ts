/**
 * Configuração de cada espécie. Os números de equilíbrio ficam todos aqui,
 * comentados, para ser fácil ajustar e explicar.
 */
import type { Genes } from './genome';
import { Biome } from '../world/biomes';
import { DAY_LENGTH } from './clock';

export const enum Species {
  RABBIT = 0,
  DEER = 1,
  WOLF = 2,
  FOX = 3,
}
export const SPECIES_COUNT = 4;

export interface SpeciesConfig {
  id: Species;
  name: string;
  plural: string;
  /** cor usada nos gráficos */
  chart: string;
  /** o que come: plantas (herbívoro) ou carne (predador) */
  diet: 'plants' | 'meat';
  /** espécies que caça (só predadores) */
  prey: Species[];
  /** multiplicador do metabolismo basal (carnívoros passam muito tempo parados entre refeições) */
  basal: number;
  /** fração da energia da mãe que vai para a ninhada no parto */
  invest: number;
  /** energia mínima (fração) para estar pronto para acasalar */
  readyEnergy: number;
  /** "massa" relativa: escala energia, custo e mordida (coelho = 1) */
  mass: number;
  /** genes médios da população inicial */
  genes: Genes;
  /** gestação em segundos de simulação */
  gestation: number;
  /** maior degrau que consegue subir (em blocos) */
  maxStep: number;
  /** eficiência ao comer grama e frutas */
  grassEff: number;
  /** altura mínima de grama (0..1) que a espécie consegue pastar: boca grande não rói grama rente */
  grazeMin: number;
  fruitEff: number;
  /** eficiência ao comer folhas de árvores (ramoneio); 0 = não alcança */
  browseEff: number;
  initialCount: number;
  /** tamanho dos bandos na população inicial */
  groupSize: number;
  /** biomas onde nascem na população inicial / no repovoamento */
  homes: Biome[];
}


export const SPECIES: SpeciesConfig[] = [
  {
    id: Species.RABBIT,
    name: 'Coelho',
    plural: 'Coelhos',
    chart: '#d9a066',
    diet: 'plants',
    basal: 1,
    invest: 0.5,
    readyEnergy: 0.4,
    prey: [],
    mass: 1,
    genes: {
      size: 1, speed: 5, vision: 14, metabolism: 1.1, fur: 0.35,
      maxAge: 6 * DAY_LENGTH, litter: 3, r: 0.62, g: 0.52, b: 0.42,
    },
    gestation: 50,
    maxStep: 1,
    grassEff: 1,
    grazeMin: 0, // rói a grama até o chão
    fruitEff: 0.5,
    browseEff: 0, // não alcança as folhas
    initialCount: 420,
    groupSize: 12,
    homes: [Biome.PLAINS, Biome.FOREST],
  },
  {
    id: Species.DEER,
    name: 'Cervo',
    plural: 'Cervos',
    chart: '#8f5a34',
    diet: 'plants',
    basal: 1,
    invest: 0.5,
    readyEnergy: 0.4,
    prey: [],
    mass: 6,
    genes: {
      size: 1, speed: 6, vision: 20, metabolism: 0.9, fur: 0.45,
      maxAge: 9 * DAY_LENGTH, litter: 2, r: 0.55, g: 0.36, b: 0.22,
    },
    gestation: 60,
    maxStep: 2,
    grassEff: 0.6,
    grazeMin: 0.3, // só aproveita grama alta
    fruitEff: 2,
    browseEff: 1, // come as folhas baixas das árvores
    initialCount: 150,
    groupSize: 15,
    homes: [Biome.FOREST],
  },
  {
    id: Species.WOLF,
    name: 'Lobo',
    plural: 'Lobos',
    chart: '#9aa3ad',
    diet: 'meat',
    basal: 0.3,
    // predador investe menos no parto e amamenta depois (filhote não caça)
    invest: 0.3,
    readyEnergy: 0.3,
    // caça cervos (grandes: precisa da alcateia) e coelhos
    prey: [Species.DEER, Species.RABBIT],
    mass: 4,
    genes: {
      size: 1, speed: 7, vision: 28, metabolism: 1, fur: 0.55,
      maxAge: 10 * DAY_LENGTH, litter: 3, r: 0.56, g: 0.56, b: 0.58,
    },
    gestation: 90,
    maxStep: 2,
    grassEff: 0, grazeMin: 1, fruitEff: 0, browseEff: 0,
    initialCount: 18,
    groupSize: 6, // alcateias
    homes: [Biome.FOREST, Biome.PLAINS],
  },
  {
    id: Species.FOX,
    name: 'Raposa',
    plural: 'Raposas',
    chart: '#e07a2e',
    diet: 'meat',
    basal: 0.3,
    // predador investe menos no parto e amamenta depois (filhote não caça)
    invest: 0.3,
    readyEnergy: 0.3,
    prey: [Species.RABBIT],
    mass: 1.5,
    genes: {
      size: 1, speed: 7.5, vision: 24, metabolism: 1.1, fur: 0.4,
      maxAge: 7 * DAY_LENGTH, litter: 3, r: 0.85, g: 0.45, b: 0.18,
    },
    gestation: 70,
    maxStep: 1,
    // onívora: caça coelhos, mas come frutas quando falta presa (isso estabiliza a população)
    grassEff: 0, grazeMin: 1, fruitEff: 0.5, browseEff: 0,
    initialCount: 20,
    groupSize: 3, // casal + 1
    homes: [Biome.PLAINS, Biome.FOREST],
  },
];

/** espécies que caçam a espécie s */
export const PREDATORS_OF: Species[][] = SPECIES.map((s) => SPECIES.filter((p) => p.prey.includes(s.id)).map((p) => p.id));

/**
 * Entradas do cérebro (as mesmas para todas as espécies).
 * Direções são relativas à cabeça do bicho: seno (lado) e cosseno (frente/trás).
 */
export const INPUT_LABELS = [
  'comida: lado', 'comida: frente', 'comida: perto',
  'água: lado', 'água: frente', 'água: perto',
  'predador: lado', 'predador: frente', 'predador: perto',
  'parceiro: lado', 'parceiro: frente', 'parceiro: perto',
  'grupo: lado', 'grupo: frente', 'grupo: perto',
  'fome', 'sede', 'cansaço', 'frio', 'é noite?',
  'subida à frente', 'bloqueado à frente', 'constante',
];
export const OUTPUT_LABELS = ['virar', 'acelerar', 'comer', 'beber', 'dormir', 'acasalar'];
/** mesmo cérebro para todas as espécies: 23 → 12 → 6 */
export const BRAIN_SHAPE = { inputs: INPUT_LABELS.length, hidden: 12, outputs: OUTPUT_LABELS.length };

/** para predadores, "comida" é a presa e "comer" é atacar/comer carne */
export function inputLabels(species: Species): string[] {
  if (SPECIES[species].diet === 'plants') return INPUT_LABELS;
  return INPUT_LABELS.map((l) => l.replace('comida', 'presa').replace('predador', 'ameaça'));
}
export function outputLabels(species: Species): string[] {
  if (SPECIES[species].diet === 'plants') return OUTPUT_LABELS;
  return OUTPUT_LABELS.map((l) => (l === 'comer' ? 'atacar' : l));
}
