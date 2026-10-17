const { db, getCfg } = require('./db');
const meta = require('./meta');
const { gerar } = require('./regras');
const exp = require('./experimento');

const dia = d => d.toISOString().slice(0, 10);
const somaDias = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const ehMsg = a => /CONVERSATIONS|REPLIES|MESSAG/i.test(a.optimization_goal || '') || /MESSAG/i.test((a.campaign || {}).objective || '');

async function sincronizar() {
  try {
    const cfg = getCfg();
    const dias = Math.max(14, Number(cfg.janela_dias) * 2 + 1);
    const [adsets, ads, ins] = await Promise.all([meta.listarAdsets(), meta.listarAds(), meta.listarInsights(dias)]);
    const agora = new Date().toISOString();
    db.transaction(() => {
      const up = db.prepare(`INSERT INTO adsets (id, campanha_id, campanha, nome, objetivo, meta_otimizacao, tipo, status, status_efetivo, orcamento_cent, criado_meta, atualizado_em)
        VALUES (@id, @cid, @camp, @nome, @obj, @meta, @tipo, @st, @se, @orc, @cr, @agora)
        ON CONFLICT(id) DO UPDATE SET campanha_id=@cid, campanha=@camp, nome=@nome, objetivo=@obj, meta_otimizacao=@meta,
          tipo = CASE WHEN tipo_manual = 1 THEN tipo ELSE @tipo END, status=@st, status_efetivo=@se, orcamento_cent=@orc, criado_meta=@cr, atualizado_em=@agora`);
      for (const a of adsets) up.run({ id: a.id, cid: a.campaign_id || '', camp: (a.campaign || {}).name || '', nome: a.name || '', obj: (a.campaign || {}).objective || '', meta: a.optimization_goal || '',
        tipo: ehMsg(a) ? 'msg' : 'site', st: a.status || '', se: a.effective_status || '', orc: a.daily_budget != null ? Number(a.daily_budget) : null, cr: a.created_time || null, agora });
      const ua = db.prepare(`INSERT INTO ads (id, adset_id, nome, status, status_efetivo) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET adset_id=excluded.adset_id, nome=excluded.nome, status=excluded.status, status_efetivo=excluded.status_efetivo`);
      for (const a of ads) ua.run(a.id, a.adset_id || '', a.name || '', a.status || '', a.effective_status || '');
      const ui = db.prepare(`INSERT INTO insights (dia, ad_id, adset_id, gasto, impressoes, cliques, alcance, msgs, vendas, valor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dia, ad_id) DO UPDATE SET gasto=excluded.gasto, impressoes=excluded.impressoes, cliques=excluded.cliques, alcance=excluded.alcance, msgs=excluded.msgs, vendas=excluded.vendas, valor=excluded.valor`);
      for (const r of ins) { const x = meta.resultados(r); ui.run(r.date_start, r.ad_id, r.adset_id, Number(r.spend) || 0, Number(r.impressions) || 0, Number(r.clicks) || 0, Number(r.reach) || 0, x.msgs, x.vendas, x.valor); }
    })();
    const novas = gerarSugestoes() + exp.avaliarRodando();
    db.prepare('INSERT INTO sync_log (ok, msg) VALUES (1, ?)').run(`${adsets.length} conjuntos, ${ads.length} anúncios, ${ins.length} linhas; ${novas} sugestão(ões) nova(s)`);
    return { adsets: adsets.length, ads: ads.length, linhas: ins.length, novas };
  } catch (e) { db.prepare('INSERT INTO sync_log (ok, msg) VALUES (0, ?)').run(e.message); throw e; }
}

function somar(adsetId, de, ate, adId) {
  const r = db.prepare(`SELECT COALESCE(SUM(gasto),0) gasto, COALESCE(SUM(impressoes),0) imp, COALESCE(SUM(cliques),0) cliques, COALESCE(SUM(alcance),0) alcance,
      COALESCE(SUM(msgs),0) msgs, COALESCE(SUM(vendas),0) vendas, COALESCE(SUM(valor),0) valor FROM insights
      WHERE dia >= ? AND dia <= ? ${adId ? 'AND ad_id = ?' : 'AND adset_id = ?'}`).get(de, ate, adId || adsetId);
  return r;
}
const resDe = (tipo, r) => (tipo === 'msg' ? r.msgs : r.vendas);

