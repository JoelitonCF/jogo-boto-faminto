"""
Servidor do Boto Faminto.

Rode com:   python servidor.py

- Celulares abrem  http://<ip-do-notebook>:8000/        (tela do jogador)
- Projetor abre    http://<ip-do-notebook>:8000/telao   (mapa e placar)

O servidor é "autoritativo": só ele calcula movimento, quem come quem e o
placar. Os celulares mandam apenas a direção do joystick e o botão de
arrancada, então ninguém consegue trapacear mexendo no JavaScript.
"""

from __future__ import annotations

import asyncio
import json
import math
import socket
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import qrcode
import qrcode.image.svg
import uvicorn
from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
from jogo import banco
from jogo.partida import Partida

PASTA_STATIC = Path(__file__).resolve().parent / "static"


# ---------------------------------------------------------------------------
# Rede local
# ---------------------------------------------------------------------------
def descobrir_ip() -> str:
    """Descobre o IP do notebook na rede local (não precisa de internet)."""
    if config.IP_PUBLICADO:
        return config.IP_PUBLICADO
    teste = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        teste.connect(("10.254.254.254", 1))   # nenhum pacote é enviado de verdade
        return teste.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        teste.close()


IP = descobrir_ip()
URL_JOGO = f"http://{IP}:{config.PORTA}/"


# ---------------------------------------------------------------------------
# Conexões
# ---------------------------------------------------------------------------
class Conexao:
    """
    Envolve um WebSocket com uma tarefa de envio própria.

    Se um celular estiver lento, ele não trava o jogo dos outros: guardamos só
    o estado mais recente para ele (os antigos são descartados) e as mensagens
    importantes (elenco, comida, erros) ficam numa fila que nunca perde nada.
    """

    def __init__(self, ws: WebSocket, admin: bool = False):
        self.ws = ws
        self.admin = admin
        self.importantes: list[str] = []
        self.ultimo_estado: str | None = None
        self.sinal = asyncio.Event()
        self.tarefa = asyncio.create_task(self._laco_de_envio())

    def enviar(self, mensagem: dict | str, importante: bool = True) -> None:
        texto = mensagem if isinstance(mensagem, str) else json.dumps(mensagem, separators=(",", ":"))
        if importante:
            self.importantes.append(texto)
        else:
            self.ultimo_estado = texto
        self.sinal.set()

    async def _laco_de_envio(self) -> None:
        try:
            while True:
                await self.sinal.wait()
                self.sinal.clear()
                while self.importantes:
                    await self.ws.send_text(self.importantes.pop(0))
                if self.ultimo_estado is not None:
                    texto, self.ultimo_estado = self.ultimo_estado, None
                    await self.ws.send_text(texto)
        except Exception:
            pass   # conexão caiu; o laço de recebimento cuida do resto

    def fechar(self) -> None:
        self.tarefa.cancel()


class Central:
    """Sabe quem está conectado e manda mensagens para todo mundo."""

    def __init__(self):
        self.todas: set[Conexao] = set()
        self.por_jogador: dict[str, Conexao] = {}

    def para_todos(self, mensagem: dict, importante: bool = True) -> None:
        texto = json.dumps(mensagem, separators=(",", ":"))
        for conexao in list(self.todas):
            conexao.enviar(texto, importante)


central = Central()


# ---------------------------------------------------------------------------
# Partida e banco de dados
# ---------------------------------------------------------------------------
acumulado = {"partidas": 0, "turmas": []}


def ao_terminar(resultado: dict) -> None:
    global acumulado
    try:
        banco.salvar_partida(resultado)
        acumulado = banco.placar_acumulado()
    except Exception as erro:            # o jogo continua mesmo se o banco falhar
        print("Não foi possível salvar a partida:", erro)
    resultado["acumulado"] = acumulado


partida = Partida(ao_terminar=ao_terminar)


