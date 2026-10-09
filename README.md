# Boto Faminto

Jogo multiplayer em rede local para o interclasses, no estilo agar.io. Cada
aluno é um peixe no rio, controlado pelo celular ou computador. O peixe cresce comendo
piabas e engolindo peixes menores de outras turmas. O telão mostra o rio
inteiro e o **tamanho somado de cada turma** ao vivo.

De tempos em tempos aparece o **Boto**, de chapéu branco como na lenda, para
caçar o maior peixe do rio.

Funciona **sem internet**: basta um notebook, um roteador e o projetor.

---

## Regras

- Arraste o dedo em qualquer lugar da tela para nadar (no computador: setas ou WASD).
- **Piabas** valem 1 de tamanho; **frutos de taperebá** (laranja, brilhando) valem 5.
- Quem for **25% maior** engole um peixe de **outra turma** ao passar por cima
  dele. Colegas de turma não se comem.
- Quanto maior o peixe, **mais lento** ele nada, e peixes grandes emagrecem
  devagar com o tempo.
- O botão **⚡ Arrancada** dá um impulso rápido para fugir ou dar o bote. Ele
  recarrega em 4 segundos (barra de espaço no computador).
- As **vitórias-régias** são esconderijo: só peixe pequeno passa por baixo
  delas, e lá embaixo o grande não alcança.
- O **Boto** aparece a cada 30 segundos e persegue o maior peixe do rio (a
  partir de 70 de tamanho). Se pegar, arranca **metade do tamanho** dele, e o
  pedaço vira comida no rio. A presa recebe um alerta vermelho no celular.
- Quem é devorado volta em 3 segundos, pequeno e protegido por um instante.
- No celular, peixes com **anel vermelho** podem engolir você; com
  **anel verde**, você pode engoli-los.
- **Ganha a turma com o maior tamanho somado** quando o tempo acaba (3 minutos
  por padrão). Ser devorado diminui o placar da turma, então vale crescer e
  também proteger os colegas.

---

## Do que precisa

| Item | Observação |
|---|---|
| Notebook | Windows, Linux ou Mac com **Python 3.10 ou mais novo** |
| Roteador Wi-Fi | Um roteador próprio, mesmo simples. Não precisa de internet |
| Projetor | Ligado no notebook, para o telão |
| Celulares | Qualquer navegador recente (Chrome, Safari). Nada para instalar |

> **Por que um roteador próprio?** O Wi-Fi  costuma ter "isolamento
> de clientes": os aparelhos não conseguem conversar entre si, e aí o celular
> não enxerga o notebook. Com um roteador só para o jogo isso não acontece.

---

## Instalação (uma vez, com internet)

```bash
pip install -r requirements.txt
```

No Linux pode ser necessário `pip3` ou `pip install --break-system-packages -r requirements.txt`.

---

## Como usar na escola

1. **Ligue o roteador** e conecte o notebook no Wi-Fi dele.
2. Abra `config.py` e confira os nomes e as cores das turmas, o nome e a senha
   do Wi-Fi, a duração da partida e a `SENHA_ADMIN`.
3. **Inicie o servidor** com dois cliques em `iniciar.bat` (Windows) ou com
   `python servidor.py`. Ele mostra três endereços:
   ```
   Jogadores (celular):  http://192.168.0.10:8000/
   Telão (projetor):     http://192.168.0.10:8000/telao
   Telão com controles:  http://192.168.0.10:8000/telao?senha=boto2026
   ```
4. No navegador do notebook, abra o **telão com controles** e aperte `F` para
   tela cheia.
5. Os alunos leem os QR codes do telão: o primeiro conecta no Wi-Fi e o
   segundo abre o jogo. Eles escolhem nome e turma e já podem treinar.
6. Quando todos estiverem no rio, aperte **Iniciar** (ou a tecla `I`).

### Controles do professor (telão)

| Tecla | Ação |
|---|---|
| `I` | Iniciar partida / nova rodada |
| `E` | Encerrar a rodada antes do tempo |
| `L` | Voltar ao lobby (treino livre) |
| `J` | Lista de jogadores, para remover nomes inadequados |
| `F` | Tela cheia |

Cada rodada encerrada é salva no banco `dados/boto.db`. O resultado mostra o
**placar acumulado**, com as vitórias e o tamanho somado de cada turma em
todas as rodadas. Para começar do zero, apague a pasta `dados/`.

