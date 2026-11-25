# Ecossistema 3D

Simulador de ecossistema em 3D que roda no navegador, com visual de blocos (voxels).
Os seres vivos têm **genes** e um **cérebro de rede neural** que evoluem por **seleção natural**:
ninguém programa o comportamento deles; os cérebros e corpos que funcionam melhor simplesmente deixam mais filhos.

A arte é 100% original: blocos com cores planas, variação de tom e contorno feitos no shader, sem texturas de outros jogos.

> **Status:** Fase 2 de 6 concluída: mundo 3D, plantas e herbívoros (coelhos e cervos) evoluindo.
> Predadores chegam na Fase 3.

![Coelhos, arbustos, gráfico de população e a ficha com o cérebro ao vivo](docs/screenshot-fase2.jpg)

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
| Criaturas | **clique** num bicho para abrir a ficha · "Seguir" · "Olhos do bicho" (primeira pessoa) |
| Geral | `F` alterna órbita/voo · `T` pausa · `Esc` sai dos olhos do bicho / fecha a ficha |

## Arquitetura

```
src/
├─ core/        RNG com seed e funções matemáticas (sem dependências)
├─ world/       blocos, biomas, geração do terreno, grade de voxels, greedy meshing
├─ sim/         a simulação: rede neural, genoma, espécies, plantas, criaturas, relógio
├─ workers/     Web Workers (mundo e simulação) e os protocolos de mensagens
├─ render/      Three.js: chunks, céu/dia-noite, câmera, criaturas e arbustos instanciados
├─ ui/          painel, gráfico de população (uPlot), ficha da criatura, desenho do cérebro
└─ main.ts      liga tudo e roda o laço de renderização
tests/          testes unitários da lógica (sem navegador)
prototipo/      protótipo 2D original (a origem das ideias de evolução)
```

**Princípio central: separar lógica de desenho.** Tudo em `core/`, `world/` e `sim/` é TypeScript puro,
sem DOM nem Three.js, por isso roda tanto no navegador quanto nos testes. A thread principal só desenha;
o trabalho pesado acontece em Web Workers, então a tela não congela nem quando o tempo está em 100x.

```
 thread principal (60 fps)                 workers do MUNDO (2 a 4, em paralelo)
 ┌──────────────────────────┐    seed     ┌───────────────────────────────┐
 │ Three.js: chunks, céu,   │ ──────────▶ │ gera o mundo pela seed        │
 │ criaturas instanciadas,  │ ◀────────── │ faz a malha de 1/N dos chunks │
 │ HUD, gráfico, ficha      │   malhas    └───────────────────────────────┘
 │                          │
 │ interpola as posições    │    seed     worker da SIMULAÇÃO
 │ entre os quadros         │ ──────────▶ ┌───────────────────────────────┐
 │                          │ ◀────────── │ recria o mundo pela seed      │
 └──────────────────────────┘   ~20×/s    │ plantas, cérebros, evolução   │
                              12 números  │ roda N passos conforme a      │
                              por bicho   │ velocidade (1x a 100x)        │
                                          └───────────────────────────────┘
```

**Truque de paralelismo:** como a geração é determinística, cada worker gera o mundo inteiro sozinho
(~0,7 s) em vez de recebê-lo. Assim não é preciso mandar 25 MB de voxels entre threads.
As criaturas viajam como um `Float32Array` "achatado" (12 números por bicho), *transferido* sem cópia.

## Como o mundo é gerado

O mundo tem 512 × 512 × 96 blocos (~25 MB, 1 byte por bloco), dividido em 256 chunks de 32 × 32.

1. **Altura**: soma de ruído simplex em várias escalas (fBm). Um ruído de baixa frequência define continentes;
   um ruído "ridged" (`1 − |ruído|`, elevado ao cubo) forma as cristas das montanhas.
2. **Borda**: uma máscara leva a altura para baixo perto das bordas → o mapa é uma ilha cercada de oceano profundo.
3. **Temperatura e umidade**: mais dois ruídos independentes; a temperatura cai com a altitude.
4. **Biomas**: oceano, praia, planície, floresta, montanha (neve no alto), deserto e pântano.
5. **Lagos**: regiões planas onde um ruído passa de um limiar; o fundo é escavado e as margens viram diques.
6. **Rios**: nascem nas montanhas e descem escolhendo o vizinho de menor `altura + distância até o mar`
   (distância calculada por busca em largura a partir do oceano). O nível da água só desce; se o caminho sobe,
   o terreno é escavado, formando cânions.
