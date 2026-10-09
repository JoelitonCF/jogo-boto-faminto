/*
 * render.js — desenha o rio do Boto Faminto num <canvas>.
 * É usado tanto pela tela do jogador (celular) quanto pelo telão.
 *
 * O servidor manda o estado ~15 vezes por segundo; aqui a gente desenha a
 * 60 quadros por segundo e "suaviza" o caminho entre um estado e outro.
 */
"use strict";

// Celulares mais antigos não têm roundRect no canvas: criamos uma versão simples
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, l, a, r) {
    r = Math.min(r, l / 2, a / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + l, y, x + l, y + a, r);
    this.arcTo(x + l, y + a, x, y + a, r);
    this.arcTo(x, y + a, x, y, r);
    this.arcTo(x, y, x + l, y, r);
    this.closePath();
  };
}

const CORES = {
  fundoFora: "#021419",
  aguaFunda: "#063a45",
  aguaClara: "#0b5662",
  areia: "#3f6a5b",
  folha: "#3f9a3a",
  folhaBorda: "#7cc35a",
  folhaEscura: "#2b7330",
  boto: "#f59ac3",
  botoEscuro: "#d2709f",
  ouro: "#ffd166",
  perigo: "#ff4d6d",
  presa: "#9bf6a0",
};

