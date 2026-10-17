process.env.DB_PATH = ':memory:'; process.env.NODE_ENV = 'test'; process.env.ADMIN_PASSWORD = 's'; process.env.META_ACCESS_TOKEN = 'tok'; process.env.META_AD_ACCOUNT_ID = '9';
process.env.META_PAGE_ID = 'PG1'; process.env.META_INSTAGRAM_ID = 'IG1'; process.env.DATA_DIR = require('os').tmpdir() + '/adpilot-t-' + process.pid;
const assert = require('assert'), http = require('http');
let ok = 0, falhou = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ✓ ' + n); } catch (e) { falhou++; console.log('  ✗ ' + n + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); } };
const hoje = new Date().toISOString().slice(0, 10);
(async () => {
  const log = []; let seq = 100, falharEm = null; const insights = [];
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
    res.setHeader('content-type', 'application/json'); const u = new URL(req.url, 'http://x');
    if (u.pathname === '/v1/messages') return res.end(JSON.stringify({ content: [{ text: 'Claro! [{"angulo":"dor","titulo":"Perdendo vendas?","texto":"Texto IA 1"},{"angulo":"oferta","titulo":"Oferta IA","texto":"Texto IA 2"}]' }] }));
    if (req.method === 'POST') { const c = JSON.parse(b || '{}'); log.push({ p: u.pathname.replace(/^\/v23.0/, ''), c });
      if (falharEm && u.pathname.endsWith(falharEm)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'Parâmetro inválido', code: 100 } })); }
      if (u.pathname.endsWith('/adimages')) return res.end(JSON.stringify({ images: { f: { hash: 'HASH' + (++seq) } } }));
      return res.end(JSON.stringify({ id: 'M' + (++seq) })); }
    if (u.pathname.endsWith('/adsets') || u.pathname.endsWith('/ads')) return res.end(JSON.stringify({ data: [] }));
    if (u.pathname.endsWith('/insights')) return res.end(JSON.stringify({ data: insights }));
    res.end('{}'); }); });
  await new Promise(r => fake.listen(0, r)); const pf = fake.address().port;
  process.env.GRAPH_BASE = 'http://localhost:' + pf; process.env.ANTHROPIC_BASE = 'http://localhost:' + pf;
  const app = require('./server.js'); const { db } = require('./db'); const srv = app.listen(0); await new Promise(r => srv.once('listening', r)); const porta = srv.address().port;
  const chamar = (m, p, corpo, tok) => new Promise(r => { const q = http.request({ port: porta, path: p, method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => r({ status: s.statusCode, json: (() => { try { return JSON.parse(b); } catch (_) { return b; } })() })); }); if (corpo) q.write(JSON.stringify(corpo)); q.end(); });
  const tok = (await chamar('POST', '/api/login', { senha: 's' })).json.token; const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  console.log('Criativos');
  await t('gera textos por modelo (ângulos diferentes) quando não há chave de IA', async () => {
    const r = await chamar('POST', '/api/copy', { produto: 'placa NFC de avaliação', publico: 'barbearias', beneficio: 'ter mais avaliações no Google', objetivo: 'msg', n: 4 }, tok);
    assert.strictEqual(r.json.length, 4); assert.strictEqual(new Set(r.json.map(x => x.angulo)).size, 4); assert.ok(r.json.every(x => x.titulo.length <= 40 && x.texto.length <= 180 && x.origem === 'modelo' && x.cta === 'SEND_MESSAGE'));
    assert.strictEqual((await chamar('POST', '/api/copy', { objetivo: 'msg' }, tok)).status, 400);
  });
  await t('com chave de IA usa as variações da IA', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'; const r = await chamar('POST', '/api/copy', { produto: 'placa', n: 2 }, tok); delete process.env.ANTHROPIC_API_KEY;
    assert.strictEqual(r.json[0].origem, 'ia'); assert.strictEqual(r.json[0].titulo, 'Perdendo vendas?');
  });
  let img1, img2;
  await t('sobe imagem PNG, recusa outros tipos, serve o arquivo', async () => {
    img1 = (await chamar('POST', '/api/imagens', { nome: 'a.png', dados: png }, tok)).json.id; img2 = (await chamar('POST', '/api/imagens', { nome: 'b.png', dados: png }, tok)).json.id; assert.ok(img1 && img2);
    assert.strictEqual((await chamar('POST', '/api/imagens', { nome: 'x', dados: 'data:text/html;base64,PGI+' }, tok)).status, 400);
    assert.strictEqual((await chamar('GET', `/api/imagens/${img1}/arquivo`, null, tok)).status, 200);
  });

  console.log('Teste A/B');
  const base = () => ({ nome: 'Teste placas', objetivo: 'msg', orcamento_dia: 30, dias: 4, lat: -12.26, lng: -38.96, raio_km: 15, variacoes: [{ titulo: 'Título A', texto: 'Texto A', angulo: 'dor', imagem_id: img1 }, { titulo: 'Título B', texto: 'Texto B', angulo: 'oferta', imagem_id: img2 }] });
  await t('valida: mínimo de 2 variações, verba mínima por variação, teto de segurança, link no site', async () => {
    assert.strictEqual((await chamar('POST', '/api/testes', { ...base(), variacoes: [base().variacoes[0]] }, tok)).status, 400);
    const r1 = await chamar('POST', '/api/testes', { ...base(), orcamento_dia: 8 }, tok); assert.strictEqual(r1.status, 400); assert.ok(/mínimo/.test(r1.json.error));
    const r2 = await chamar('POST', '/api/testes', { ...base(), orcamento_dia: 500 }, tok); assert.ok(/Trava/.test(r2.json.error));
    assert.ok(/https/.test((await chamar('POST', '/api/testes', { ...base(), objetivo: 'site' }, tok)).json.error));
  });
  let id, ex;
  await t('rascunho não toca na Meta', async () => { const n0 = log.length; ex = (await chamar('POST', '/api/testes', base(), tok)).json; id = ex.id; assert.strictEqual(ex.status, 'rascunho'); assert.strictEqual(log.length, n0); });
  await t('criar na Meta: campanha → conjuntos → imagem → criativo → anúncio, tudo PAUSADO, verba dividida igual', async () => {
    const r = await chamar('POST', `/api/testes/${id}/criar`, null, tok); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); ex = r.json; assert.strictEqual(ex.status, 'criado');
    const camp = log.find(x => x.p.endsWith('/campaigns')).c; assert.strictEqual(camp.status, 'PAUSED'); assert.strictEqual(camp.objective, 'OUTCOME_ENGAGEMENT'); assert.deepStrictEqual(camp.special_ad_categories, []);
    const sets = log.filter(x => x.p.endsWith('/adsets')).map(x => x.c); assert.strictEqual(sets.length, 2); assert.ok(sets.every(s => s.status === 'PAUSED' && s.daily_budget === '1500' && s.optimization_goal === 'CONVERSATIONS' && s.destination_type === 'INSTAGRAM_DIRECT' && s.promoted_object.page_id === 'PG1'));
    assert.strictEqual(sets[0].targeting.geo_locations.custom_locations[0].radius, 15); assert.ok(log.filter(x => x.p.endsWith('/ads')).every(a => a.c.status === 'PAUSED'));
    const cr = log.find(x => x.p.endsWith('/adcreatives')).c.object_story_spec; assert.strictEqual(cr.instagram_user_id, 'IG1'); assert.strictEqual(cr.link_data.call_to_action.type, 'INSTAGRAM_MESSAGE');
    assert.ok(ex.variacoes.every(v => v.adset_id && v.ad_id && v.creative_id));
    assert.ok(!log.some(x => x.c.status === 'ACTIVE'), 'nada ativo antes de publicar');
  });
  await t('imagem já enviada não é reenviada à Meta', async () => assert.strictEqual(log.filter(x => x.p.endsWith('/adimages')).length, 2));
  await t('publicar liga campanha, conjuntos e anúncios; não publica duas vezes', async () => {
    const r = await chamar('POST', `/api/testes/${id}/publicar`, null, tok); assert.strictEqual(r.json.status, 'rodando');
    assert.strictEqual(log.filter(x => x.c.status === 'ACTIVE').length, 5); assert.strictEqual((await chamar('POST', `/api/testes/${id}/publicar`, null, tok)).status, 502);
  });
  await t('durante o teste as regras automáticas não mexem nos conjuntos dele', async () => {
    const [a, b] = ex.variacoes; db.prepare("UPDATE adsets SET criado_meta = ?").run(new Date(Date.now() - 20 * 864e5).toISOString());
    insights.push({ ad_id: a.ad_id, adset_id: a.adset_id, date_start: hoje, spend: '60', impressions: '3000', clicks: '90', reach: '2500', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '0' }] });
    const r = await chamar('POST', '/api/sync', null, tok); assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.ok(!(await chamar('GET', '/api/sugestoes', null, tok)).json.some(s => s.alvo_id === a.adset_id));
  });
  await t('vencedor claro → conclui e propõe pausar a perdedora e escalar a vencedora (aprovação sua)', async () => {
    const [a, b] = ex.variacoes; insights.length = 0; db.prepare("UPDATE experimentos SET inicio = ? WHERE id = ?").run(new Date(Date.now() - 5 * 864e5).toISOString(), id);
    const l = (v, gasto, msgs) => ({ ad_id: v.ad_id, adset_id: v.adset_id, date_start: hoje, spend: String(gasto), impressions: '4000', clicks: '100', reach: '3000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(msgs) }] });
    insights.push(l(a, 60, 4), l(b, 60, 12)); // A: R$15 por conversa; B: R$5
    await chamar('POST', '/api/sync', null, tok); const e2 = (await chamar('GET', '/api/testes', null, tok)).json.find(x => x.id === id);
    assert.strictEqual(e2.status, 'concluido'); assert.strictEqual(e2.resultado.estado, 'vencedor'); assert.strictEqual(e2.resultado.vencedor_id, b.id);
    const s = (await chamar('GET', '/api/sugestoes', null, tok)).json; assert.ok(s.some(x => x.tipo === 'pausar_adset' && x.alvo_id === a.adset_id)); const esc = s.find(x => x.tipo === 'orcamento' && x.alvo_id === b.adset_id); assert.strictEqual(esc.params.para, 18);
    await chamar('POST', '/api/sync', null, tok); assert.ok((await chamar('GET', '/api/sugestoes', null, tok)).json.some(x => x.alvo_id === a.adset_id && x.tipo === 'pausar_adset'), 'sugestão do teste sobrevive à próxima sincronização');
  });
  await t('custos parecidos → "empate", sem pausar nada', async () => {
    const id2 = (await chamar('POST', '/api/testes', { ...base(), nome: 'Empate' }, tok)).json.id; await chamar('POST', `/api/testes/${id2}/criar`, null, tok); await chamar('POST', `/api/testes/${id2}/publicar`, null, tok);
    db.prepare("UPDATE experimentos SET inicio = ? WHERE id = ?").run(new Date(Date.now() - 5 * 864e5).toISOString(), id2); const [a, b] = db.prepare('SELECT * FROM variacoes WHERE experimento_id = ?').all(id2);
    const l = (v, gasto, msgs) => ({ ad_id: v.ad_id, adset_id: v.adset_id, date_start: hoje, spend: String(gasto), impressions: '4000', clicks: '100', reach: '3000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(msgs) }] });
    insights.length = 0; insights.push(l(a, 60, 8), l(b, 60, 9)); await chamar('POST', '/api/sync', null, tok);
    const e2 = (await chamar('GET', '/api/testes', null, tok)).json.find(x => x.id === id2); assert.strictEqual(e2.resultado.estado, 'empate');
    assert.ok(!(await chamar('GET', '/api/sugestoes', null, tok)).json.some(x => x.alvo_id === a.adset_id));
  });
  await t('falha no meio da criação: apaga o que criou, registra o erro e deixa tentar de novo', async () => {
    const id3 = (await chamar('POST', '/api/testes', { ...base(), nome: 'Falha' }, tok)).json.id; falharEm = '/ads';
    const r = await chamar('POST', `/api/testes/${id3}/criar`, null, tok); assert.strictEqual(r.status, 502); assert.ok(/Parâmetro inválido/.test(r.json.error));
    assert.ok(log.some(x => x.c.status === 'DELETED'), 'campanha parcial apagada'); const e = (await chamar('GET', '/api/testes', null, tok)).json.find(x => x.id === id3); assert.strictEqual(e.status, 'erro');
    falharEm = null; assert.strictEqual((await chamar('POST', `/api/testes/${id3}/criar`, null, tok)).status, 200);
  });
  await t('sem a Página/Instagram configurados explica o que falta; rascunho pode ser descartado', async () => {
    const id4 = (await chamar('POST', '/api/testes', { ...base(), nome: 'SemPg' }, tok)).json.id; const pg = process.env.META_PAGE_ID; process.env.META_PAGE_ID = '';
    const r = await chamar('POST', `/api/testes/${id4}/criar`, null, tok); process.env.META_PAGE_ID = pg; assert.ok(/META_PAGE_ID/.test(r.json.error));
    assert.strictEqual((await chamar('POST', `/api/testes/${id4}/descartar`, null, tok)).status, 200);
  });
  await t('imagem usada em teste não pode ser apagada', async () => assert.strictEqual((await chamar('DELETE', `/api/imagens/${img1}`, null, tok)).status, 409));

  fake.close(); srv.close(); console.log(`\n${ok} passaram, ${falhou} falharam`); process.exit(falhou ? 1 : 0);
})();
