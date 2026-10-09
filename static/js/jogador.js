/*
 * jogador.js — tela do celular: entrada, joystick, arrancada e HUD.
 *
 * O celular só manda para o servidor a direção do joystick ({dx, dy} entre -1 e 1)
 * e o aperto do botão de arrancada. Quem come quem é decidido no servidor.
 */
"use strict";

const $ = (id) => document.getElementById(id);
document.querySelectorAll(".logo-icone").forEach((el) => (el.innerHTML = ICONE_BOTO));

// Identidade do celular: guardada no navegador para reconectar no mesmo peixe
const guardado = {
  ler(chave) { try { return localStorage.getItem("boto_" + chave); } catch { return null; } },
  gravar(chave, valor) { try { localStorage.setItem("boto_" + chave, valor); } catch { } },
};
let meuId = guardado.ler("id");
if (!meuId) {
  meuId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  guardado.gravar("id", meuId);
}

const jogo = {
  info: null,
  render: null,
  elenco: null,
  meuNumero: null,
  minhaTurma: null,
  turmaEscolhida: Number(guardado.ler("turma") ?? -1),
  fase: "lobby",
  vivo: true,
  voltaEm: 0,
  arrancadaLivreEm: 0,
  cacadoPeloBoto: false,
};

const conexao = new ConexaoJogo("/ws/jogador", receber, (online) => {
  $("status-conexao").hidden = online;
});

// ------------------------------------------------------------------ mensagens
function receber(msg) {
  switch (msg.tipo) {
    case "info":
      jogo.info = msg;
      if (!jogo.render) jogo.render = new Renderizador($("rio"), msg.mundo, msg.turmas);
      montarTurmas();
      // celular recarregou ou o Wi-Fi caiu: volta para o mesmo peixe
      if (guardado.ler("entrou") === "1" && guardado.ler("nome")) entrar();
      break;

    case "elenco":
      jogo.elenco = msg;
      jogo.render?.receberElenco(msg);
      atualizarLotacao(msg.lotacao);
      if (msg.resultado) mostrarFim(msg.resultado);
      break;

    case "comida":
      jogo.render?.receberComida(msg);
      break;

    case "estado":
      jogo.render?.receberEstado(msg);
      atualizarFase(msg);
      atualizarHud(msg);
      for (const evento of msg.eventos) reagir(evento);
      break;

    case "bem_vindo":
      jogo.meuNumero = msg.numero;
      jogo.minhaTurma = msg.turma;
      guardado.gravar("entrou", "1");
      $("tela-entrada").hidden = true;
      $("hud").hidden = false;
      $("botao-entrar").disabled = false;
      montarHudTurma();
      break;

    case "erro":
      $("erro-entrada").textContent = msg.mensagem;
      $("botao-entrar").disabled = false;
      guardado.gravar("entrou", "0");
      $("tela-entrada").hidden = false;
      break;

    case "removido":
      sairDoJogo(msg.motivo);
      break;
  }
}

// ------------------------------------------------------------------ entrada
function montarTurmas() {
  const lista = $("lista-turmas");
  lista.innerHTML = "";
  jogo.info.turmas.forEach((turma, i) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "turma" + (i === jogo.turmaEscolhida ? " escolhida" : "");
    botao.dataset.indice = i;
    botao.innerHTML = `<span class="chip-cor" style="background:${turma.cor}"></span>
                       ${escaparHtml(turma.nome)}<small>0/${jogo.info.max_por_turma}</small>`;
    botao.addEventListener("click", () => {
      jogo.turmaEscolhida = i;
      for (const b of lista.children) b.classList.toggle("escolhida", b === botao);
    });
    lista.appendChild(botao);
  });
  $("campo-nome").value = guardado.ler("nome") || "";
  if (jogo.elenco) atualizarLotacao(jogo.elenco.lotacao);
}

function atualizarLotacao(lotacao) {
  if (!jogo.info) return;
  for (const botao of $("lista-turmas").children) {
    const i = Number(botao.dataset.indice);
    botao.querySelector("small").textContent = `${lotacao[i]}/${jogo.info.max_por_turma}`;
    botao.disabled = lotacao[i] >= jogo.info.max_por_turma && i !== jogo.minhaTurma;
  }
}

