"""
Configurações do Boto Faminto.

Este é o único arquivo que normalmente precisa ser alterado antes do evento.
"""

# ---------------------------------------------------------------------------
# Rede
# ---------------------------------------------------------------------------
PORTA = 8000                 # porta HTTP do servidor
IP_PUBLICADO = ""            # vazio = descobre sozinho o IP do notebook na rede
                             # (preencha, ex.: "192.168.0.10", se o QR code sair errado)
SENHA_ADMIN = "boto2026"     # senha para controlar a partida pelo telão

# Wi-Fi do roteador do jogo. Se preencher, o telão mostra um QR code que
# conecta o celular na rede automaticamente (passo 1) antes do QR do jogo.
NOME_WIFI = "BOTO"
SENHA_WIFI = "boto1234"      # deixe "" se a rede for aberta

# ---------------------------------------------------------------------------
# Turmas participantes (nome exibido e cor do peixe em hexadecimal)
# ---------------------------------------------------------------------------
TURMAS = [
    {"nome": "1º A", "cor": "#ff595e"},
    {"nome": "1º B", "cor": "#ff924c"},
    {"nome": "2º A", "cor": "#8ac926"},
    {"nome": "2º B", "cor": "#4cc9f0"},
    {"nome": "3º A", "cor": "#b388eb"},
    {"nome": "3º B", "cor": "#ffca3a"},
]
MAX_JOGADORES_POR_TURMA = 6  # deixa a disputa justa entre turmas grandes e pequenas

# ---------------------------------------------------------------------------
# Partida
# ---------------------------------------------------------------------------
DURACAO_PARTIDA = 180        # segundos de jogo
CONTAGEM_REGRESSIVA = 5      # segundos de "3, 2, 1..." antes de começar
TICKS_POR_SEGUNDO = 30       # quantas vezes por segundo a física é calculada
ENVIOS_POR_SEGUNDO = 15      # quantas vezes por segundo o estado vai para as telas

# ---------------------------------------------------------------------------
# Mundo (unidades do jogo, não pixels — as telas escalam sozinhas)
# ---------------------------------------------------------------------------
LARGURA_MUNDO = 2400
ALTURA_MUNDO = 1350

# ---------------------------------------------------------------------------
# Peixes (jogadores)
# ---------------------------------------------------------------------------
MASSA_INICIAL = 15
MASSA_MAXIMA = 1000
VELOCIDADE_BASE = 300        # velocidade de um peixe recém-nascido
VELOCIDADE_MINIMA = 70       # nem o maior peixe fica parado
PROPORCAO_PARA_COMER = 1.25  # precisa ser 25% maior para engolir outro peixe
MASSA_SEM_PERDA = 40         # acima disso o peixe "gasta energia" e emagrece devagar
PERDA_POR_SEGUNDO = 0.008    # fração do excesso perdida por segundo
TEMPO_RENASCER = 3           # segundos até voltar depois de ser devorado
TEMPO_PROTEGIDO = 3          # segundos sem poder comer nem ser comido ao nascer

# Arrancada (botão no celular / barra de espaço)
ARRANCADA_FORCA = 2.3        # multiplica a velocidade
ARRANCADA_DURACAO = 0.35
ARRANCADA_RECARGA = 4.0

# ---------------------------------------------------------------------------
# Comida
# ---------------------------------------------------------------------------
MASSA_PIABA = 1
MASSA_FRUTO = 5              # fruto de taperebá que cai no rio: vale mais
CHANCE_FRUTO = 0.05
COMIDA_MINIMA = 140
COMIDA_POR_JOGADOR = 6
COMIDA_MAXIMA = 380
COMIDA_NOVA_POR_PASSO = 6    # quantas aparecem por passo até completar o rio

# ---------------------------------------------------------------------------
# Vitórias-régias: esconderijo dos peixes pequenos
# ---------------------------------------------------------------------------
QUANTIDADE_VITORIAS_REGIAS = 7
RAIO_VITORIA_REGIA = (55, 80)  # peixe maior que a folha não passa por baixo

# ---------------------------------------------------------------------------
# O Boto Faminto (caçador controlado pelo servidor)
# ---------------------------------------------------------------------------
BOTO_INTERVALO = 30          # segundos entre uma aparição e outra
BOTO_DURACAO = 18            # quanto tempo ele caça antes de ir embora
BOTO_VELOCIDADE = 175        # mais rápido que peixes grandes, mais lento que pequenos
BOTO_RAIO = 46
BOTO_MASSA_MINIMA_ALVO = 70  # só caça peixes desse tamanho para cima
BOTO_MORDIDA = 0.5           # fração da massa que a mordida arranca
BOTO_DEVOLVE_COMIDA = 0.6    # parte da massa mordida que vira comida no rio

# ---------------------------------------------------------------------------
# Jogadores desconectados
# ---------------------------------------------------------------------------
TEMPO_RECONEXAO = 45         # segundos que o peixe espera o celular voltar
