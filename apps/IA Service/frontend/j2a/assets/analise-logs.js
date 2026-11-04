'use strict';

class AnaliseLogs {
  constructor(opcoes) {
    this.opcoes = opcoes;
    this.modo = 'chamado';
    this.versaoLista = 0;
    this.versaoAnalise = 0;
    this.arquivos = [];
    this.relatorio = null;
    this.ocupado = false;
    this.el('modo-chamado').addEventListener('click', () => this.setModo('chamado'));
    this.el('modo-avulso').addEventListener('click', () => this.setModo('avulso'));
    this.el('atualizar').addEventListener('click', () => this.carregar());
    this.el('analisar').addEventListener('click', () => this.analisar());
    this.el('baixar').addEventListener('click', () => this.baixar());
    this.el('escolher').addEventListener('click', () => this.el('arquivo').click());
    this.el('arquivo').addEventListener('change', () => {
      this.el('nome-arquivo').textContent = this.el('arquivo').files[0]?.name || 'Nenhum arquivo selecionado';
    });
  }
  el(id) { return document.getElementById(`logs-${id}`); }
  chave() { const c = this.opcoes.contexto(); return `${c.empresa}:${c.chamadoId}`; }
  node(tag, texto, classe) {
    const n = document.createElement(tag);
    if (texto != null) n.textContent = texto;
    if (classe) n.className = classe;
    return n;
  }
  status(texto) { this.el('status').textContent = texto; }
  setModo(modo) {
    if (this.ocupado) return;
    this.modo = modo;
    for (const m of ['chamado', 'avulso']) {
      this.el(`modo-${m}`).setAttribute('aria-pressed', String(m === modo));
      this.el(`origem-${m}`).hidden = m !== modo;
    }
    this.status('');
    if (modo === 'chamado') this.carregar();
  }
  abrir() { if (this.modo === 'chamado') this.carregar(); }
  reset() {
    this.versaoAnalise++;
    this.versaoLista++;
    this.controller?.abort();
    this.setOcupado(false);
    this.limparResultado();
    this.arquivos = [];
    this.el('arquivo').value = '';
    this.el('nome-arquivo').textContent = 'Nenhum arquivo selecionado';
    this.el('lista').replaceChildren();
    this.el('contexto').textContent = 'Selecione um chamado para consultar seus logs ou anexe um log avulso.';
    this.status('');
  }
  contextChanged() {
    this.versaoLista++;
    this.arquivos = [];
    this.el('lista').replaceChildren();
    if (this.modo === 'chamado' || this.fonteAnalise?.modo === 'chamado') {
      this.versaoAnalise++;
      this.controller?.abort();
      this.setOcupado(false);
      this.status('Selecione o arquivo do chamado atual para analisar.');
      this.el('contexto').textContent = 'A lista será atualizada ao abrir a aba.';
      this.limparResultado();
    }
  }
  async request(caminho, opts = {}) {
    const r = await fetch(this.opcoes.url(caminho), { ...opts, headers: { ...this.opcoes.headers(), ...opts.headers } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Não foi possível concluir a operação (${r.status}).`);
    return body;
  }
  async carregar() {
    const versao = ++this.versaoLista;
    const chave = this.chave();
    const { chamadoId } = this.opcoes.contexto();
    this.arquivos = [];
    this.el('lista').replaceChildren();
    if (!chamadoId) {
      this.el('contexto').textContent = 'Nenhum chamado selecionado. Selecione um na fila ou use “Anexar log avulso”.';
      return;
    }
    this.el('contexto').textContent = 'Consultando logs do chamado selecionado…';
    try {
      const dados = await this.request(`/radar/logs?chamadoId=${encodeURIComponent(chamadoId)}`);
      if (versao !== this.versaoLista || chave !== this.chave()) return;
      this.el('contexto').textContent = `Chamado #${dados.numero} · ${(dados.arquivos || []).length} arquivo(s) .log`;
      this.arquivos = dados.arquivos || [];
      for (const aviso of dados.avisos || []) this.el('lista').append(this.node('p', aviso, 'logs-aviso'));
      if (!this.arquivos.length) this.el('lista').append(this.node('p', 'Nenhum log disponível nesta consulta. Você também pode anexar um log avulso.'));
      this.arquivos.forEach((a, i) => {
        const label = this.node('label', null, 'logs-item');
        const radio = this.node('input');
        radio.type = 'radio'; radio.name = 'logs-selecao'; radio.value = String(i); radio.disabled = !a.disponivel;
        const descricao = this.node('span', a.nome);
        const data = a.data ? new Date(a.data).toLocaleString('pt-BR') : 'Data não informada';
        descricao.append(this.node('small', `${a.origem} · ${data}${a.tamanho ? ` · ${(a.tamanho / 1024).toFixed(1)} KB` : ''}${!a.disponivel ? ' · Original indisponível' : ''}`));
        label.append(radio, descricao); this.el('lista').append(label);
      });
    } catch (err) {
      if (versao === this.versaoLista && chave === this.chave()) this.el('contexto').textContent = `Não foi possível listar os arquivos: ${err.message}`;
    }
  }
  limparResultado() {
    this.relatorio = null;
    this.fonteAnalise = null;
    this.el('resultado').replaceChildren();
    this.el('baixar').hidden = true;
  }
  setOcupado(valor) {
    this.ocupado = valor;
    for (const id of ['analisar', 'modo-chamado', 'modo-avulso', 'atualizar', 'arquivo', 'escolher']) this.el(id).disabled = valor;
    this.el('analisar').textContent = valor ? 'Analisando…' : 'Analisar';
    this.el('resultado').setAttribute('aria-busy', String(valor));
  }
  async analisar(grupoId = null) {
    if (this.ocupado) return;
    const modo = grupoId ? this.fonteAnalise?.modo : this.modo;
    if (!modo) return;
    const chave = this.chave();
    let caminho;
    let opts;
    if (grupoId) {
      caminho = `${this.fonteAnalise.caminho}?grupoId=${encodeURIComponent(grupoId)}`;
      opts = this.fonteAnalise.opts;
    } else if (modo === 'avulso') {
      const arquivo = this.el('arquivo').files[0];
      if (!arquivo || !/\.log(?:\.txt)?$/i.test(arquivo.name)) { this.status('Selecione um arquivo com extensão .log ou .log.txt.'); return; }
      if (!arquivo.size || arquivo.size > 20 * 1024 * 1024) { this.status('Selecione um arquivo não vazio, de até 20 MB.'); return; }
      const body = new FormData(); body.append('arquivo', arquivo);
      caminho = '/radar/logs/avulso'; opts = { method: 'POST', body };
    } else {
      const selecao = document.querySelector('input[name="logs-selecao"]:checked');
      const arquivo = selecao && this.arquivos[Number(selecao.value)];
      if (!arquivo || !arquivo.disponivel) { this.status('Selecione um log disponível na lista.'); return; }
      caminho = '/radar/logs/analisar';
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chamadoId: this.opcoes.contexto().chamadoId, arquivoId: arquivo.id, tipo: arquivo.tipo }) };
    }
    const versao = ++this.versaoAnalise;
    const empresa = this.opcoes.contexto().empresa;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 120000);
    const anterior = grupoId ? this.relatorio : null;
    if (!grupoId) {
      this.limparResultado();
      this.fonteAnalise = { caminho, opts, modo };
    }
    this.setOcupado(true);
    this.status('Lendo o arquivo e analisando as evidências. Aguarde; arquivos grandes podem levar mais tempo.');
    try {
      const resultado = await this.request(caminho, { ...opts, signal: controller.signal });
      if (versao !== this.versaoAnalise || empresa !== this.opcoes.contexto().empresa || (modo === 'chamado' && chave !== this.chave())) return;
      if (anterior) {
        for (const g of resultado.grupos) if (!g.analise) g.analise = anterior.grupos.find(a => a.id === g.id)?.analise;
        resultado.ia = { ...resultado.ia, gruposAnalisados: resultado.grupos.filter(g => g.analise).length };
      }
      this.relatorio = resultado; this.renderizar(resultado);
      this.status(resultado.ia?.indisponivel ? 'Varredura concluída. Análise por IA indisponível.' : 'Análise concluída. Consulte a cobertura e os avisos abaixo.');
    } catch (err) {
      if (versao === this.versaoAnalise) this.status(err.name === 'AbortError' ? 'A análise foi interrompida ou excedeu o tempo de espera. Tente novamente.' : err.message);
    } finally {
      clearTimeout(timeout);
      if (versao === this.versaoAnalise) this.setOcupado(false);
    }
  }
  renderizar(r) {
    const container = this.el('resultado'); container.replaceChildren();
    const resumo = this.node('section', null, 'logs-cartao');
    resumo.append(this.node('h3', `${r.origem?.tipo === 'avulso' ? 'Análise avulsa' : `Chamado #${r.origem?.numero}`} · ${r.arquivo.nome}`));
    resumo.append(this.node('p', `${r.cobertura.linhasLidas} linhas percorridas · ${r.cobertura.ocorrencias} ocorrência(s) identificada(s) · ${r.grupos.length} grupo(s) detalhado(s) · ${r.arquivo.encoding}`));
    resumo.append(this.node('p', `${r.ia?.gruposAnalisados || 0} grupo(s) com análise por IA. Credenciais reconhecidas pelo filtro são ocultadas nos trechos exibidos.`));
    for (const aviso of r.avisos || []) resumo.append(this.node('p', aviso, 'logs-aviso'));
    if (r.contextoArquivo?.length) {
      const eventos = this.node('details'); eventos.append(this.node('summary', 'Eventos de contexto do arquivo'));
      eventos.append(this.node('pre', r.contextoArquivo.flatMap(e => e.evidencia.map(l => `${l.linha}: ${l.texto}`)).join('\n')));
      resumo.append(eventos);
    }
    if (!r.grupos.length) resumo.append(this.node('p', 'Nenhum erro foi reconhecido pelos padrões examinados. Isso não confirma que o ambiente está livre de problemas.'));
    container.append(resumo);
    for (const grupo of r.grupos) {
      const card = this.node('article', null, 'logs-cartao');
      card.append(this.node('h3', `${grupo.id} · ${grupo.titulo}`));
      card.append(this.node('p', `${grupo.quantidade} ocorrência(s) · Linhas do log: ${grupo.linhas.join(', ')}${grupo.quantidade > grupo.linhas.length ? ' (lista limitada)' : ''}`));
      if (grupo.rotina) card.append(this.node('p', `Referência técnica encontrada: ${grupo.rotina}`));
      if (grupo.analise) {
        for (const [campo, titulo] of [['explicacao', 'O que aconteceu'], ['causaProvavel', 'Causa provável'], ['solucoes', 'Possíveis soluções e responsáveis'], ['validacao', 'Como validar'], ['informacoesFaltantes', 'O que falta confirmar']]) {
          card.append(this.node('h4', titulo), this.node('p', grupo.analise[campo]));
        }
      } else {
        card.append(this.node('p', 'Sem diagnóstico por IA para este grupo. As evidências abaixo mostram o que foi localizado no arquivo.'));
        const botao = this.node('button', 'Analisar este erro'); botao.type = 'button';
        botao.addEventListener('click', () => this.analisar(grupo.id));
        card.append(botao);
      }
      const detalhe = this.node('details'); detalhe.append(this.node('summary', 'Ver evidência e linhas do log (trecho limitado)'));
      detalhe.append(this.node('pre', [...(grupo.contextoAnterior || []), ...grupo.evidencia].map(l => `${l.linha}: ${l.texto}${l.truncada ? ' […]' : ''}`).join('\n')));
      card.append(detalhe); container.append(card);
    }
    this.el('baixar').hidden = false;
  }
  baixar() {
    if (!this.relatorio) return;
    const r = this.relatorio;
    const partes = [`Análise de Logs — ${r.arquivo.nome}`, r.origem?.tipo === 'avulso' ? 'Análise avulsa' : `Chamado #${r.origem?.numero}`,
      `${r.cobertura.linhasLidas} linhas lidas; ${r.cobertura.ocorrencias} ocorrências.`, ...(r.avisos || [])];
    for (const evento of r.contextoArquivo || []) partes.push('Evento de contexto:', ...evento.evidencia.map(l => `${l.linha}: ${l.texto}`));
    for (const g of r.grupos) {
      partes.push(`\n${g.id}: ${g.titulo}`, `${g.quantidade} ocorrência(s); linhas: ${g.linhas.join(', ')}`);
      if (g.analise) for (const [campo, titulo] of [['explicacao', 'O que aconteceu'], ['causaProvavel', 'Causa provável'], ['solucoes', 'Possíveis soluções'], ['validacao', 'Como validar'], ['informacoesFaltantes', 'O que falta confirmar']]) partes.push(`${titulo}: ${g.analise[campo]}`);
      else partes.push('Sem diagnóstico por IA.');
      partes.push('Evidência (trecho limitado):', ...[...(g.contextoAnterior || []), ...g.evidencia].map(l => `${l.linha}: ${l.texto}${l.truncada ? ' […]' : ''}`));
    }
    const blob = new Blob([partes.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = this.node('a'); a.href = url; a.download = 'analise-log.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

window.AnaliseLogs = AnaliseLogs;
