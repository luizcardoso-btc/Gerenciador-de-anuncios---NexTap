// Motor de decisão. Função pura: recebe números, devolve SUGESTÕES (nunca age sozinho).
const r2 = n => Math.round(n * 100) / 100;
const brl = n => 'R$ ' + r2(n).toFixed(2).replace('.', ',');

// a = conjunto com: id, nome, tipo('msg'|'site'), status, orcamento (moeda), horas_vida,
//     j = {gasto, res, valor, imp, cliques, alcance} (janela de decisão), ant = {imp, cliques} (período anterior), ads[]
function gerar(adsets, cfg, ctx = {}) {
  const sug = [];
  const meta = a => Number(a.tipo === 'msg' ? cfg.meta_cpa_msg : cfg.meta_cpa_site);
  const passo = Math.min(50, Math.max(5, Number(cfg.passo_escala_pct) || 20)) / 100;
  const tetoAd = Number(cfg.orcamento_max_adset) || 0, tetoTot = Number(cfg.orcamento_max_total) || 0;
  let totalDia = adsets.filter(a => a.status === 'ACTIVE').reduce((s, a) => s + (a.orcamento || 0), 0);
  const unidade = a => (a.tipo === 'msg' ? 'conversa' : 'resultado');

  for (const a of adsets) {
    if (a.status !== 'ACTIVE') continue;
    const m = meta(a), j = a.j, cpa = j.res > 0 ? j.gasto / j.res : null;
    const aprendendo = a.horas_vida != null && a.horas_vida < Number(cfg.espera_horas);
    const mexeuRecente = (ctx.mexeuOrcamento || {})[a.id];
    const base = { alvo_id: a.id, alvo_nome: a.nome };

    // 1) gastou bastante e nada de resultado → pausar
    if (!aprendendo && j.res === 0 && j.gasto >= Math.max(2 * m, 15)) {
      sug.push({ ...base, tipo: 'pausar_adset', titulo: `Pausar "${a.nome}"`, economia: r2(a.orcamento || 0),
        motivo: `Gastou ${brl(j.gasto)} nos últimos ${cfg.janela_dias} dias sem nenhum ${unidade(a)}. A meta é ${brl(m)} por ${unidade(a)}.`, params: {} });
      continue;
    }
    // 2) custo muito acima da meta → pausar; um pouco acima → reduzir verba
    if (!aprendendo && cpa != null && j.gasto >= 3 * m) {
      if (cpa > 1.6 * m) {
        sug.push({ ...base, tipo: 'pausar_adset', titulo: `Pausar "${a.nome}"`, economia: r2(a.orcamento || 0),
          motivo: `Custo por ${unidade(a)} de ${brl(cpa)}, ${Math.round((cpa / m - 1) * 100)}% acima da meta (${brl(m)}), com ${brl(j.gasto)} gastos.`, params: {} });
        continue;
      }
      if (cpa > 1.3 * m && a.orcamento && !mexeuRecente) {
        const novo = r2(a.orcamento * 0.7);
        sug.push({ ...base, tipo: 'orcamento', titulo: `Reduzir verba de "${a.nome}" em 30%`, economia: r2(a.orcamento - novo),
          motivo: `Custo por ${unidade(a)} de ${brl(cpa)} (meta ${brl(m)}). Reduzir limita o prejuízo enquanto você testa um criativo novo.`, params: { de: a.orcamento, para: novo } });
        continue;
      }
    }
    // 2b) site com valor de venda: retorno abaixo do mínimo
    if (!aprendendo && a.tipo === 'site' && j.valor > 0 && j.gasto >= 3 * m && j.valor / j.gasto < Number(cfg.roas_min)) {
      sug.push({ ...base, tipo: 'pausar_adset', titulo: `Pausar "${a.nome}" (retorno baixo)`, economia: r2(a.orcamento || 0),
        motivo: `Retorno de ${r2(j.valor / j.gasto)}x (mínimo ${cfg.roas_min}x): ${brl(j.gasto)} gastos para ${brl(j.valor)} vendidos.`, params: {} });
      continue;
    }
    // 3) ótimo resultado → escalar com cuidado (sem passar dos tetos e sem mexer em fase de aprendizado)
    if (!aprendendo && cpa != null && j.res >= 5 && cpa <= 0.8 * m && j.gasto >= 3 * m && a.orcamento && !mexeuRecente) {
      let novo = r2(a.orcamento * (1 + passo)); if (tetoAd) novo = Math.min(novo, tetoAd);
      if (tetoTot) novo = Math.min(novo, a.orcamento + Math.max(0, tetoTot - totalDia));
      if (novo > a.orcamento + 0.009) {
        totalDia += novo - a.orcamento;
        sug.push({ ...base, tipo: 'orcamento', titulo: `Aumentar verba de "${a.nome}" em ${Math.round((novo / a.orcamento - 1) * 100)}%`, economia: 0,
          motivo: `Custo por ${unidade(a)} de ${brl(cpa)}, ${Math.round((1 - cpa / m) * 100)}% abaixo da meta, com ${j.res} resultados. Aumento gradual para não reiniciar o aprendizado.`, params: { de: a.orcamento, para: novo } });
      }
    }
    // 4) fadiga: frequência alta ou CTR caindo
    const freq = j.alcance > 0 ? j.imp / j.alcance : 0;
    const ctr = j.imp > 0 ? j.cliques / j.imp : 0, ctrAnt = a.ant && a.ant.imp > 500 ? a.ant.cliques / a.ant.imp : 0;
    if (!aprendendo && j.imp >= 1000 && freq >= Number(cfg.freq_max)) {
      sug.push({ ...base, tipo: 'aviso', titulo: `Público saturado em "${a.nome}"`, economia: 0,
        motivo: `Cada pessoa viu o anúncio ${r2(freq)} vezes (limite ${cfg.freq_max}). Troque o criativo ou amplie o público.`, params: {} });
    } else if (!aprendendo && j.imp >= 1000 && ctrAnt > 0 && ctr < 0.7 * ctrAnt) {
      sug.push({ ...base, tipo: 'aviso', titulo: `Criativo cansando em "${a.nome}"`, economia: 0,
        motivo: `O CTR caiu de ${r2(ctrAnt * 100)}% para ${r2(ctr * 100)}% em relação ao período anterior. Hora de testar um criativo novo.`, params: {} });
    }
    // 5) anúncio fraco dentro de conjunto que funciona
    const ativos = (a.ads || []).filter(x => x.status === 'ACTIVE');
    if (!aprendendo && cpa != null && ativos.length > 1) {
      for (const d of ativos) {
        const fraco = d.res === 0 ? d.gasto >= 2 * m : d.gasto / d.res >= 2 * cpa && d.gasto >= 2 * m;
        if (fraco) sug.push({ alvo_id: d.id, alvo_nome: d.nome, tipo: 'pausar_ad', titulo: `Pausar anúncio "${d.nome}"`, economia: 0,
          motivo: `Gastou ${brl(d.gasto)} ${d.res ? 'com custo de ' + brl(d.gasto / d.res) + ' por ' + unidade(a) : 'sem nenhum ' + unidade(a)}, enquanto o conjunto "${a.nome}" faz ${brl(cpa)}.`, params: { conjunto: a.id } });
      }
    }
  }
  return sug;
}
module.exports = { gerar };
