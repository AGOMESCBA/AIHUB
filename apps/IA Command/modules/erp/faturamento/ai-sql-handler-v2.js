'use strict';

const iaOwner = require('../ia-owner/runner');
const spec = require('./faturamento-ia-owner-spec');
const entitySqlGuard = require('../entity-sql-guard');

async function executar(intent, empresaId) {
  return iaOwner.executar(spec, intent, empresaId);
}

async function executarSqlDireto(sqlCanonico, intent, empresaId) {
  return iaOwner.executarSqlDireto(spec, sqlCanonico, intent, empresaId);
}

function garantirIntencao(empresaId) {
  return spec.garantirIntencao(empresaId);
}

module.exports = {
  executar,
  executarSqlDireto,
  garantirIntencao,
  _test: {
    _entidadesNomeadasDosFiltros(filtros = {}) {
      return Object.entries(filtros || {})
        .filter(([, valor]) => typeof valor === 'string' && valor.trim() && !/^\d+$/.test(valor.trim()))
        .map(([campo, valor]) => ({ texto: valor.trim(), tipo_sugerido: campo === 'cliente' ? 'cliente' : campo }));
    },
    _decidirEntidadesParaFase2(intent = {}, fase1 = {}, entidadesDosFiltros = []) {
      const entidades = Array.isArray(fase1.entidades_nomeadas) && fase1.entidades_nomeadas.length
        ? fase1.entidades_nomeadas
        : entidadesDosFiltros;
      const resolvidas = Array.isArray(intent._entidadesResolvidas) ? intent._entidadesResolvidas : [];
      const explicitas = intent._filtroEntidadeExplicitaMensagem || {};
      const pedido = (entidades || [])[0];
      const filtro = pedido?.tipo_sugerido ? intent.filtros?.[pedido.tipo_sugerido] : null;
      const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const compativel = pedido && resolvidas.some(e => {
        if (String(e.tipo || '').toLowerCase() !== String(pedido.tipo_sugerido || '').toLowerCase()) return false;
        const alvo = normalizar(pedido.texto || filtro);
        const nome = normalizar(e.nome || e.texto || '');
        return alvo && (nome.includes(alvo) || alvo.includes(nome));
      });
      const explicitamenteNovo = pedido?.tipo_sugerido && explicitas[pedido.tipo_sugerido] && !compativel;
      if (compativel || intent._entidadeEscolhidaManualmente) {
        return {
          entidadesParaResolver: [],
          entidadesResolvidas: resolvidas,
          podeReusarEntidadeCompativel: true,
          lookupObrigatorioEntidadeAtual: false,
        };
      }
      return {
        entidadesParaResolver: entidades || [],
        entidadesResolvidas: explicitamenteNovo ? [] : resolvidas,
        podeReusarEntidadeCompativel: false,
        lookupObrigatorioEntidadeAtual: Boolean((entidades || []).length),
      };
    },
    _sincronizarFiltrosComEntidadesFase1(intent = {}, fase1 = {}) {
      const filtros = { ...(intent.filtros || {}) };
      const explicitas = { ...(intent._filtroEntidadeExplicitaMensagem || {}) };
      for (const e of fase1.entidades_nomeadas || []) {
        if (e.tipo_sugerido && e.texto) {
          filtros[e.tipo_sugerido] = e.texto;
          explicitas[e.tipo_sugerido] = e.texto;
        }
      }
      return { intent: { ...intent, filtros, _filtroEntidadeExplicitaMensagem: explicitas } };
    },
    _removerDimensaoClienteNaoSolicitadaSql(sql) {
      let out = String(sql || '');
      out = out.replace(/,\s*SA1\.A1_NOME\s+AS\s+cliente\b/ig, '');
      out = out.replace(/SA1\.A1_NOME\s+AS\s+cliente\s*,\s*/ig, '');
      const splitGroupBy = out.match(/([\s\S]*?\bGROUP\s+BY\s+)([\s\S]*?)(\bORDER\s+BY\b[\s\S]*|$)/i);
      if (splitGroupBy) {
        const prefixo = splitGroupBy[1];
        const corpo = splitGroupBy[2].trim().replace(/;+\s*$/, '');
        const sufixo = splitGroupBy[3] || '';
        const itens = corpo.split(',').map(item => item.trim()).filter(Boolean)
          .filter(item => !/^SA1\.A1_NOME\b/i.test(item));
        out = itens.length
          ? `${prefixo}${itens.join(', ')} ${sufixo}`.trim()
          : `${splitGroupBy[1].replace(/\bGROUP\s+BY\s*$/i, '')}${sufixo}`.trim();
      }
      return out;
    },
    _aplicarParametrosEntidadesObrigatorios(sql, entidades = []) {
      return entitySqlGuard.aplicarParametrosEntidadesSql(sql, entidades);
    },
  },
};