function montar(diasJanela) {
  const hoje = new Date(), n = diasJanela;
  const de = dia(somaDias(hoje, -(n - 1))), ate = dia(hoje), deAnt = dia(somaDias(hoje, -(2 * n - 1))), ateAnt = dia(somaDias(hoje, -n));
  return db.prepare('SELECT * FROM adsets').all().map(a => {
    const j = somar(a.id, de, ate), p = somar(a.id, deAnt, ateAnt);
    const ads = db.prepare('SELECT * FROM ads WHERE adset_id = ?').all(a.id).map(d => { const x = somar(null, de, ate, d.id); return { id: d.id, nome: d.nome, status: d.status, gasto: x.gasto, res: resDe(a.tipo, x), imp: x.imp, cliques: x.cliques }; });
    return { id: a.id, experimento_id: a.experimento_id, campanha: a.campanha, nome: a.nome, tipo: a.tipo, status: a.status, status_efetivo: a.status_efetivo, orcamento: a.orcamento_cent != null ? a.orcamento_cent / 100 : null,
      horas_vida: a.criado_meta ? (Date.now() - new Date(a.criado_meta).getTime()) / 36e5 : null,
      j: { gasto: j.gasto, res: resDe(a.tipo, j), valor: j.valor, imp: j.imp, cliques: j.cliques, alcance: j.alcance }, ant: { imp: p.imp, cliques: p.cliques }, ads };
  });
}

function gerarSugestoes() {
  const cfg = getCfg();
  const mexeu = {};
  for (const r of db.prepare(`SELECT alvo_id FROM acoes WHERE tipo = 'orcamento' AND ok = 1 AND desfeita = 0 AND criado_em >= datetime('now', ?)`).all(`-${Number(cfg.espera_horas) || 72} hours`)) mexeu[r.alvo_id] = true;
  const lista = gerar(montar(Number(cfg.janela_dias) || 3).filter(a => !a.experimento_id), cfg, { mexeuOrcamento: mexeu });
  // uma pendente por alvo+tipo; as pendentes que deixaram de valer são arquivadas
  const chaves = new Set(lista.map(s => s.alvo_id + '|' + s.tipo));
  for (const p of db.prepare("SELECT id, alvo_id, tipo FROM sugestoes WHERE status = 'pendente' AND origem = 'regra'").all()) if (!chaves.has(p.alvo_id + '|' + p.tipo)) db.prepare("UPDATE sugestoes SET status = 'expirada', resolvido_em = datetime('now') WHERE id = ?").run(p.id);
  let novas = 0;
  for (const s of lista) {
    const ja = db.prepare("SELECT id FROM sugestoes WHERE status = 'pendente' AND origem = 'regra' AND alvo_id = ? AND tipo = ?").get(s.alvo_id, s.tipo);
    if (ja) { db.prepare('UPDATE sugestoes SET titulo=?, motivo=?, params=?, economia=? WHERE id=?').run(s.titulo, s.motivo, JSON.stringify(s.params), s.economia, ja.id); continue; }
    // não repete algo que você acabou de rejeitar (24h)
    if (db.prepare("SELECT 1 FROM sugestoes WHERE status = 'rejeitada' AND alvo_id = ? AND tipo = ? AND resolvido_em >= datetime('now','-24 hours')").get(s.alvo_id, s.tipo)) continue;
    db.prepare('INSERT INTO sugestoes (tipo, alvo_id, alvo_nome, titulo, motivo, params, economia) VALUES (?, ?, ?, ?, ?, ?, ?)').run(s.tipo, s.alvo_id, s.alvo_nome, s.titulo, s.motivo, JSON.stringify(s.params), s.economia);
    novas++;
  }
  return novas;
}

