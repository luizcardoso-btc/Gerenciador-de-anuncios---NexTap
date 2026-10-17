const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, getCfg, setCfg, PADRAO } = require('./db');
const meta = require('./meta');
const S = require('./servico');
const fs = require('fs');
const copy = require('./copy');
const T = require('./experimento');
const { dir: pastaDados } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => express.json({ limit: req.method === 'POST' && req.path === '/api/imagens' ? '12mb' : '200kb' })(req, res, next));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });

// ---- login simples por senha (token assinado, vale 12 h) ----
const senha = () => process.env.ADMIN_PASSWORD || '';
const segredo = () => crypto.createHash('sha256').update('adpilot|' + senha()).digest();
const assinar = exp => { const b = String(exp); return b + '.' + crypto.createHmac('sha256', segredo()).update(b).digest('hex'); };
const valido = t => { const [e, h] = String(t || '').split('.'); if (!e || !h || Number(e) < Date.now()) return false; const x = crypto.createHmac('sha256', segredo()).update(e).digest('hex'); return h.length === x.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(x)); };
const tentativas = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip, t = tentativas.get(ip) || { n: 0, ate: 0 };
  if (t.n >= 8 && Date.now() < t.ate) return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' });
  if (!senha()) return res.status(503).json({ error: 'Defina ADMIN_PASSWORD no Railway.' });
  const a = Buffer.from(String((req.body || {}).senha || '')), b = Buffer.from(senha());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { tentativas.set(ip, { n: t.n + 1, ate: Date.now() + 10 * 60000 }); return res.status(401).json({ error: 'Senha incorreta.' }); }
  tentativas.delete(ip); res.json({ token: assinar(Date.now() + 12 * 3600e3) });
});
const auth = (req, res, next) => valido((req.headers.authorization || '').replace(/^Bearer /, '')) ? next() : res.status(401).json({ error: 'Faça login.' });
const api = express.Router(); app.use('/api', auth, api);
const erro = (res, e, s = 502) => res.status(s).json({ error: e.message || String(e) });

api.get('/status', async (req, res) => {
  const last = db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get();
  let conta = null, contaErro = '';
  if (meta.configurado()) { try { conta = await meta.infoConta(); } catch (e) { contaErro = e.message; } }
  res.json({ meta: meta.configurado(), conta, contaErro, ultimo_sync: last || null, config: getCfg() });
});
api.post('/sync', async (req, res) => { try { res.json(await S.sincronizar()); } catch (e) { erro(res, e); } });
api.get('/resumo', (req, res) => res.json(S.resumo(Math.min(30, Math.max(1, Number(req.query.dias) || 7)))));
api.get('/conjuntos', (req, res) => res.json(S.montar(Math.min(30, Math.max(1, Number(req.query.dias) || 7)))));
api.put('/conjuntos/:id/tipo', (req, res) => {
  const t = (req.body || {}).tipo; if (!['msg', 'site'].includes(t)) return res.status(400).json({ error: 'Tipo deve ser msg ou site.' });
  const r = db.prepare('UPDATE adsets SET tipo = ?, tipo_manual = 1 WHERE id = ?').run(t, req.params.id); if (!r.changes) return res.status(404).json({ error: 'Conjunto não encontrado.' });
  S.gerarSugestoes(); res.json({ ok: true });
});
api.get('/sugestoes', (req, res) => {
  const st = req.query.status || 'pendente';
  res.json(db.prepare('SELECT * FROM sugestoes WHERE status = ? ORDER BY economia DESC, id DESC LIMIT 200').all(st).map(s => ({ ...s, params: JSON.parse(s.params || '{}') })));
});
api.post('/sugestoes/:id/aprovar', async (req, res) => {
  const s = db.prepare("SELECT * FROM sugestoes WHERE id = ? AND status = 'pendente'").get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sugestão não está mais pendente.' });
  try { res.json(await S.aplicar(s)); } catch (e) { erro(res, e); }
});
api.post('/sugestoes/:id/rejeitar', (req, res) => {
  const r = db.prepare("UPDATE sugestoes SET status = 'rejeitada', resolvido_em = datetime('now') WHERE id = ? AND status = 'pendente'").run(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Sugestão não está mais pendente.' });
});
api.get('/acoes', (req, res) => res.json(db.prepare('SELECT * FROM acoes ORDER BY id DESC LIMIT 100').all()));
api.post('/acoes/:id/desfazer', async (req, res) => {
  const a = db.prepare('SELECT * FROM acoes WHERE id = ? AND ok = 1 AND desfeita = 0').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Ação não encontrada ou já desfeita.' });
  try { await S.desfazer(a); res.json({ ok: true }); } catch (e) { erro(res, e); }
});
api.put('/config', (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) { if (!(k in PADRAO)) continue; const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `Valor inválido em ${k}.` }); setCfg(k, n); }
  res.json(getCfg());
});

