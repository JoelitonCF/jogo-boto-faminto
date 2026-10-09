/*
 * telao.js — tela do projetor: rio inteiro, placar ao vivo e resultado.
 * Abra /telao?senha=SUA_SENHA para ter os controles da partida.
 */
"use strict";

const $ = (id) => document.getElementById(id);
document.querySelectorAll(".logo-icone").forEach((el) => (el.innerHTML = ICONE_BOTO));

const senha = new URLSearchParams(location.search).get("senha") || "";
const telao = {
  info: null,
  render: null,
  elenco: null,
  fase: null,
  pontosAnteriores: [],
  linhas: [],
  ultimoRanking: "",
};

const conexao = new ConexaoJogo(`/ws/telao?senha=${encodeURIComponent(senha)}`, receber, (online) => {
  $("status-conexao").hidden = online;
});

function receber(msg) {
  if (msg.tipo === "info") {
    telao.info = msg;
    if (!telao.render) telao.render = new Renderizador($("rio"), msg.mundo, msg.turmas);
    configurarEntrada(msg);
    montarPlacar(msg.turmas);
    $("admin").hidden = !msg.admin;
  } else if (msg.tipo === "elenco") {
    telao.elenco = msg;
    telao.render?.receberElenco(msg);
    atualizarListaJogadores(msg);
    $("total-peixes").textContent = msg.jogadores.filter((j) => j[4]).length;
    if (msg.resultado) mostrarResultado(msg.resultado);
  } else if (msg.tipo === "comida") {
    telao.render?.receberComida(msg);
  } else if (msg.tipo === "estado") {
    telao.render?.receberEstado(msg);
    atualizarFase(msg);
    atualizarPlacar(msg.turmas);
    atualizarMaiores(msg.peixes);
    for (const evento of msg.eventos) registrarEvento(evento);
  }
}

// ------------------------------------------------------------------ como entrar
function configurarEntrada(info) {
  const url = info.url.replace(/\/$/, "");
  $("url-jogo").textContent = url;
  $("url-jogo-mini").textContent = url;
  $("qr-jogo").src = "/qrcode.svg";
  $("qr-jogo-mini").src = "/qrcode.svg";
  const temWifi = Boolean(info.wifi && info.wifi.nome);
  $("passo-wifi").hidden = !temWifi;
  $("numero-passo-jogo").textContent = temWifi ? "2" : "1";
  if (temWifi) {
    $("qr-wifi").src = "/qrcode-wifi.svg";
    $("wifi-nome").textContent = info.wifi.nome;
    $("wifi-senha").textContent = info.wifi.senha ? `senha: ${info.wifi.senha}` : "rede aberta";
  }
}

// ------------------------------------------------------------------ fases
const NOMES_DAS_FASES = {
  lobby: "Aguardando jogadores",
  contagem: "Preparar…",
  jogando: "Tempo restante",
  fim: "Fim da rodada",
};

function atualizarFase(estado) {
  const relogio = $("relogio");
  $("relogio-fase").textContent = NOMES_DAS_FASES[estado.fase];
  $("relogio-tempo").textContent = estado.fase === "jogando" ? formatarTempo(estado.tempo)
    : estado.fase === "lobby" ? formatarTempo(telao.info?.duracao || 0) : estado.fase === "fim" ? "0:00" : "--:--";
  relogio.classList.toggle("acabando", estado.fase === "jogando" && estado.tempo <= 10);

  $("como-entrar").hidden = estado.fase !== "lobby";
  $("qr-mini").hidden = estado.fase === "lobby";
  $("placar-treino").hidden = estado.fase !== "lobby";
  $("contagem").hidden = estado.fase !== "contagem";
  if (estado.fase !== "fim") $("resultado").hidden = true;
  else $("faixa-boto").hidden = true;

  if (estado.fase === "contagem") {
    const numero = $("contagem-numero");
    const texto = estado.tempo > 3 ? "Preparem as nadadeiras!" : String(estado.tempo || "Já!");
    if (numero.textContent !== texto) {
      numero.textContent = texto;
      numero.classList.toggle("texto", texto.length > 3);
      numero.style.animation = "none";
      void numero.offsetWidth;
      numero.style.animation = "";
    }
  }

  if (estado.fase !== telao.fase) {
    if (estado.fase === "contagem") $("feed").innerHTML = "";
    telao.fase = estado.fase;
    atualizarBotoes();
  }
}

// ------------------------------------------------------------------ placar
function montarPlacar(turmas) {
  const placar = $("placar");
  placar.innerHTML = "";
  telao.linhas = turmas.map((turma) => {
    const linha = document.createElement("div");
    linha.className = "linha-turma";
    linha.innerHTML = `
      <span class="pos"></span>
      <span class="nome"><span class="chip-cor" style="background:${turma.cor}"></span>
        ${escaparHtml(turma.nome)}<small>0 peixes</small></span>
      <span class="barra"><i style="background:${turma.cor}; width:0%"></i></span>
      <span class="pontos">0</span>`;
    placar.appendChild(linha);
    return linha;
  });
  telao.pontosAnteriores = turmas.map(() => 0);
  telao.ordem = "";
  posicionarLinhas(turmas.map((_, i) => i));
}