$("form-entrada").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const nome = $("campo-nome").value.trim();
  if (!nome) return ($("erro-entrada").textContent = "Digite seu nome.");
  if (jogo.turmaEscolhida < 0) return ($("erro-entrada").textContent = "Escolha sua turma.");
  guardado.gravar("nome", nome);
  guardado.gravar("turma", jogo.turmaEscolhida);
  $("erro-entrada").textContent = "";
  $("botao-entrar").disabled = true;
  entrar();
  // tela cheia esconde a barra do navegador (só funciona após um toque)
  document.documentElement.requestFullscreen?.().catch(() => {});
});

function entrar() {
  conexao.enviar({
    tipo: "entrar",
    id: meuId,
    nome: guardado.ler("nome"),
    turma: Number(guardado.ler("turma")),
  });
}

$("botao-sair").addEventListener("click", () => {
  if (confirm("Sair do rio? Seu peixe some e deixa de contar para a turma.")) {
    conexao.enviar({ tipo: "sair" });
    sairDoJogo("");
  }
});

function sairDoJogo(motivo) {
  jogo.meuNumero = null;
  jogo.minhaTurma = null;
  guardado.gravar("entrou", "0");
  $("hud").hidden = true;
  $("tela-fim").hidden = true;
  $("devorado").hidden = true;
  $("tela-entrada").hidden = false;
  $("erro-entrada").textContent = motivo || "";
  $("botao-entrar").disabled = false;
  if (jogo.elenco) atualizarLotacao(jogo.elenco.lotacao);
}

// ------------------------------------------------------------------ HUD
function montarHudTurma() {
  const turma = jogo.info.turmas[jogo.minhaTurma];
  $("hud-cor").style.background = turma.cor;
  $("hud-turma-nome").textContent = turma.nome;
}

function atualizarHud(estado) {
  if (jogo.meuNumero === null) return;
  $("hud-turma-pontos").textContent = `${estado.turmas[jogo.minhaTurma]} no total`;

  const relogio = $("hud-relogio");
  relogio.classList.toggle("treino", estado.fase === "lobby");
  relogio.classList.toggle("acabando", estado.fase === "jogando" && estado.tempo <= 10);
  relogio.textContent = estado.fase === "lobby" ? "TREINO"
                      : estado.fase === "fim" ? "FIM" : formatarTempo(estado.tempo);
  $("hud-dica").hidden = estado.fase !== "lobby";

  const meu = estado.peixes.find((p) => p[0] === jogo.meuNumero);
  if (!meu) return;
  const vivo = !(meu[5] & 8);
  if (vivo) {
    $("hud-massa").textContent = meu[3];
    const vivos = estado.peixes.filter((p) => !(p[5] & 8)).sort((a, b) => b[3] - a[3]);
    const posicao = vivos.findIndex((p) => p[0] === jogo.meuNumero) + 1;
    const eu = jogo.elenco?.jogadores.find((j) => j[0] === jogo.meuNumero);
    const devorados = eu ? eu[3] : 0;
    $("hud-posicao").textContent =
      `${posicao}º maior · ${devorados} devorado${devorados === 1 ? "" : "s"}`;
  }
  if (vivo !== jogo.vivo) {
    jogo.vivo = vivo;
    if (vivo) $("devorado").hidden = true;
  }

  const alvoDoBoto = estado.boto && estado.boto[3] === jogo.meuNumero;
  if (alvoDoBoto !== jogo.cacadoPeloBoto) {
    jogo.cacadoPeloBoto = alvoDoBoto;
    const alerta = $("alerta-boto");
    alerta.dataset.texto = "O Boto está atrás de VOCÊ! Fuja ou esconda-se numa vitória-régia";
    alerta.hidden = !alvoDoBoto;
    if (alvoDoBoto) vibrar([200, 100, 200]);
  }
}

function atualizarFase(estado) {
  const contagem = estado.fase === "contagem";
  $("contagem").hidden = !contagem;
  if (contagem) {
    const numero = $("contagem-numero");
    const texto = estado.tempo > 3 ? "Prepare-se" : String(estado.tempo || "Já!");
    if (numero.textContent !== texto) {
      numero.textContent = texto;
      numero.style.fontSize = texto.length > 3 ? "min(14vw, 14vh)" : "";
      numero.style.animation = "none";
      void numero.offsetWidth;                // reinicia a animação
      numero.style.animation = "";
      vibrar(60);
    }
  }
  if (estado.fase !== jogo.fase) {
    if (estado.fase === "jogando") avisar("Valendo! Bom apetite!");
    if (estado.fase !== "fim") $("tela-fim").hidden = true;
    jogo.fase = estado.fase;
  }
}

