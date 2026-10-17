// Gerador de textos de anúncio: ângulos diferentes para o teste descobrir qual converte mais.
const cortar = (t, n) => { t = String(t || '').trim().replace(/\s+/g, ' '); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const ANGULOS = {
  dor:       { nome: 'Dor / problema', f: p => ({ titulo: `Cansado de ${p.dor || 'perder clientes'}?`, texto: `${p.produto} resolve isso: ${p.beneficio || 'simples e rápido'}. ${p.oferta ? p.oferta + '. ' : ''}${p.chamada}` }) },
  beneficio: { nome: 'Benefício direto', f: p => ({ titulo: cortar(p.beneficio ? p.beneficio.charAt(0).toUpperCase() + p.beneficio.slice(1) : p.produto, 40), texto: `${p.produto} para ${p.publico || 'o seu negócio'}. ${p.oferta ? p.oferta + '. ' : ''}${p.chamada}` }) },
  oferta:    { nome: 'Oferta / preço', f: p => ({ titulo: cortar(p.oferta || `Condição especial: ${p.produto}`, 40), texto: `${p.produto}${p.beneficio ? ' — ' + p.beneficio : ''}. Por tempo limitado. ${p.chamada}` }) },
  curiosidade:{ nome: 'Curiosidade', f: p => ({ titulo: `O jeito mais fácil de ${p.beneficio || 'vender mais'}`, texto: `Descubra como ${p.publico || 'quem empreende'} está usando ${p.produto}. ${p.chamada}` }) },
  prova:     { nome: 'Prova social', f: p => ({ titulo: cortar(`${p.publico ? p.publico.charAt(0).toUpperCase() + p.publico.slice(1) : 'Empresas'} já usam ${p.produto}`, 40), texto: `Veja por que ${p.publico || 'tanta gente'} escolheu ${p.produto}${p.beneficio ? ' para ' + p.beneficio : ''}. ${p.chamada}` }) },
  simples:   { nome: 'Simples e direto', f: p => ({ titulo: cortar(p.produto, 40), texto: `${p.beneficio ? p.beneficio.charAt(0).toUpperCase() + p.beneficio.slice(1) + '. ' : ''}${p.chamada}` }) },
};
const CHAMADAS = { msg: 'Chame no direct e peça o seu orçamento.', site: 'Clique e conheça.' };
const CTA = { msg: 'SEND_MESSAGE', site: 'LEARN_MORE' };

function porModelo(o, n) {
  const p = { produto: String(o.produto || '').trim(), publico: String(o.publico || '').trim(), beneficio: String(o.beneficio || '').trim(), oferta: String(o.oferta || '').trim(), dor: String(o.dor || '').trim(), chamada: CHAMADAS[o.objetivo === 'site' ? 'site' : 'msg'] };
  return Object.keys(ANGULOS).slice(0, n).map(k => { const r = ANGULOS[k].f(p); return { angulo: k, angulo_nome: ANGULOS[k].nome, titulo: cortar(r.titulo, 40), texto: cortar(r.texto, 180), cta: CTA[o.objetivo === 'site' ? 'site' : 'msg'], origem: 'modelo' }; });
}
async function porIA(o, n) {
  const chave = process.env.ANTHROPIC_API_KEY; if (!chave) return null;
  const base = (process.env.ANTHROPIC_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');
  const prompt = `Escreva ${n} variações de anúncio para Instagram/Facebook, em português do Brasil, cada uma com um ÂNGULO diferente (dor, benefício, oferta, curiosidade, prova social, simplicidade).
Produto: ${o.produto}\nPúblico: ${o.publico || 'não informado'}\nBenefício: ${o.beneficio || 'não informado'}\nOferta: ${o.oferta || 'nenhuma'}\nObjetivo: ${o.objetivo === 'site' ? 'levar ao site' : 'gerar conversa no Instagram Direct'}
Regras: título até 40 caracteres; texto até 180 caracteres, direto, sem exageros nem promessas que não possam ser cumpridas; sem emojis em excesso.
Responda SOMENTE um JSON: [{"angulo":"dor|beneficio|oferta|curiosidade|prova|simples","titulo":"...","texto":"..."}]`;
  const r = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('IA ' + r.status);
  const txt = ((await r.json()).content || []).map(c => c.text || '').join(''); const m = txt.match(/\[[\s\S]*\]/); if (!m) throw new Error('IA sem JSON');
  const arr = JSON.parse(m[0]); const cta = CTA[o.objetivo === 'site' ? 'site' : 'msg'];
  return arr.slice(0, n).filter(x => x && x.titulo && x.texto).map(x => ({ angulo: ANGULOS[x.angulo] ? x.angulo : 'beneficio', angulo_nome: (ANGULOS[x.angulo] || ANGULOS.beneficio).nome, titulo: cortar(x.titulo, 40), texto: cortar(x.texto, 180), cta, origem: 'ia' }));
}
async function gerar(o) {
  const n = Math.min(6, Math.max(2, Number(o.n) || 4));
  if (!String(o.produto || '').trim()) throw new Error('Diga qual é o produto ou serviço.');
  try { const ia = await porIA(o, n); if (ia && ia.length >= 2) return ia; } catch (_) { /* cai nos modelos */ }
  return porModelo(o, n);
}
module.exports = { gerar, ANGULOS };