7. **Árvores** por bioma: carvalhos, pinheiros, árvores de pântano e cactos.

## Como a simulação funciona

A simulação anda em passos de 0,2 s de "tempo de simulação"; um dia dura 240 s (4 min em 1x).
A cada passo, cada criatura:

1. **Sente** o mundo e preenche as 23 entradas do cérebro.
2. **Pensa**: as entradas passam pela rede neural (23 → 10 → 6).
3. **Age** conforme as 6 saídas: virar, acelerar, comer, beber, dormir, acasalar.
4. **Gasta energia**: metabolismo, movimento (∝ massa × velocidade²), cérebro e olhos.
5. Pode **acasalar**, **parir** ou **morrer** (fome, sede, frio, velhice).

### O cérebro

```
 23 entradas (sentidos)               10 ocultos (tanh)      6 saídas (decisões)
 comida/água/parceiro/grupo:            ●                     virar
   [lado, frente, perto]                ●                     acelerar
 predador (Fase 3)                      ●                     comer
 fome, sede, cansaço, frio, noite  ──▶  ●   ──────────────▶   beber
 subida à frente, bloqueado             ●                     dormir
 constante (viés)                       ●                     acasalar
```

- As direções são **relativas à cabeça do bicho**: seno do ângulo até o alvo (está à esquerda ou à direita?)
  e cosseno (está na frente ou atrás?). Por isso uma única ligação "comida à direita → vire à direita" já funciona.
- Os **296 pesos fazem parte do DNA**. Não existe treino por gradiente nem "nota": só seleção natural.
- A ficha da criatura desenha a rede ao vivo: linha verde reforça, laranja inibe, e as bolinhas acendem conforme ela pensa.

### Genes de corpo e seus custos (trade-offs)

| Gene | Vantagem | Custo |
|---|---|---|
| Tamanho | mais reserva, mordida maior, gasta menos por quilo (Kleiber), perde menos calor, passada maior, preferido pelas fêmeas | energia total ∝ tamanho³; sofre mais no calor |
| Velocidade | chega antes na comida e no parceiro | energia ∝ velocidade² |
| Visão | enxerga comida e parceiros de mais longe | custo fixo por bloco de visão |
| Metabolismo | amadurece mais cedo, digere e descansa mais rápido | gasta mais energia parado |
| Resistência ao frio | aguenta noites e montanhas frias | gasto extra e sofre no calor |
| Ninhada | mais filhotes por gestação | cada filhote nasce com menos energia |
| Idade máxima | vive mais | amadurece mais tarde |
| Cor (RGB) | camuflagem (Fase 3) | — |

### Reprodução sexuada

1. Uma fêmea **pronta** (adulta, com energia e água, sem cooldown) e cujo cérebro diz "acasalar" ouve o
   chamado de um macho pronto que também quer acasalar e vai até ele (**corte**). Ela prefere machos
   maiores (**seleção sexual**): um macho 40% maior "vale" tanto quanto um normal à metade da distância.
2. A menos de 4 blocos, ela engravida do maior macho pronto por perto. A gestação dura 50 s (coelho) ou 60 s (cervo).
3. No parto, cada filhote recebe `crossover(mãe, pai) + mutação`:
   - **genes de corpo**: cada gene vem de um dos pais ou é a média dos dois; depois, mutação gaussiana pequena;
   - **cérebro**: o crossover é **por neurônio**, ou seja, cada neurônio oculto vem inteiro de um dos pais
     (pesos de entrada e de saída juntos). Assim um "detector" que funciona passa intacto para o filho.
4. A mãe investe 50% da energia, dividida entre os filhotes da ninhada.

### Plantas e cadeia alimentar

- **Grama**: um valor 0..1 por bloco de chão, que cresce de forma logística conforme fertilidade, umidade e luz.
  O chão fica marrom-palha onde os bichos comeram (o shader do terreno lê uma textura vinda da simulação).