let temporizadorAviso;
function avisar(texto, ruim = false) {
  const toast = $("toast");
  toast.textContent = texto;
  toast.classList.toggle("ruim", ruim);
  toast.classList.add("visivel");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => toast.classList.remove("visivel"), 2200);
}

function vibrar(padrao) {
  try { navigator.vibrate?.(padrao); } catch { }
}

function nomeDe(numero) {
  const j = jogo.elenco?.jogadores.find((x) => x[0] === numero);
  return j ? { nome: j[1], turma: jogo.info.turmas[j[2]].nome } : { nome: "alguém", turma: "" };
}

function reagir(evento) {
  const eu = jogo.meuNumero;
  if (eu === null) return;
  if (evento.t === "devorou" && evento.n === eu) {
    vibrar([40, 30, 40]);
    avisar(`Nhac! Você engoliu ${nomeDe(evento.v).nome} (+${evento.p})`);
  } else if (evento.t === "devorou" && evento.v === eu) {
    vibrar(500);
    const quem = nomeDe(evento.n);
    $("devorado-por").textContent = quem.turma ? `${quem.nome} (${quem.turma}) engoliu você`
                                               : "Um peixe maior engoliu você";
    jogo.voltaEm = performance.now() + jogo.info.mundo.tempo_renascer * 1000;
    $("devorado").hidden = false;
  } else if (evento.t === "boto_mordeu" && evento.a === eu) {
    vibrar([300, 80, 300]);
    avisar(`O Boto te mordeu! Perdeu ${evento.p} de tamanho`, true);
  } else if (evento.t === "boto_desistiu" && evento.a === eu) {
    avisar("Ufa! O Boto desistiu de você");
  } else if (evento.t === "boto_aparece" && evento.a !== eu) {
    avisar(`O Boto apareceu! Ele caça ${nomeDe(evento.a).nome}`);
  }
}

function mostrarFim(resultado) {
  if (jogo.meuNumero === null) return;
  $("devorado").hidden = true;
  $("alerta-boto").hidden = true;
  const campea = resultado.turmas[0];
  $("fim-campea").innerHTML = campea.pontos > 0
    ? `<span class="chip-cor" style="background:${campea.cor}"></span> ${escaparHtml(campea.nome)} venceu!`
    : "Ninguém sobrou no rio";
  const posicao = resultado.turmas.findIndex((t) => t.indice === jogo.minhaTurma) + 1;
  const eu = resultado.jogadores.find((j) => j.numero === jogo.meuNumero);
  $("fim-minha").innerHTML = `Sua turma ficou em <b>${posicao}º lugar</b>
    Seu maior tamanho: ${eu ? eu.maior_massa : 0} · devorou ${eu ? eu.devorados : 0}`;
  $("fim-lista").innerHTML = resultado.turmas.map((t, i) => `
    <li class="${t.indice === jogo.minhaTurma ? "minha" : ""}">
      ${i + 1}º <span class="chip-cor" style="background:${t.cor}"></span>
      ${escaparHtml(t.nome)} <b>${t.pontos}</b>
    </li>`).join("");
  $("tela-fim").hidden = false;
}

// ------------------------------------------------------------------ controles
const controle = { dx: 0, dy: 0, enviadoX: 0, enviadoY: 0, ultimoEnvio: 0, dedo: null, baseX: 0, baseY: 0 };
const RAIO_JOYSTICK = 55;

window.addEventListener("pointerdown", (e) => {
  if (jogo.meuNumero === null || controle.dedo !== null) return;
  if (e.target.closest("button, input, .tela")) return;
  controle.dedo = e.pointerId;
  controle.baseX = e.clientX;
  controle.baseY = e.clientY;
  const joystick = $("joystick");
  joystick.style.left = e.clientX + "px";
  joystick.style.top = e.clientY + "px";
  joystick.hidden = false;
  moverManche(e);
});

window.addEventListener("pointermove", (e) => {
  if (e.pointerId === controle.dedo) moverManche(e);
});

