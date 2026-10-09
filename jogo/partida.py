"""
Partida: coordena peixes, comida, vitórias-régias e o Boto, e aplica as regras.

Fases de uma partida:
    lobby     -> jogadores entram e treinam (o placar não vale)
    contagem  -> peixes parados, contagem regressiva no telão
    jogando   -> valendo! o relógio corre
    fim       -> resultado na tela, até o professor voltar ao lobby

Pontuação: o placar de cada turma é a SOMA DO TAMANHO (massa) de todos os
peixes dela naquele instante. Ser devorado derruba o placar da turma, então
vale a pena crescer e também proteger os colegas.
"""

from __future__ import annotations

import math
import random
from datetime import datetime
from typing import Callable, Optional

import config
from jogo.entidades import Boto, Comida, GradeDeComida, Peixe, VitoriaRegia, raio_da_massa

LOBBY, CONTAGEM, JOGANDO, FIM = "lobby", "contagem", "jogando", "fim"


class Partida:
    def __init__(self, ao_terminar: Optional[Callable[[dict], None]] = None):
        self.fase = LOBBY
        self.peixes: dict[str, Peixe] = {}
        self.comida = GradeDeComida()
        self.folhas = VitoriaRegia.espalhar(config.QUANTIDADE_VITORIAS_REGIAS)
        self.boto = Boto()
        self.boto.agendar(0)
        self.fim_da_fase = 0.0
        self.iniciada_em: Optional[datetime] = None
        self.resultado: Optional[dict] = None
        self.ao_terminar = ao_terminar

        self.eventos: list[dict] = []     # coisas que aconteceram desde o último envio
        self.comida_nova: list[Comida] = []
        self.comida_removida: list[int] = []
        self.elenco_mudou = True          # avisa a rede para reenviar a lista de nomes
        self._repor_comida(tudo=True)

    # ------------------------------------------------------------------
    # Jogadores
    # ------------------------------------------------------------------
    def jogadores_na_turma(self, turma: int) -> int:
        return sum(1 for p in self.peixes.values() if p.turma == turma)

    def entrar(self, id_jogador: str, nome: str, turma: int,
               agora: float) -> tuple[Optional[Peixe], str]:
        """Coloca um jogador no rio. Devolve (peixe, "") ou (None, mensagem de erro)."""
        if id_jogador in self.peixes:                 # celular reconectando
            peixe = self.peixes[id_jogador]
            peixe.conectado = True
            self.elenco_mudou = True
            return peixe, ""

        nome = " ".join(nome.split())[:14]
        if not nome:
            return None, "Digite seu nome."
        if not (0 <= turma < len(config.TURMAS)):
            return None, "Escolha uma turma."
        if self.jogadores_na_turma(turma) >= config.MAX_JOGADORES_POR_TURMA:
            return None, f"A turma {config.TURMAS[turma]['nome']} já está completa."

        peixe = Peixe(id_jogador, nome, turma)
        peixe.nascer(*self._lugar_seguro(), agora)
        self.peixes[id_jogador] = peixe
        self.elenco_mudou = True
        return peixe, ""

    def desconectar(self, id_jogador: str, agora: float) -> None:
        peixe = self.peixes.get(id_jogador)
        if peixe:
            peixe.conectado = False
            peixe.desconectado_em = agora
            peixe.definir_entrada(0, 0)
            self.elenco_mudou = True

    def remover(self, numero: int) -> Optional[str]:
        """Remove um peixe pelo número curto (usado pelo professor). Devolve o id."""
        for id_jogador, peixe in list(self.peixes.items()):
            if peixe.numero == numero:
                del self.peixes[id_jogador]
                if self.boto.alvo is peixe:
                    self.boto.alvo = None
                self.elenco_mudou = True
                return id_jogador
        return None

    def mover(self, id_jogador: str, dx: float, dy: float) -> None:
        peixe = self.peixes.get(id_jogador)
        if peixe:
            peixe.definir_entrada(dx, dy)

    def arrancar(self, id_jogador: str, agora: float) -> None:
        peixe = self.peixes.get(id_jogador)
        if peixe and self.fase != CONTAGEM:
            peixe.arrancar(agora)

    def _lugar_seguro(self) -> tuple[float, float]:
        """Sorteia um ponto longe dos peixes que poderiam engolir um recém-nascido."""
        perigosos = [p for p in self.peixes.values()
                     if p.vivo and p.massa > config.MASSA_INICIAL * config.PROPORCAO_PARA_COMER]
        melhor, melhor_folga = (config.LARGURA_MUNDO / 2, config.ALTURA_MUNDO / 2), -1.0
        for _ in range(25):
            x = random.uniform(60, config.LARGURA_MUNDO - 60)
            y = random.uniform(60, config.ALTURA_MUNDO - 60)
            folga = min([math.hypot(p.x - x, p.y - y) - p.raio for p in perigosos] + [9999.0])
            if folga > melhor_folga:
                melhor, melhor_folga = (x, y), folga
            if folga > 400:
                break
        return melhor

    # ------------------------------------------------------------------
    # Controle da partida (comandos do professor)
    # ------------------------------------------------------------------
    def iniciar(self, agora: float) -> None:
        if self.fase not in (LOBBY, FIM):
            return
        for peixe in self.peixes.values():
            peixe.massa = 0                      # não atrapalha o sorteio dos lugares
        for peixe in self.peixes.values():
            peixe.nascer(*self._lugar_seguro(), agora + config.CONTAGEM_REGRESSIVA)
            peixe.zerar_placar()
        self._repor_comida(tudo=True)
        self.boto = Boto()
        self.boto.agendar(agora + config.CONTAGEM_REGRESSIVA)
        self.resultado = None
        self.fase = CONTAGEM
        self.fim_da_fase = agora + config.CONTAGEM_REGRESSIVA
        self.elenco_mudou = True

    def encerrar(self, agora: float) -> None:
        if self.fase == CONTAGEM:
            self.voltar_ao_lobby(agora)
        elif self.fase == JOGANDO:
            self._finalizar(agora)

    def voltar_ao_lobby(self, agora: float = 0.0) -> None:
        self.fase = LOBBY
        self.resultado = None
        for peixe in self.peixes.values():
            peixe.zerar_placar()
        self.boto = Boto()
        self.boto.agendar(agora)
        self.elenco_mudou = True

    def pontos_das_turmas(self) -> list[int]:
        pontos = [0.0] * len(config.TURMAS)
        for peixe in self.peixes.values():
            if peixe.vivo:
                pontos[peixe.turma] += peixe.massa
        return [round(p) for p in pontos]

    def _finalizar(self, agora: float) -> None:
        self.fase = FIM
        self.boto.ir_embora()
        pontos = self.pontos_das_turmas()
        turmas = [{"indice": i, "nome": t["nome"], "cor": t["cor"], "pontos": pontos[i],
                   "jogadores": self.jogadores_na_turma(i)}
                  for i, t in enumerate(config.TURMAS)]
        turmas.sort(key=lambda t: -t["pontos"])

        destaques = sorted(self.peixes.values(), key=lambda p: (-p.maior_massa, -p.devorados))
        duracao = config.DURACAO_PARTIDA - max(0, self.fim_da_fase - agora)
        self.resultado = {
            "iniciada_em": (self.iniciada_em or datetime.now()).isoformat(timespec="seconds"),
            "duracao": round(duracao),
            "turmas": turmas,
            "jogadores": [
                {"numero": p.numero, "nome": p.nome, "turma": p.turma,
                 "massa": round(p.massa), "maior_massa": round(p.maior_massa),
                 "devorados": p.devorados}
                for p in destaques
            ],
        }
        self.elenco_mudou = True
        if self.ao_terminar:
            self.ao_terminar(self.resultado)

    def tempo_restante(self, agora: float) -> int:
        if self.fase in (CONTAGEM, JOGANDO):
            return max(0, math.ceil(self.fim_da_fase - agora))
        return 0

    # ------------------------------------------------------------------
    # Um passo da simulação (chamado TICKS_POR_SEGUNDO vezes por segundo)
    # ------------------------------------------------------------------
    def passo(self, dt: float, agora: float) -> None:
        self._trocar_de_fase(agora)
        self._remover_ausentes(agora)
        if self.fase == CONTAGEM:              # todo mundo espera a largada
            return

        self._renascer(agora)
        for peixe in self.peixes.values():
            peixe.atualizar(dt, agora, gastar_energia=self.fase != FIM)  # no fim o placar congela
        self._folhas_empurram()

        if self.fase in (LOBBY, JOGANDO):
            self._comer_comida()
            self._peixes_se_comem(agora)
            self._repor_comida()
            self._cuidar_do_boto(dt, agora)
        else:
            self.boto.atualizar(dt)            # no fim ele só vai embora

    def _trocar_de_fase(self, agora: float) -> None:
        if self.fase == CONTAGEM and agora >= self.fim_da_fase:
            self.fase = JOGANDO
            self.fim_da_fase = agora + config.DURACAO_PARTIDA
            self.iniciada_em = datetime.now()
        elif self.fase == JOGANDO and agora >= self.fim_da_fase:
            self._finalizar(agora)

    def _remover_ausentes(self, agora: float) -> None:
        for id_jogador, peixe in list(self.peixes.items()):
            if not peixe.conectado and agora - peixe.desconectado_em > config.TEMPO_RECONEXAO:
                self.remover(peixe.numero)

    def _renascer(self, agora: float) -> None:
        for peixe in self.peixes.values():
            if not peixe.vivo and peixe.conectado and agora >= peixe.renasce_em:
                peixe.nascer(*self._lugar_seguro(), agora)
                self.eventos.append({"t": "nasceu", "n": peixe.numero})

    def _folhas_empurram(self) -> None:
        for folha in self.folhas:
            for peixe in self.peixes.values():
                if peixe.vivo and not folha.cabe(peixe.raio):
                    folha.empurrar(peixe, peixe.raio)
            if self.boto.ativo and not self.boto.saindo:
                folha.empurrar(self.boto, config.BOTO_RAIO)

    def escondido(self, peixe: Peixe) -> bool:
        return any(f.cabe(peixe.raio) and f.esconde(peixe.x, peixe.y) for f in self.folhas)

    def _comer_comida(self) -> None:
        for peixe in self.peixes.values():
            if not (peixe.vivo and peixe.conectado):
                continue
            for comida in self.comida.perto_de(peixe.x, peixe.y, peixe.raio):
                if math.hypot(comida.x - peixe.x, comida.y - peixe.y) < peixe.raio:
                    peixe.ganhar(comida.massa)
                    self.comida.remover(comida)
                    self.comida_removida.append(comida.numero)

    def _peixes_se_comem(self, agora: float) -> None:
        # do maior para o menor: o grande come primeiro
        ativos = sorted((p for p in self.peixes.values() if p.ativo(agora)),
                        key=lambda p: -p.massa)
        for i, grande in enumerate(ativos):
            if not grande.vivo:
                continue
            for pequeno in ativos[i + 1:]:
                if not pequeno.vivo or pequeno.turma == grande.turma:
                    continue                    # colegas de turma não se comem
                if not grande.pode_engolir(pequeno):
                    continue
                if self.escondido(pequeno) and not self.escondido(grande):
                    continue                    # embaixo da folha o grande não alcança
                grande.ganhar(pequeno.massa)
                grande.devorados += 1
                self.eventos.append({"t": "devorou", "n": grande.numero, "v": pequeno.numero,
                                     "p": round(pequeno.massa),
                                     "x": round(pequeno.x), "y": round(pequeno.y)})
                pequeno.ser_devorado(agora)
                if self.boto.alvo is pequeno:
                    self.boto.alvo = None
                self.elenco_mudou = True

    def _repor_comida(self, tudo: bool = False) -> None:
        if tudo:
            for comida in self.comida.todas():
                self.comida_removida.append(comida.numero)
            self.comida.limpar()
        conectados = sum(1 for p in self.peixes.values() if p.conectado)
        alvo = min(config.COMIDA_MAXIMA,
                   config.COMIDA_MINIMA + config.COMIDA_POR_JOGADOR * conectados)
        limite = alvo if tudo else config.COMIDA_NOVA_POR_PASSO
        while self.comida.total < alvo and limite > 0:
            self._adicionar_comida(Comida.sortear())
            limite -= 1

    def _adicionar_comida(self, comida: Comida) -> None:
        self.comida.adicionar(comida)
        self.comida_nova.append(comida)

    # ------------------------------------------------------------------
    # O Boto Faminto
    # ------------------------------------------------------------------
    def _maior_presa(self, agora: float) -> Optional[Peixe]:
        candidatos = [p for p in self.peixes.values()
                      if p.ativo(agora) and p.massa >= config.BOTO_MASSA_MINIMA_ALVO]
        return max(candidatos, key=lambda p: p.massa, default=None)

    def _cuidar_do_boto(self, dt: float, agora: float) -> None:
        boto = self.boto
        if not boto.ativo:
            if agora >= boto.proxima_aparicao:
                presa = self._maior_presa(agora)
                if presa:
                    boto.aparecer(agora, presa)
                    self.eventos.append({"t": "boto_aparece", "a": presa.numero})
                else:
                    boto.proxima_aparicao = agora + 5   # ninguém grande ainda: tenta logo mais
            return

        if not boto.saindo:
            alvo = boto.alvo
            if (alvo is None or not alvo.ativo(agora)
                    or alvo.massa < config.BOTO_MASSA_MINIMA_ALVO * 0.7):
                novo = self._maior_presa(agora)
                if novo:
                    boto.alvo = novo
                    self.eventos.append({"t": "boto_aparece", "a": novo.numero})
                else:
                    boto.ir_embora()
                    boto.agendar(agora)
            elif agora >= boto.vai_embora_em:
                self.eventos.append({"t": "boto_desistiu", "a": alvo.numero})
                boto.ir_embora()
                boto.agendar(agora)
            elif boto.alcancou(alvo):
                self._mordida(alvo)
                boto.ir_embora()
                boto.agendar(agora)

        boto.atualizar(dt)

    def _mordida(self, peixe: Peixe) -> None:
        perdida = peixe.perder(config.BOTO_MORDIDA)
        devolvida = perdida * config.BOTO_DEVOLVE_COMIDA
        pedacos = max(1, min(18, int(devolvida // 3)))
        for i in range(pedacos):
            angulo = random.uniform(0, 2 * math.pi)
            distancia = peixe.raio + random.uniform(30, 110)
            x = min(max(peixe.x + math.cos(angulo) * distancia, 15), config.LARGURA_MUNDO - 15)
            y = min(max(peixe.y + math.sin(angulo) * distancia, 15), config.ALTURA_MUNDO - 15)
            self._adicionar_comida(Comida(x, y, devolvida / pedacos, 2))
        self.eventos.append({"t": "boto_mordeu", "a": peixe.numero, "p": round(perdida),
                             "x": round(peixe.x), "y": round(peixe.y)})

    # ------------------------------------------------------------------
    # Mensagens para as telas
    # ------------------------------------------------------------------
    def estado(self, agora: float) -> dict:
        """Tudo o que se move, em formato compacto. Enviado várias vezes por segundo."""
        mensagem = {
            "tipo": "estado",
            "fase": self.fase,
            "tempo": self.tempo_restante(agora),
            "turmas": self.pontos_das_turmas(),
            "peixes": [p.para_envio(agora) for p in self.peixes.values()],
            "boto": self.boto.para_envio(),
            "eventos": self.eventos,
        }
        self.eventos = []
        return mensagem

    def mudancas_na_comida(self) -> Optional[dict]:
        """Comida não se mexe: só avisamos o que apareceu e o que foi comido."""
        if not self.comida_nova and not self.comida_removida:
            return None
        mensagem = {
            "tipo": "comida",
            "novas": [c.para_envio() for c in self.comida_nova],
            "removidas": self.comida_removida,
        }
        self.comida_nova, self.comida_removida = [], []
        return mensagem

    def comida_completa(self) -> dict:
        return {"tipo": "comida", "todas": [c.para_envio() for c in self.comida.todas()]}

    def elenco(self) -> dict:
        """Nomes e contadores. A rede só reenvia quando elenco_mudou fica True."""
        return {
            "tipo": "elenco",
            "jogadores": [[p.numero, p.nome, p.turma, p.devorados, 1 if p.conectado else 0]
                          for p in self.peixes.values()],
            "lotacao": [self.jogadores_na_turma(i) for i in range(len(config.TURMAS))],
            "resultado": self.resultado,
        }

    def folhas_para_envio(self) -> list:
        return [f.para_envio() for f in self.folhas]


__all__ = ["Partida", "raio_da_massa", "LOBBY", "CONTAGEM", "JOGANDO", "FIM"]
