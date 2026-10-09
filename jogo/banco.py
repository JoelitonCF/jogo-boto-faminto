"""
Banco de dados SQLite: guarda o resultado de cada partida e calcula o
placar acumulado do interclasses.

Tabelas:
    partidas           (id, iniciada_em, duracao, total_jogadores)
    resultados_turma   (partida_id, turma, pontos, posicao)
    resultados_jogador (partida_id, nome, turma, massa_final, maior_massa, devorados)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import config

CAMINHO = Path(__file__).resolve().parent.parent / "dados" / "boto.db"


def conectar() -> sqlite3.Connection:
    CAMINHO.parent.mkdir(exist_ok=True)
    conexao = sqlite3.connect(CAMINHO)
    conexao.row_factory = sqlite3.Row
    return conexao


def criar_tabelas() -> None:
    with conectar() as conexao:
        conexao.executescript("""
            CREATE TABLE IF NOT EXISTS partidas (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                iniciada_em     TEXT    NOT NULL,
                duracao         INTEGER NOT NULL,
                total_jogadores INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS resultados_turma (
                partida_id INTEGER NOT NULL REFERENCES partidas(id),
                turma      TEXT    NOT NULL,
                pontos     INTEGER NOT NULL,
                posicao    INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS resultados_jogador (
                partida_id  INTEGER NOT NULL REFERENCES partidas(id),
                nome        TEXT    NOT NULL,
                turma       TEXT    NOT NULL,
                massa_final INTEGER NOT NULL,
                maior_massa INTEGER NOT NULL,
                devorados   INTEGER NOT NULL
            );
        """)


def salvar_partida(resultado: dict) -> int:
    with conectar() as conexao:
        cursor = conexao.execute(
            "INSERT INTO partidas (iniciada_em, duracao, total_jogadores) VALUES (?, ?, ?)",
            (resultado["iniciada_em"], resultado["duracao"], len(resultado["jogadores"])),
        )
        partida_id = cursor.lastrowid
        for posicao, turma in enumerate(resultado["turmas"], start=1):
            if turma["jogadores"] == 0 and turma["pontos"] == 0:
                continue   # turma que não jogou esta rodada
            conexao.execute(
                "INSERT INTO resultados_turma VALUES (?, ?, ?, ?)",
                (partida_id, turma["nome"], turma["pontos"], posicao),
            )
        for jogador in resultado["jogadores"]:
            conexao.execute(
                "INSERT INTO resultados_jogador VALUES (?, ?, ?, ?, ?, ?)",
                (partida_id, jogador["nome"], config.TURMAS[jogador["turma"]]["nome"],
                 jogador["massa"], jogador["maior_massa"], jogador["devorados"]),
            )
        return partida_id


def placar_acumulado() -> dict:
    """Soma de pontos e vitórias de cada turma em todas as partidas salvas."""
    with conectar() as conexao:
        linhas = conexao.execute("""
            SELECT turma,
                   SUM(pontos)                              AS pontos,
                   SUM(CASE WHEN posicao = 1 THEN 1 END)    AS vitorias,
                   COUNT(*)                                 AS partidas
              FROM resultados_turma
          GROUP BY turma
          ORDER BY vitorias DESC, pontos DESC
        """).fetchall()
        total = conexao.execute("SELECT COUNT(*) FROM partidas").fetchone()[0]
    return {
        "partidas": total,
        "turmas": [
            {"nome": l["turma"], "pontos": l["pontos"] or 0,
             "vitorias": l["vitorias"] or 0, "partidas": l["partidas"]}
            for l in linhas
        ],
    }