> Este jogo usa a porta (8000). Rode um de cada vez,
> ou mude `PORTA` no `config.py` de um deles.

---

## Ajustando o equilíbrio

Tudo fica no `config.py`. Os ajustes que mais mudam o jogo:

| Quer… | Mexa em |
|---|---|
| Partidas mais curtas ou longas | `DURACAO_PARTIDA` |
| Boto mais ou menos frequente | `BOTO_INTERVALO`, `BOTO_DURACAO`, `BOTO_VELOCIDADE` |
| Boto mais ou menos cruel | `BOTO_MORDIDA`, `BOTO_MASSA_MINIMA_ALVO` |
| Mais comida no rio | `COMIDA_MINIMA`, `COMIDA_POR_JOGADOR` |
| Grandões menos dominantes | `PERDA_POR_SEGUNDO` (maior = emagrecem mais rápido), `MASSA_MAXIMA` |
| Mais esconderijos | `QUANTIDADE_VITORIAS_REGIAS`, `RAIO_VITORIA_REGIA` |

---

## Problemas comuns

**O QR code abre um endereço errado.** O notebook pode ter mais de uma rede
(cabo + Wi-Fi). Descubra o IP certo com `ipconfig` (Windows) ou `ip a` (Linux)
e coloque em `IP_PUBLICADO` no `config.py`.

**O celular não abre a página.** No Windows, na primeira vez que rodar, o
Firewall pergunta se o Python pode acessar a rede: marque **Redes privadas** e
permita. Se já negou, libere o Python em *Firewall do Windows › Permitir um
aplicativo*.

**A tela do celular apaga durante o jogo.** Peça para os alunos aumentarem o
tempo de bloqueio de tela antes de começar.

**O Wi-Fi caiu no meio da partida.** O celular reconecta sozinho no mesmo
peixe, que espera até 45 segundos (`TEMPO_RECONEXAO`).

**Quantos jogadores aguenta?** Com 36 peixes, cada passo do jogo leva cerca de
1 ms no servidor. O limite costuma ser o roteador: roteadores domésticos
simples lidam bem com 30 a 40 celulares.

### Testar sem alunos

Com o servidor rodando, em outro terminal:

```bash
python ferramentas/robos.py 24
```

Isso conecta 24 peixes-robô que comem, caçam, fogem dos maiores e do Boto.

---

## Como o código funciona

```
  Celulares (navegador)                 Notebook                    Projetor
 ┌────────────────────┐   WebSocket   ┌──────────────────────┐   ┌────────────┐
 │ jogador.html       │──{dx, dy}────▶│ servidor.py (FastAPI)│   │ telao.html │
 │  joystick+arrancada│──arrancar────▶│  laço de 30 passos/s │──▶│ rio+placar │
 │  HUD e alertas     │◀──estado──────│  jogo/partida.py     │   └────────────┘
 └────────────────────┘   15x/seg     │  jogo/banco.py ──▶ SQLite
                                      └──────────────────────┘
```

O servidor é **autoritativo**: só ele decide quem come quem. O celular manda
apenas a direção do joystick e o aperto da arrancada, então ninguém trapaceia
alterando o JavaScript.

### Estrutura

```
boto-faminto/
├── config.py              ← tudo que se ajusta antes do evento
├── servidor.py            ← páginas, WebSockets, laço do jogo, QR codes
├── jogo/
│   ├── entidades.py       ← classes Peixe, Comida, GradeDeComida, VitoriaRegia, Boto
│   ├── partida.py         ← regras: fases, comer, esconder, o Boto, placar
│   └── banco.py           ← SQLite: salva rodadas, calcula placar acumulado
├── static/
│   ├── jogador.html       ← tela do celular
│   ├── telao.html         ← tela do projetor
│   ├── css/               ← estilos
│   └── js/
│       ├── conexao.js     ← WebSocket que reconecta sozinho
│       ├── render.js      ← desenha o rio no <canvas> (usado pelas duas telas)
│       ├── jogador.js     ← entrada, joystick, arrancada, HUD
│       └── telao.js       ← placar, acontecimentos, resultado, controles
└── ferramentas/robos.py   ← jogadores falsos para teste de carga
```

### Mensagens trocadas (JSON)