// Gerador de números aleatórios com semente: todas as telas desenham o
// mesmo fundo no mesmo lugar.
function aleatorioComSemente(semente) {
  return function () {
    semente |= 0;
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aproximar(atual, alvo, fator) {
  return atual + (alvo - atual) * fator;
}

function aproximarAngulo(atual, alvo, fator) {
  let diferenca = ((alvo - atual + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (diferenca < -Math.PI) diferenca += 2 * Math.PI;
  return atual + diferenca * fator;
}

function raioDaMassa(massa) {
  return 4 * Math.sqrt(Math.max(massa, 0));
}

function clarear(hex, quanto) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mistura = (c) => Math.round(c + (quanto > 0 ? (255 - c) : c) * quanto);
  return `rgb(${mistura(r)},${mistura(g)},${mistura(b)})`;
}

class Renderizador {
  constructor(canvas, mundo, turmas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.mundo = mundo;
    this.turmas = turmas;
    this.estado = null;
    this.nomes = new Map();      // numero -> {nome, turma, devorados, conectado}
    this.peixes = new Map();     // numero -> posição suavizada
    this.comida = new Map();     // numero -> [x, y, tipo]
    this.boto = null;
    this.efeitos = [];
    this.bolhas = [];
    this.relogio = 0;
    this.fundo = this._desenharFundo(1.25);
    this.luzes = this._criarLuzes();
  }

  // ---------------------------------------------------------------- dados
  receberEstado(estado) {
    this.estado = estado;
    const vistos = new Set();
    for (const [n, x, y, massa, a, flags] of estado.peixes) {
      vistos.add(n);
      let p = this.peixes.get(n);
      if (!p || (p.flags & 8 && !(flags & 8))) {           // novo ou acabou de renascer
        p = { x, y, a: a / 100, massa, vel: 0, cauda: Math.random() * 6 };
        this.peixes.set(n, p);
      }
      Object.assign(p, { ax: x, ay: y, aa: a / 100, am: massa, flags });
    }
    for (const n of this.peixes.keys()) if (!vistos.has(n)) this.peixes.delete(n);

    if (estado.boto) {
      const [x, y, a, alvo] = estado.boto;
      if (!this.boto) this.boto = { x, y, a: a / 100, cauda: 0 };
      Object.assign(this.boto, { ax: x, ay: y, aa: a / 100, alvo });
    } else {
      this.boto = null;
    }

    for (const e of estado.eventos) this._criarEfeito(e);
  }

  receberComida(msg) {
    if (msg.todas) {
      this.comida.clear();
      for (const [n, x, y, tipo] of msg.todas) this.comida.set(n, [x, y, tipo]);
    }
    for (const n of msg.removidas || []) this.comida.delete(n);
    for (const [n, x, y, tipo] of msg.novas || []) this.comida.set(n, [x, y, tipo]);
  }

  receberElenco(elenco) {
    this.nomes.clear();
    for (const [numero, nome, turma, devorados, conectado] of elenco.jogadores) {
      this.nomes.set(numero, { nome, turma, devorados, conectado });
    }
  }

  massaDe(numero) {
    const p = this.peixes.get(numero);
    return p && !(p.flags & 8) ? p.am : 0;
  }

  // ---------------------------------------------------------------- câmeras
  static cameraMundoInteiro(largura, altura, mundo) {
    const escala = Math.min(largura / mundo.largura, altura / mundo.altura);
    return { x: mundo.largura / 2, y: mundo.altura / 2, escala };
  }

  cameraSeguindo(numero, largura, altura) {
    const p = this.peixes.get(numero);
    const raio = p ? raioDaMassa(p.massa) : 15;
    // quanto maior o peixe, mais longe a câmera fica (como no agar.io)
    const alvo = Math.min(largura, altura) / (520 + raio * 5);
    this._escala = this._escala ? aproximar(this._escala, alvo, 0.05) : alvo;
    return { x: p ? p.x : this.mundo.largura / 2, y: p ? p.y : this.mundo.altura / 2,
             escala: this._escala };
  }

  // ---------------------------------------------------------------- quadro
  ajustarTamanho() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const largura = this.canvas.clientWidth;
    const altura = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(largura * dpr) ||
        this.canvas.height !== Math.round(altura * dpr)) {
      this.canvas.width = Math.round(largura * dpr);
      this.canvas.height = Math.round(altura * dpr);
    }
    return { largura, altura, dpr };
  }

  /*
   * opcoes: { camera, destaque (numero do meu peixe), tamanhoNome,
   *           marcarPerigo (anéis verde/vermelho), linhaDoBoto }
   */
  desenhar(dt, opcoes) {
    const { largura, altura, dpr } = this.ajustarTamanho();
    const ctx = this.ctx;
    const cam = opcoes.camera;
    this.relogio += dt;
    this._suavizar(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CORES.fundoFora;
    ctx.fillRect(0, 0, largura, altura);

    const ox = largura / 2 - cam.x * cam.escala;
    const oy = altura / 2 - cam.y * cam.escala;
    ctx.setTransform(dpr * cam.escala, 0, 0, dpr * cam.escala, dpr * ox, dpr * oy);
    ctx.drawImage(this.fundo, 0, 0, this.mundo.largura, this.mundo.altura);
    this._desenharLuzes(ctx, dt);

    // só desenha o que aparece na tela (importante no celular)
    const margem = 60;
    const visivel = {
      x1: (0 - ox) / cam.escala - margem, y1: (0 - oy) / cam.escala - margem,
      x2: (largura - ox) / cam.escala + margem, y2: (altura - oy) / cam.escala + margem,
    };
    const naTela = (x, y, r = 0) => x + r > visivel.x1 && x - r < visivel.x2 &&
                                    y + r > visivel.y1 && y - r < visivel.y2;

    for (const [n, c] of this.comida) if (naTela(c[0], c[1])) this._desenharComida(ctx, n, c);
    this._desenharBolhas(ctx, dt);

    const meu = this.peixes.get(opcoes.destaque);
    const minhaMassa = meu && !(meu.flags & 8) ? meu.massa : 0;
    const minhaTurma = this.nomes.get(opcoes.destaque)?.turma;

    // peixes pequenos por cima dos grandes, para não sumirem
    const ordem = [...this.peixes.entries()]
      .filter(([, p]) => !(p.flags & 8))
      .sort((a, b) => b[1].massa - a[1].massa);
    for (const [n, p] of ordem) {
      if (!naTela(p.x, p.y, raioDaMassa(p.massa) * 1.6)) continue;
      let anel = null;
      if (opcoes.marcarPerigo && minhaMassa && n !== opcoes.destaque) {
        const info = this.nomes.get(n);
        if (info && info.turma !== minhaTurma) {
          if (p.massa >= minhaMassa * this.mundo.proporcao) anel = CORES.perigo;
          else if (minhaMassa >= p.massa * this.mundo.proporcao) anel = CORES.presa;
        }
      }
      this._desenharPeixe(ctx, n, p, anel);
    }

    if (this.boto) this._desenharBoto(ctx, this.boto, opcoes.linhaDoBoto);

    // as vitórias-régias ficam por cima: quem está embaixo fica escondido
    for (const [x, y, r] of this.mundo.folhas) if (naTela(x, y, r)) this._desenharFolha(ctx, x, y, r);
    if (meu && minhaMassa) this._contornoPorCima(ctx, meu);

    ctx.strokeStyle = "rgba(255,255,255,0.18)";            // borda do mundo
    ctx.lineWidth = 6 / cam.escala;
    ctx.strokeRect(0, 0, this.mundo.largura, this.mundo.altura);

    // textos em coordenadas de tela para terem tamanho fixo
    const paraTela = (x, y) => [ox + x * cam.escala, oy + y * cam.escala];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._desenharNomes(ctx, paraTela, cam.escala, ordem, opcoes, naTela);
    this._desenharEfeitos(ctx, paraTela, dt, opcoes.tamanhoNome || 13);
  }

  _suavizar(dt) {
    const fator = 1 - Math.exp(-dt * 14);
    for (const p of this.peixes.values()) {
      const antesX = p.x, antesY = p.y;
      p.x = aproximar(p.x, p.ax, fator);
      p.y = aproximar(p.y, p.ay, fator);
      p.a = aproximarAngulo(p.a, p.aa, fator);
      p.massa = aproximar(p.massa, p.am, 1 - Math.exp(-dt * 6));
      const vel = dt > 0 ? Math.hypot(p.x - antesX, p.y - antesY) / dt : 0;
      p.vel = aproximar(p.vel, vel, 0.2);
      p.cauda += dt * (4 + Math.min(p.vel, 400) / 25);
      if (p.flags & 2 && Math.random() < 0.6) this._soltarBolha(p.x, p.y, raioDaMassa(p.massa));
    }
    if (this.boto) {
      const b = this.boto;
      b.x = aproximar(b.x, b.ax, fator);
      b.y = aproximar(b.y, b.ay, fator);
      b.a = aproximarAngulo(b.a, b.aa, fator);
      b.cauda += dt * 7;
    }
  }

  // ---------------------------------------------------------------- cenário fixo
  _desenharFundo(resolucao) {
    const m = this.mundo;
    const tela = document.createElement("canvas");
    tela.width = Math.round(m.largura * resolucao);
    tela.height = Math.round(m.altura * resolucao);
    const ctx = tela.getContext("2d");
    ctx.scale(resolucao, resolucao);
    const sorte = aleatorioComSemente(1998);

    const degrade = ctx.createRadialGradient(m.largura / 2, m.altura / 2, 100,
                                             m.largura / 2, m.altura / 2, m.largura * 0.7);
    degrade.addColorStop(0, CORES.aguaClara);
    degrade.addColorStop(1, CORES.aguaFunda);
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, m.largura, m.altura);

    // manchas de areia e lodo no fundo
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = sorte() < 0.6 ? "rgba(70,110,90,0.18)" : "rgba(2,30,36,0.25)";
      ctx.beginPath();
      ctx.ellipse(sorte() * m.largura, sorte() * m.altura, 60 + sorte() * 180, 30 + sorte() * 80,
                  sorte() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // pedrinhas
    for (let i = 0; i < 260; i++) {
      const x = sorte() * m.largura, y = sorte() * m.altura, r = 2 + sorte() * 6;
      ctx.fillStyle = `rgba(${150 + sorte() * 60},${170 + sorte() * 40},${150},0.13)`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, sorte() * 3, 0, Math.PI * 2); ctx.fill();
    }
    // algas ondulando paradas no fundo
    for (let i = 0; i < 70; i++) {
      const x = sorte() * m.largura, y = sorte() * m.altura;
      const tamanho = 30 + sorte() * 60;
      ctx.strokeStyle = `rgba(${40 + sorte() * 40},${120 + sorte() * 60},${70},0.35)`;
      ctx.lineWidth = 3 + sorte() * 3;
      ctx.lineCap = "round";
      for (let f = 0; f < 4; f++) {
        const ang = sorte() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(ang + 0.6) * tamanho * 0.5, y + Math.sin(ang + 0.6) * tamanho * 0.5,
                             x + Math.cos(ang) * tamanho, y + Math.sin(ang) * tamanho);
        ctx.stroke();
      }
    }
    // grade suave: ajuda a perceber o movimento quando a câmera segue o peixe
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= m.largura; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, m.altura); ctx.stroke();
    }
    for (let y = 0; y <= m.altura; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.largura, y); ctx.stroke();
    }
    // sombra das vitórias-régias no fundo
    for (const [x, y, r] of m.folhas) {
      ctx.fillStyle = "rgba(0,15,18,0.35)";
      ctx.beginPath(); ctx.arc(x + 18, y + 22, r * 1.05, 0, Math.PI * 2); ctx.fill();
    }
    return tela;
  }

  _criarLuzes() {
    const sorte = aleatorioComSemente(5);
    return Array.from({ length: 14 }, () => ({
      x: sorte() * this.mundo.largura, y: sorte() * this.mundo.altura,
      r: 140 + sorte() * 220, fase: sorte() * 6, vx: 6 + sorte() * 10,
    }));
  }

  _desenharLuzes(ctx, dt) {
    // reflexos de sol atravessando a água
    for (const l of this.luzes) {
      l.x += l.vx * dt;
      if (l.x - l.r > this.mundo.largura) l.x = -l.r;
      const brilho = 0.05 + 0.03 * Math.sin(this.relogio * 0.8 + l.fase);
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, `rgba(190,255,230,${brilho})`);
      g.addColorStop(1, "rgba(190,255,230,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------------------------------------------------------------- comida
  _desenharComida(ctx, numero, [x, y, tipo]) {
    const t = this.relogio;
    if (tipo === 0) {                                     // piaba: peixinho prateado
      const ang = (numero * 2.399) % (Math.PI * 2) + Math.sin(t * 1.5 + numero) * 0.3;
      const dx = Math.cos(t * 0.7 + numero) * 3;
      ctx.save();
      ctx.translate(x + dx, y + Math.sin(t * 0.9 + numero) * 3);
      ctx.rotate(ang);
      ctx.fillStyle = numero % 3 === 0 ? "#cfe8ef" : "#a9d6e5";
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
      const abana = Math.sin(t * 10 + numero) * 2;
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-11, -4 + abana); ctx.lineTo(-11, 4 + abana); ctx.fill();
      ctx.fillStyle = "#ff6b6b";                          // a pintinha vermelha do neon
      ctx.fillRect(-2, -1, 5, 1.6);
      ctx.restore();
    } else if (tipo === 1) {                              // fruto de taperebá
      const r = 9 + Math.sin(t * 3 + numero) * 0.8;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r * 2.4);
      g.addColorStop(0, "rgba(255,209,102,0.55)");
      g.addColorStop(1, "rgba(255,209,102,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f4a261";
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.85, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.ellipse(x - 3, y - 3, r * 0.4, r * 0.3, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4caf50";
      ctx.beginPath(); ctx.ellipse(x + r * 0.6, y - r * 0.8, 5, 2.5, -0.6, 0, Math.PI * 2); ctx.fill();
    } else {                                              // pedaço arrancado pelo boto
      const r = 7;
      ctx.fillStyle = "#ff8fab";
      ctx.beginPath(); ctx.arc(x, y + Math.sin(t * 2 + numero) * 2, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#c9184a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- peixes
  _corDoPeixe(numero) {
    const info = this.nomes.get(numero);
    return info ? this.turmas[info.turma].cor : "#cccccc";
  }

  _formaDoPeixe(ctx, r, cauda) {
    // corpo
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.82, 0, 0, Math.PI * 2);
    // rabo
    const abana = Math.sin(cauda) * r * 0.35;
    ctx.moveTo(-r * 0.95, 0);
    ctx.quadraticCurveTo(-r * 1.45, abana * 0.5, -r * 1.85, -r * 0.7 + abana);
    ctx.quadraticCurveTo(-r * 1.6, abana, -r * 1.85, r * 0.7 + abana);
    ctx.quadraticCurveTo(-r * 1.45, abana * 0.5, -r * 0.95, 0);
  }

  _desenharPeixe(ctx, numero, p, anel) {
    const r = raioDaMassa(p.massa);
    const cor = this._corDoPeixe(numero);
    const protegido = p.flags & 1, ausente = p.flags & 4;
    ctx.save();
    ctx.translate(p.x, p.y);

    if (anel) {
      ctx.strokeStyle = anel;
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(this.relogio * 6);
      ctx.lineWidth = Math.max(3, r * 0.12);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    let alfa = 1;
    if (ausente) alfa = 0.3;
    else if (protegido) alfa = 0.45 + 0.4 * Math.abs(Math.sin(this.relogio * 10));
    ctx.globalAlpha = alfa;
    ctx.rotate(p.a);

    // sombra
    ctx.save(); ctx.translate(r * 0.15, r * 0.25);
    this._formaDoPeixe(ctx, r, p.cauda);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();
    ctx.restore();

    // barbatanas laterais
    ctx.fillStyle = clarear(cor, -0.25);
    const bate = Math.sin(p.cauda * 1.3) * 0.3;
    for (const lado of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(r * 0.1, lado * r * 0.75, r * 0.45, r * 0.18, lado * (0.6 + bate), 0, Math.PI * 2);
      ctx.fill();
    }

    this._formaDoPeixe(ctx, r, p.cauda);
    const corpo = ctx.createLinearGradient(0, -r, 0, r);
    corpo.addColorStop(0, clarear(cor, -0.2));
    corpo.addColorStop(0.5, cor);
    corpo.addColorStop(1, clarear(cor, -0.2));
    ctx.fillStyle = corpo;
    ctx.fill();
    ctx.strokeStyle = clarear(cor, -0.45);
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.stroke();

    // escamas e faixa de luz nas costas
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath(); ctx.ellipse(r * 0.1, 0, r * 0.8, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    if (r > 18) {
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = Math.max(1, r * 0.04);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.arc(r * (0.05 + i * 0.3), 0, r * 0.45, -0.9, 0.9); ctx.stroke();
      }
    }

    // olhos (vistos de cima, um de cada lado)
    for (const lado of [-1, 1]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(r * 0.62, lado * r * 0.38, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(r * 0.68, lado * r * 0.4, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  _contornoPorCima(ctx, p) {
    // mostra o meu peixe mesmo quando está embaixo de uma folha
    const r = raioDaMassa(p.massa);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.setLineDash([r * 0.35, r * 0.25]);
    ctx.lineDashOffset = -this.relogio * 30;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- o boto
  _desenharBoto(ctx, b, linha) {
    const r = this.mundo.raio_boto;
    const alvo = this.peixes.get(b.alvo);
    if (linha && alvo && !(alvo.flags & 8)) {             // mira no alvo (telão)
      ctx.strokeStyle = "rgba(255,77,109,0.55)";
      ctx.lineWidth = 4;
      ctx.setLineDash([16, 14]);
      ctx.lineDashOffset = -this.relogio * 60;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(alvo.x, alvo.y); ctx.stroke();
      ctx.setLineDash([]);
      const ra = raioDaMassa(alvo.massa) * 1.6 + 6 * Math.sin(this.relogio * 8);
      ctx.beginPath(); ctx.arc(alvo.x, alvo.y, ra, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    const abana = Math.sin(b.cauda) * 0.35;

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(r * 0.15, r * 0.3, r * 1.5, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();

    // nadadeiras peitorais
    ctx.fillStyle = CORES.botoEscuro;
    for (const lado of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(r * 0.25, lado * r * 0.62, r * 0.5, r * 0.18, lado * (0.7 + abana * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    // cauda em forma de "V"
    ctx.save();
    ctx.translate(-r * 1.45, 0);
    ctx.rotate(abana);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.3, -r * 0.2, -r * 0.6, -r * 0.7);
    ctx.quadraticCurveTo(-r * 0.35, 0, -r * 0.6, r * 0.7);
    ctx.quadraticCurveTo(-r * 0.3, r * 0.2, 0, 0);
    ctx.fill();
    ctx.restore();

    // corpo
    const corpo = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
    corpo.addColorStop(0, CORES.botoEscuro);
    corpo.addColorStop(0.5, CORES.boto);
    corpo.addColorStop(1, CORES.botoEscuro);
    ctx.fillStyle = corpo;
    ctx.beginPath();
    ctx.moveTo(r * 1.0, -r * 0.42);
    ctx.quadraticCurveTo(-r * 0.4, -r * 0.65, -r * 1.5, 0);
    ctx.quadraticCurveTo(-r * 0.4, r * 0.65, r * 1.0, r * 0.42);
    ctx.quadraticCurveTo(r * 1.3, 0, r * 1.0, -r * 0.42);
    ctx.fill();
    // bico comprido
    ctx.beginPath();
    ctx.ellipse(r * 1.5, 0, r * 0.55, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,30,70,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // olhinhos
    ctx.fillStyle = "#3a0d24";
    for (const lado of [-1, 1]) {
      ctx.beginPath(); ctx.arc(r * 0.85, lado * r * 0.3, r * 0.07, 0, Math.PI * 2); ctx.fill();
    }

    // o chapéu branco da lenda: o boto esconde o buraco da cabeça
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.arc(r * 0.42, r * 0.06, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fbfbf5";
    ctx.beginPath(); ctx.arc(r * 0.38, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ddd8c8";
    ctx.lineWidth = 2;
    ctx.stroke();
    // copa do chapéu com a fita preta em volta
    ctx.fillStyle = "#efebdd";
    ctx.beginPath(); ctx.arc(r * 0.38, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#262626";
    ctx.lineWidth = r * 0.07;
    ctx.beginPath(); ctx.arc(r * 0.38, 0, r * 0.31, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.ellipse(r * 0.3, -r * 0.08, r * 0.12, r * 0.07, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- vitória-régia
  _desenharFolha(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((x * 0.013) % (Math.PI * 2));
    ctx.globalAlpha = 0.94;
    // a folha tem uma borda levantada (é assim que a vitória-régia flutua)
    ctx.fillStyle = CORES.folhaBorda;
    ctx.beginPath(); ctx.arc(0, 0, r, 0.12, Math.PI * 2 - 0.12); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.92);
    g.addColorStop(0, "#58b04a");
    g.addColorStop(1, CORES.folha);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0.14, Math.PI * 2 - 0.14); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    // nervuras
    ctx.strokeStyle = CORES.folhaEscura;
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const a = 0.3 + (i / 14) * (Math.PI * 2 - 0.6);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0.2, Math.PI * 2 - 0.2); ctx.stroke();
    ctx.globalAlpha = 1;
    // algumas folhas têm flor
    if (Math.round(x) % 3 === 0) {
      ctx.translate(r * 0.35, -r * 0.3);
      for (let i = 0; i < 10; i++) {
        ctx.rotate(Math.PI / 5);
        ctx.fillStyle = i % 2 ? "#ffe5ec" : "#ffc2d1";
        ctx.beginPath(); ctx.ellipse(r * 0.13, 0, r * 0.14, r * 0.06, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.06, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- nomes
  _desenharNomes(ctx, paraTela, escala, ordem, opcoes, naTela) {
    const base = opcoes.tamanhoNome || 13;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [numero, p] of ordem) {
      const info = this.nomes.get(numero);
      if (!info || !naTela(p.x, p.y, 50)) continue;
      const r = raioDaMassa(p.massa) * escala;
      const [sx, sy] = paraTela(p.x, p.y);
      const meu = numero === opcoes.destaque;
      ctx.globalAlpha = p.flags & 4 ? 0.4 : 1;
      if (r > base * 2.4) {
        // peixe grande: nome dentro do corpo
        const tamanho = Math.min(r * 0.42, base * 2.2);
        ctx.font = `800 ${tamanho}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.lineWidth = Math.max(3, tamanho * 0.2);
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(info.nome, sx, sy);
        ctx.fillStyle = "#fff";
        ctx.fillText(info.nome, sx, sy);
        if (opcoes.mostrarMassa || meu) {
          ctx.font = `700 ${tamanho * 0.6}px system-ui, sans-serif`;
          ctx.strokeText(Math.round(p.massa), sx, sy + tamanho * 0.95);
          ctx.fillText(Math.round(p.massa), sx, sy + tamanho * 0.95);
        }
      } else {
        // peixe pequeno: etiqueta em cima
        ctx.font = `700 ${base}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        const largura = ctx.measureText(info.nome).width + base * 1.4;
        const altura = base * 1.5;
        const y = sy - r * 1.05 - altura / 2 - 3;
        ctx.fillStyle = meu ? "rgba(255,255,255,0.92)" : "rgba(2,20,25,0.7)";
        ctx.beginPath();
        ctx.roundRect(sx - largura / 2, y - altura / 2, largura, altura, altura / 2);
        ctx.fill();
        ctx.fillStyle = this.turmas[info.turma].cor;
        ctx.beginPath(); ctx.arc(sx - largura / 2 + base * 0.6, y, base * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = meu ? "#022027" : "#fff";
        ctx.fillText(info.nome, sx + base * 0.25, y + 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- efeitos
  _soltarBolha(x, y, r) {
    if (this.bolhas.length > 300) return;
    this.bolhas.push({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r,
                       r: 2 + Math.random() * 4, vida: 0, duracao: 0.8 + Math.random() * 0.6 });
  }

  _desenharBolhas(ctx, dt) {
    ctx.strokeStyle = "rgba(220,255,250,0.7)";
    ctx.lineWidth = 1.5;
    this.bolhas = this.bolhas.filter((b) => (b.vida += dt) < b.duracao);
    for (const b of this.bolhas) {
      ctx.globalAlpha = 1 - b.vida / b.duracao;
      ctx.beginPath(); ctx.arc(b.x, b.y - b.vida * 20, b.r * (1 + b.vida), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _criarEfeito(e) {
    if (e.t === "devorou") {
      for (let i = 0; i < 14; i++) this._soltarBolha(e.x, e.y, 40);
      this.efeitos.push({ x: e.x, y: e.y, texto: `+${e.p}`, cor: CORES.ouro, tamanho: 1.6,
                          vida: 0, duracao: 1.2 });
    } else if (e.t === "boto_mordeu") {
      for (let i = 0; i < 40; i++) this._soltarBolha(e.x, e.y, 120);
      this.efeitos.push({ x: e.x, y: e.y, anel: true, vida: 0, duracao: 0.9 });
      this.efeitos.push({ x: e.x, y: e.y, texto: `NHAC! −${e.p}`, cor: CORES.perigo, tamanho: 2,
                          vida: 0, duracao: 1.6 });
    }
  }

  _desenharEfeitos(ctx, paraTela, dt, tamanhoBase) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.efeitos = this.efeitos.filter((e) => (e.vida += dt) < e.duracao);
    for (const e of this.efeitos) {
      const progresso = e.vida / e.duracao;
      const [sx, sy] = paraTela(e.x, e.y);
      ctx.globalAlpha = 1 - progresso;
      if (e.anel) {
        ctx.strokeStyle = CORES.perigo;
        ctx.lineWidth = 4;
        for (const atraso of [0, 0.2, 0.4]) {
          const p = Math.max(0, progresso - atraso);
          ctx.beginPath(); ctx.arc(sx, sy, 15 + p * 90, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        const tamanho = tamanhoBase * e.tamanho;
        ctx.font = `900 ${tamanho}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(2,20,25,0.85)";
        ctx.strokeText(e.texto, sx, sy - progresso * 45);
        ctx.fillStyle = e.cor;
        ctx.fillText(e.texto, sx, sy - progresso * 45);
      }
    }
    ctx.globalAlpha = 1;
  }
}
