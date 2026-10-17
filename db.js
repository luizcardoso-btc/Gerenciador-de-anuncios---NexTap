const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const emMemoria = process.env.DB_PATH === ':memory:';
const dir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!emMemoria) fs.mkdirSync(dir, { recursive: true });
const db = new Database(emMemoria ? ':memory:' : (process.env.DB_PATH || path.join(dir, 'adpilot.db')));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS adsets (
  id TEXT PRIMARY KEY, campanha_id TEXT, campanha TEXT, nome TEXT, objetivo TEXT, meta_otimizacao TEXT,
  tipo TEXT NOT NULL DEFAULT 'site', tipo_manual INTEGER NOT NULL DEFAULT 0,
  status TEXT, status_efetivo TEXT, orcamento_cent INTEGER, criado_meta TEXT, atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS ads (id TEXT PRIMARY KEY, adset_id TEXT, nome TEXT, status TEXT, status_efetivo TEXT);
CREATE TABLE IF NOT EXISTS insights (
  dia TEXT NOT NULL, ad_id TEXT NOT NULL, adset_id TEXT NOT NULL,
  gasto REAL NOT NULL DEFAULT 0, impressoes INTEGER NOT NULL DEFAULT 0, cliques INTEGER NOT NULL DEFAULT 0, alcance INTEGER NOT NULL DEFAULT 0,
  msgs INTEGER NOT NULL DEFAULT 0, vendas INTEGER NOT NULL DEFAULT 0, valor REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_ins_adset ON insights(adset_id, dia);
CREATE TABLE IF NOT EXISTS sugestoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, alvo_id TEXT NOT NULL, alvo_nome TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL, motivo TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '{}', economia REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente', criado_em TEXT NOT NULL DEFAULT (datetime('now')), resolvido_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_sug ON sugestoes(status, alvo_id, tipo);
CREATE TABLE IF NOT EXISTS acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sugestao_id INTEGER, tipo TEXT NOT NULL, alvo_id TEXT NOT NULL, alvo_nome TEXT NOT NULL DEFAULT '',
  antes TEXT NOT NULL DEFAULT '{}', depois TEXT NOT NULL DEFAULT '{}', ok INTEGER NOT NULL DEFAULT 0, erro TEXT NOT NULL DEFAULT '',
  desfeita INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ok INTEGER NOT NULL, msg TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL DEFAULT (datetime('now')));
`);


db.exec(`
CREATE TABLE IF NOT EXISTS imagens (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, arquivo TEXT NOT NULL, mime TEXT NOT NULL, hash_meta TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS experimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, objetivo TEXT NOT NULL DEFAULT 'msg', status TEXT NOT NULL DEFAULT 'rascunho',
  orcamento_dia REAL NOT NULL, dias INTEGER NOT NULL DEFAULT 5, publico TEXT NOT NULL DEFAULT '{}', destino TEXT NOT NULL DEFAULT '{}',
  campanha_id TEXT, inicio TEXT, resultado TEXT NOT NULL DEFAULT '{}', erro TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS variacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, experimento_id INTEGER NOT NULL, rotulo TEXT NOT NULL DEFAULT '', angulo TEXT NOT NULL DEFAULT '', imagem_id INTEGER,
  titulo TEXT NOT NULL DEFAULT '', texto TEXT NOT NULL DEFAULT '', cta TEXT NOT NULL DEFAULT '', adset_id TEXT, ad_id TEXT, creative_id TEXT, orcamento_cent INTEGER
);
CREATE INDEX IF NOT EXISTS idx_var_exp ON variacoes(experimento_id);
`);
if (!db.prepare('PRAGMA table_info(sugestoes)').all().some(c => c.name === 'origem')) db.exec("ALTER TABLE sugestoes ADD COLUMN origem TEXT NOT NULL DEFAULT 'regra'");
if (!db.prepare("PRAGMA table_info(adsets)").all().some(c => c.name === 'experimento_id')) db.exec('ALTER TABLE adsets ADD COLUMN experimento_id INTEGER');

// Metas e limites (valores na moeda da conta; tudo editável no painel)
const PADRAO = {
  meta_cpa_msg: '8',            // custo máximo aceitável por conversa iniciada
  meta_cpa_site: '40',          // custo máximo aceitável por compra/lead no site
  roas_min: '2',                // retorno mínimo (vendas ÷ gasto) nas campanhas de site com valor
  janela_dias: '3',             // período usado para decidir
  espera_horas: '72',           // não mexe em conjunto criado há menos que isso (fase de aprendizado)
  passo_escala_pct: '20',       // aumento máximo de verba por vez
  orcamento_max_adset: '0',     // teto de verba diária por conjunto (0 = sem teto)
  orcamento_max_total: '0',     // teto da soma de verbas diárias (0 = sem teto)
  freq_max: '3.5',
  teste_max_dia: '100',         // teto de verba diária somada de um teste (trava de segurança)
  teste_min_variacao: '6',      // verba diária mínima por variação do teste
  teste_dias: '5',              // duração padrão de um teste              // frequência a partir da qual avisa fadiga
};
const getCfg = () => { const o = { ...PADRAO }; for (const r of db.prepare('SELECT chave, valor FROM config').all()) if (r.chave in PADRAO) o[r.chave] = r.valor; return o; };
const setCfg = (k, v) => { if (k in PADRAO) db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, String(v)); };

module.exports = { db, dir, getCfg, setCfg, PADRAO };
