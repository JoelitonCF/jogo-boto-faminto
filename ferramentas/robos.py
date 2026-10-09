"""
Robôs de teste: conectam vários "jogadores" falsos ao servidor.

Serve para testar o jogo sozinho antes do evento (e para a turma medir
quantos jogadores o notebook e o roteador aguentam).

    python ferramentas/robos.py            # 24 robôs no servidor local
    python ferramentas/robos.py 36 192.168.0.10
"""

import asyncio
import json
import math
import random
import sys

import websockets

NOMES = ["Ana", "Bia", "Caio", "Davi", "Duda", "Enzo", "Gabi", "Heitor", "Iara", "João",
         "Kauã", "Lara", "Lucas", "Malu", "Nina", "Otávio", "Pedro", "Rafa", "Sofia",
         "Theo", "Uiara", "Vitor", "Yara", "Zeca", "Alice", "Bento", "Cecília", "Dani",
         "Elisa", "Fábio", "Gui", "Helena", "Ícaro", "Júlia", "Kiko", "Lívia"]

PROPORCAO = 1.25


async def robo(indice: int, endereco: str, total_turmas: int = 6):
    url = f"ws://{endereco}/ws/jogador"
    meu, estado, turmas_de = None, None, {}
    comida: dict[int, tuple] = {}
    coragem = random.uniform(0.4, 1.0)        # uns caçam mais, outros fogem mais
    async with websockets.connect(url, max_size=None) as ws:
        minha_turma = indice % total_turmas
        await ws.send(json.dumps({"tipo": "entrar", "id": f"robo{indice}",
                                  "nome": NOMES[indice % len(NOMES)], "turma": minha_turma}))

        async def ouvir():
            nonlocal meu, estado
            async for texto in ws:
                dados = json.loads(texto)
                if dados["tipo"] == "bem_vindo":
                    meu = dados["numero"]
                elif dados["tipo"] == "estado":
                    estado = dados
                elif dados["tipo"] == "elenco":
                    turmas_de.clear()
                    turmas_de.update({j[0]: j[2] for j in dados["jogadores"]})
                elif dados["tipo"] == "comida":
                    if "todas" in dados:
                        comida.clear()
                        comida.update({c[0]: c for c in dados["todas"]})
                    for n in dados.get("removidas", []):
                        comida.pop(n, None)
                    for c in dados.get("novas", []):
                        comida[c[0]] = c

        ouvinte = asyncio.create_task(ouvir())
        try:
            while True:
                await asyncio.sleep(0.12)
                if not estado or meu is None:
                    continue
                eu = next((p for p in estado["peixes"] if p[0] == meu), None)
                if not eu or eu[5] & 8:
                    continue
                _, x, y, massa, _, _ = eu
                outros = [p for p in estado["peixes"]
                          if p[0] != meu and not p[5] & 8 and turmas_de.get(p[0]) != minha_turma]
                dx = dy = 0.0
                arrancar = False

                # foge de quem pode me engolir (e do boto, se eu for o alvo)
                perigos = [(p[1], p[2]) for p in outros if p[3] >= massa * PROPORCAO
                           and math.hypot(p[1] - x, p[2] - y) < 260]
                if estado["boto"] and estado["boto"][3] == meu:
                    perigos.append((estado["boto"][0], estado["boto"][1]))
                if perigos and random.random() > coragem * 0.5:
                    for px, py in perigos:
                        d = math.hypot(px - x, py - y) or 1
                        dx -= (px - x) / d
                        dy -= (py - y) / d
                    arrancar = random.random() < 0.15
                else:
                    presas = [p for p in outros if massa >= p[3] * PROPORCAO
                              and math.hypot(p[1] - x, p[2] - y) < 350 * coragem]
                    if presas:
                        alvo = min(presas, key=lambda p: math.hypot(p[1] - x, p[2] - y))
                        alvo = (alvo[1], alvo[2])
                        arrancar = random.random() < 0.08
                    elif comida:
                        c = min(comida.values(), key=lambda c: (c[1] - x) ** 2 + (c[2] - y) ** 2)
                        alvo = (c[1], c[2])
                    else:
                        alvo = (1200, 675)
                    d = math.hypot(alvo[0] - x, alvo[1] - y) or 1
                    dx, dy = (alvo[0] - x) / d, (alvo[1] - y) / d
                dx += random.uniform(-0.25, 0.25)
                dy += random.uniform(-0.25, 0.25)
                await ws.send(json.dumps({"tipo": "mover", "dx": round(dx, 2), "dy": round(dy, 2)}))
                if arrancar:
                    await ws.send(json.dumps({"tipo": "arrancar"}))
        finally:
            ouvinte.cancel()


async def principal():
    quantidade = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    endereco = (sys.argv[2] if len(sys.argv) > 2 else "localhost") + ":8000"
    print(f"Conectando {quantidade} robôs em {endereco}… (Ctrl+C para parar)")
    tarefas = []
    for i in range(quantidade):
        tarefas.append(asyncio.create_task(robo(i, endereco)))
        await asyncio.sleep(0.05)
    await asyncio.gather(*tarefas)


if __name__ == "__main__":
    try:
        asyncio.run(principal())
    except KeyboardInterrupt:
        pass
