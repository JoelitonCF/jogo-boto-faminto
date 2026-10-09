"""
Entidades do jogo: tudo o que existe no rio.

Cada classe guarda o próprio estado e sabe se atualizar. A classe Partida
(partida.py) coordena todas elas e aplica as regras.
"""

from __future__ import annotations

import math
import random
from typing import Iterator, Optional

import config


def limitar(valor: float, minimo: float, maximo: float) -> float:
    """Mantém um valor dentro do intervalo [minimo, maximo]."""
    return max(minimo, min(maximo, valor))


def raio_da_massa(massa: float) -> float:
    """
    O tamanho na tela cresce com a raiz da massa (como a área de um círculo).
    Assim, dobrar a massa não dobra o raio, e peixes enormes não tomam o rio todo.
    """
    return 4 * math.sqrt(massa)


# ---------------------------------------------------------------------------
# Peixe: um por jogador
# ---------------------------------------------------------------------------
class Peixe:
    _proximo_numero = 1

    def __init__(self, id_jogador: str, nome: str, turma: int):
        self.id = id_jogador
        self.numero = Peixe._proximo_numero        # id curto para economizar rede
        Peixe._proximo_numero += 1
        self.nome = nome
        self.turma = turma

        self.x = self.y = 0.0
        self.vx = self.vy = 0.0
        self.angulo = 0.0
        self.entrada_x = self.entrada_y = 0.0     # direção pedida pelo joystick
        self.massa = float(config.MASSA_INICIAL)

        self.vivo = True
        self.renasce_em = 0.0
        self.protegido_ate = 0.0
        self.arrancada_ate = 0.0
        self.arrancada_livre_em = 0.0

        self.maior_massa = self.massa
        self.devorados = 0                        # quantos peixes este já engoliu

        self.conectado = True
        self.desconectado_em = 0.0

    @property
    def raio(self) -> float:
        return raio_da_massa(self.massa)

    # --- controle -----------------------------------------------------------
    def definir_entrada(self, dx: float, dy: float) -> None:
        tamanho = math.hypot(dx, dy)
        if tamanho > 1:                           # o joystick nunca passa de 100%
            dx, dy = dx / tamanho, dy / tamanho
        self.entrada_x, self.entrada_y = dx, dy

    def arrancar(self, agora: float) -> bool:
        if not self.vivo or agora < self.arrancada_livre_em:
            return False
        self.arrancada_ate = agora + config.ARRANCADA_DURACAO
        self.arrancada_livre_em = agora + config.ARRANCADA_RECARGA
        return True

    def protegido(self, agora: float) -> bool:
        return agora < self.protegido_ate

    def ativo(self, agora: float) -> bool:
        """Pode comer e ser comido?"""
        return self.vivo and self.conectado and not self.protegido(agora)

    # --- física -------------------------------------------------------------
    def velocidade_maxima(self) -> float:
        """Quanto maior o peixe, mais lento ele nada."""
        v = config.VELOCIDADE_BASE * (config.MASSA_INICIAL / self.massa) ** 0.35
        return max(config.VELOCIDADE_MINIMA, v)

    def atualizar(self, dt: float, agora: float, gastar_energia: bool = True) -> None:
        if not self.vivo:
            return
        alvo = self.velocidade_maxima()
        if agora < self.arrancada_ate:
            alvo *= config.ARRANCADA_FORCA
        desejado_x = self.entrada_x * alvo if self.conectado else 0
        desejado_y = self.entrada_y * alvo if self.conectado else 0

        # aproxima a velocidade da desejada: o peixe "desliza" um pouco na água
        fator = 1 - math.exp(-8 * dt)
        self.vx += (desejado_x - self.vx) * fator
        self.vy += (desejado_y - self.vy) * fator
        self.x = limitar(self.x + self.vx * dt, 0, config.LARGURA_MUNDO)
        self.y = limitar(self.y + self.vy * dt, 0, config.ALTURA_MUNDO)
        if math.hypot(self.vx, self.vy) > 10:
            self.angulo = math.atan2(self.vy, self.vx)

        # peixe grande gasta mais energia e emagrece devagar
        excesso = self.massa - config.MASSA_SEM_PERDA
        if excesso > 0 and gastar_energia:
            self.massa -= excesso * config.PERDA_POR_SEGUNDO * dt

    # --- massa --------------------------------------------------------------
    def ganhar(self, massa: float) -> None:
        self.massa = min(config.MASSA_MAXIMA, self.massa + massa)
        self.maior_massa = max(self.maior_massa, self.massa)

    def perder(self, fracao: float) -> float:
        perdida = (self.massa - config.MASSA_INICIAL) * fracao
        perdida = max(0.0, perdida)
        self.massa -= perdida
        return perdida

    def pode_engolir(self, outro: "Peixe") -> bool:
        if self.massa < outro.massa * config.PROPORCAO_PARA_COMER:
            return False
        # o centro do outro precisa entrar bem na boca deste
        distancia = math.hypot(self.x - outro.x, self.y - outro.y)
        return distancia < self.raio - outro.raio * 0.4

    def nascer(self, x: float, y: float, agora: float) -> None:
        self.x, self.y = x, y
        self.vx = self.vy = 0.0
        self.massa = float(config.MASSA_INICIAL)
        self.vivo = True
        self.protegido_ate = agora + config.TEMPO_PROTEGIDO

    def ser_devorado(self, agora: float) -> None:
        self.vivo = False
        self.massa = 0.0
        self.renasce_em = agora + config.TEMPO_RENASCER

    def zerar_placar(self) -> None:
        self.maior_massa = float(config.MASSA_INICIAL)
        self.devorados = 0

    # --- rede ---------------------------------------------------------------
    def para_envio(self, agora: float) -> list:
        """Formato compacto: [numero, x, y, massa, angulo*100, flags]."""
        flags = 0
        if self.protegido(agora):
            flags |= 1
        if agora < self.arrancada_ate:
            flags |= 2
        if not self.conectado:
            flags |= 4
        if not self.vivo:
            flags |= 8
        return [self.numero, round(self.x), round(self.y), round(self.massa),
                round(self.angulo * 100), flags]