- **Arbustos**: dão frutas vermelhas (comida forte) e espalham sementes.
- **Folhas de árvore** (ramoneio): só o cervo alcança. Esse **nicho separado** evita que os coelhos,
  que pastam rente, deixem os cervos sem comida.

### Instinto inicial e repovoamento

- Com cérebros 100% aleatórios, quase todos os bichos giram em círculos e morrem, e o cervo, que se reproduz devagar,
  não tem tempo de evoluir. Por isso a **primeira geração** nasce de um "ancestral primitivo": algumas ligações simples
  escritas à mão ("fome + comida perto → comer", "cansado + noite → dormir"...) mais ruído aleatório.
  Depois disso, tudo é seleção natural. Dá para desligar no painel e comparar.
- **Repovoamento** (pode desligar): se uma espécie cai abaixo de 6 indivíduos, dois bandos novos são soltos a partir
  dos **melhores genomas já vistos** daquela espécie (mais filhos deixados).

### Números do equilíbrio (e por quê)

Ajustados rodando a simulação sem tela por 30 a 60 dias simulados e olhando populações, mortes e genes:

| Parâmetro | Valor | Motivo |
|---|---|---|
| Reserva de energia | 300 × massa | um adulto parado aguenta ~1,5 dia sem comer |
| Crescimento da grama | 0,2%/s | sustenta algumas centenas de coelhos; com mais, a grama acaba e eles passam fome |
| Arbustos | máx. 2.000, fruta a cada 90–150 s | com 4.500 arbustos as frutas alimentavam ~1.500 coelhos (explosão) |
| Folhas (ramoneio) | rebrota 0,8%/s, raio 4 em volta das árvores | com 0,4%/s sustentavam só ~50 cervos; com 1,2%/s os cervos explodiam |
| Altura mínima de pastejo | coelho 0, cervo 0,3 | o coelho rói a grama rente; o cervo só aproveita grama alta |
| Bandos iniciais | 12 coelhos / 15 cervos | espalhados, os pares quase nunca se encontram |
| Chamado de acasalamento | 3 × visão | populações ralas somem por não se encontrarem (efeito Allee) |
| Metabolismo basal | ∝ massa^0,75 (lei de Kleiber) | bicho grande gasta menos por quilo |
| Custo fixo do cérebro/olhos | 0,1 + 0,004 × visão | não diminui se o corpo encolher |
| Seleção sexual | fêmea prefere macho maior | contrapeso real ao encolhimento |

Resultado numa rodada de 30 dias (seed `ecossistema`): depois do pico e da queda dos primeiros dias, coelhos
oscilam entre ~180 e ~350 e cervos sobem devagar até ~600, convivendo, cada um no seu nicho. Sem predadores, ainda não
há um teto natural firme para os cervos: isso fica para a Fase 3.

### Fenômenos que apareceram sozinhos (e como cada um foi resolvido)

O balanceamento foi feito rodando a simulação sem tela e olhando os números. Vários comportamentos
apareceram sem ninguém programar:

- **Nanismo**: com todos os custos proporcionais à massa, os coelhos encolheram de 1,0 para 0,57 em 60 dias,
  porque ser pequeno saía "de graça" (na biologia: nanismo insular). Custo fixo do cérebro, regra de Bergmann,
  lei de Kleiber e seleção sexual reduziram isso: na versão final, 1,0 → 0,83 em 30 dias. Ainda há uma leve
  tendência a encolher; os predadores da Fase 3 (que pegam mais fácil os pequenos) devem completar o equilíbrio.
- **Exclusão competitiva**: quando coelhos e cervos comiam a mesma grama, uma espécie sempre eliminava a outra
  (às vezes os coelhos, às vezes os cervos). Separar os nichos (folhas de árvore e grama alta para o cervo, grama rente
  para o coelho) permitiu a convivência.
- **Efeito Allee**: com poucos cervos espalhados pela floresta, quase nenhuma fêmea pronta tinha um macho pronto a menos
  de 40 blocos. A população caía mesmo com comida sobrando. O chamado de acasalamento e a corte resolveram.
- **Explosão por excesso de comida**: com 4.500 arbustos dando frutas, os coelhos chegavam ao limite de 2.000.

## Renderização e desempenho

