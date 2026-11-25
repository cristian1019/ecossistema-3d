# Ecossistema 3D

Simulador de ecossistema em 3D que roda no navegador, com visual de blocos (voxels).
Os seres vivos têm **genes** e um **cérebro de rede neural** que evoluem por **seleção natural**:
ninguém programa o comportamento deles, os cérebros que funcionam melhor simplesmente deixam mais filhos.

A arte é 100% original: blocos com cores planas, variação de tom e contorno feitos no shader, sem texturas de outros jogos.

> **Status:** Fase 1 de 6 concluída (o mundo 3D). As criaturas chegam na Fase 2.

![Visão geral do mundo](docs/screenshot-fase1.jpg)

## Como rodar

Pré-requisito: [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm test           # testes unitários (Vitest)
npm run build      # versão de produção em dist/
```

Dá para escolher o mundo pela URL: `http://localhost:5173/?seed=ilha-azul`.
A mesma seed sempre gera o mesmo mundo.

### Controles

| Modo | Ação |
|---|---|
| Órbita | arrastar = girar · botão direito = mover · roda = zoom · `W A S D` = andar pelo mapa |
| Voo livre | arrastar = olhar · `W A S D` = voar · `Espaço`/`Q` = subir/descer · `Shift` = rápido · roda = velocidade |
| Geral | `F` alterna órbita/voo · `T` pausa o tempo |

## Arquitetura

```
src/
├─ core/        RNG com seed e funções matemáticas (sem dependências)
├─ world/       blocos, biomas, geração do terreno, grade de voxels, greedy meshing
├─ workers/     Web Worker que gera o mundo e monta as malhas
├─ render/      Three.js: chunks, céu/dia-noite, materiais, câmera, resolução dinâmica
├─ ui/          painel (HUD) e estilos
└─ main.ts      liga tudo e roda o laço de renderização
tests/          testes unitários da lógica (sem navegador)
prototipo/      protótipo 2D original (a origem das ideias de evolução)
```

**Princípio central: separar lógica de desenho.** Tudo em `core/` e `world/` é TypeScript puro,
sem DOM nem Three.js, por isso roda tanto no navegador quanto nos testes. A thread principal só desenha;
o trabalho pesado acontece em Web Workers, então a tela nunca congela.

```
 thread principal (60 fps)                 workers (em paralelo)
 ┌──────────────────────────┐   seed     ┌──────────────────────────────┐
 │ Three.js: chunks, céu,   │ ─────────▶ │ gera o mundo pela seed       │
 │ câmera, HUD              │            │ faz a malha de 1/N dos chunks│
 │                          │ ◀───────── │ (buffers transferidos,       │
 └──────────────────────────┘  malhas    │  sem cópia)                  │
                                         └──────────────────────────────┘
```

**Truque de paralelismo:** como a geração é determinística, cada worker gera o mundo inteiro sozinho
(~0,7 s) e monta a malha só da sua parte dos chunks. Assim não é preciso mandar 25 MB de voxels entre threads.
Na Fase 2 o worker da simulação vai usar a mesma ideia.

## Como o mundo é gerado

O mundo tem 512 × 512 × 96 blocos (~25 MB, 1 byte por bloco), dividido em 256 chunks de 32 × 32.

1. **Altura**: soma de ruído simplex em várias escalas (fBm). Um ruído de baixa frequência define continentes;
   um ruído "ridged" (`1 − |ruído|`, elevado ao cubo) forma as cristas das montanhas.
2. **Borda**: uma máscara leva a altura para baixo perto das bordas → o mapa é uma ilha cercada de oceano profundo.
3. **Temperatura e umidade**: mais dois ruídos independentes; a temperatura cai com a altitude.
4. **Biomas** a partir das três grandezas: oceano, praia, planície, floresta, montanha (com neve no alto),
   deserto (quente e seco) e pântano (úmido, quente e baixo, com poças).
5. **Lagos**: regiões planas onde um ruído passa de um limiar; o fundo é escavado e as margens viram diques.
6. **Rios**: nascem nas montanhas e descem escolhendo o vizinho de menor `altura + distância até o mar`
   (a distância vem de uma busca em largura a partir do oceano). O nível da água só desce; se o caminho sobe,
   o terreno é escavado, formando cânions. A largura cresce ao longo do rio.
7. **Árvores** por bioma: carvalhos, pinheiros (frio e montanha), árvores de pântano e cactos.

Tudo usa um gerador aleatório com seed (`mulberry32`), em vez de `Math.random()`.

## Renderização e desempenho

- **Greedy meshing**: faces vizinhas iguais viram um único retângulo. O mundo cai de ~1,5 milhão de faces
  para ~410 mil retângulos. Faces só são fundidas se tiverem o mesmo bloco **e** a mesma oclusão de ambiente.
- **Oclusão de ambiente por vértice**: cada canto olha os 3 blocos vizinhos e escurece conforme estiver cercado.
- **Shader do terreno**: variação de tom por bloco e um contorno leve nas arestas deixam os blocos visíveis
  mesmo depois de fundidos.
- **Sombras em cache**: o mapa de sombra só é redesenhado quando o sol anda ~0,35° ou o foco muda de região.
  Girar a câmera não custa nada de sombra.
- **Resolução dinâmica**: se o FPS cair abaixo de ~52, desenha com menos pixels (até 60%); quando sobra folga, volta a subir.
- **Frustum culling por chunk**: só os chunks que a câmera vê são desenhados.

Medições numa GPU integrada Intel UHD (1024 × 768, mapa inteiro na tela):

| Configuração | Tempo por quadro |
|---|---|
| Primeira versão (sombra redesenhada todo quadro, filtro largo) | 20,8 ms (~48 fps) |
| Sombra em cache + filtro PCF de raio 1 | 12,7 ms (~78 fps) |
| Câmera mais próxima do chão | ~8 ms |

## Como a evolução vai funcionar (Fases 2 e 3)

Vem do protótipo 2D (`prototipo/vida-artificial.html`):

- **Genes de corpo**: tamanho, velocidade, visão, metabolismo, resistência ao frio, cor (camuflagem), idade máxima, ninhada.
- **Cérebro**: rede neural entrada → camada(s) oculta(s) → saídas. Os **pesos fazem parte do DNA**.
  Entradas são relativas à criatura (seno/cosseno do ângulo até a comida, distância normalizada, fome, sede...).
- **Custo de energia** ∝ tamanho³ × velocidade², mais um custo por neurônio: ser grande, rápido ou inteligente custa caro.
- **Reprodução sexuada**: dois pais com energia → filho com *crossover* dos genes e pesos + mutação gaussiana.
- **Seleção natural**: não existe função de "nota". Quem come, foge e se reproduz melhor passa mais genes adiante.

## Testes

```bash
npm test
```

- `rng.test.ts`: o gerador com seed é determinístico, fica no intervalo certo e respeita os limites.
- `worldgen.test.ts`: mesma seed → mundo idêntico; borda é oceano profundo; existem os 7 biomas, rios, lagos e
  árvores bem apoiadas no chão.
- `mesher.test.ts`: casos conhecidos (1 bloco = 6 retângulos, cubo 4³ = 6, chão 32×32 = 6), blocos diferentes
  não se fundem, **sem buracos** (a área total da malha é igual à contagem ingênua de faces) e a oclusão escurece os cantos certos.

## Roteiro

- [x] **Fase 1**: mundo 3D com biomas, rios, lagos, árvores, dia/noite, neblina, sombras, câmera, FPS
- [ ] **Fase 2**: simulação no Web Worker, plantas, herbívoros com cérebro e reprodução sexuada, gráficos
- [ ] **Fase 3**: predadores, caça/fuga, camuflagem, ciclos predador-presa
- [ ] **Fase 4**: peixes, algas e pássaros
- [ ] **Fase 5**: humanos, tribos, conhecimento e construções
- [ ] **Fase 6**: estações, clima, modo deus, salvar/carregar, mini-mapa, polimento

## Tecnologias

TypeScript · Vite · Three.js · simplex-noise · Vitest