function posicionarLinhas(ordem) {
  const altura = telao.linhas[0]?.offsetHeight || 40;
  ordem.forEach((indice, posicao) => {
    const linha = telao.linhas[indice];
    linha.style.transform = `translateY(${posicao * (altura + 4)}px)`;
    linha.querySelector(".pos").textContent = `${posicao + 1}º`;
  });
  $("placar").style.height = `${ordem.length * (altura + 4)}px`;
}

function atualizarPlacar(pontos) {
  if (!telao.linhas.length) return;
  const maximo = Math.max(1, ...pontos);
  const lotacao = telao.elenco?.lotacao || [];
  pontos.forEach((valor, i) => {
    const linha = telao.linhas[i];
    linha.querySelector(".pontos").textContent = valor;
    linha.querySelector(".barra i").style.width = `${(valor / maximo) * 100}%`;
    const peixes = lotacao[i] || 0;
    linha.querySelector(".nome small").textContent = `${peixes} peixe${peixes === 1 ? "" : "s"}`;
    if (valor > telao.pontosAnteriores[i] + 15) {
      linha.classList.remove("subiu");
      void linha.offsetWidth;
      linha.classList.add("subiu");
    }
  });
  telao.pontosAnteriores = pontos.slice();
  // reordena só quando a classificação muda (o tamanho muda o tempo todo)
  const ordem = pontos.map((_, i) => i).sort((a, b) => pontos[b] - pontos[a] || a - b);
  const chave = ordem.join(",");
  if (chave !== telao.ordem) {
    telao.ordem = chave;
    posicionarLinhas(ordem);
  }
}
window.addEventListener("resize", () => (telao.ordem = ""));

function atualizarMaiores(peixes) {
  if (!telao.elenco || !telao.info) return;
  const vivos = peixes.filter((p) => !(p[5] & 8)).sort((a, b) => b[3] - a[3]).slice(0, 5);
  const medalhas = ["🥇", "🥈", "🥉", "4º", "5º"];
  const linhas = vivos.map(([numero, , , massa], i) => {
    const j = telao.elenco.jogadores.find((x) => x[0] === numero);
    if (!j) return "";
    return `<li><span class="medalha">${medalhas[i]}</span>
      <span class="chip-cor" style="background:${telao.info.turmas[j[2]].cor}"></span>
      ${escaparHtml(j[1])}<b>${massa}</b></li>`;
  }).join("");
  const html = linhas || `<li class="vazio">O rio está vazio</li>`;
  if (html !== telao.ultimoRanking) {
    telao.ultimoRanking = html;
    $("destaques").innerHTML = html;
  }
}

// ------------------------------------------------------------------ acontecimentos
function jogador(numero) {
  const j = telao.elenco?.jogadores.find((x) => x[0] === numero);
  if (!j) return null;
  return { nome: j[1], turma: telao.info.turmas[j[2]] };
}

function etiqueta(p) {
  return `<span class="chip-cor" style="background:${p.turma.cor}"></span><b>${escaparHtml(p.nome)}</b>`;
}

let temporizadorFaixa;
function mostrarFaixa(texto, calma = false) {
  const faixa = $("faixa-boto");
  faixa.textContent = texto;
  faixa.classList.toggle("calma", calma);
  faixa.hidden = false;
  clearTimeout(temporizadorFaixa);
  temporizadorFaixa = setTimeout(() => (faixa.hidden = true), calma ? 2500 : 4000);
}

function registrarEvento(evento) {
  if (!telao.info) return;
  let html = "";
  if (evento.t === "devorou") {
    const a = jogador(evento.n), b = jogador(evento.v);
    if (!a || !b) return;
    html = `${etiqueta(a)} engoliu ${escaparHtml(b.nome)}<span class="ganho">+${evento.p}</span>`;
  } else if (evento.t === "boto_aparece") {
    const a = jogador(evento.a);
    if (!a) return;
    mostrarFaixa(`🐬 O Boto apareceu! Ele caça ${a.nome}`);
    html = `<span class="boto-icone">🐬</span> caçando ${etiqueta(a)}`;
  } else if (evento.t === "boto_mordeu") {
    const a = jogador(evento.a);
    if (!a) return;
    mostrarFaixa(`🐬 NHAC! O Boto mordeu ${a.nome}`);
    html = `<span class="boto-icone">🐬</span> mordeu ${etiqueta(a)}<span class="perda">−${evento.p}</span>`;
  } else if (evento.t === "boto_desistiu") {
    const a = jogador(evento.a);
    if (!a) return;
    mostrarFaixa(`${a.nome} escapou do Boto!`, true);
    html = `${etiqueta(a)} escapou do Boto`;
  } else {
    return;
  }
  const item = document.createElement("li");
  item.innerHTML = html;
  const feed = $("feed");
  feed.prepend(item);
  while (feed.children.length > 7) feed.lastChild.remove();
}