- **Greedy meshing**: faces vizinhas iguais viram um único retângulo. O mundo cai de ~1,5 milhão de faces
  para ~410 mil retângulos. Faces só são fundidas se tiverem o mesmo bloco **e** a mesma oclusão de ambiente.
- **Oclusão de ambiente por vértice**, variação de tom por bloco e contorno leve nas arestas (no shader).
- **Sombras em cache**: o mapa de sombra só é redesenhado quando o sol anda ~0,35° ou o foco muda de região.
- **Resolução dinâmica**: se o FPS cair abaixo de ~52, desenha com menos pixels (até 60%).
- **Criaturas com InstancedMesh**: cada parte do boneco (corpo, cabeça, orelhas, pernas...) é um InstancedMesh, então
  centenas de bichos custam poucas chamadas de desenho. Bichos fora da câmera não são montados, e os distantes só
  desenham corpo e cabeça (LOD). Sombra "blob" (um degradê no chão) em vez de sombra real.
- **Interpolação**: o worker manda posições ~20×/s; a tela interpola entre os dois últimos quadros para ficar suave a 60 fps.
  Em 20x e 100x, a interpolação e as animações são desligadas (simplificação pedida para velocidades altas).
- **Simulação**: a busca cara (comida, água, parceiros) roda a cada 3 passos, escalonada pelo id; as entradas do cérebro
  são recalculadas todo passo a partir dos alvos guardados. Grades espaciais (células 8×8) para vizinhos e arbustos.

Medições numa GPU integrada Intel UHD, notebook de 4 núcleos:

| Medida | Valor |
|---|---|
| Desenho do mapa inteiro, 1024 × 768 (sombra em cache) | 12,7 ms (~78 fps) |
| Montar as matrizes de ~570 bichos (mapa inteiro / de perto) | 2,0 ms / 0,6 ms |
| Passo da simulação | ~5 µs por criatura |

Velocidade real alcançada neste notebook (4 núcleos, com a tela desenhando ao mesmo tempo): **20x pedido → 20x**;
**100x pedido → ~50x** com ~600 bichos (e menos no pico de ~1.500 do primeiro dia). O painel mostra sempre a
**velocidade real** (em amarelo quando fica abaixo da pedida). Chegar a 100x de verdade é um objetivo da otimização
da Fase 6 (por exemplo, rodar a simulação em mais de um worker).

## Testes

```bash
npm test
```

- `rng.test.ts`: o gerador com seed é determinístico e respeita os limites.
- `worldgen.test.ts`: mesma seed → mundo idêntico; borda é oceano; 7 biomas; rios, lagos e árvores.
- `mesher.test.ts`: casos conhecidos, blocos diferentes não se fundem, **sem buracos**, oclusão nos cantos certos.
- `neural.test.ts`: conta à mão da propagação, saídas em [-1, 1], crossover por neurônio, limites da mutação.
- `genome.test.ts`: crossover/mutação dos genes, determinismo, e uma mini seleção artificial que faz a velocidade subir.
- `simulation.test.ts`: num mundinho 64×64, com cérebros montados à mão:
  - **cadeia alimentar**: comer grama, frutas e folhas (só o cervo alcança);
  - **necessidades**: beber na margem, morrer de fome, de sede e de velhice, não entrar na água;
  - **reprodução**: gestação, filhotes com geração certa e pais registrados; macho + macho, espécies diferentes,
    jovens e famintos não reproduzem;
  - **determinismo**: mesma seed, mesmo resultado.

## Roteiro

- [x] **Fase 1**: mundo 3D com biomas, rios, lagos, árvores, dia/noite, neblina, sombras, câmera, FPS
- [x] **Fase 2**: simulação no Web Worker, plantas, coelhos e cervos com cérebro, genes, necessidades e
      reprodução sexuada; gráfico de população; ficha com a rede neural ao vivo
- [ ] **Fase 3**: predadores, caça/fuga, camuflagem, ciclos predador-presa, gráficos de genes
- [ ] **Fase 4**: peixes, algas e pássaros
- [ ] **Fase 5**: humanos, tribos, conhecimento e construções
- [ ] **Fase 6**: estações, clima, modo deus, salvar/carregar, mini-mapa, polimento

## Tecnologias

TypeScript · Vite · Three.js · simplex-noise · uPlot · Vitest
