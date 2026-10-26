'use strict';
/**
 * Camada de banco de dados.
 *
 * Usamos SQLite compilado para WebAssembly (sql.js, incluído em server/vendor).
 * Motivo: SQL de verdade, com schema, índices e transações, sem exigir que o
 * avaliador instale banco nem compile módulo nativo. O banco vive em memória e é
 * persistido em data/fogo.sqlite (escrita atômica, com debounce).
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('./vendor/sql-wasm.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'fogo.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);

CREATE TABLE IF NOT EXISTS bairros (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, zona TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, cep TEXT, ruas TEXT
);

CREATE TABLE IF NOT EXISTS equipamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, serie TEXT NOT NULL UNIQUE, marca TEXT, modelo TEXT, orgao TEXT NOT NULL,
  cep TEXT, rua TEXT, referencia TEXT, bairro_id INTEGER REFERENCES bairros(id),
  cidade TEXT NOT NULL DEFAULT 'Marília', uf TEXT NOT NULL DEFAULT 'SP',
  lat REAL NOT NULL, lng REAL NOT NULL,
  situacao TEXT NOT NULL, manut_tipo TEXT NOT NULL DEFAULT 'nenhuma',
  manut_data INTEGER, manut_periodicidade_dias INTEGER,
  instalado_em INTEGER, ultima_manut INTEGER,
  atributos TEXT NOT NULL DEFAULT '{}',
  ultimo_sinal INTEGER, criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_eq_tipo ON equipamentos(tipo);
CREATE INDEX IF NOT EXISTS ix_eq_situacao ON equipamentos(situacao);
CREATE INDEX IF NOT EXISTS ix_eq_bairro ON equipamentos(bairro_id);

CREATE TABLE IF NOT EXISTS agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, matricula TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, orgao TEXT NOT NULL,
  turno TEXT NOT NULL, status TEXT NOT NULL, telefone TEXT,
  bairro_id INTEGER REFERENCES bairros(id), lat REAL, lng REAL,
  veiculo_id INTEGER REFERENCES equipamentos(id), ocorrencia_id INTEGER,
  criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ocorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, bairro_id INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  inicio INTEGER NOT NULL, fim INTEGER, status TEXT NOT NULL, origem TEXT NOT NULL,
  agente_id INTEGER, descricao TEXT, exercicio INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_oc_inicio ON ocorrencias(inicio);
CREATE INDEX IF NOT EXISTS ix_oc_bairro ON ocorrencias(bairro_id, inicio);

CREATE TABLE IF NOT EXISTS clima (hora INTEGER PRIMARY KEY, chuva_mm REAL NOT NULL, previsao INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS eventos_cidade (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, local TEXT, bairro_id INTEGER,
  inicio INTEGER NOT NULL, fim INTEGER NOT NULL, publico_estimado INTEGER
);

CREATE TABLE IF NOT EXISTS manutencoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, equipamento_id INTEGER NOT NULL,
  data INTEGER NOT NULL, tipo TEXT NOT NULL, motivo TEXT
);
CREATE INDEX IF NOT EXISTS ix_man_eq ON manutencoes(equipamento_id, data);

CREATE TABLE IF NOT EXISTS telemetria_diaria (
  equipamento_id INTEGER NOT NULL, dia INTEGER NOT NULL,
  disponibilidade REAL NOT NULL, leituras INTEGER NOT NULL, erros INTEGER NOT NULL,
  PRIMARY KEY (equipamento_id, dia)
);

CREATE TABLE IF NOT EXISTS situacao_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT, equipamento_id INTEGER NOT NULL,
  ts INTEGER NOT NULL, de TEXT, para TEXT NOT NULL, motivo TEXT
);
CREATE INDEX IF NOT EXISTS ix_sh_eq ON situacao_historico(equipamento_id, ts);

CREATE TABLE IF NOT EXISTS recomendacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, tipo TEXT NOT NULL,
  titulo TEXT NOT NULL, detalhes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendente',
  decidido_por TEXT, decidido_em INTEGER
);

CREATE TABLE IF NOT EXISTS alertas (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, dados TEXT NOT NULL, reconhecido INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ator TEXT NOT NULL,
  acao TEXT NOT NULL, entidade TEXT NOT NULL, entidade_id INTEGER, detalhes TEXT
);
CREATE INDEX IF NOT EXISTS ix_aud_ts ON auditoria(ts);
`;

class Db {
  constructor(SQL, bytes) {
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run(SCHEMA);
    this._saveTimer = null;
    this._stmts = new Map();
  }

  _prep(sql) {
    let s = this._stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }

  /** Executa um comando (INSERT/UPDATE/DELETE). Retorna o último id inserido. */
  run(sql, params = []) {
    const s = this._prep(sql);
    s.bind(params); s.step(); s.reset();
    this.dirty();
    return this.lastId();
  }

  lastId() {
    const r = this._prep('SELECT last_insert_rowid() AS id'); r.step();
    const id = r.getAsObject().id; r.reset();
    return id;
  }

  all(sql, params = []) {
    const s = this._prep(sql);
    s.bind(params);
    const out = [];
    while (s.step()) out.push(s.getAsObject());
    s.reset();
    return out;
  }

  get(sql, params = []) { return this.all(sql, params)[0]; }

  /** Agrupa várias escritas em uma transação (muito mais rápido no seed). */
  tx(fn) {
    this.db.run('BEGIN');
    try { const r = fn(); this.db.run('COMMIT'); this.dirty(); return r; }
    catch (e) { this.db.run('ROLLBACK'); throw e; }
  }

  dirty() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try { this.save(); } catch (e) { console.error('  [aviso] não foi possível salvar o banco agora:', e.message); }
    }, 20000);
  }

  /** Escrita atômica: grava em arquivo temporário e renomeia. */
  save() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const bytes = Buffer.from(this.db.export());
    this._stmts.clear(); // export() fecha os statements preparados no sql.js
    this.db.run('PRAGMA foreign_keys = ON;'); // e reabre a conexão com pragmas padrão
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, bytes);
    try {
      fs.renameSync(tmp, DB_FILE);
    } catch {
      // No Windows, antivírus/indexador podem travar o arquivo por instantes: grava direto.
      fs.writeFileSync(DB_FILE, bytes);
      try { fs.unlinkSync(tmp); } catch { /* ignora */ }
    }
  }

  getMeta(chave) { const r = this.get('SELECT valor FROM meta WHERE chave = ?', [chave]); return r ? r.valor : null; }
  setMeta(chave, valor) { this.run('INSERT INTO meta(chave, valor) VALUES(?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', [chave, String(valor)]); }
}

async function openDb({ reset = false } = {}) {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(__dirname, 'vendor', f) });
  if (reset && fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const existe = fs.existsSync(DB_FILE);
  const db = new Db(SQL, existe ? fs.readFileSync(DB_FILE) : null);
  return { db, novo: !existe };
}

module.exports = { openDb, DB_FILE };
