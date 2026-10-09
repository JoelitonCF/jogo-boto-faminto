/*
 * conexao.js — WebSocket que se reconecta sozinho.
 * Celular perde Wi-Fi o tempo todo; o jogo não pode quebrar por isso.
 */
"use strict";

class ConexaoJogo {
  constructor(caminho, aoReceber, aoMudarStatus) {
    this.caminho = caminho;
    this.aoReceber = aoReceber;
    this.aoMudarStatus = aoMudarStatus || (() => {});
    this.ws = null;
    this.abrir();
  }

  abrir() {
    const protocolo = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocolo}://${location.host}${this.caminho}`);
    this.ws.onopen = () => this.aoMudarStatus(true);
    this.ws.onmessage = (evento) => this.aoReceber(JSON.parse(evento.data));
    this.ws.onclose = () => {
      this.aoMudarStatus(false);
      setTimeout(() => this.abrir(), 1500);
    };
  }

  enviar(mensagem) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(mensagem));
      return true;
    }
    return false;
  }
}

function formatarTempo(segundos) {
  const m = Math.floor(segundos / 60);
  const s = String(segundos % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

const ICONE_BOTO = `
<svg viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="22" fill="#0b5662" stroke="#063a45" stroke-width="2"/>
  <path d="M8 30 Q14 16 30 17 Q38 17 43 21 Q38 24 31 24 Q30 30 22 32 Q14 34 8 30 Z" fill="#f59ac3"/>
  <path d="M8 30 L3 25 L5 33 Z" fill="#d2709f"/>
  <path d="M20 31 L17 37 L24 32 Z" fill="#d2709f"/>
  <circle cx="34" cy="20" r="1.4" fill="#3a0d24"/>
  <ellipse cx="25" cy="16.5" rx="9" ry="2.4" fill="#fbfbf5"/>
  <path d="M19.5 16.5 Q20 9.5 25 9.5 Q30 9.5 30.5 16.5 Z" fill="#fbfbf5"/>
  <rect x="19.7" y="13.3" width="10.6" height="2.2" fill="#1f1f1f"/>
</svg>`;
