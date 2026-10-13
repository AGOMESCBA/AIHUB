import json
import re
import sys
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:4987"
ATENDIMENTO_ID = "9b71a00a-ffb7-4d90-ac8b-24a64815469b"  # AI-000835, empresa 1
SCREEN_DIR = "C:/Users/aless/AppData/Local/Temp/claude/c--Apps-iahub/40f02e42-f232-48d2-961f-359f7e031637/scratchpad/homolog-avaliacao"

resultados = {}
console_errors = []
http_errors = []


def registrar(nome, ok, detalhe=""):
    resultados[nome] = {"ok": ok, "detalhe": detalhe}
    print(f"[{'OK' if ok else 'FALHA'}] {nome} {('- ' + detalhe) if detalhe else ''}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("response", lambda resp: http_errors.append((resp.url, resp.status)) if resp.status >= 400 else None)

        # 1) Abrir atendimento
        page.goto(f"{BASE_URL}/app/ia-service/atendimento.html?id={ATENDIMENTO_ID}", wait_until="networkidle")
        page.wait_for_timeout(500)
        titulo_visivel = page.locator("#topbar-codigo").inner_text()
        registrar("abrir_atendimento", "AI-000835" in titulo_visivel, f"topbar={titulo_visivel}")
        page.screenshot(path=f"{SCREEN_DIR}/01-atendimento-aberto.png", full_page=True)

        # 2) Localizar o link "Avaliar investigação" na mensagem do assistente
        link_avaliar = page.locator("button.avaliacao-link", has_text="Avaliar investigação").first
        existe_link = link_avaliar.count() > 0
        registrar("botao_avaliar_presente", existe_link)
        if not existe_link:
            page.screenshot(path=f"{SCREEN_DIR}/02-ERRO-sem-botao.png", full_page=True)
            browser.close()
            return

        link_avaliar.click()
        page.wait_for_timeout(300)
        modal_visivel = page.locator("#avaliacao-modal-backdrop.ativo").count() > 0
        registrar("modal_abre", modal_visivel)
        page.screenshot(path=f"{SCREEN_DIR}/02-modal-aberto.png", full_page=True)

        # 3) Preencher as 5 notas, observações e checkbox, salvar
        campos = [
            "avaliacao-compreensaoProblema",
            "avaliacao-aproveitamentoEvidencias",
            "avaliacao-profundidadeTecnica",
            "avaliacao-orientacaoPratica",
            "avaliacao-confiabilidadeTecnica",
        ]
        valores_primeira_avaliacao = [4, 4, 3, 4, 2]
        for campo, valor in zip(campos, valores_primeira_avaliacao):
            page.locator(f"#{campo}").select_option(str(valor))
        page.locator("#avaliacao-observacoes").fill("Homologação funcional automatizada - 1a avaliação.")
        page.locator("#avaliacao-erro-critico").check()
        page.locator("button.avaliacao-salvar").click()
        page.wait_for_timeout(600)

        card_depois_salvar = page.locator("div.ficha-operacional-avaliacao").first.inner_text()
        soma_esperada = sum(valores_primeira_avaliacao)
        salvou_ok = str(soma_esperada) in card_depois_salvar
        registrar("salvar_avaliacao", salvou_ok, f"card={card_depois_salvar!r} soma_esperada={soma_esperada}")
        page.screenshot(path=f"{SCREEN_DIR}/03-apos-salvar.png", full_page=True)

        # 4) Reabrir (reload da página) e confirmar que persistiu
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(500)
        card_apos_reload = page.locator("div.ficha-operacional-avaliacao").first.inner_text()
        persistiu = str(soma_esperada) in card_apos_reload
        registrar("persistencia_apos_reload", persistiu, f"card={card_apos_reload!r}")
        page.screenshot(path=f"{SCREEN_DIR}/04-apos-reload.png", full_page=True)

        # 5) Editar a avaliação (reabrir modal via link "editar", mudar notas, salvar de novo)
        link_editar = page.locator("button.avaliacao-link", has_text="editar").first
        tem_editar = link_editar.count() > 0
        registrar("botao_editar_presente", tem_editar)
        if tem_editar:
            link_editar.click()
            page.wait_for_timeout(300)

            # Confirma pré-popularização com os valores da 1a avaliação
            valor_pre_populado = page.locator(f"#{campos[0]}").input_value()
            pre_populado_ok = valor_pre_populado == str(valores_primeira_avaliacao[0])
            registrar("pre_populacao_modal_edicao", pre_populado_ok, f"valor={valor_pre_populado}")

            valores_segunda_avaliacao = [5, 5, 5, 5, 5]
            for campo, valor in zip(campos, valores_segunda_avaliacao):
                page.locator(f"#{campo}").select_option(str(valor))
            page.locator("#avaliacao-observacoes").fill("Homologação funcional automatizada - 2a avaliação (editada).")
            page.locator("#avaliacao-erro-critico").uncheck()
            page.locator("button.avaliacao-salvar").click()
            page.wait_for_timeout(600)

            soma_esperada_2 = sum(valores_segunda_avaliacao)
            card_apos_edicao = page.locator("div.ficha-operacional-avaliacao").first.inner_text()
            edicao_ok = str(soma_esperada_2) in card_apos_edicao and "Excelente" in card_apos_edicao
            registrar("editar_avaliacao", edicao_ok, f"card={card_apos_edicao!r}")
            page.screenshot(path=f"{SCREEN_DIR}/05-apos-editar.png", full_page=True)

        # 6) Consultar relatório de homologação
        page.goto(f"{BASE_URL}/app/ia-service/homologacao.html", wait_until="networkidle")
        page.wait_for_timeout(700)
        total_texto = page.locator("#resumo-total").inner_text()
        media_texto = page.locator("#resumo-media").inner_text()
        faixas_texto = page.locator("#resumo-faixas").inner_text()
        relatorio_carregou = total_texto.strip() not in ("", "—") and media_texto.strip() not in ("", "—")
        registrar("relatorio_carrega", relatorio_carregou, f"total={total_texto} media={media_texto} faixas={faixas_texto!r}")
        page.screenshot(path=f"{SCREEN_DIR}/06-relatorio-homologacao.png", full_page=True)

        # Erro tecnico critico: a 2a avaliacao desmarcou o checkbox, entao a
        # lista "erro tecnico critico" deve estar vazia para este caso agora
        # (estado atual = mais recente, que tem erroTecnicoCritico=false).
        lista_erro_critico = page.locator("#lista-erro-critico").inner_text()
        registrar("relatorio_reflete_estado_atual_erro_critico", "Nenhum" in lista_erro_critico or ATENDIMENTO_ID not in lista_erro_critico, f"conteudo={lista_erro_critico[:200]!r}")

        browser.close()

    # Erros de JS/HTTP capturados durante toda a sessao
    registrar("console_sem_erros_js", len(console_errors) == 0, f"erros={console_errors[:5]}")
    registrar("http_sem_erros_4xx_5xx", len(http_errors) == 0, f"erros={http_errors[:10]}")

    with open(f"{SCREEN_DIR}/resultados.json", "w", encoding="utf-8") as f:
        json.dump(resultados, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
