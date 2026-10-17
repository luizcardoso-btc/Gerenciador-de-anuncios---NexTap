// Cliente da Meta Marketing API (Graph). Só usa a conta de anúncios configurada.
const base = () => `${(process.env.GRAPH_BASE || 'https://graph.facebook.com').replace(/\/+$/, '')}/${process.env.META_API_VERSION || 'v23.0'}`;
const conta = () => { const c = String(process.env.META_AD_ACCOUNT_ID || '').trim(); return c ? (c.startsWith('act_') ? c : 'act_' + c) : ''; };
const configurado = () => !!(process.env.META_ACCESS_TOKEN && conta());

async function chamar(caminho, { method = 'GET', corpo, query } = {}) {
  if (!configurado()) throw new Error('Meta não configurada: defina META_ACCESS_TOKEN e META_AD_ACCOUNT_ID no Railway.');
  const url = caminho.startsWith('http') ? caminho : `${base()}/${caminho}` + (query ? '?' + new URLSearchParams(query) : '');
  const r = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + process.env.META_ACCESS_TOKEN, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(30000),
  });
  let j = {}; try { j = await r.json(); } catch (_) {}
  if (!r.ok || j.error) { const e = j.error || {}; throw new Error(`Meta: ${e.error_user_msg || e.message || 'erro ' + r.status}${e.code ? ' (código ' + e.code + ')' : ''}`); }
  return j;
}
async function todos(caminho, query) {
  const out = []; let j = await chamar(caminho, { query: { limit: '200', ...query } });
  for (let i = 0; i < 20; i++) { out.push(...(j.data || [])); const nx = j.paging && j.paging.next; if (!nx) break; j = await chamar(nx); }
  return out;
}
const infoConta = () => chamar(conta(), { query: { fields: 'name,currency,account_status,amount_spent' } });
const listarAdsets = () => todos(`${conta()}/adsets`, { fields: 'id,name,campaign_id,campaign{name,objective},status,effective_status,daily_budget,optimization_goal,created_time' });
const listarAds = () => todos(`${conta()}/ads`, { fields: 'id,name,adset_id,status,effective_status' });
const listarInsights = dias => todos(`${conta()}/insights`, {
  level: 'ad', time_increment: '1', date_preset: dias <= 7 ? 'last_7d' : dias <= 14 ? 'last_14d' : 'last_30d',
  fields: 'ad_id,adset_id,spend,impressions,clicks,reach,actions,action_values',
});
const pausar = id => chamar(id, { method: 'POST', corpo: { status: 'PAUSED' } });
const ativar = id => chamar(id, { method: 'POST', corpo: { status: 'ACTIVE' } });
const orcamento = (id, cent) => chamar(id, { method: 'POST', corpo: { daily_budget: String(Math.round(cent)) } });

// action_type → resultado (um só por prioridade, para não contar duas vezes a mesma venda)
const PRI_MSG = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];
const PRI_SITE = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_lead', 'lead', 'omni_lead'];
const pegar = (lista, pri) => { const a = lista || []; for (const t of pri) { const x = a.find(y => y.action_type === t); if (x) return Number(x.value) || 0; } return 0; };
const resultados = r => ({ msgs: pegar(r.actions, PRI_MSG), vendas: pegar(r.actions, PRI_SITE), valor: pegar(r.action_values, ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']) });

// ---- criação (tudo nasce PAUSADO) ----
const idPagina = () => process.env.META_PAGE_ID || '', idInsta = () => process.env.META_INSTAGRAM_ID || '';
const criarCampanha = ({ nome, objetivo }) => chamar(`${conta()}/campaigns`, { method: 'POST', corpo: { name: nome, objective: objetivo, status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false } });
const criarConjunto = o => chamar(`${conta()}/adsets`, { method: 'POST', corpo: { name: o.nome, campaign_id: o.campanha_id, daily_budget: String(o.orcamento_cent), billing_event: 'IMPRESSIONS', optimization_goal: o.otimizacao,
  destination_type: o.destino_tipo, ...(o.promoted ? { promoted_object: o.promoted } : {}), bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: o.targeting, status: 'PAUSED' } });
const subirImagem = (nome, base64) => chamar(`${conta()}/adimages`, { method: 'POST', corpo: { name: nome, bytes: base64 } }).then(j => { const k = Object.keys(j.images || {})[0]; if (!k) throw new Error('Meta não devolveu o código da imagem.'); return j.images[k].hash; });
const criarCriativo = o => chamar(`${conta()}/adcreatives`, { method: 'POST', corpo: { name: o.nome, object_story_spec: { page_id: o.page_id, ...(o.instagram_id ? { instagram_user_id: o.instagram_id } : {}), link_data: { image_hash: o.hash, link: o.link, message: o.texto, name: o.titulo, call_to_action: o.cta } } } });
const criarAnuncio = o => chamar(`${conta()}/ads`, { method: 'POST', corpo: { name: o.nome, adset_id: o.adset_id, creative: { creative_id: o.creative_id }, status: 'PAUSED' } });
const apagar = id => chamar(id, { method: 'POST', corpo: { status: 'DELETED' } });

module.exports = { idPagina, idInsta, criarCampanha, criarConjunto, subirImagem, criarCriativo, criarAnuncio, apagar, configurado, conta, infoConta, listarAdsets, listarAds, listarInsights, pausar, ativar, orcamento, resultados };