| Direção | `tipo` | Conteúdo |
|---|---|---|
| celular → servidor | `entrar` | `id`, `nome`, `turma` |
| celular → servidor | `mover` | `dx`, `dy` entre -1 e 1 |
| celular → servidor | `arrancar` | — |
| telão → servidor | `comando` | `acao`: `iniciar`, `encerrar`, `lobby`, `remover` |
| servidor → todos | `info` | turmas, tamanho do mundo, vitórias-régias, URL, Wi-Fi |
| servidor → todos | `estado` | fase, tempo, placar, peixes, boto, eventos (15x/s) |
| servidor → todos | `comida` | `todas` ao conectar; depois só `novas` e `removidas` |
| servidor → todos | `elenco` | nomes, devorados, lotação das turmas, resultado (quando muda) |
| servidor → celular | `bem_vindo` / `erro` / `removido` | resposta ao `entrar` |

Peixes vão como listas curtas, `[numero, x, y, massa, angulo×100, flags]`, em
que `flags` soma 1 (protegido), 2 (arrancada), 4 (desconectado) e 8 (devorado).

**Por que a comida tem mensagem própria?** São centenas de itens que não se
mexem. Mandar todos 15 vezes por segundo para 30 celulares daria
mais de 2 MB/s saindo do notebook. Mandando só o que mudou, o tráfego cai para uma
fração disso. É um bom exemplo de otimização de rede para discutir em aula.

**Por que existe uma `GradeDeComida`?** Para saber o que um peixe comeu, o
servidor precisaria comparar cada peixe com cada piaba (36 × 300 = 10 mil
contas, 30 vezes por segundo). A grade divide o rio em quadrados e só confere
a comida dos quadrados perto de cada peixe.

---

## Projeto com a turma

O protótipo já funciona de ponta a ponta. A ideia é a turma de
Desenvolvimento de Sistemas assumir e evoluir o jogo até o interclasses.

### Sugestão de equipes

| Equipe | Responsável por | Arquivos principais |
|---|---|---|
| Jogabilidade | Regras, equilíbrio, novos personagens | `jogo/entidades.py`, `jogo/partida.py` |
| Rede | Servidor, protocolo, testes de carga | `servidor.py`, `ferramentas/robos.py` |
| Arte e som | Peixes, Boto, cenário, efeitos sonoros | `static/js/render.js`, `static/css/` |
| Telas | Entrada, HUD, telão, acessibilidade | `static/*.html`, `jogador.js`, `telao.js` |
| Dados | Banco, histórico, relatórios do evento | `jogo/banco.py` |

### Desafios para evoluir

- **Mais lendas**: a **Iara**, que encanta e puxa os peixes próximos para o
  centro do rio; a **Cobra-Grande**, que atravessa o mapa de ponta a ponta e
  divide os peixes que corta; o **Curupira**, que inverte o joystick de quem
  encosta nele.
- **Espécies amazônicas**: cada turma escolhe um peixe (tambaqui, pirarucu,
  tucunaré, acará-disco), com desenho próprio e uma vantagem pequena.
- **Dividir o peixe** (como no agar.io): o peixe se parte em dois para
  alcançar uma presa e depois se junta de novo.
- **Sons**: "nhac" ao engolir, alarme quando o Boto aparece, buzina no fim
  (Web Audio).
- **Minimapa** no celular, mostrando onde estão o Boto e as vitórias-régias.
- **Página de histórico**: rota `/historico` com todas as rodadas do dia,
  consultando o SQLite.
- **Testes automatizados**: `pytest` para as regras de comer, esconder e a
  mordida do Boto.

### Ligação com as disciplinas

- **POO com Python**: classes com responsabilidades claras, encapsulamento
  (`Peixe.pode_engolir`, `VitoriaRegia.cabe`), estado e comportamento juntos.
- **Redes de Computadores**: cliente-servidor, WebSocket sobre TCP, IP local,
  envio por diferença (comida), largura de banda medida com os robôs.
- **Banco de Dados**: modelagem das tabelas, consultas com `GROUP BY` e
  `CASE` no placar acumulado.
- **Estruturas de dados**: a grade espacial como forma de evitar buscas
  quadráticas.
- **Desenvolvimento Mobile**: interface responsiva, multitoque (joystick e
  arrancada ao mesmo tempo), vibração.
- **Engenharia de Software**: divisão em equipes, versionamento com Git,
  testes antes do evento.