// Aplica uma sugestão aprovada, com travas de segurança, e guarda o "antes" para poder desfazer.
async function aplicar(sug) {
  const cfg = getCfg(); const p = JSON.parse(sug.params || '{}');
  let antes = {}, depois = {};
  try {
    if (sug.tipo === 'aviso') { antes = {}; depois = { visto: true }; }
    else if (sug.tipo === 'pausar_adset' || sug.tipo === 'pausar_ad') {
      antes = { status: 'ACTIVE' }; depois = { status: 'PAUSED' }; await meta.pausar(sug.alvo_id);
      db.prepare(`UPDATE ${sug.tipo === 'pausar_adset' ? 'adsets' : 'ads'} SET status = 'PAUSED', status_efetivo = 'PAUSED' WHERE id = ?`).run(sug.alvo_id);
    } else if (sug.tipo === 'orcamento') {
      const a = db.prepare('SELECT * FROM adsets WHERE id = ?').get(sug.alvo_id); if (!a || a.orcamento_cent == null) throw new Error('Conjunto sem verba diária própria (verba no nível da campanha). Ajuste direto no Gerenciador.');
      const atual = a.orcamento_cent / 100, novo = Number(p.para);
      if (!(novo > 0)) throw new Error('Valor de verba inválido.');
      if (novo > atual * (1 + Math.min(50, Number(cfg.passo_escala_pct) || 20) / 100) + 0.01) throw new Error('Trava de segurança: aumento acima do passo máximo permitido.');
      if (Number(cfg.orcamento_max_adset) && novo > Number(cfg.orcamento_max_adset)) throw new Error('Trava de segurança: acima do teto por conjunto.');
      antes = { orcamento_cent: a.orcamento_cent }; depois = { orcamento_cent: Math.round(novo * 100) };
      await meta.orcamento(sug.alvo_id, depois.orcamento_cent);
      db.prepare('UPDATE adsets SET orcamento_cent = ? WHERE id = ?').run(depois.orcamento_cent, sug.alvo_id);
    } else throw new Error('Tipo de ação desconhecido.');
    db.prepare('INSERT INTO acoes (sugestao_id, tipo, alvo_id, alvo_nome, antes, depois, ok) VALUES (?, ?, ?, ?, ?, ?, 1)').run(sug.id, sug.tipo, sug.alvo_id, sug.alvo_nome, JSON.stringify(antes), JSON.stringify(depois));
    db.prepare("UPDATE sugestoes SET status = 'aplicada', resolvido_em = datetime('now') WHERE id = ?").run(sug.id);
    return { ok: true };
  } catch (e) {
    db.prepare('INSERT INTO acoes (sugestao_id, tipo, alvo_id, alvo_nome, antes, depois, ok, erro) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(sug.id, sug.tipo, sug.alvo_id, sug.alvo_nome, JSON.stringify(antes), JSON.stringify(depois), e.message);
    throw e;
  }
}
async function desfazer(ac) {
  const antes = JSON.parse(ac.antes || '{}');
  if (ac.tipo === 'orcamento') { await meta.orcamento(ac.alvo_id, antes.orcamento_cent); db.prepare('UPDATE adsets SET orcamento_cent = ? WHERE id = ?').run(antes.orcamento_cent, ac.alvo_id); }
  else if (ac.tipo === 'pausar_adset' || ac.tipo === 'pausar_ad') { await meta.ativar(ac.alvo_id); db.prepare(`UPDATE ${ac.tipo === 'pausar_adset' ? 'adsets' : 'ads'} SET status = 'ACTIVE', status_efetivo = 'ACTIVE' WHERE id = ?`).run(ac.alvo_id); }
  db.prepare('UPDATE acoes SET desfeita = 1 WHERE id = ?').run(ac.id);
}

function resumo(n) {
  const hoje = new Date(), de = dia(somaDias(hoje, -(n - 1)));
  const tot = db.prepare(`SELECT COALESCE(SUM(i.gasto),0) gasto, COALESCE(SUM(i.impressoes),0) imp, COALESCE(SUM(i.cliques),0) cliques,
      COALESCE(SUM(CASE WHEN a.tipo='msg' THEN i.msgs END),0) msgs, COALESCE(SUM(CASE WHEN a.tipo='site' THEN i.vendas END),0) vendas,
      COALESCE(SUM(CASE WHEN a.tipo='site' THEN i.valor END),0) valor,
      COALESCE(SUM(CASE WHEN a.tipo='msg' THEN i.gasto END),0) gasto_msg, COALESCE(SUM(CASE WHEN a.tipo='site' THEN i.gasto END),0) gasto_site
      FROM insights i LEFT JOIN adsets a ON a.id = i.adset_id WHERE i.dia >= ?`).get(de);
  const porDia = db.prepare(`SELECT i.dia, SUM(i.gasto) gasto, SUM(CASE WHEN a.tipo='msg' THEN i.msgs ELSE i.vendas END) res FROM insights i LEFT JOIN adsets a ON a.id = i.adset_id WHERE i.dia >= ? GROUP BY i.dia ORDER BY i.dia`).all(de);
  const cfg = getCfg();
  return { dias: n, ...tot, cpa_msg: tot.msgs ? tot.gasto_msg / tot.msgs : null, cpa_site: tot.vendas ? tot.gasto_site / tot.vendas : null, roas: tot.gasto_site && tot.valor ? tot.valor / tot.gasto_site : null,
    meta_cpa_msg: Number(cfg.meta_cpa_msg), meta_cpa_site: Number(cfg.meta_cpa_site), por_dia: porDia,
    economia_possivel: db.prepare("SELECT COALESCE(SUM(economia),0) v FROM sugestoes WHERE status = 'pendente'").get().v };
}
module.exports = { sincronizar, gerarSugestoes, aplicar, desfazer, montar, resumo };
