/**
 * dashboard-vagas.js
 * Gerencia a exibição de cards de vagas no dashboard principal.
 */

async function renderizarVagasDashboard() {
    const container = document.getElementById('container-vagas-dashboard');
    if (!container) return;

    try {
        const res = await fetch('/api/dashboard/resumo');
        const data = await res.json();

        if (!data.vagas_abertas || data.vagas_abertas.length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhuma vaga aberta no momento.</div>';
            return;
        }

        container.innerHTML = data.vagas_abertas.map(vaga => `
            <div class="vaga-card">
                <div class="vaga-card-header">
                    <span class="badge-status">Aberta</span>
                    <span class="vaga-id">#${vaga.id}</span>
                </div>
                <h3 class="vaga-titulo">${vaga.funcao_nome}</h3>
                <div class="vaga-info">
                    <p><strong>Qtd:</strong> ${vaga.quantidade || 1}</p>
                    <p><strong>Criada em:</strong> ${new Date(vaga.criado_em).toLocaleDateString('pt-BR')}</p>
                </div>
                <div class="vaga-card-footer">
                    <button class="btn-analisar" onclick="location.href='/analisador.html?vaga_id=${vaga.id}'">
                        Ver Candidatos
                    </button>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Erro ao carregar vagas para o dashboard:', err);
        container.innerHTML = '<div class="error-state">Falha ao carregar vagas.</div>';
    }
}

// Inicia a renderização assim que o contexto de autenticação (window._iahubAuthReady) estiver pronto
window._iahubAuthReady.then(() => {
    // Adiciona o CSS necessário dinamicamente se não existir
    if (!document.getElementById('dashboard-vagas-style')) {
        const style = document.createElement('style');
        style.id = 'dashboard-vagas-style';
        style.innerHTML = `
            #container-vagas-dashboard { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; padding: 20px 0; }
            .vaga-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; transition: transform 0.2s, box-shadow 0.2s; }
            .vaga-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
            .vaga-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .badge-status { background: #28a74522; color: #28a745; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
            .vaga-id { color: var(--text-lo); font-family: monospace; font-size: 12px; }
            .vaga-titulo { margin: 0 0 12px 0; font-size: 18px; color: var(--text-hi); }
            .vaga-info p { margin: 4px 0; font-size: 14px; color: var(--text-lo); }
            .vaga-card-footer { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px; }
            .btn-analisar { width: 100%; background: var(--accent); color: white; border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600; transition: opacity 0.2s; }
            .btn-analisar:hover { opacity: 0.9; }
            .empty-state { color: var(--text-lo); font-style: italic; grid-column: 1 / -1; text-align: center; padding: 40px; }
        `;
        document.head.appendChild(style);
    }
    renderizarVagasDashboard();
});