// ------------------------------------------------------------------ resultado
function mostrarResultado(resultado) {
  const campea = resultado.turmas[0];
  $("res-campea").innerHTML = campea.pontos > 0
    ? `<small>Campeã da rodada</small><span class="chip-cor" style="background:${campea.cor}"></span> ${escaparHtml(campea.nome)}`
    : `<small>Fim da rodada</small>Ninguém sobrou no rio`;

  $("podio").innerHTML = [1, 0, 2].map((i) => {
    const t = resultado.turmas[i];
    if (!t) return "";
    return `<div class="degrau p${i + 1}" style="background:${t.cor}">
      <span>${i + 1}º</span><b>${escaparHtml(t.nome)}</b><i>${t.pontos} de tamanho</i></div>`;
  }).join("");

  const turmas = telao.info.turmas;
  $("res-destaques").innerHTML = resultado.jogadores.slice(0, 5).map((j) => `
    <li><span class="chip-cor" style="background:${turmas[j.turma].cor}"></span>
      ${escaparHtml(j.nome)} <em>${escaparHtml(turmas[j.turma].nome)} · devorou ${j.devorados}</em><b>${j.maior_massa}</b></li>`).join("")
    || `<li>—</li>`;

  const acumulado = resultado.acumulado || { partidas: 0, turmas: [] };
  const cor = (nome) => (turmas.find((t) => t.nome === nome) || { cor: "#999" }).cor;
  $("res-partidas").textContent = `· ${acumulado.partidas} rodada${acumulado.partidas === 1 ? "" : "s"}`;
  $("res-acumulado").innerHTML = acumulado.turmas.slice(0, 6).map((t) => `
    <li><span class="chip-cor" style="background:${cor(t.nome)}"></span>
      ${escaparHtml(t.nome)} <em>${t.pontos} de tamanho</em><b>${t.vitorias} vitória${t.vitorias === 1 ? "" : "s"}</b></li>`).join("")
    || `<li>—</li>`;

  $("resultado").hidden = false;
}

// ------------------------------------------------------------------ professor
function comando(acao) {
  conexao.enviar({ tipo: "comando", acao });
}

function atualizarBotoes() {
  $("bt-iniciar").disabled = !["lobby", "fim"].includes(telao.fase);
  $("bt-encerrar").disabled = !["contagem", "jogando"].includes(telao.fase);
  $("bt-lobby").disabled = telao.fase !== "fim";
  $("bt-iniciar").firstChild.textContent = telao.fase === "fim" ? "▶ Nova rodada " : "▶ Iniciar ";
}

document.querySelectorAll(".admin [data-acao]").forEach((botao) => {
  botao.addEventListener("click", () => {
    if (botao.dataset.acao === "encerrar" && !confirm("Encerrar a rodada agora?")) return;
    comando(botao.dataset.acao);
  });
});

function telaCheia() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}
$("bt-tela-cheia").addEventListener("click", telaCheia);
$("bt-jogadores").addEventListener("click", () => $("janela-jogadores").showModal());
$("fechar-jogadores").addEventListener("click", () => $("janela-jogadores").close());

function atualizarListaJogadores(elenco) {
  if (!telao.info?.admin) return;
  const turmas = telao.info.turmas;
  const lista = [...elenco.jogadores].sort((a, b) => a[2] - b[2] || a[1].localeCompare(b[1]));
  $("lista-jogadores").innerHTML = lista.map(([numero, nome, turma, devorados, conectado]) => `
    <li><span class="chip-cor" style="background:${turmas[turma].cor}"></span>
      <b>${escaparHtml(nome)}</b> <em>${escaparHtml(turmas[turma].nome)} · devorou ${devorados}${conectado ? "" : " · desconectado"}</em>
      <button data-numero="${numero}">Remover</button></li>`).join("")
    || `<li><em>Ninguém conectado</em></li>`;
}
$("lista-jogadores").addEventListener("click", (e) => {
  const numero = e.target.dataset?.numero;
  if (numero) conexao.enviar({ tipo: "comando", acao: "remover", numero: Number(numero) });
});

window.addEventListener("keydown", (e) => {
  const tecla = e.key.toLowerCase();
  if (tecla === "f") telaCheia();
  if (!telao.info?.admin || $("janela-jogadores").open) return;
  if (tecla === "i" && !$("bt-iniciar").disabled) comando("iniciar");
  if (tecla === "e" && !$("bt-encerrar").disabled && confirm("Encerrar a rodada agora?")) comando("encerrar");
  if (tecla === "l" && !$("bt-lobby").disabled) comando("lobby");
  if (tecla === "j") $("janela-jogadores").showModal();
});

// ------------------------------------------------------------------ desenho
let anterior = performance.now();
function quadro(agora) {
  const dt = Math.min(0.1, (agora - anterior) / 1000);
  anterior = agora;
  if (telao.render) {
    const canvas = $("rio");
    const camera = Renderizador.cameraMundoInteiro(canvas.clientWidth, canvas.clientHeight, telao.info.mundo);
    const tamanhoNome = Math.max(10, Math.min(16, canvas.clientWidth / 95));
    telao.render.desenhar(dt, { camera, tamanhoNome, linhaDoBoto: true, mostrarMassa: true });
  }
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);
