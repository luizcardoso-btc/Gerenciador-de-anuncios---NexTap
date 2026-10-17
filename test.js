process.env.DB_PATH = ':memory:'; process.env.NODE_ENV = 'test'; process.env.ADMIN_PASSWORD = 'segredo123';
process.env.META_ACCESS_TOKEN = 'tok'; process.env.META_AD_ACCOUNT_ID = '1';
const assert = require('assert'), http = require('http');
let ok = 0, falhou = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ✓ ' + n); } catch (e) { falhou++; console.log('  ✗ ' + n + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); } };
const hoje = new Date().toISOString().slice(0, 10), h = x => new Date(Date.now() - x * 36e5).toISOString();

(async () => {
  const chamadas = [];
  const linha = (ad, adset, spend, imp, cl, reach, msgs, vendas = 0, valor = 0) => ({ ad_id: ad, adset_id: adset, date_start: hoje, spend: String(spend), impressions: String(imp), clicks: String(cl), reach: String(reach),
    actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(msgs) }, ...(vendas ? [{ action_type: 'purchase', value: String(vendas) }, { action_type: 'omni_purchase', value: String(vendas) }] : [])],
    action_values: valor ? [{ action_type: 'purchase', value: String(valor) }, { action_type: 'omni_purchase', value: String(valor) }] : [] });
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
    res.setHeader('content-type', 'application/json'); const u = new URL(req.url, 'http://x');
    if (req.headers.authorization !== 'Bearer tok') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'token inválido', code: 190 } })); }
    if (req.method === 'POST') { chamadas.push({ url: u.pathname, corpo: JSON.parse(b || '{}') }); if (/FALHA/.test(u.pathname)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'Sem permissão', code: 200 } })); } return res.end('{"success":true}'); }
    if (u.pathname.endsWith('/act_1')) return res.end(JSON.stringify({ name: 'Conta Teste', currency: 'BRL', account_status: 1 }));
    if (u.pathname.endsWith('/adsets')) return res.end(JSON.stringify({ data: [
      { id: 'A1', name: 'Msgs Bom', campaign_id: 'C1', campaign: { name: 'Camp Msg', objective: 'OUTCOME_ENGAGEMENT' }, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000', optimization_goal: 'CONVERSATIONS', created_time: h(24 * 10) },
      { id: 'A2', name: 'Msgs Ruim', campaign_id: 'C1', campaign: { name: 'Camp Msg', objective: 'OUTCOME_ENGAGEMENT' }, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '4000', optimization_goal: 'CONVERSATIONS', created_time: h(24 * 10) },
      { id: 'A3', name: 'Site Caro', campaign_id: 'C2', campaign: { name: 'Camp Site', objective: 'OUTCOME_SALES' }, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '3000', optimization_goal: 'OFFSITE_CONVERSIONS', created_time: h(24 * 10) },
      { id: 'A4', name: 'Conjunto Novo', campaign_id: 'C1', campaign: { name: 'Camp Msg', objective: 'OUTCOME_ENGAGEMENT' }, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '4000', optimization_goal: 'CONVERSATIONS', created_time: h(5) },
      { id: 'A5', name: 'Dois Anuncios', campaign_id: 'C1', campaign: { name: 'Camp Msg', objective: 'OUTCOME_ENGAGEMENT' }, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '4000', optimization_goal: 'CONVERSATIONS', created_time: h(24 * 10) },
      { id: 'A6', name: 'FALHA', campaign_id: 'C1', campaign: { name: 'Camp Msg', objective: 'OUTCOME_ENGAGEMENT' }, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '4000', optimization_goal: 'CONVERSATIONS', created_time: h(24 * 10) }] }));
    if (u.pathname.endsWith('/ads')) return res.end(JSON.stringify({ data: [
      { id: 'X1', name: 'Ad A1', adset_id: 'A1', status: 'ACTIVE' }, { id: 'X2', name: 'Ad A2', adset_id: 'A2', status: 'ACTIVE' }, { id: 'X3', name: 'Ad A3', adset_id: 'A3', status: 'ACTIVE' },
      { id: 'X4', name: 'Ad A4', adset_id: 'A4', status: 'ACTIVE' }, { id: 'B1', name: 'Bom', adset_id: 'A5', status: 'ACTIVE' }, { id: 'B2', name: 'Fraco', adset_id: 'A5', status: 'ACTIVE' }, { id: 'X6', name: 'Ad A6', adset_id: 'A6', status: 'ACTIVE' }] }));
    if (u.pathname.endsWith('/insights')) {
      if (!u.searchParams.get('after')) return res.end(JSON.stringify({ data: [linha('X1', 'A1', 60, 4000, 120, 3000, 12), linha('X2', 'A2', 50, 3000, 60, 2500, 0)], paging: { next: `http://localhost:${fake.address().port}${u.pathname}?after=2` } }));
      return res.end(JSON.stringify({ data: [linha('X3', 'A3', 150, 5000, 100, 4000, 0, 2, 200), linha('X4', 'A4', 100, 2000, 40, 1800, 0), linha('B1', 'A5', 40, 3000, 90, 2800, 8), linha('B2', 'A5', 30, 2000, 30, 1900, 0), linha('X6', 'A6', 60, 4000, 120, 3000, 12)] }));
    }
    res.statusCode = 404; res.end('{"error":{"message":"rota"}}');
  }); });
  await new Promise(r => fake.listen(0, r)); process.env.GRAPH_BASE = 'http://localhost:' + fake.address().port;

  const app = require('./server.js'); const srv = app.listen(0); await new Promise(r => srv.once('listening', r)); const porta = srv.address().port;
  const chamar = (m, p, corpo, tok) => new Promise(r => { const q = http.request({ port: porta, path: p, method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => r({ status: s.statusCode, json: (() => { try { return JSON.parse(b); } catch (_) { return b; } })() })); }); if (corpo) q.write(JSON.stringify(corpo)); q.end(); });
  let tok;

  console.log('Acesso');
  await t('sem login é recusado; senha errada falha; certa devolve token', async () => {
    assert.strictEqual((await chamar('GET', '/api/status')).status, 401);
    assert.strictEqual((await chamar('POST', '/api/login', { senha: 'x' })).status, 401);
    const r = await chamar('POST', '/api/login', { senha: 'segredo123' }); assert.strictEqual(r.status, 200); tok = r.json.token;
    assert.strictEqual((await chamar('GET', '/api/status', null, tok)).status, 200);
    assert.strictEqual((await chamar('GET', '/api/status', null, tok + 'x')).status, 401);
  });
  await t('status mostra a conta da Meta', async () => { const r = (await chamar('GET', '/api/status', null, tok)).json; assert.strictEqual(r.conta.name, 'Conta Teste'); });

  console.log('Sincronização e regras');
  await t('sincroniza conjuntos, anúncios e métricas (com paginação) e classifica mensagens x site', async () => {
    const r = await chamar('POST', '/api/sync', null, tok); assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.adsets, 6); assert.strictEqual(r.json.linhas, 7);
    const c = (await chamar('GET', '/api/conjuntos?dias=3', null, tok)).json; assert.strictEqual(c.find(x => x.id === 'A1').tipo, 'msg'); assert.strictEqual(c.find(x => x.id === 'A3').tipo, 'site');
    assert.strictEqual(c.find(x => x.id === 'A3').j.res, 2, 'compra não pode ser contada em dobro (purchase + omni_purchase)');
  });
  let sug;
  await t('gera as sugestões certas e ignora conjunto em aprendizado', async () => {
    sug = (await chamar('GET', '/api/sugestoes', null, tok)).json;
    const por = (tipo, id) => sug.find(s => s.tipo === tipo && s.alvo_id === id);
    assert.ok(por('orcamento', 'A1') && por('orcamento', 'A1').params.para === 60, 'escalar A1 +20%');
    assert.ok(por('pausar_adset', 'A2'), 'pausar A2 (sem resultado)'); assert.ok(por('pausar_adset', 'A3'), 'pausar A3 (caro)');
    assert.ok(!sug.some(s => s.alvo_id === 'A4'), 'A4 está em aprendizado'); assert.ok(por('pausar_ad', 'B2'), 'pausar anúncio fraco'); assert.ok(!por('pausar_ad', 'B1'));
    assert.ok(!sug.some(s => s.alvo_id === 'A5' && s.tipo === 'pausar_adset'));
  });
  await t('sincronizar de novo não duplica sugestões', async () => { await chamar('POST', '/api/sync', null, tok); assert.strictEqual((await chamar('GET', '/api/sugestoes', null, tok)).json.length, sug.length); });
  await t('resumo calcula custo por resultado separado para mensagens e site', async () => {
    const r = (await chamar('GET', '/api/resumo?dias=7', null, tok)).json;
    assert.strictEqual(Math.round(r.gasto), 490); assert.strictEqual(r.msgs, 32); assert.strictEqual(r.vendas, 2); assert.ok(Math.abs(r.cpa_site - 75) < 0.01); assert.ok(Math.abs(r.roas - 200 / 150) < 0.01);
  });

  console.log('Aprovação, travas e desfazer');
  await t('nada é alterado na Meta sem aprovar', async () => assert.strictEqual(chamadas.length, 0));
  await t('aprovar "pausar" envia PAUSED e registra a ação; não aprova duas vezes', async () => {
    const s = sug.find(x => x.tipo === 'pausar_adset' && x.alvo_id === 'A2');
    assert.strictEqual((await chamar('POST', `/api/sugestoes/${s.id}/aprovar`, null, tok)).status, 200);
    assert.deepStrictEqual(chamadas.at(-1), { url: '/v23.0/A2', corpo: { status: 'PAUSED' } });
    assert.strictEqual((await chamar('POST', `/api/sugestoes/${s.id}/aprovar`, null, tok)).status, 404);
  });
  await t('aprovar aumento de verba envia o valor em centavos', async () => {
    const s = sug.find(x => x.tipo === 'orcamento' && x.alvo_id === 'A1');
    assert.strictEqual((await chamar('POST', `/api/sugestoes/${s.id}/aprovar`, null, tok)).status, 200);
    assert.deepStrictEqual(chamadas.at(-1), { url: '/v23.0/A1', corpo: { daily_budget: '6000' } });
  });
  await t('desfazer devolve a verba/estado anteriores', async () => {
    const ac = (await chamar('GET', '/api/acoes', null, tok)).json; const a1 = ac.find(x => x.alvo_id === 'A1');
    assert.strictEqual((await chamar('POST', `/api/acoes/${a1.id}/desfazer`, null, tok)).status, 200);
    assert.deepStrictEqual(chamadas.at(-1), { url: '/v23.0/A1', corpo: { daily_budget: '5000' } });
    assert.strictEqual((await chamar('POST', `/api/acoes/${a1.id}/desfazer`, null, tok)).status, 404);
    const a2 = ac.find(x => x.alvo_id === 'A2'); await chamar('POST', `/api/acoes/${a2.id}/desfazer`, null, tok); assert.deepStrictEqual(chamadas.at(-1), { url: '/v23.0/A2', corpo: { status: 'ACTIVE' } });
  });
  await t('erro da Meta vira mensagem clara, fica no histórico e a sugestão continua pendente', async () => {
    const { db } = require('./db'); db.prepare("INSERT INTO sugestoes (tipo, alvo_id, alvo_nome, titulo, params) VALUES ('pausar_adset', 'FALHA', 'x', 'Pausar x', '{}')").run();
    const id = db.prepare("SELECT id FROM sugestoes WHERE alvo_id = 'FALHA'").get().id;
    const r = await chamar('POST', `/api/sugestoes/${id}/aprovar`, null, tok); assert.strictEqual(r.status, 502); assert.ok(/Sem permissão/.test(r.json.error));
    assert.strictEqual(db.prepare('SELECT status FROM sugestoes WHERE id = ?').get(id).status, 'pendente');
    assert.strictEqual(db.prepare("SELECT ok FROM acoes WHERE alvo_id = 'FALHA'").get().ok, 0);
  });
  await t('trava de segurança recusa aumento acima do passo máximo', async () => {
    const { db } = require('./db'); db.prepare("INSERT INTO sugestoes (tipo, alvo_id, alvo_nome, titulo, params) VALUES ('orcamento', 'A5', 'x', 'x', ?)").run(JSON.stringify({ para: 100 }));
    const id = db.prepare("SELECT id FROM sugestoes WHERE alvo_id = 'A5' AND tipo = 'orcamento'").get().id;
    const r = await chamar('POST', `/api/sugestoes/${id}/aprovar`, null, tok); assert.strictEqual(r.status, 502); assert.ok(/Trava/.test(r.json.error));
  });
  await t('rejeitar não repete a mesma sugestão logo em seguida', async () => {
    const p = (await chamar('GET', '/api/sugestoes', null, tok)).json.find(x => x.tipo === 'pausar_adset' && x.alvo_id === 'A3');
    assert.strictEqual((await chamar('POST', `/api/sugestoes/${p.id}/rejeitar`, null, tok)).status, 200);
    await chamar('POST', '/api/sync', null, tok); assert.ok(!(await chamar('GET', '/api/sugestoes', null, tok)).json.some(x => x.alvo_id === 'A3' && x.tipo === 'pausar_adset'));
  });

  console.log('Configuração e tetos');
  await t('metas editáveis, valores inválidos recusados', async () => {
    assert.strictEqual((await chamar('PUT', '/api/config', { meta_cpa_msg: '5,5' }, tok)).json.meta_cpa_msg, '5.5');
    assert.strictEqual((await chamar('PUT', '/api/config', { meta_cpa_msg: 'abc' }, tok)).status, 400);
    await chamar('PUT', '/api/config', { meta_cpa_msg: 8 }, tok);
  });
  await t('teto por conjunto limita o aumento sugerido', async () => {
    await chamar('PUT', '/api/config', { orcamento_max_adset: 52 }, tok);
    const { db } = require('./db'); db.prepare("UPDATE sugestoes SET status='expirada' WHERE tipo='orcamento'").run(); db.prepare('DELETE FROM acoes').run();
    await chamar('POST', '/api/sync', null, tok); const s = (await chamar('GET', '/api/sugestoes', null, tok)).json.find(x => x.alvo_id === 'A1' && x.tipo === 'orcamento'); assert.strictEqual(s.params.para, 52);
    await chamar('PUT', '/api/config', { orcamento_max_adset: 0 }, tok);
  });
  await t('depois de mexer na verba, não sugere mexer de novo durante a espera', async () => {
    const { db } = require('./db'); db.prepare("INSERT INTO acoes (tipo, alvo_id, ok) VALUES ('orcamento', 'A1', 1)").run();
    db.prepare("UPDATE sugestoes SET status='expirada' WHERE tipo='orcamento'").run(); await chamar('POST', '/api/sync', null, tok);
    assert.ok(!(await chamar('GET', '/api/sugestoes', null, tok)).json.some(x => x.alvo_id === 'A1' && x.tipo === 'orcamento'));
  });
  await t('painel é servido', async () => { const r = await chamar('GET', '/'); assert.strictEqual(r.status, 200); assert.ok(String(r.json).includes('AdPilot')); });

  fake.close(); srv.close();
  console.log(`\n${ok} passaram, ${falhou} falharam`); process.exit(falhou ? 1 : 0);
})();
