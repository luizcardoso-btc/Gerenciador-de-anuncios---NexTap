const fs = require('fs');
const { db, getCfg } = require('./db');
const meta = require('./meta');

const dia = d => d.toISOString().slice(0, 10);
const jp = s => { try { return JSON.parse(s || '{}'); } catch (_) { return {}; } };
const OBJ = { msg: { campanha: 'OUTCOME_ENGAGEMENT', otimizacao: 'CONVERSATIONS', destino: 'INSTAGRAM_DIRECT' }, site: { campanha: 'OUTCOME_TRAFFIC', otimizacao: 'LANDING_PAGE_VIEWS', destino: 'WEBSITE' } };

function validar(b) {
  const cfg = getCfg(); const obj = b.objetivo === 'site' ? 'site' : 'msg';
  const nome = String(b.nome || '').trim().slice(0, 80); if (!nome) throw new Error('Dê um nome ao teste.');
  const orc = Number(String(b.orcamento_dia).replace(',', '.')); if (!(orc > 0)) throw new Error('Informe a verba diária total do teste.');
  if (Number(cfg.teste_max_dia) && orc > Number(cfg.teste_max_dia)) throw new Error(`Trava de segurança: a verba diária do teste passa do limite de R$ ${cfg.teste_max_dia}. Ajuste o limite na aba Metas se for isso mesmo que você quer.`);
  const vars = (b.variacoes || []).filter(v => v && v.titulo && v.texto); if (vars.length < 2) throw new Error('Um teste precisa de pelo menos 2 variações (texto e título).');
  if (vars.length > 6) throw new Error('No máximo 6 variações por teste.');
  const porVar = orc / vars.length; if (porVar < Number(cfg.teste_min_variacao)) throw new Error(`Cada variação ficaria com R$ ${porVar.toFixed(2)} por dia, abaixo do mínimo de R$ ${cfg.teste_min_variacao}. Aumente a verba ou reduza as variações.`);
  const dias = Math.min(21, Math.max(2, Number(b.dias) || Number(cfg.teste_dias) || 5));
  const destino = { link: String(b.link || '').trim() }; if (obj === 'site' && !/^https:\/\//.test(destino.link)) throw new Error('Para teste de site, informe o link começando com https://');
  const pub = { cidade_lat: Number(b.lat) || null, cidade_lng: Number(b.lng) || null, raio_km: Math.min(80, Math.max(1, Number(b.raio_km) || 15)), idade_min: Math.max(18, Number(b.idade_min) || 18), idade_max: Math.min(65, Number(b.idade_max) || 65) };
  return { obj, nome, orc, vars, dias, destino, pub };
}
function criarRascunho(b) {
  const v = validar(b);
  return db.transaction(() => {
    const id = db.prepare('INSERT INTO experimentos (nome, objetivo, orcamento_dia, dias, publico, destino) VALUES (?, ?, ?, ?, ?, ?)').run(v.nome, v.obj, v.orc, v.dias, JSON.stringify(v.pub), JSON.stringify(v.destino)).lastInsertRowid;
    const ins = db.prepare('INSERT INTO variacoes (experimento_id, rotulo, angulo, imagem_id, titulo, texto, cta) VALUES (?, ?, ?, ?, ?, ?, ?)');
    v.vars.forEach((x, i) => { if (x.imagem_id && !db.prepare('SELECT 1 FROM imagens WHERE id = ?').get(x.imagem_id)) throw new Error('Imagem não encontrada.');
      ins.run(id, String.fromCharCode(65 + i), String(x.angulo || ''), x.imagem_id || null, String(x.titulo).slice(0, 40), String(x.texto).slice(0, 180), v.obj === 'site' ? 'LEARN_MORE' : 'SEND_MESSAGE'); });
    return id;
  })();
}
const detalhe = id => { const e = db.prepare('SELECT * FROM experimentos WHERE id = ?').get(id); if (!e) return null; return { ...e, publico: jp(e.publico), destino: jp(e.destino), resultado: jp(e.resultado), variacoes: db.prepare('SELECT * FROM variacoes WHERE experimento_id = ? ORDER BY id').all(id) }; };

// Cria tudo na Meta, PAUSADO. Se algo falhar no meio, apaga o que foi criado e guarda o erro (nada fica "pela metade" gastando).
async function criarNaMeta(id) {
  const e = detalhe(id); if (!e) throw new Error('Teste não encontrado.'); if (e.status !== 'rascunho' && e.status !== 'erro') throw new Error('Este teste já foi criado na Meta.');
  const pagina = meta.idPagina(); if (!pagina) throw new Error('Falta a variável META_PAGE_ID (ID da sua Página do Facebook ligada ao Instagram).');
  if (e.objetivo === 'msg' && !meta.idInsta()) throw new Error('Falta a variável META_INSTAGRAM_ID (ID da conta do Instagram nos anúncios).');
  for (const v of e.variacoes) if (!v.imagem_id) throw new Error(`A variação ${v.rotulo} está sem imagem.`);
  const o = OBJ[e.objetivo], cfg = getCfg(); const porVar = Math.round(e.orcamento_dia / e.variacoes.length * 100);
  let campanha = null;
  try {
    campanha = (await meta.criarCampanha({ nome: `[TESTE] ${e.nome}`, objetivo: o.campanha })).id;
    db.prepare('UPDATE experimentos SET campanha_id = ?, erro = ? WHERE id = ?').run(campanha, '', id);
    const pub = e.publico;
    const targeting = { age_min: pub.idade_min, age_max: pub.idade_max, targeting_automation: { advantage_audience: 0 },
      geo_locations: pub.cidade_lat ? { custom_locations: [{ latitude: pub.cidade_lat, longitude: pub.cidade_lng, radius: pub.raio_km, distance_unit: 'kilometer' }] } : { countries: ['BR'] },
      publisher_platforms: ['instagram'], instagram_positions: ['stream', 'story', 'reels'] };
    for (const v of e.variacoes) {
      const img = db.prepare('SELECT * FROM imagens WHERE id = ?').get(v.imagem_id); if (!img) throw new Error(`Imagem da variação ${v.rotulo} não existe mais.`);
      let hash = img.hash_meta; if (!hash) { hash = await meta.subirImagem(img.nome, fs.readFileSync(img.arquivo).toString('base64')); db.prepare('UPDATE imagens SET hash_meta = ? WHERE id = ?').run(hash, img.id); }
      const adset = (await meta.criarConjunto({ nome: `${e.nome} · ${v.rotulo}`, campanha_id: campanha, orcamento_cent: porVar, otimizacao: o.otimizacao, destino_tipo: o.destino,
        promoted: e.objetivo === 'msg' ? { page_id: pagina } : undefined, targeting })).id;
      db.prepare('UPDATE variacoes SET adset_id = ?, orcamento_cent = ? WHERE id = ?').run(adset, porVar, v.id);
      const cta = e.objetivo === 'msg' ? { type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT' } } : { type: 'LEARN_MORE', value: { link: e.destino.link } };
      const criativo = (await meta.criarCriativo({ nome: `${e.nome} · ${v.rotulo}`, page_id: pagina, instagram_id: meta.idInsta(), hash, link: e.objetivo === 'msg' ? 'https://www.instagram.com/' : e.destino.link, texto: v.texto, titulo: v.titulo, cta })).id;
      const anuncio = (await meta.criarAnuncio({ nome: `${e.nome} · ${v.rotulo}`, adset_id: adset, creative_id: criativo })).id;
      db.prepare('UPDATE variacoes SET creative_id = ?, ad_id = ? WHERE id = ?').run(criativo, anuncio, v.id);
      db.prepare('INSERT INTO adsets (id, campanha_id, campanha, nome, tipo, status, status_efetivo, orcamento_cent, experimento_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET experimento_id = excluded.experimento_id')
        .run(adset, campanha, `[TESTE] ${e.nome}`, `${e.nome} · ${v.rotulo}`, e.objetivo, 'PAUSED', 'PAUSED', porVar, id);
    }
    db.prepare("UPDATE experimentos SET status = 'criado' WHERE id = ?").run(id);
    return detalhe(id);
  } catch (err) {
    if (campanha) { try { await meta.apagar(campanha); } catch (_) {} }
    db.prepare("UPDATE variacoes SET adset_id = NULL, ad_id = NULL, creative_id = NULL WHERE experimento_id = ?").run(id);
    db.prepare("DELETE FROM adsets WHERE experimento_id = ?").run(id);
    db.prepare("UPDATE experimentos SET status = 'erro', erro = ?, campanha_id = NULL WHERE id = ?").run(err.message, id);
    throw err;
  }
}
// Liga o teste (campanha, conjuntos e anúncios). Só depois disso começa a gastar.
async function publicar(id) {
  const e = detalhe(id); if (!e || e.status !== 'criado') throw new Error('Só dá para publicar um teste que já foi criado na Meta e ainda não está rodando.');
  await meta.ativar(e.campanha_id);
  for (const v of e.variacoes) { await meta.ativar(v.adset_id); await meta.ativar(v.ad_id); db.prepare("UPDATE adsets SET status = 'ACTIVE', status_efetivo = 'ACTIVE' WHERE id = ?").run(v.adset_id); }
  db.prepare("UPDATE experimentos SET status = 'rodando', inicio = ? WHERE id = ?").run(new Date().toISOString(), id);
  return detalhe(id);
}
async function descartar(id) {
  const e = detalhe(id); if (!e) throw new Error('Teste não encontrado.'); if (e.status === 'rodando') throw new Error('Pause ou conclua o teste antes de descartar.');
  if (e.campanha_id) await meta.apagar(e.campanha_id);
  db.prepare("DELETE FROM adsets WHERE experimento_id = ?").run(id); db.prepare("UPDATE experimentos SET status = 'descartado' WHERE id = ?").run(id);
}

// ---- Avaliação: quem venceu? ----
function avaliar(e, cfg, agora = new Date()) {
  const meta_ = Number(e.objetivo === 'msg' ? cfg.meta_cpa_msg : cfg.meta_cpa_site);
  const desde = (e.inicio || '').slice(0, 10) || dia(agora);
  const dec = (new Date(agora) - new Date(e.inicio || agora)) / 864e5;
  const linhas = e.variacoes.map(v => {
    const r = db.prepare('SELECT COALESCE(SUM(gasto),0) gasto, COALESCE(SUM(impressoes),0) imp, COALESCE(SUM(cliques),0) cliques, COALESCE(SUM(msgs),0) msgs, COALESCE(SUM(vendas),0) vendas FROM insights WHERE adset_id = ? AND dia >= ?').get(v.adset_id, desde);
    const res = e.objetivo === 'msg' ? r.msgs : r.cliques; // no teste de site mede custo por clique qualificado (visita à página)
    return { id: v.id, rotulo: v.rotulo, angulo: v.angulo, titulo: v.titulo, adset_id: v.adset_id, gasto: r.gasto, imp: r.imp, cliques: r.cliques, res, cpa: res > 0 ? r.gasto / res : null, ctr: r.imp ? r.cliques / r.imp : 0 };
  });
  const alvoRes = e.objetivo === 'msg' ? 5 : 30;
  const comDados = linhas.filter(l => l.cpa != null).sort((a, b) => a.cpa - b.cpa);
  const gastouTudo = linhas.every(l => l.gasto >= (e.objetivo === 'msg' ? 3 * meta_ : 15));
  const acabou = dec >= e.dias;
  if (!acabou && !gastouTudo) return { estado: 'aguardando', linhas, dias_rodados: Math.floor(dec), resumo: `Rodando há ${Math.floor(dec)} de ${e.dias} dias. Ainda juntando dados.` };
  if (!comDados.length || comDados[0].res < alvoRes) {
    if (dec >= e.dias + 3) return { estado: 'sem_dados', linhas, resumo: 'Poucos resultados mesmo depois do prazo: a oferta, o público ou o criativo precisam mudar antes de um novo teste.' };
    return { estado: 'aguardando', linhas, dias_rodados: Math.floor(dec), resumo: `O melhor ainda tem poucos resultados (precisa de ${alvoRes}). Vou esperar mais um pouco.` };
  }
  const [melhor, segundo] = comDados;
  if (segundo && melhor.cpa > 0.85 * segundo.cpa) return { estado: 'empate', vencedor_id: melhor.id, linhas, resumo: `Sem vencedor claro: o melhor (${melhor.rotulo}) custa só ${Math.round((1 - melhor.cpa / segundo.cpa) * 100)}% menos que o segundo. Mantenha os dois e teste outra ideia.` };
  return { estado: 'vencedor', vencedor_id: melhor.id, linhas, resumo: `A variação ${melhor.rotulo} venceu: ${melhor.cpa.toFixed(2).replace('.', ',')} por resultado${segundo ? ', contra ' + segundo.cpa.toFixed(2).replace('.', ',') + ' da segunda' : ''}.` };
}
// Roda depois de cada sincronização: conclui testes e transforma o resultado em SUGESTÕES (você aprova).
function avaliarRodando() {
  const cfg = getCfg(); const passo = Math.min(50, Math.max(5, Number(cfg.passo_escala_pct) || 20)) / 100; let n = 0;
  for (const x of db.prepare("SELECT id FROM experimentos WHERE status = 'rodando'").all()) {
    const e = detalhe(x.id), r = avaliar(e, cfg);
    db.prepare('UPDATE experimentos SET resultado = ? WHERE id = ?').run(JSON.stringify(r), e.id);
    if (r.estado === 'aguardando') continue;
    db.prepare("UPDATE experimentos SET status = 'concluido' WHERE id = ?").run(e.id); db.prepare('UPDATE adsets SET experimento_id = NULL WHERE experimento_id = ?').run(e.id);
    const ins = db.prepare("INSERT INTO sugestoes (tipo, alvo_id, alvo_nome, titulo, motivo, params, economia, origem) VALUES (?, ?, ?, ?, ?, ?, ?, 'teste')");
    if (r.estado === 'vencedor') {
      const venc = r.linhas.find(l => l.id === r.vencedor_id);
      for (const l of r.linhas) if (l.id !== venc.id) { ins.run('pausar_adset', l.adset_id, `${e.nome} · ${l.rotulo}`, `Pausar variação ${l.rotulo} do teste "${e.nome}"`, `Perdeu o teste: ${l.cpa ? l.cpa.toFixed(2).replace('.', ',') + ' por resultado' : 'nenhum resultado'} contra ${venc.cpa.toFixed(2).replace('.', ',')} da vencedora ${venc.rotulo}.`, '{}', (db.prepare('SELECT orcamento_cent FROM adsets WHERE id = ?').get(l.adset_id) || {}).orcamento_cent / 100 || 0); n++; }
      const a = db.prepare('SELECT orcamento_cent FROM adsets WHERE id = ?').get(venc.adset_id);
      if (a && a.orcamento_cent) { const atual = a.orcamento_cent / 100; ins.run('orcamento', venc.adset_id, `${e.nome} · ${venc.rotulo}`, `Escalar a vencedora (${venc.rotulo}) do teste "${e.nome}"`, `${r.resumo} Aumento gradual de ${Math.round(passo * 100)}%.`, JSON.stringify({ de: atual, para: Math.round(atual * (1 + passo) * 100) / 100 }), 0); n++; }
    } else { ins.run('aviso', String(e.campanha_id || e.id), e.nome, `Resultado do teste "${e.nome}"`, r.resumo, '{}', 0); n++; }
  }
  return n;
}
module.exports = { criarRascunho, criarNaMeta, publicar, descartar, detalhe, avaliar, avaliarRodando, validar };
