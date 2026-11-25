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
}
export const SPECIES_COUNT = 2;

export interface SpeciesConfig {
  id: Species;
  name: string;
  plural: string;
  /** cor usada nos gráficos */
  chart: string;
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
];

/**
 * Entradas do cérebro (iguais para todos os herbívoros).
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
export const HERBIVORE_BRAIN = { inputs: INPUT_LABELS.length, hidden: 10, outputs: OUTPUT_LABELS.length };
