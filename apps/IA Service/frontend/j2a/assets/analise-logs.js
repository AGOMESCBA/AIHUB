'use strict';

class AnaliseLogs {
  constructor(opcoes) {
    this.opcoes = opcoes;
    this.root = document.querySelector('#panel-logs .logs-tela, #painel-logs .logs-tela');
    this.montar();
    this.empresaAtual = this.opcoes.contexto().empresa;
    this.montarMonitor();
    this.modo = 'chamado';
    this.versaoLista = 0;
    this.versaoAnalise = 0;
    this.arquivos = [];
    this.relatorio = null;
    this.ocupado = false;
    this.carregando = false;
    this.el('modo-chamado').addEventListener('click', () => this.setModo('chamado'));
    this.el('modo-avulso').addEventListener('click', () => this.setModo('avulso'));
    this.el('atualizar').addEventListener('click', () => this.carregar());
    this.el('analisar').addEventListener('click', () => this.analisar());
    this.el('baixar').addEventListener('click', () => this.baixar());
    this.el('historico').addEventListener('click', () => {
      if (this.el('historico-area').hidden) this.carregarHistorico();
      else this.fecharHistorico();
    });
    this.el('historico-todas').addEventListener('change', () => {
      this.el('historico-lista').querySelectorAll('[data-log-historico-id]').forEach(c => { c.checked = this.el('historico-todas').checked; });
      this.atualizarSelecaoHistorico();
    });
    this.el('historico-lista').addEventListener('change', () => this.atualizarSelecaoHistorico());
    this.el('historico-excluir').addEventListener('click', () => this.excluirHistorico());
    this.el('escolher').addEventListener('click', () => this.el('arquivo').click());
    this.el('arquivo').addEventListener('change', () => {
      this.atualizarArquivo();
    });
    this.el('continuar').addEventListener('click', () => this.el('splash').close());
    this.el('ver-progresso').addEventListener('click', () => this.expandirProgresso());
    this.el('busca').addEventListener('input', () => this.filtrar());
    this.el('somente-analisados').addEventListener('change', () => this.filtrar());
    this.el('buscar-arquivo').addEventListener('click', () => this.buscarArquivo());
    this.el('busca').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.buscarArquivo(); } });
    this.el('lista').addEventListener('change', () => this.atualizarBotao());
    this.el('drop').addEventListener('dragover', e => { e.preventDefault(); if (!this.ocupado) this.el('drop').classList.add('arrastando'); });
    this.el('drop').addEventListener('dragleave', () => this.el('drop').classList.remove('arrastando'));
    this.el('drop').addEventListener('drop', e => {
      e.preventDefault(); this.el('drop').classList.remove('arrastando');
      if (this.ocupado || !e.dataTransfer.files.length) return;
      const transferencia = new DataTransfer(); transferencia.items.add(e.dataTransfer.files[0]);
      this.el('arquivo').files = transferencia.files; this.atualizarArquivo();
    });
    this.atualizarBotao();
  }
  icone(nome) {
    const caminhos = {
      arquivo: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
      busca: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      brilho: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7ZM20 2v4M18 4h4"/>',
      upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos[nome] || caminhos.arquivo}</svg>`;
  }
  montar() {
    // Template estático compartilhado pelos dois frontends; conteúdo de
    // arquivos e respostas da IA são inseridos somente com textContent.
    this.root.innerHTML = `
      <div class="logs-shell">
        <header class="logs-hero">
          <div><span class="logs-eyebrow">DIAGNÓSTICO PROTHEUS</span><h2>Do log ao próximo passo.</h2><p>Encontre os erros, as possíveis causas e soluções.</p></div>
          <div class="logs-hero-tools"><button type="button" id="logs-historico" aria-expanded="false" aria-controls="logs-historico-area">Histórico de análises</button><span class="logs-hero-icon">${this.icone('brilho')}</span></div>
        </header>
        <section id="logs-historico-area" class="logs-history" hidden><div class="logs-list-heading"><div><h3>Análises salvas</h3><p>Últimas 50 análises da empresa. Reabra sem chamar a IA novamente.</p></div></div><div id="logs-historico-acoes" class="logs-history-actions" hidden><label><input type="checkbox" id="logs-historico-todas"> Selecionar todas as exibidas</label><button type="button" id="logs-historico-excluir" disabled>Excluir selecionadas</button></div><p id="logs-historico-status" role="status" aria-live="polite"></p><div id="logs-historico-lista" aria-live="polite"></div></section>
        <div class="logs-workspace">
          <details class="logs-source" aria-label="Escolha do arquivo" open>
            <summary class="logs-section-head"><span class="logs-step-number">01</span><span class="logs-source-title"><b>Comece pelo arquivo</b><small>Escolha a origem do log que deseja investigar.</small></span><span class="logs-format">.log / .log.txt</span></summary>
            <div class="logs-source-actions"><div class="logs-source-tabs" role="group" aria-label="Origem do log">
              <button type="button" id="logs-modo-chamado" aria-pressed="true">${this.icone('arquivo')}<span>Logs do atendimento</span></button>
              <button type="button" id="logs-modo-avulso" aria-pressed="false">${this.icone('upload')}<span>Anexar log avulso</span></button>
            </div><button type="button" id="logs-analisar" class="logs-primario">${this.icone('brilho')}<span>Analisar log</span></button></div>
            <div id="logs-origem-chamado" class="logs-source-body">
              <div class="logs-list-heading"><p id="logs-contexto">Selecione um chamado para consultar os anexos.</p><button type="button" id="logs-atualizar" class="logs-text-button">Atualizar</button></div>
              <div id="logs-lista" class="logs-lista" aria-live="polite"></div>
            </div>
            <div id="logs-origem-avulso" class="logs-source-body" hidden>
              <input type="file" id="logs-arquivo" accept=".log,.txt" aria-label="Selecionar arquivo .log ou .log.txt" hidden>
              <div class="logs-drop" id="logs-drop"><span class="logs-drop-icon">${this.icone('upload')}</span><h4>Seu arquivo, uma leitura mais clara.</h4><p>Arraste o log até aqui ou selecione no computador.</p><button type="button" id="logs-escolher">Selecionar arquivo</button><span class="logs-file-name" id="logs-nome-arquivo">Nenhum arquivo selecionado</span><small>.log ou .log.txt · até 20 MB</small></div>
              <p class="logs-source-note">Análise independente: não cria chamado nem vincula o arquivo ao atendimento aberto.</p>
            </div>
            <footer class="logs-source-footer"><span id="logs-ajuda">Escolha um arquivo para continuar.</span></footer>
          </details>
        </div>
        <div class="logs-feedback"><p id="logs-status" role="status" aria-live="polite"></p><button type="button" id="logs-ver-progresso" hidden>Ver andamento</button></div>
        <section id="logs-resultados-area" hidden>
          <div class="logs-results-header"><div><span class="logs-eyebrow">02 · RESULTADO DA ANÁLISE</span><h2>O que o log está dizendo</h2></div><button type="button" id="logs-baixar" hidden>Baixar relatório</button></div>
          <div class="logs-search"><label for="logs-busca">${this.icone('busca')}<span class="logs-sr-only">Buscar palavra, mensagem ou rotina</span></label><input type="search" id="logs-busca" maxlength="100" placeholder="Buscar palavra, mensagem, campo ou rotina…"><button type="button" id="logs-buscar-arquivo">Buscar no arquivo completo</button></div>
          <div class="logs-filter-row"><label><input type="checkbox" id="logs-somente-analisados"> Somente analisados pela IA</label><span id="logs-filtro-status" role="status" aria-live="polite"></span></div>
          <p id="logs-filtro-vazio" class="logs-filter-empty" role="status" hidden></p>
          <p id="logs-busca-status" class="logs-search-status" role="status" aria-live="polite"></p><div id="logs-busca-arquivo"></div>
          <div id="logs-resultado"></div>
        </section>
      </div>
      <dialog id="logs-splash" class="logs-dialog" aria-labelledby="logs-splash-titulo" aria-describedby="logs-splash-descricao">
        <div class="logs-dialog-top"><span class="logs-processing-orb">${this.icone('brilho')}</span><span class="logs-live-label"><i></i> ANÁLISE EM ANDAMENTO</span><h2 id="logs-splash-titulo">Transformando o log em clareza.</h2><p id="logs-splash-descricao">Continue no chat. Acompanhe aqui as etapas confirmadas pelo sistema.</p></div>
        <ol class="logs-progress-steps">${[['arquivo','Preparar o arquivo','Receber o envio ou carregar o anexo selecionado.'],['varredura','Localizar as ocorrências','Ler o log e reunir os trechos relevantes.'],['ia','Investigar com a IA','Relacionar evidências, possíveis causas e ações.'],['relatorio','Organizar o diagnóstico','Preparar o resumo e os detalhes para consulta.']].map(([id,t,d],i) => `<li data-log-step="${id}"><span class="logs-progress-dot">${i+1}</span><div><b>${t}</b><small>${d}</small></div><span class="logs-step-state">Aguardando</span></li>`).join('')}</ol>
        <div class="logs-dialog-bottom"><span id="logs-tempo">Iniciando agora</span><button type="button" id="logs-continuar">Recolher detalhes</button></div><p class="logs-dialog-note">Troque de chamado ou vá para o chat. Este acompanhamento não bloqueia a navegação.</p>
      </dialog>`;
  }
  el(id) { return document.getElementById(`logs-${id}`); }
  montarMonitor() {
    this.monitor = this.node('aside', null, 'logs-floating' + (this.root.closest('#panel-logs') ? ' logs-floating-j2a' : ''));
    this.monitor.hidden = true;
    this.monitor.setAttribute('aria-label', 'Acompanhamento da análise de log');
    this.monitor.innerHTML = `<div class="logs-monitor" id="logs-monitor" data-estado="processando"><div class="logs-monitor-heading"><span class="logs-monitor-icon">${this.icone('brilho')}</span><div><b id="logs-monitor-titulo">Analisando seu log</b><span id="logs-monitor-arquivo"></span></div><button type="button" id="logs-monitor-recolher" aria-label="Recolher acompanhamento" aria-expanded="true" aria-controls="logs-monitor-status">−</button><button type="button" id="logs-monitor-fechar" aria-label="Dispensar aviso da análise" hidden>×</button></div><p id="logs-monitor-status" role="status" aria-live="polite"></p><div class="logs-monitor-footer"><small id="logs-monitor-tempo">Iniciando agora</small><button type="button" id="logs-monitor-detalhes" aria-controls="logs-splash" aria-expanded="false">Ver etapas</button><button type="button" id="logs-monitor-resultado" hidden>Ver resultado</button></div></div>`;
    this.monitor.append(this.el('splash'));
    document.body.append(this.monitor);
    this.el('monitor-detalhes').addEventListener('click', () => this.expandirProgresso());
    this.el('monitor-recolher').addEventListener('click', () => this.recolherMonitor(!this.monitor.classList.contains('recolhido')));
    this.el('monitor-resultado').addEventListener('click', () => this.verResultadoConcluido());
    this.el('monitor-fechar').addEventListener('click', () => { if (!this.ocupado) { this.monitor.hidden = true; this.concluida = null; } });
    this.el('splash').addEventListener('close', () => this.el('monitor-detalhes').setAttribute('aria-expanded', 'false'));
  }
  expandirProgresso() {
    if (!this.ocupado) return;
    const janela = this.el('splash');
    if (janela.open) janela.close();
    else janela.show();
    this.el('monitor-detalhes').setAttribute('aria-expanded', String(janela.open));
  }
  recolherMonitor(valor) {
    this.monitor.classList.toggle('recolhido', valor);
    this.el('monitor-recolher').textContent = valor ? '+' : '−';
    this.el('monitor-recolher').setAttribute('aria-expanded', String(!valor));
    this.el('monitor-recolher').setAttribute('aria-label', valor ? 'Expandir acompanhamento' : 'Recolher acompanhamento');
    if (valor) this.el('splash').close();
  }
  concluirMonitor(resultado, fonte, erro = null) {
    this.concluida = resultado ? { resultado, fonte } : null;
    this.monitor.hidden = false;
    this.recolherMonitor(false);
    const aviso = resultado?.ia?.indisponivel || resultado?.historico?.salvo === false;
    if (resultado) this.el('monitor-arquivo').textContent = `${resultado.origem?.numero ? 'Chamado #' + resultado.origem.numero + ' · ' : ''}${resultado.arquivo.nome}`;
    this.el('monitor').dataset.estado = erro ? 'erro' : aviso ? 'aviso' : 'concluido';
    this.el('monitor-titulo').textContent = erro ? 'Não foi possível concluir' : aviso ? 'Leitura concluída com aviso' : 'Análise concluída';
    this.el('monitor-status').textContent = erro || (resultado.historico?.salvo === false ? 'O resultado não foi salvo. Abra e baixe o relatório.' : resultado.ia?.indisponivel ? resultado.ia.falha?.mensagem || 'A IA não concluiu o diagnóstico. Consulte as evidências localizadas.' : 'Seu diagnóstico está pronto para consulta.');
    this.el('monitor-detalhes').hidden = true;
    this.el('monitor-resultado').hidden = !resultado;
    this.el('monitor-fechar').hidden = false;
  }
  verResultadoConcluido() {
    if (!this.concluida || this.ocupado) return;
    const { resultado, fonte } = this.concluida;
    // A navegação pode consultar anexos; restaure a fonte depois de abrir a aba.
    this.opcoes.abrirPainel?.();
    this.versaoLista++; this.listaController?.abort(); this.carregando = false;
    this.versaoAnalise++;
    this.limparResultado(); this.relatorio = resultado; this.fonteAnalise = fonte;
    this.renderizar(resultado);
    this.status(resultado.ia?.indisponivel ? resultado.ia.falha?.mensagem || 'A IA não concluiu o diagnóstico. Consulte as evidências localizadas.' : 'Resultado do arquivo analisado. Confira a identificação do chamado no relatório.', resultado.ia?.indisponivel ? 'aviso' : 'sucesso');
    this.el('resultados-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.monitor.hidden = true;
  }
  chave() { const c = this.opcoes.contexto(); return `${c.empresa}:${c.chamadoId}`; }
  node(tag, texto, classe) {
    const n = document.createElement(tag);
    if (texto != null) n.textContent = texto;
    if (classe) n.className = classe;
    return n;
  }
  status(texto, tipo = '') { this.el('status').textContent = texto; this.el('status').dataset.tipo = tipo; }
  atualizarArquivo() {
    const arquivo = this.el('arquivo').files[0];
    this.el('nome-arquivo').textContent = arquivo ? `${arquivo.name} · ${(arquivo.size / 1024 / 1024).toFixed(2)} MB` : 'Nenhum arquivo selecionado';
    this.el('drop').classList.toggle('selecionado', !!arquivo);
    this.atualizarBotao();
    if (arquivo && this.relatorio?.historico?.id && this.relatorio.origem?.tipo === 'avulso' && this.reaberta) {
      const body = new FormData(); body.append('arquivo', arquivo);
      this.fonteAnalise = { modo: 'avulso', caminho: '/radar/logs/avulso', opts: { method: 'POST', body } };
      this.root.querySelectorAll('[data-log-grupo]').forEach(b => { b.disabled = false; });
    }
    if (arquivo && !/\.log(?:\.txt)?$/i.test(arquivo.name)) this.status('Escolha um arquivo .log ou .log.txt.', 'erro');
    else this.status('');
  }
  atualizarBotao() {
    const arquivo = this.el('arquivo').files[0];
    const pronto = this.modo === 'avulso'
      ? arquivo && /\.log(?:\.txt)?$/i.test(arquivo.name) && arquivo.size > 0 && arquivo.size <= 20 * 1024 * 1024
      : !this.carregando && !!this.el('lista').querySelector('input:checked:not(:disabled)');
    this.el('analisar').disabled = this.ocupado || !pronto;
    this.el('ajuda').textContent = this.ocupado ? 'Sua análise está em andamento.' : pronto ? 'Arquivo pronto para análise.' : this.carregando ? 'Aguarde a consulta dos anexos.' : this.reaberta && this.relatorio?.origem?.tipo === 'avulso' && !arquivo ? 'Relatório salvo aberto. Selecione o original para uma nova análise ou pesquisa no arquivo completo.' : 'Escolha um arquivo para continuar.';
  }
  setModo(modo) {
    if (this.ocupado) return;
    this.modo = modo;
    for (const m of ['chamado', 'avulso']) {
      this.el(`modo-${m}`).setAttribute('aria-pressed', String(m === modo));
      this.el(`origem-${m}`).hidden = m !== modo;
    }
    this.status('');
    if (modo === 'chamado') this.carregar();
    else { this.listaController?.abort(); this.versaoLista++; this.carregando = false; this.atualizarBotao(); }
  }
  abrir() {
    if (!this.ocupado && this.relatorio?.origem?.chamadoId && String(this.relatorio.origem.chamadoId) !== String(this.opcoes.contexto().chamadoId)) this.limparResultado();
    if (this.modo === 'chamado') this.carregar();
    if (!this.relatorio && !this.ocupado) this.restaurarRecente();
  }
  async restaurarRecente() {
    const { chamadoId } = this.opcoes.contexto(); if (!chamadoId) return;
    const chave = this.chave(); const versao = this.versaoAnalise;
    try {
      const r = await this.request(`/radar/logs/historico?chamadoId=${encodeURIComponent(chamadoId)}`);
      if (chave === this.chave() && versao === this.versaoAnalise && !this.relatorio && !this.ocupado && r.analises?.[0]) await this.abrirSalva(r.analises[0].id);
    } catch (_) { /* A consulta de anexos e o acesso manual ao histórico continuam disponíveis. */ }
  }
  fecharHistorico() {
    this.el('historico-area').hidden = true;
    this.el('historico').setAttribute('aria-expanded', 'false');
    this.versaoHistorico = (this.versaoHistorico || 0) + 1;
  }
  async carregarHistorico() {
    if (this.ocupado || this.excluindoHistorico) return;
    const empresa = this.opcoes.contexto().empresa;
    const versao = this.versaoHistorico = (this.versaoHistorico || 0) + 1;
    this.el('historico-area').hidden = false;
    this.el('historico').setAttribute('aria-expanded', 'true');
    this.el('historico-lista').textContent = 'Consultando as análises salvas…';
    this.el('historico-acoes').hidden = true; this.el('historico-status').textContent = '';
    try {
      const r = await this.request('/radar/logs/historico');
      if (empresa !== this.opcoes.contexto().empresa || versao !== this.versaoHistorico) return;
      const lista = this.el('historico-lista'); lista.replaceChildren();
      if (!r.analises?.length) lista.append(this.node('p', 'Nenhuma análise salva ainda. As próximas análises serão guardadas automaticamente.'));
      for (const a of r.analises || []) {
        const linha = this.node('div', null, 'logs-history-row');
        const escolha = this.node('input'); escolha.type = 'checkbox'; escolha.dataset.logHistoricoId = a.id;
        escolha.setAttribute('aria-label', `Selecionar análise de ${a.nome}`);
        const item = this.node('button', null, 'logs-history-item'); item.type = 'button';
        item.append(this.node('b', a.nome), this.node('span', `${a.tipo === 'avulso' ? 'Avulso' : a.numero ? 'Chamado #' + a.numero : 'Atendimento'} · ${new Date(a.atualizadoEm).toLocaleString('pt-BR')} · ${a.ocorrencias} ocorrência(s) · ${(a.bytesHistorico / 1024).toFixed(1)} KB salvos`));
        item.addEventListener('click', () => this.abrirSalva(a.id)); linha.append(escolha, item); lista.append(linha);
      }
      this.el('historico-acoes').hidden = !r.analises?.length;
      this.atualizarSelecaoHistorico();
    } catch (err) { if (empresa === this.opcoes.contexto().empresa && versao === this.versaoHistorico) this.el('historico-lista').textContent = `Não foi possível consultar o histórico: ${err.message}`; }
  }
  atualizarSelecaoHistorico() {
    const opcoes = [...this.el('historico-lista').querySelectorAll('[data-log-historico-id]')];
    const total = opcoes.filter(c => c.checked).length;
    this.el('historico-todas').checked = !!opcoes.length && total === opcoes.length;
    this.el('historico-todas').indeterminate = total > 0 && total < opcoes.length;
    this.el('historico-todas').disabled = !!this.excluindoHistorico;
    this.el('historico-excluir').disabled = !total || !!this.excluindoHistorico;
    this.el('historico-excluir').textContent = this.excluindoHistorico ? 'Excluindo…' : total ? `Excluir selecionadas (${total})` : 'Excluir selecionadas';
  }
  async excluirHistorico() {
    if (this.ocupado || this.excluindoHistorico) return;
    const ids = [...this.el('historico-lista').querySelectorAll('[data-log-historico-id]:checked')].map(c => c.dataset.logHistoricoId);
    if (!ids.length || !window.confirm(`Excluir ${ids.length} análise(s) do histórico compartilhado desta empresa? A exclusão é definitiva para toda a equipe. Os arquivos originais serão preservados e poderão ser analisados novamente.`)) return;
    const empresa = this.opcoes.contexto().empresa;
    this.excluindoHistorico = true; this.atualizarSelecaoHistorico();
    try {
      const r = await this.request('/radar/logs/historico', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (empresa !== this.opcoes.contexto().empresa) return;
      if (ids.includes(this.relatorio?.historico?.id)) this.limparResultado();
      if (ids.includes(this.concluida?.resultado?.historico?.id)) { this.concluida = null; this.monitor.hidden = true; }
      this.excluindoHistorico = false;
      if (!this.el('historico-area').hidden) await this.carregarHistorico();
      if (empresa === this.opcoes.contexto().empresa) this.el('historico-status').textContent = `${r.excluidas} análise(s) excluída(s). Os arquivos originais foram preservados.`;
    } catch (err) {
      if (empresa === this.opcoes.contexto().empresa) this.el('historico-status').textContent = `Não foi possível excluir: ${err.message}`;
    } finally {
      this.excluindoHistorico = false;
      if (empresa === this.opcoes.contexto().empresa) this.atualizarSelecaoHistorico();
    }
  }
  async abrirSalva(id) {
    if (this.ocupado || this.excluindoHistorico) return;
    const chave = this.chave(); const versao = ++this.versaoAnalise;
    try {
      const r = await this.request(`/radar/logs/historico/${encodeURIComponent(id)}`);
      if (chave !== this.chave() || versao !== this.versaoAnalise || this.ocupado) return;
      this.limparResultado(); this.relatorio = r; this.reaberta = true;
      if (r.origem?.tipo !== 'avulso') this.fonteAnalise = { modo: 'chamado', caminho: '/radar/logs/analisar', opts: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chamadoId: r.origem.chamadoId, tipo: r.origem.tipo, arquivoId: r.origem.arquivoId }) } };
      else { this.el('arquivo').value = ''; this.el('nome-arquivo').textContent = 'Selecione o original somente se quiser buscar no arquivo completo.'; }
      this.renderizar(r); this.fecharHistorico();
      this.atualizarBotao();
      this.status('Análise recuperada do histórico. Nenhuma nova chamada à IA foi feita.', 'sucesso');
      this.el('resultados-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { if (chave === this.chave() && versao === this.versaoAnalise) this.status(`Não foi possível reabrir a análise: ${err.message}`, 'erro'); }
  }
  reset() {
    this.empresaAtual = this.opcoes.contexto().empresa;
    this.concluida = null;
    this.monitor.hidden = true;
    this.versaoHistorico = (this.versaoHistorico || 0) + 1;
    this.versaoAnalise++;
    this.versaoLista++;
    this.controller?.abort();
    this.listaController?.abort(); this.carregando = false;
    this.setOcupado(false);
    this.limparResultado();
    this.arquivos = [];
    this.el('arquivo').value = '';
    this.el('nome-arquivo').textContent = 'Nenhum arquivo selecionado';
    this.el('lista').replaceChildren();
    this.fecharHistorico(); this.el('historico-lista').replaceChildren();
    this.el('contexto').textContent = 'Selecione um chamado para consultar seus logs ou anexe um log avulso.';
    this.status('');
    this.atualizarArquivo();
  }
  contextChanged() {
    if (this.empresaAtual !== this.opcoes.contexto().empresa) { this.reset(); return; }
    this.versaoLista++;
    this.arquivos = [];
    this.listaController?.abort(); this.carregando = false;
    this.el('lista').replaceChildren();
    if (this.ocupado) {
      this.el('contexto').textContent = 'O log anterior continua em análise. Você pode atender o chamado atual normalmente.';
      return;
    }
    if (this.modo === 'chamado' || this.fonteAnalise?.modo === 'chamado') {
      this.versaoAnalise++;
      this.controller?.abort();
      this.setOcupado(false);
      this.status('Selecione o arquivo do chamado atual para analisar.');
      this.el('contexto').textContent = 'A lista será atualizada ao abrir a aba.';
      this.limparResultado();
    }
    this.atualizarBotao();
  }
  async request(caminho, opts = {}) {
    const { onProgress, ...fetchOpts } = opts;
    const r = await fetch(this.opcoes.url(caminho), { ...fetchOpts, headers: { ...this.opcoes.headers(), ...opts.headers } });
    if (r.ok && r.headers.get('content-type')?.includes('application/x-ndjson')) {
      const leitor = r.body.getReader(); const decoder = new TextDecoder();
      let pendente = ''; let resultado;
      const consumir = linha => {
        if (!linha.trim()) return;
        const evento = JSON.parse(linha);
        if (evento.tipo === 'erro') throw new Error(evento.error || 'Não foi possível concluir a análise.');
        if (evento.tipo === 'progresso') onProgress?.(evento);
        if (evento.tipo === 'resultado') resultado = evento.resultado;
      };
      try {
        for (;;) {
          const { done, value } = await leitor.read();
          pendente += decoder.decode(value, { stream: !done });
          const partes = pendente.split('\n'); pendente = partes.pop();
          partes.forEach(consumir);
          if (done) { consumir(pendente); break; }
        }
      } finally { leitor.releaseLock(); }
      if (!resultado) throw new Error('A conexão terminou antes da conclusão. Tente novamente.');
      return resultado;
    }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Não foi possível concluir a operação (${r.status}).`);
    return body;
  }
  async carregar() {
    if (this.ocupado) return;
    this.listaController?.abort();
    const versao = ++this.versaoLista;
    const chave = this.chave();
    const { chamadoId } = this.opcoes.contexto();
    this.arquivos = [];
    this.el('lista').replaceChildren();
    if (!chamadoId) {
      this.el('contexto').textContent = 'Nenhum chamado selecionado. Selecione um na fila ou use “Anexar log avulso”.';
      this.estadoLista('Nenhum chamado selecionado', 'Abra um chamado na fila para ver seus logs ou escolha “Anexar log avulso”.');
      this.carregando = false; this.el('atualizar').disabled = false; this.atualizarBotao();
      return;
    }
    this.el('contexto').textContent = 'Consultando logs do chamado selecionado…';
    this.carregando = true; this.el('atualizar').disabled = true; this.el('atualizar').textContent = 'Buscando…';
    this.el('lista').setAttribute('aria-busy', 'true');
    this.estadoLista('Buscando os logs do atendimento', 'Consultando os anexos do chat e do SoftExpert. Aguarde um momento.', 'carregando');
    this.atualizarBotao();
    const controller = new AbortController(); this.listaController = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const dados = await this.request(`/radar/logs?chamadoId=${encodeURIComponent(chamadoId)}`, { signal: controller.signal });
      if (versao !== this.versaoLista || chave !== this.chave()) return;
      this.el('contexto').textContent = `Chamado #${dados.numero} · ${(dados.arquivos || []).length} arquivo(s) .log`;
      this.arquivos = dados.arquivos || [];
      this.el('lista').replaceChildren();
      for (const aviso of dados.avisos || []) this.el('lista').append(this.node('p', aviso, 'logs-aviso'));
      if (!this.arquivos.length) this.estadoLista(dados.avisos?.length ? 'Consulta incompleta' : 'Nenhum log neste atendimento', dados.avisos?.length ? 'Nenhum arquivo foi encontrado nas origens consultadas. A origem indisponível pode conter outros logs; tente atualizar.' : 'A consulta terminou e não encontrou arquivos .log ou .log.txt. Você pode anexar um log avulso.');
      this.arquivos.forEach((a, i) => {
        const label = this.node('label', null, 'logs-item');
        const radio = this.node('input');
        radio.type = 'radio'; radio.name = 'logs-selecao'; radio.value = String(i); radio.disabled = !a.disponivel;
        radio.dataset.disponivel = String(!!a.disponivel);
        radio.checked = a.disponivel && this.arquivos.filter(a => a.disponivel).length === 1;
        const descricao = this.node('span', a.nome);
        const data = a.data ? new Date(a.data).toLocaleString('pt-BR') : 'Data não informada';
        descricao.append(this.node('small', `${a.origem} · ${data}${a.tamanho ? ` · ${(a.tamanho / 1024).toFixed(1)} KB` : ''}${!a.disponivel ? ' · Original indisponível' : ''}`));
        label.append(radio, descricao); this.el('lista').append(label);
      });
    } catch (err) {
      if (versao === this.versaoLista && chave === this.chave()) {
        const motivo = err.name === 'AbortError' ? 'A consulta demorou mais que o esperado. Clique em Atualizar para tentar novamente.' : err.message;
        this.el('contexto').textContent = 'Não foi possível consultar os anexos.';
        this.el('lista').replaceChildren(); this.estadoLista('Não conseguimos buscar os logs', motivo, 'erro');
      }
    } finally {
      clearTimeout(timeout);
      if (versao === this.versaoLista) {
        this.carregando = false; this.el('lista').setAttribute('aria-busy', 'false');
        this.el('atualizar').disabled = this.ocupado; this.el('atualizar').textContent = 'Atualizar'; this.atualizarBotao();
      }
    }
  }
  estadoLista(titulo, descricao, tipo = 'vazio') {
    const estado = this.node('div', null, `logs-state ${tipo}`);
    const simbolo = this.node('span', null, 'logs-state-icon'); simbolo.innerHTML = this.icone(tipo === 'carregando' ? 'busca' : 'arquivo');
    estado.append(simbolo, this.node('h4', titulo), this.node('p', descricao));
    this.el('lista').append(estado);
  }
  limparResultado() {
    this.reaberta = false;
    this.buscaController?.abort(); this.buscando = false;
    this.root.classList.remove('tem-resultado');
    this.relatorio = null;
    this.fonteAnalise = null;
    this.el('resultado').replaceChildren();
    this.el('baixar').hidden = true;
    this.el('resultados-area').hidden = true;
    this.el('busca').value = ''; this.el('busca-arquivo').replaceChildren(); this.el('busca-status').textContent = '';
    this.el('somente-analisados').checked = false; this.el('filtro-status').textContent = ''; this.el('filtro-vazio').hidden = true;
  }
  setOcupado(valor) {
    this.ocupado = valor;
    for (const id of ['modo-chamado', 'modo-avulso', 'atualizar', 'arquivo', 'escolher', 'buscar-arquivo', 'historico']) this.el(id).disabled = valor;
    this.el('analisar').querySelector('span').textContent = valor ? 'Análise em andamento…' : 'Analisar log';
    this.root.querySelectorAll('[data-log-grupo]').forEach(b => { b.disabled = valor; });
    this.el('lista').querySelectorAll('input').forEach(r => { r.disabled = valor || r.dataset.disponivel !== 'true'; });
    this.el('resultado').setAttribute('aria-busy', String(valor));
    this.el('ver-progresso').hidden = !valor;
    clearInterval(this.timerProgresso);
    if (valor) {
      this.concluida = null; this.inicioProcessamento = Date.now();
      this.recolherMonitor(false);
      this.monitor.hidden = false; this.el('monitor').dataset.estado = 'processando';
      this.el('monitor-titulo').textContent = 'Analisando seu log';
      this.el('monitor-detalhes').hidden = false; this.el('monitor-resultado').hidden = true; this.el('monitor-fechar').hidden = true;
      this.progresso({ etapa: 'arquivo' });
      this.el('tempo').textContent = 'Iniciando agora';
      this.el('monitor-tempo').textContent = 'Iniciando agora';
      this.timerProgresso = setInterval(() => {
        const tempo = `Tempo decorrido: ${Math.floor((Date.now() - this.inicioProcessamento) / 1000)}s`;
        this.el('tempo').textContent = tempo; this.el('monitor-tempo').textContent = tempo;
      }, 1000);
    } else {
      this.el('splash').close();
    }
    this.atualizarBotao();
  }
  progresso(evento) {
    const etapas = ['arquivo', 'varredura', 'ia', 'relatorio']; const atual = etapas.indexOf(evento.etapa);
    if (atual < 0) return;
    this.monitor.querySelectorAll('[data-log-step]').forEach((li, i) => {
      li.dataset.estado = i < atual ? 'concluido' : i === atual ? 'ativo' : 'aguardando';
      li.querySelector('.logs-step-state').textContent = i < atual ? 'Concluído' : i === atual ? 'Em andamento' : 'Aguardando';
      if (i === 2 && (evento.semErros || evento.iaIndisponivel)) {
        li.dataset.estado = 'limitado'; li.querySelector('.logs-step-state').textContent = evento.semErros ? 'Dispensado' : 'Indisponível';
      }
    });
    const mensagem = { arquivo: 'Preparando o arquivo para análise…', varredura: 'Localizando as ocorrências e reunindo evidências…', ia: 'A IA está investigando os erros e possíveis ações…', relatorio: 'Organizando o relatório…' }[evento.etapa];
    this.el('monitor-status').textContent = mensagem;
    this.status(mensagem);
  }
  async analisar(grupoId = null) {
    if (this.ocupado) return;
    const modo = grupoId ? this.fonteAnalise?.modo : this.modo;
    if (!modo) return;
    const chave = this.chave();
    let caminho;
    let opts;
    let nomeArquivo = this.relatorio?.arquivo?.nome;
    if (grupoId) {
      caminho = `${this.fonteAnalise.caminho}?grupoId=${encodeURIComponent(grupoId)}${this.relatorio?.historico?.id ? '&historicoId=' + encodeURIComponent(this.relatorio.historico.id) : ''}`;
      opts = this.fonteAnalise.opts;
    } else if (modo === 'avulso') {
      const arquivo = this.el('arquivo').files[0];
      nomeArquivo = arquivo?.name;
      if (!arquivo || !/\.log(?:\.txt)?$/i.test(arquivo.name)) { this.status('Selecione um arquivo com extensão .log ou .log.txt.'); return; }
      if (!arquivo.size || arquivo.size > 20 * 1024 * 1024) { this.status('Selecione um arquivo não vazio, de até 20 MB.'); return; }
      const body = new FormData(); body.append('arquivo', arquivo);
      caminho = '/radar/logs/avulso'; opts = { method: 'POST', body };
    } else {
      const selecao = document.querySelector('input[name="logs-selecao"]:checked');
      const arquivo = selecao && this.arquivos[Number(selecao.value)];
      nomeArquivo = arquivo?.nome;
      if (!arquivo || !arquivo.disponivel) { this.status('Selecione um log disponível na lista.'); return; }
      caminho = '/radar/logs/analisar';
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chamadoId: this.opcoes.contexto().chamadoId, arquivoId: arquivo.id, tipo: arquivo.tipo }) };
    }
    const versao = ++this.versaoAnalise;
    const empresa = this.opcoes.contexto().empresa;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 120000);
    // Reanalisar a mesma fonte complementa o relatório; trocar o arquivo cria outro.
    const fonteAnterior = this.fonteAnalise;
    let mesmaFonte = false;
    if (!grupoId && fonteAnterior?.modo === modo && fonteAnterior.caminho === caminho) {
      if (modo === 'avulso') mesmaFonte = !!opts.body?.get('arquivo') && opts.body.get('arquivo') === fonteAnterior.opts.body?.get('arquivo');
      else {
        const atual = JSON.parse(opts.body); const previa = JSON.parse(fonteAnterior.opts.body);
        mesmaFonte = ['chamadoId', 'arquivoId', 'tipo'].every(c => String(atual[c]) === String(previa[c]));
      }
    }
    const anterior = grupoId || mesmaFonte ? this.relatorio : null;
    if (!grupoId && anterior?.historico?.id) caminho += `?historicoId=${encodeURIComponent(anterior.historico.id)}`;
    if (!grupoId) {
      if (!anterior) this.limparResultado();
      this.fonteAnalise = { caminho: caminho.split('?')[0], opts, modo };
    }
    const fonte = this.fonteAnalise;
    this.el('monitor-arquivo').textContent = nomeArquivo || 'Log selecionado';
    this.setOcupado(true);
    this.status('Lendo o arquivo e analisando as evidências. Aguarde; arquivos grandes podem levar mais tempo.');
    try {
      const resultado = await this.request(caminho + (caminho.includes('?') ? '&' : '?') + 'progresso=1', { ...opts, signal: controller.signal,
        onProgress: e => { if (versao === this.versaoAnalise && empresa === this.opcoes.contexto().empresa) this.progresso(e); } });
      if (versao !== this.versaoAnalise || empresa !== this.opcoes.contexto().empresa) return;
      if (anterior) {
        for (const g of resultado.grupos) if (!g.analise) g.analise = anterior.grupos.find(a => a.id === g.id)?.analise;
        resultado.ia = { ...resultado.ia, gruposAnalisados: resultado.grupos.filter(g => g.analise).length };
        if (anterior.visaoGeral) resultado.visaoGeral = anterior.visaoGeral;
      }
      this.concluirMonitor(resultado, fonte);
      if (modo === 'avulso' || chave === this.chave()) {
        this.relatorio = resultado; this.renderizar(resultado);
        this.status(resultado.historico?.salvo === false ? 'Análise concluída, mas não foi salva. Baixe o relatório para preservar o resultado.' : resultado.ia?.indisponivel ? resultado.ia.falha?.mensagem || 'Leitura concluída. A IA está indisponível; as evidências podem ser consultadas abaixo.' : 'Análise concluída. Seu diagnóstico está pronto abaixo.', resultado.historico?.salvo === false || resultado.ia?.indisponivel ? 'aviso' : 'sucesso');
      } else {
        this.limparResultado();
        this.status('A análise do chamado anterior terminou. Use “Ver resultado” no aviso para consultá-la.', 'sucesso');
      }
    } catch (err) {
      if (versao === this.versaoAnalise && empresa === this.opcoes.contexto().empresa) {
        const mensagem = err.name === 'AbortError' ? 'A análise foi interrompida ou excedeu o tempo de espera. Tente novamente.' : err.message;
        this.status(mensagem, 'erro'); this.concluirMonitor(null, null, mensagem);
      }
    } finally {
      clearTimeout(timeout);
      if (versao === this.versaoAnalise) this.setOcupado(false);
    }
  }
  renderizar(r) {
    this.root.classList.add('tem-resultado');
    this.el('resultados-area').hidden = false;
    const container = this.el('resultado'); container.replaceChildren();
    const resumo = this.node('section', null, 'logs-resumo');
    const estatisticas = this.node('details', null, 'logs-file-summary');
    const tituloArquivo = this.node('summary');
    tituloArquivo.append(this.node('h3', `${r.origem?.tipo === 'avulso' ? 'Análise avulsa' : `Chamado #${r.origem?.numero}`} · ${r.arquivo.nome} — Resumo do arquivo`));
    estatisticas.append(tituloArquivo);
    if (r.historico?.salvo) estatisticas.append(this.node('p', `Salvo no histórico · ${new Date(r.historico.atualizadoEm).toLocaleString('pt-BR')} · ${(r.historico.bytesHistorico / 1024).toFixed(1)} KB. O arquivo original não é armazenado no histórico.`, 'logs-muted'));
    const numeros = this.node('div', null, 'logs-metrics');
    for (const [valor, label] of [[r.cobertura.ocorrencias, 'ocorrências no arquivo'], [r.grupos.length, 'grupos de mensagens'], [r.ia?.gruposAnalisados || 0, 'grupos avaliados pela IA'], [Number(r.cobertura.linhasLidas).toLocaleString('pt-BR'), 'linhas percorridas']]) {
      const metrica = this.node('div'); metrica.append(this.node('strong', valor), this.node('span', label)); numeros.append(metrica);
    }
    estatisticas.append(numeros, this.node('p', 'Ocorrências repetidas não são necessariamente causas diferentes. Confira o contexto antes de decidir uma ação.', 'logs-muted'));
    resumo.append(estatisticas);
    if (r.grupos.length) {
      const comDiagnostico = r.grupos.filter(g => g.analise?.solucoes?.trim()).length;
      const diagnostico = this.node('section', null, 'logs-solutions-summary');
      diagnostico.dataset.estado = comDiagnostico ? 'disponivel' : 'pendente';
      diagnostico.append(this.node('h3', comDiagnostico ? 'Diagnóstico e possíveis soluções' : 'As possíveis soluções ainda não foram geradas'));
      diagnostico.append(this.node('p', comDiagnostico ? `${comDiagnostico} de ${r.grupos.length} grupo(s) com diagnóstico. Consulte as possíveis soluções destacadas em cada erro.` : r.ia?.falha?.mensagem || (r.ia?.indisponivel ? 'A leitura do arquivo terminou, mas a IA não concluiu o diagnóstico. Abaixo estão as evidências, sem soluções geradas.' : 'A IA não retornou um diagnóstico válido para estes grupos.')));
      if (comDiagnostico) {
        const ver = this.node('button', 'Ver possíveis soluções'); ver.type = 'button';
        ver.addEventListener('click', () => {
          const alvo = this.el('resultado').querySelector('[data-log-card]:not([hidden]) .logs-diagnostico.solucoes');
          if (alvo) { alvo.closest('details').open = true; alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); alvo.focus({ preventScroll: true }); }
          else this.status('Nenhuma solução corresponde aos filtros atuais. Altere a busca ou desmarque o filtro para consultar outros diagnósticos.', 'aviso');
        });
        diagnostico.append(ver);
      } else diagnostico.append(this.node('p', this.fonteAnalise ? 'Use “Analisar este erro” para tentar gerar o diagnóstico e as soluções de uma ocorrência.' : 'Para tentar novamente, acesse o anexo do chamado ou selecione o arquivo avulso original.'));
      resumo.append(diagnostico);
    }
    const familias = this.node('div', null, 'logs-family-list');
    for (const familia of r.familias || []) {
      const item = this.node('span', null, 'logs-family'); item.append(this.node('b', familia.quantidade), this.node('span', familia.titulo)); familias.append(item);
    }
    estatisticas.append(familias);
    if (!r.grupos.length) resumo.append(this.node('p', 'Nenhum erro foi reconhecido pelos padrões examinados. Isso não confirma que o ambiente está livre de problemas.'));
    container.append(resumo);
    for (const grupo of r.grupos) {
      const card = this.node('article', null, 'logs-cartao');
      card.dataset.logCard = grupo.id; card.dataset.busca = this.normalizar(JSON.stringify(grupo)); card.dataset.analisado = String(!!grupo.analise);
      const cabecalho = this.node('div', null, 'logs-error-header');
      cabecalho.append(this.node('span', grupo.id.replace('erro-', '#'), 'logs-error-index'), this.node('span', `${grupo.quantidade} ocorrência(s)`, 'logs-count'), this.node('span', grupo.analise ? 'Analisado pela IA' : 'Evidência localizada', 'logs-analysis-label'));
      card.append(cabecalho, this.node('h3', grupo.titulo));
      if (grupo.analise) {
        const informacoes = this.node('details', null, 'logs-informacoes-analise');
        informacoes.open = true;
        informacoes.append(this.node('summary', 'Informações da análise'));
        const conteudo = this.node('div', null, 'logs-diagnostico-grid');
        for (const [campo, titulo] of [['explicacao', 'O que aconteceu'], ['causaProvavel', 'Causa provável'], ['solucoes', 'Possíveis soluções']]) {
          const bloco = this.node('section', null, `logs-diagnostico ${campo}`);
          if (campo === 'solucoes') bloco.tabIndex = -1;
          bloco.append(this.node('h4', titulo), this.node('p', grupo.analise[campo])); conteudo.append(bloco);
        }
        informacoes.append(conteudo); card.append(informacoes);
        const validacao = this.node('details', null, 'logs-validation'); validacao.append(this.node('summary', 'Como validar e o que falta confirmar'));
        for (const [campo, titulo] of [['validacao', 'Como validar'], ['informacoesFaltantes', 'O que falta confirmar']]) {
          validacao.append(this.node('h4', titulo), this.node('p', grupo.analise[campo]));
        }
        card.append(validacao);
      } else {
        card.append(this.node('p', 'Sem diagnóstico por IA para este grupo. As evidências abaixo mostram o que foi localizado no arquivo.'));
        const botao = this.node('button', 'Analisar este erro'); botao.type = 'button';
        botao.dataset.logGrupo = grupo.id; botao.disabled = this.ocupado || !this.fonteAnalise;
        if (!this.fonteAnalise) botao.title = 'Selecione o arquivo original para analisar este erro.';
        botao.addEventListener('click', () => this.analisar(grupo.id));
        card.append(botao);
      }
      const detalhe = this.node('details'); detalhe.append(this.node('summary', 'Ver evidência e linhas do log (trecho limitado)'));
      detalhe.append(this.node('p', `Linhas do log: ${grupo.linhas.join(', ')}${grupo.quantidade > grupo.linhas.length ? ' (lista limitada)' : ''}`));
      if (grupo.rotina) detalhe.append(this.node('p', `Referência técnica: ${grupo.rotina}`));
      detalhe.append(this.node('pre', [...(grupo.contextoAnterior || []), ...grupo.evidencia].map(l => `${l.linha}: ${l.texto}${l.truncada ? ' […]' : ''}`).join('\n')));
      card.append(detalhe); container.append(card);
    }
    this.el('baixar').hidden = false;
    this.filtrar();
  }
  normalizar(texto) { return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'); }
  filtrar() {
    if (this.buscando) { this.buscaController?.abort(); this.buscando = false; this.el('buscar-arquivo').disabled = this.ocupado; }
    const termo = this.normalizar(this.el('busca').value.trim()); let visiveis = 0;
    const somenteAnalisados = this.el('somente-analisados').checked;
    let total = 0; let analisados = 0;
    this.root.querySelectorAll('[data-log-card]').forEach(card => {
      total++; if (card.dataset.analisado === 'true') analisados++;
      card.hidden = (somenteAnalisados && card.dataset.analisado !== 'true') || (!!termo && !card.dataset.busca.includes(termo)); if (!card.hidden) visiveis++;
    });
    this.el('filtro-status').textContent = `${visiveis} de ${total} erro(s) exibido(s) · ${analisados} analisado(s)`;
    this.el('filtro-vazio').hidden = visiveis > 0 || !total;
    this.el('filtro-vazio').textContent = somenteAnalisados && !analisados ? 'Nenhum erro deste relatório possui diagnóstico por IA ainda. Desmarque o filtro para escolher um erro e analisá-lo.' : 'Nenhum erro corresponde aos filtros. Altere a busca ou desmarque “Somente analisados pela IA”.';
    this.el('busca-status').textContent = termo ? `${visiveis} de ${this.relatorio?.grupos.length || 0} grupos correspondem à busca. Use “Buscar no arquivo completo” para localizar também outros trechos do log.` : '';
    this.el('busca-arquivo').replaceChildren();
  }
  marcar(texto, termo) {
    const span = this.node('span'); const normal = this.normalizar(texto); const busca = this.normalizar(termo);
    let inicio = 0; let pos;
    while (busca && (pos = normal.indexOf(busca, inicio)) >= 0) {
      span.append(document.createTextNode(texto.slice(inicio, pos)), this.node('mark', texto.slice(pos, pos + busca.length)));
      inicio = pos + busca.length;
    }
    span.append(document.createTextNode(texto.slice(inicio))); return span;
  }
  async buscarArquivo() {
    if (this.ocupado || this.buscando) return;
    if (!this.fonteAnalise) { this.el('busca-status').textContent = 'O histórico guarda o diagnóstico e as evidências, não o log completo. Selecione novamente o arquivo original na opção avulsa para pesquisar seu conteúdo.'; return; }
    const termo = this.el('busca').value.trim();
    if (termo.length < 2) { this.el('busca-status').textContent = 'Digite pelo menos 2 caracteres para buscar no arquivo completo.'; return; }
    const versao = this.versaoAnalise; const fonte = this.fonteAnalise; const empresa = this.opcoes.contexto().empresa;
    this.buscando = true; this.el('buscar-arquivo').disabled = true;
    this.el('busca-status').textContent = 'Procurando no arquivo completo…';
    const controller = new AbortController(); this.buscaController?.abort(); this.buscaController = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const r = await this.request(`${fonte.caminho}?busca=${encodeURIComponent(termo)}${this.relatorio?.historico?.id ? '&historicoId=' + encodeURIComponent(this.relatorio.historico.id) : ''}`, { ...fonte.opts, signal: controller.signal });
      if (versao !== this.versaoAnalise || empresa !== this.opcoes.contexto().empresa || termo !== this.el('busca').value.trim()) return;
      this.el('busca-arquivo').replaceChildren();
      this.el('busca-status').textContent = r.total ? `${r.total} linha(s) encontrada(s) no arquivo completo. ${r.total > r.limite ? `Mostrando as primeiras ${r.limite}. Refine a busca para localizar outros trechos.` : 'Os trechos estão destacados abaixo.'}` : 'Nenhuma ocorrência desta expressão foi encontrada no arquivo completo.';
      for (const hit of r.resultados) {
        const card = this.node('details', null, 'logs-search-hit'); card.open = true;
        card.append(this.node('summary', `Encontrado na linha ${hit.linha}`)); const pre = this.node('pre');
        for (const l of hit.evidencia) { pre.append(this.marcar(`${l.linha}: ${l.texto}`, termo), document.createTextNode('\n')); }
        card.append(pre); this.el('busca-arquivo').append(card);
      }
    } catch (err) {
      if (versao === this.versaoAnalise && this.buscaController === controller && empresa === this.opcoes.contexto().empresa && termo === this.el('busca').value.trim()) this.el('busca-status').textContent = err.name === 'AbortError' ? 'A busca foi interrompida. Tente novamente.' : `Não foi possível buscar: ${err.message}`;
    } finally {
      clearTimeout(timeout);
      if (this.buscaController === controller) { this.buscando = false; this.el('buscar-arquivo').disabled = this.ocupado; }
    }
  }
  baixar() {
    if (!this.relatorio) return;
    const r = this.relatorio;
    const partes = [`Análise de Logs — ${r.arquivo.nome}`, r.origem?.tipo === 'avulso' ? 'Análise avulsa' : `Chamado #${r.origem?.numero}`,
      `${r.cobertura.linhasLidas} linhas lidas; ${r.cobertura.ocorrencias} ocorrências.`];
    for (const familia of r.familias || []) partes.push(`${familia.titulo}: ${familia.quantidade} ocorrência(s).`);
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