def mensagem_info(admin: bool = False) -> dict:
    return {
        "tipo": "info",
        "turmas": config.TURMAS,
        "max_por_turma": config.MAX_JOGADORES_POR_TURMA,
        "duracao": config.DURACAO_PARTIDA,
        "url": URL_JOGO,
        "wifi": {"nome": config.NOME_WIFI, "senha": config.SENHA_WIFI},
        "admin": admin,
        "acumulado": acumulado,
        "mundo": {
            "largura": config.LARGURA_MUNDO,
            "altura": config.ALTURA_MUNDO,
            "folhas": partida.folhas_para_envio(),
            "raio_boto": config.BOTO_RAIO,
            "massa_inicial": config.MASSA_INICIAL,
            "proporcao": config.PROPORCAO_PARA_COMER,
            "recarga_arrancada": config.ARRANCADA_RECARGA,
            "massa_alvo_boto": config.BOTO_MASSA_MINIMA_ALVO,
            "tempo_renascer": config.TEMPO_RENASCER,
        },
    }


def boas_vindas(conexao: Conexao, admin: bool = False) -> None:
    conexao.enviar(mensagem_info(admin))
    conexao.enviar(partida.elenco())
    conexao.enviar(partida.comida_completa())


async def laco_do_jogo() -> None:
    """Relógio do jogo: calcula a física e envia o estado para as telas."""
    dt = 1 / config.TICKS_POR_SEGUNDO
    passos_por_envio = max(1, round(config.TICKS_POR_SEGUNDO / config.ENVIOS_POR_SEGUNDO))
    contador = 0
    proximo = time.monotonic()
    while True:
        agora = time.monotonic()
        try:
            partida.passo(dt, agora)
            contador += 1
            if contador % passos_por_envio == 0:
                if partida.elenco_mudou:
                    partida.elenco_mudou = False
                    central.para_todos(partida.elenco())
                comida = partida.mudancas_na_comida()
                if comida:
                    central.para_todos(comida)
                central.para_todos(partida.estado(agora), importante=False)
        except Exception as erro:          # um bug não pode derrubar o evento
            print("Erro no passo do jogo:", repr(erro))

        proximo += dt
        espera = proximo - time.monotonic()
        if espera < -0.25:                 # atrasou muito: recomeça o compasso
            proximo = time.monotonic()
        await asyncio.sleep(max(0.0, espera))


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    global acumulado
    banco.criar_tabelas()
    acumulado = banco.placar_acumulado()
    tarefa = asyncio.create_task(laco_do_jogo())
    yield
    tarefa.cancel()


app = FastAPI(title="Boto Faminto", lifespan=ciclo_de_vida)
app.mount("/static", StaticFiles(directory=PASTA_STATIC), name="static")


# ---------------------------------------------------------------------------
# Páginas
# ---------------------------------------------------------------------------
@app.get("/")
async def pagina_jogador():
    return FileResponse(PASTA_STATIC / "jogador.html")


@app.get("/telao")
async def pagina_telao():
    return FileResponse(PASTA_STATIC / "telao.html")


def svg_do_qrcode(texto: str) -> Response:
    imagem = qrcode.make(texto, image_factory=qrcode.image.svg.SvgPathImage,
                         box_size=10, border=2)
    return Response(imagem.to_string(), media_type="image/svg+xml")


@app.get("/qrcode.svg")
async def qr_code_jogo():
    return svg_do_qrcode(URL_JOGO)


@app.get("/qrcode-wifi.svg")
async def qr_code_wifi():
    """QR no padrão que câmeras de celular entendem para entrar numa rede Wi-Fi."""
    def escapar(texto: str) -> str:
        for caractere in '\\;,:"':
            texto = texto.replace(caractere, "\\" + caractere)
        return texto
    seguranca = "WPA" if config.SENHA_WIFI else "nopass"
    return svg_do_qrcode(f"WIFI:T:{seguranca};S:{escapar(config.NOME_WIFI)};"
                         f"P:{escapar(config.SENHA_WIFI)};;")