function soltar(e) {
  if (e.pointerId !== controle.dedo) return;
  controle.dedo = null;
  controle.dx = controle.dy = 0;
  $("joystick").hidden = true;
}
window.addEventListener("pointerup", soltar);
window.addEventListener("pointercancel", soltar);

function moverManche(e) {
  let dx = e.clientX - controle.baseX;
  let dy = e.clientY - controle.baseY;
  const distancia = Math.hypot(dx, dy);
  if (distancia > RAIO_JOYSTICK) {
    dx = (dx / distancia) * RAIO_JOYSTICK;
    dy = (dy / distancia) * RAIO_JOYSTICK;
  }
  $("joystick").firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  controle.dx = dx / RAIO_JOYSTICK;
  controle.dy = dy / RAIO_JOYSTICK;
}

// arrancada: pointerdown responde na hora (o "click" tem atraso no celular)
function arrancar() {
  const agora = performance.now();
  if (agora < jogo.arrancadaLivreEm || !jogo.vivo) return;
  if (conexao.enviar({ tipo: "arrancar" })) {
    jogo.arrancadaLivreEm = agora + jogo.info.mundo.recarga_arrancada * 1000;
    vibrar(30);
  }
}
const botaoArrancada = $("botao-arrancada");
botaoArrancada.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  botaoArrancada.classList.add("pressionado");
  arrancar();
});
for (const tipo of ["pointerup", "pointercancel", "pointerleave"]) {
  botaoArrancada.addEventListener(tipo, () => botaoArrancada.classList.remove("pressionado"));
}

// teclado (para jogar no computador): setas ou WASD, espaço para arrancar
const teclas = new Set();
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === " ") { e.preventDefault(); arrancar(); }
  teclas.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => teclas.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => teclas.clear());

function direcaoDoTeclado() {
  const x = (teclas.has("arrowright") || teclas.has("d") ? 1 : 0) - (teclas.has("arrowleft") || teclas.has("a") ? 1 : 0);
  const y = (teclas.has("arrowdown") || teclas.has("s") ? 1 : 0) - (teclas.has("arrowup") || teclas.has("w") ? 1 : 0);
  const t = Math.hypot(x, y) || 1;
  return [x / t, y / t];
}

function enviarControle(agora) {
  if (jogo.meuNumero === null) return;
  let [dx, dy] = controle.dedo !== null ? [controle.dx, controle.dy] : direcaoDoTeclado();
  const mudou = Math.abs(dx - controle.enviadoX) > 0.04 || Math.abs(dy - controle.enviadoY) > 0.04;
  const parado = dx === 0 && dy === 0;
  // manda quando a direção muda (no máximo a cada 50 ms) e repete de vez em quando
  if ((mudou && agora - controle.ultimoEnvio > 50) || (!parado && agora - controle.ultimoEnvio > 300)) {
    dx = Math.round(dx * 100) / 100;
    dy = Math.round(dy * 100) / 100;
    if (conexao.enviar({ tipo: "mover", dx, dy })) {
      controle.enviadoX = dx;
      controle.enviadoY = dy;
      controle.ultimoEnvio = agora;
    }
  }
}

function atualizarRecarga(agora) {
  if (!jogo.info) return;
  const total = jogo.info.mundo.recarga_arrancada * 1000;
  const falta = Math.max(0, jogo.arrancadaLivreEm - agora) / total;
  $("recarga").style.setProperty("--falta", `${falta * 100}%`);
  if (!$("devorado").hidden) {
    $("devorado-tempo").textContent = Math.max(1, Math.ceil((jogo.voltaEm - agora) / 1000));
  }
}

// ------------------------------------------------------------------ laço de desenho
let anterior = performance.now();
function quadro(agora) {
  const dt = Math.min(0.1, (agora - anterior) / 1000);
  anterior = agora;
  if (jogo.render) {
    const largura = window.innerWidth, altura = window.innerHeight;
    const camera = jogo.meuNumero !== null
      ? jogo.render.cameraSeguindo(jogo.meuNumero, largura, altura)
      : Renderizador.cameraMundoInteiro(largura, altura, jogo.info.mundo);
    jogo.render.desenhar(dt, { camera, destaque: jogo.meuNumero, tamanhoNome: 12, marcarPerigo: true });
  }
  enviarControle(agora);
  atualizarRecarga(agora);
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);
