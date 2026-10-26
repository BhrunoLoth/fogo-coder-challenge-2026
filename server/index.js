#!/usr/bin/env node
'use strict';
/**
 * F.O.G.O. — Ferramenta Onisciente de Gestão e Operações
 * Ponto de entrada: `node server/index.js` (ou `npm start`).
 * Sem dependências externas: só Node.js 18+.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { openDb } = require('./db');
const { carregarCidade } = require('./sim/city');
const seed = require('./sim/seed');
const { Motor } = require('./engine/motor');
const { Simulador } = require('./sim/simulador');
const { criarApi } = require('./api');

const [maior] = process.versions.node.split('.').map(Number);
if (maior < 18) {
  console.error(`\n  O F.O.G.O. precisa do Node.js 18 ou mais novo (você tem ${process.versions.node}).\n  Baixe em https://nodejs.org\n`);
  process.exit(1);
}

const PUBLIC = path.join(__dirname, '..', 'public');
const TIPOS_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const inicio = Date.now();
  console.log('\n  🔥 F.O.G.O. — Ferramenta Onisciente de Gestão e Operações');
  console.log('  ─────────────────────────────────────────────────────────');

  const { db, novo } = await openDb({ reset });
  const city = carregarCidade();
  if (novo) {
    process.stdout.write('  Gerando a cidade de Marília (90 dias de histórico)... ');
    seed.gerarCidade(db, city, Date.now());
    db.save();
    console.log('ok');
  } else {
    console.log('  Banco de dados encontrado em data/fogo.sqlite (use --reset para recriar).');
  }

  const motor = new Motor(db, city);
  process.stdout.write('  Treinando o motor preditivo... ');
  const sim = new Simulador(db, city, motor);
  sim.preparar();
  motor.garantirModelo(true);
  console.log(`ok (${motor.modelo.nOcorrencias} ocorrências, ${motor.modelo.tempoTreinoMs} ms)`);
  sim.timer = setInterval(() => { try { sim.tick(); } catch (e) { console.error('[simulador]', e); } }, 2000);

  const api = criarApi({ db, motor, sim, city });
  const servidor = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // o OpenStreetMap exige Referer para servir o mapa
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    return estatico(url.pathname, res);
  });

  const portaInicial = Number(process.env.PORT) || 3000;
  const porta = await escutar(servidor, portaInicial);
  const endereco = `http://localhost:${porta}`;
  console.log(`  Pronto em ${((Date.now() - inicio) / 1000).toFixed(1)}s.\n`);
  console.log(`  ➜  Abra no navegador:  ${endereco}\n`);
  console.log('  (Ctrl+C para encerrar. Os dados ficam salvos em data/fogo.sqlite)\n');
  if (!args.includes('--no-browser') && !process.env.NO_BROWSER) abrirNavegador(endereco);

  const encerrar = () => { console.log('\n  Salvando e encerrando...'); try { db.save(); } catch (e) { console.error(e); } process.exit(0); };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

function escutar(servidor, porta, tentativas = 10) {
  return new Promise((resolve, reject) => {
    servidor.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && tentativas > 0) {
        console.log(`  Porta ${porta} ocupada, tentando ${porta + 1}...`);
        resolve(escutar(servidor, porta + 1, tentativas - 1));
      } else reject(e);
    });
    servidor.listen(porta, () => resolve(porta));
  });
}

function estatico(caminho, res) {
  let decodificado;
  try { decodificado = decodeURIComponent(caminho); } catch { res.writeHead(400); return res.end('URL inválida'); }
  let arquivo = path.normalize(path.join(PUBLIC, decodificado));
  if (!arquivo.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); } // impede path traversal
  if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) arquivo = path.join(PUBLIC, 'index.html');
  if (!fs.existsSync(arquivo)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Interface não encontrada em /public. Rode "npm run build" na pasta web/.');
  }
  const ext = path.extname(arquivo);
  res.writeHead(200, { 'Content-Type': TIPOS_MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
  fs.createReadStream(arquivo).pipe(res);
}

function abrirNavegador(url) {
  try {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const p = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch { /* sem navegador disponível: tudo bem, o endereço está no terminal */ }
}

// Um erro inesperado não derruba a central: registra e segue operando.
process.on('uncaughtException', (e) => console.error('  [erro inesperado]', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('  [promessa rejeitada]', e));

main().catch((e) => { console.error('\n  Falha ao iniciar o F.O.G.O.:', e); process.exit(1); });