# ---------------------------------------------------------------------------
# Comida: piabas e frutos espalhados pelo rio
# ---------------------------------------------------------------------------
class Comida:
    _proximo_numero = 1

    def __init__(self, x: float, y: float, massa: float, tipo: int):
        self.numero = Comida._proximo_numero
        Comida._proximo_numero += 1
        self.x, self.y = x, y
        self.massa = massa
        self.tipo = tipo                 # 0 = piaba, 1 = fruto, 2 = pedaço (mordida do boto)

    @classmethod
    def sortear(cls) -> "Comida":
        x = random.uniform(20, config.LARGURA_MUNDO - 20)
        y = random.uniform(20, config.ALTURA_MUNDO - 20)
        if random.random() < config.CHANCE_FRUTO:
            return cls(x, y, config.MASSA_FRUTO, 1)
        return cls(x, y, config.MASSA_PIABA, 0)

    def para_envio(self) -> list:
        return [self.numero, round(self.x), round(self.y), self.tipo]


class GradeDeComida:
    """
    Divide o rio em quadrados para achar comida perto de um peixe sem
    conferir as centenas de itens um por um (técnica de "grade espacial").
    """

    TAMANHO = 120

    def __init__(self):
        self.celulas: dict[tuple[int, int], dict[int, Comida]] = {}
        self.total = 0

    def _celula(self, x: float, y: float) -> tuple[int, int]:
        return int(x // self.TAMANHO), int(y // self.TAMANHO)

    def adicionar(self, comida: Comida) -> None:
        self.celulas.setdefault(self._celula(comida.x, comida.y), {})[comida.numero] = comida
        self.total += 1

    def remover(self, comida: Comida) -> None:
        celula = self.celulas.get(self._celula(comida.x, comida.y))
        if celula and celula.pop(comida.numero, None):
            self.total -= 1

    def perto_de(self, x: float, y: float, raio: float) -> Iterator[Comida]:
        cx1, cy1 = self._celula(x - raio, y - raio)
        cx2, cy2 = self._celula(x + raio, y + raio)
        for cx in range(cx1, cx2 + 1):
            for cy in range(cy1, cy2 + 1):
                yield from list(self.celulas.get((cx, cy), {}).values())

    def todas(self) -> Iterator[Comida]:
        for celula in self.celulas.values():
            yield from celula.values()

    def limpar(self) -> None:
        self.celulas.clear()
        self.total = 0


# ---------------------------------------------------------------------------
# Vitória-régia: folha gigante onde só peixe pequeno consegue se esconder
# ---------------------------------------------------------------------------
class VitoriaRegia:
    def __init__(self, x: float, y: float, raio: float):
        self.x, self.y, self.raio = x, y, raio

    @classmethod
    def espalhar(cls, quantidade: int) -> list["VitoriaRegia"]:
        folhas: list[VitoriaRegia] = []
        tentativas = 0
        while len(folhas) < quantidade and tentativas < 500:
            tentativas += 1
            raio = random.uniform(*config.RAIO_VITORIA_REGIA)
            x = random.uniform(raio + 80, config.LARGURA_MUNDO - raio - 80)
            y = random.uniform(raio + 80, config.ALTURA_MUNDO - raio - 80)
            if all(math.hypot(f.x - x, f.y - y) > f.raio + raio + 220 for f in folhas):
                folhas.append(cls(x, y, raio))
        return folhas

    def cabe(self, raio_peixe: float) -> bool:
        return raio_peixe < self.raio * 0.8

    def empurrar(self, objeto, raio_objeto: float) -> None:
        """Quem não cabe embaixo da folha é empurrado para a borda dela."""
        dx, dy = objeto.x - self.x, objeto.y - self.y
        distancia = math.hypot(dx, dy) or 0.001
        alcance = self.raio + raio_objeto * 0.5
        if distancia < alcance:
            objeto.x = self.x + dx / distancia * alcance
            objeto.y = self.y + dy / distancia * alcance

    def esconde(self, x: float, y: float) -> bool:
        return math.hypot(x - self.x, y - self.y) < self.raio

    def para_envio(self) -> list:
        return [round(self.x), round(self.y), round(self.raio)]


# ---------------------------------------------------------------------------
# O Boto Faminto: aparece de tempos em tempos e caça o maior peixe do rio
# ---------------------------------------------------------------------------
class Boto:
    """
    Personagem controlado pelo servidor. Ele equilibra o jogo: quem cresce
    demais vira alvo e precisa fugir (ou ser protegido pela turma).
    """

    def __init__(self):
        self.ativo = False
        self.x = self.y = -200.0
        self.angulo = 0.0
        self.alvo: Optional[Peixe] = None
        self.vai_embora_em = 0.0
        self.saindo = False
        self.saida_x = self.saida_y = 0.0
        self.proxima_aparicao = 0.0

    def agendar(self, agora: float) -> None:
        self.proxima_aparicao = agora + config.BOTO_INTERVALO

    def aparecer(self, agora: float, alvo: Peixe) -> None:
        # entra pela borda mais distante do alvo, para dar tempo de fugir
        lado = random.choice(["esquerda", "direita", "cima", "baixo"])
        borda = {
            "esquerda": (-80, random.uniform(0, config.ALTURA_MUNDO)),
            "direita": (config.LARGURA_MUNDO + 80, random.uniform(0, config.ALTURA_MUNDO)),
            "cima": (random.uniform(0, config.LARGURA_MUNDO), -80),
            "baixo": (random.uniform(0, config.LARGURA_MUNDO), config.ALTURA_MUNDO + 80),
        }
        self.x, self.y = max(borda.values(), key=lambda p: math.hypot(p[0] - alvo.x, p[1] - alvo.y))
        self.ativo = True
        self.saindo = False
        self.alvo = alvo
        self.vai_embora_em = agora + config.BOTO_DURACAO

    def ir_embora(self) -> None:
        self.saindo = True
        self.alvo = None
        # nada para a borda mais próxima
        opcoes = [(-150, self.y), (config.LARGURA_MUNDO + 150, self.y),
                  (self.x, -150), (self.x, config.ALTURA_MUNDO + 150)]
        self.saida_x, self.saida_y = min(opcoes, key=lambda p: math.hypot(p[0] - self.x, p[1] - self.y))

    def atualizar(self, dt: float) -> None:
        if not self.ativo:
            return
        if self.saindo:
            destino = (self.saida_x, self.saida_y)
            velocidade = config.BOTO_VELOCIDADE * 1.4
        elif self.alvo:
            destino = (self.alvo.x, self.alvo.y)
            velocidade = config.BOTO_VELOCIDADE
        else:
            return
        dx, dy = destino[0] - self.x, destino[1] - self.y
        distancia = math.hypot(dx, dy)
        if distancia > 1:
            passo = min(distancia, velocidade * dt)
            self.x += dx / distancia * passo
            self.y += dy / distancia * passo
            self.angulo = math.atan2(dy, dx)
        if self.saindo and distancia < 5:
            self.ativo = False

    def alcancou(self, peixe: Peixe) -> bool:
        return math.hypot(self.x - peixe.x, self.y - peixe.y) < config.BOTO_RAIO + peixe.raio * 0.5

    def para_envio(self) -> Optional[list]:
        if not self.ativo:
            return None
        alvo = self.alvo.numero if self.alvo else 0
        return [round(self.x), round(self.y), round(self.angulo * 100), alvo]