// ---- criativos: biblioteca de imagens e gerador de textos ----
const pastaImg = path.join(pastaDados, 'imagens');
api.get('/imagens', (req, res) => res.json(db.prepare('SELECT id, nome, mime, hash_meta IS NOT NULL AS na_meta, criado_em FROM imagens ORDER BY id DESC').all()));
api.post('/imagens', (req, res) => {
  const b = req.body || {}, m = String(b.dados || '').match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Envie uma imagem PNG ou JPG.' });
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Imagem maior que 8 MB.' });
  const ext = m[1] === 'image/png' ? 'png' : 'jpg'; fs.mkdirSync(pastaImg, { recursive: true });
  const arq = path.join(pastaImg, crypto.randomBytes(8).toString('hex') + '.' + ext); fs.writeFileSync(arq, buf);
  const id = db.prepare('INSERT INTO imagens (nome, arquivo, mime) VALUES (?, ?, ?)').run(String(b.nome || 'imagem').slice(0, 80), arq, m[1]).lastInsertRowid; res.json({ id });
});
api.get('/imagens/:id/arquivo', (req, res) => { const i = db.prepare('SELECT * FROM imagens WHERE id = ?').get(req.params.id); if (!i || !fs.existsSync(i.arquivo)) return res.status(404).end(); res.type(i.mime).sendFile(i.arquivo); });
api.delete('/imagens/:id', (req, res) => {
  if (db.prepare('SELECT 1 FROM variacoes v JOIN experimentos e ON e.id = v.experimento_id WHERE v.imagem_id = ? AND e.status NOT IN (\'descartado\')').get(req.params.id)) return res.status(409).json({ error: 'Esta imagem está em um teste.' });
  const i = db.prepare('SELECT * FROM imagens WHERE id = ?').get(req.params.id); if (!i) return res.status(404).json({ error: 'Imagem não encontrada.' });
  try { fs.unlinkSync(i.arquivo); } catch (_) {} db.prepare('DELETE FROM imagens WHERE id = ?').run(i.id); res.json({ ok: true });
});
api.post('/copy', async (req, res) => { try { res.json(await copy.gerar(req.body || {})); } catch (e) { erro(res, e, 400); } });

// ---- testes A/B ----
api.get('/testes', (req, res) => res.json(db.prepare('SELECT id FROM experimentos ORDER BY id DESC LIMIT 50').all().map(x => T.detalhe(x.id))));
api.post('/testes', (req, res) => { try { res.json(T.detalhe(T.criarRascunho(req.body || {}))); } catch (e) { erro(res, e, 400); } });
api.post('/testes/:id/criar', async (req, res) => { try { res.json(await T.criarNaMeta(Number(req.params.id))); } catch (e) { erro(res, e); } });
api.post('/testes/:id/publicar', async (req, res) => { try { res.json(await T.publicar(Number(req.params.id))); } catch (e) { erro(res, e); } });
api.post('/testes/:id/descartar', async (req, res) => { try { await T.descartar(Number(req.params.id)); res.json({ ok: true }); } catch (e) { erro(res, e); } });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'panel.html')));
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('AdPilot na porta ' + PORT));
  // sincroniza sozinho a cada 6 horas (só lê dados e gera sugestões; nada é alterado sem você aprovar)
  if (process.env.NODE_ENV !== 'test') setInterval(() => { if (meta.configurado()) S.sincronizar().catch(e => console.error('[sync]', e.message)); }, 6 * 3600e3).unref();
}
module.exports = app;