# ---------------------------------------------------------------------------
# WebSockets
# ---------------------------------------------------------------------------
def numero_ok(valor) -> float:
    numero = float(valor)
    if not math.isfinite(numero):
        raise ValueError
    return numero


@app.websocket("/ws/jogador")
async def ws_jogador(ws: WebSocket):
    await ws.accept()
    conexao = Conexao(ws)
    central.todas.add(conexao)
    boas_vindas(conexao)
    id_jogador: str | None = None

    try:
        while True:
            dados = json.loads(await ws.receive_text())
            tipo = dados.get("tipo")

            if tipo == "entrar":
                pedido = str(dados.get("id") or uuid.uuid4().hex)[:40]
                peixe, erro = partida.entrar(pedido, str(dados.get("nome", "")),
                                             int(dados.get("turma", -1)), time.monotonic())
                if erro:
                    conexao.enviar({"tipo": "erro", "mensagem": erro})
                    continue
                antiga = central.por_jogador.get(pedido)
                if antiga and antiga is not conexao:      # mesmo celular, aba nova
                    antiga.enviar({"tipo": "removido", "motivo": "Você entrou em outra aba."})
                id_jogador = pedido
                central.por_jogador[id_jogador] = conexao
                conexao.enviar({"tipo": "bem_vindo", "id": id_jogador,
                                "numero": peixe.numero, "nome": peixe.nome,
                                "turma": peixe.turma})

            elif tipo == "mover" and id_jogador:
                partida.mover(id_jogador, numero_ok(dados.get("dx", 0)),
                              numero_ok(dados.get("dy", 0)))

            elif tipo == "arrancar" and id_jogador:
                partida.arrancar(id_jogador, time.monotonic())

            elif tipo == "sair" and id_jogador:
                peixe = partida.peixes.get(id_jogador)
                if peixe:
                    partida.remover(peixe.numero)
                central.por_jogador.pop(id_jogador, None)
                id_jogador = None

    except (WebSocketDisconnect, ValueError, TypeError, json.JSONDecodeError):
        pass
    finally:
        central.todas.discard(conexao)
        conexao.fechar()
        if id_jogador and central.por_jogador.get(id_jogador) is conexao:
            del central.por_jogador[id_jogador]
            partida.desconectar(id_jogador, time.monotonic())


@app.websocket("/ws/telao")
async def ws_telao(ws: WebSocket):
    await ws.accept()
    admin = ws.query_params.get("senha") == config.SENHA_ADMIN
    conexao = Conexao(ws, admin=admin)
    central.todas.add(conexao)
    boas_vindas(conexao, admin)

    try:
        while True:
            dados = json.loads(await ws.receive_text())
            if dados.get("tipo") != "comando" or not admin:
                continue
            acao, agora = dados.get("acao"), time.monotonic()
            if acao == "iniciar":
                partida.iniciar(agora)
            elif acao == "encerrar":
                partida.encerrar(agora)
            elif acao == "lobby":
                partida.voltar_ao_lobby(agora)
            elif acao == "remover":
                id_removido = partida.remover(int(dados.get("numero", 0)))
                alvo = central.por_jogador.pop(id_removido, None) if id_removido else None
                if alvo:
                    alvo.enviar({"tipo": "removido",
                                 "motivo": "O professor removeu seu peixe. Entre de novo."})
    except (WebSocketDisconnect, ValueError, TypeError, json.JSONDecodeError):
        pass
    finally:
        central.todas.discard(conexao)
        conexao.fechar()


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print()
    print("  BOTO FAMINTO")
    print("  " + "-" * 45)
    print(f"  Jogadores (celular):  {URL_JOGO}")
    print(f"  Telão (projetor):     {URL_JOGO}telao")
    print(f"  Telão com controles:  {URL_JOGO}telao?senha={config.SENHA_ADMIN}")
    print("  " + "-" * 45)
    print("  Ctrl+C para desligar")
    print()
    uvicorn.run(app, host="0.0.0.0", port=config.PORTA, log_level="warning")
