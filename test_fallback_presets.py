#!/usr/bin/env python3
"""
Testa a interface de seleção de fallback presets em config-ia.html
"""
from playwright.sync_api import sync_playwright
import time

def test_fallback_presets():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # headless=False para ver a tela
        page = browser.new_page()

        # Navegar para a página
        url = "http://localhost:3000/apps/IA%20Command/frontend/config-ia.html"
        print(f"🔄 Abrindo {url}...")
        page.goto(url)
        page.wait_for_load_state('networkidle')

        # Tirar screenshot da página carregada
        print("📸 Tirando screenshot inicial...")
        page.screenshot(path='/tmp/01_loaded.png', full_page=True)

        # Navegar para a aba "Comportamento"
        print("🔍 Procurando aba 'Comportamento'...")
        comportamento_tab = page.locator("button:has-text('⚙ Comportamento')")
        if comportamento_tab.is_visible():
            print("✓ Aba 'Comportamento' encontrada")
            comportamento_tab.click()
            page.wait_for_timeout(500)  # Aguardar animação
            print("📸 Screenshot após clicar em 'Comportamento'")
            page.screenshot(path='/tmp/02_comportamento_tab.png', full_page=True)
        else:
            print("✗ Aba 'Comportamento' não encontrada!")
            return

        # Verificar se os 3 cards estão visíveis
        print("\n🎯 Testando cards de preset...")
        cards = page.locator('.fallback-card')
        card_count = cards.count()
        print(f"✓ {card_count} cards encontrados")

        if card_count < 3:
            print("✗ Menos de 3 cards encontrados!")
            return

        # Testar clique no segundo card (Máxima Qualidade)
        print("\n🖱️ Testando clique em 'Máxima Qualidade'...")
        card2 = cards.nth(1)
        card2.click()
        page.wait_for_timeout(300)

        # Verificar se o segundo card ficou selecionado
        selected = page.locator('.fallback-card-selected')
        if selected.count() == 1:
            selected_title = selected.locator('.fallback-card-title').text_content()
            print(f"✓ Card selecionado: {selected_title}")
        else:
            print(f"✗ Número incorreto de cards selecionados: {selected.count()}")

        page.screenshot(path='/tmp/03_card2_selected.png', full_page=True)

        # Testar clique no terceiro card (Personalizado)
        print("\n🖱️ Testando clique em 'Personalizado'...")
        card3 = cards.nth(2)
        card3.click()
        page.wait_for_timeout(300)

        # Verificar se o input de texto apareceu
        custom_input = page.locator('#fallback-custom-input')
        if custom_input.is_visible():
            print("✓ Input de texto 'Personalizado' apareceu")
        else:
            print("✗ Input de texto não apareceu!")

        page.screenshot(path='/tmp/04_custom_input.png', full_page=True)

        # Testar digitação no input personalizado
        print("\n⌨️ Testando digitação em 'Personalizado'...")
        custom_input.fill('groq,gemini,openai')
        page.wait_for_timeout(200)

        # Verificar se o valor foi propagado para o input oculto
        hidden_fallback = page.locator('#fallback-ordem')
        hidden_value = hidden_fallback.input_value()
        print(f"✓ Valor no input oculto: {hidden_value}")

        if hidden_value == 'groq,gemini,openai':
            print("✓ Valor propagado corretamente!")
        else:
            print(f"✗ Valor não propagado corretamente. Esperado: 'groq,gemini,openai', obtido: '{hidden_value}'")

        page.screenshot(path='/tmp/05_custom_typed.png', full_page=True)

        # Testar clique no primeiro card (Recomendado)
        print("\n🖱️ Testando clique de volta em 'Recomendado'...")
        card1 = cards.nth(0)
        card1.click()
        page.wait_for_timeout(300)

        # Verificar se input desapareceu
        if not custom_input.is_visible():
            print("✓ Input de texto desapareceu como esperado")
        else:
            print("✗ Input de texto ainda visível!")

        # Verificar valor do input oculto
        hidden_value = hidden_fallback.input_value()
        expected = 'groq,deepseek,gemini,claude,openai'
        if hidden_value == expected:
            print(f"✓ Valor restaurado para preset: {hidden_value}")
        else:
            print(f"✗ Valor incorreto. Esperado: '{expected}', obtido: '{hidden_value}'")

        page.screenshot(path='/tmp/06_back_to_recommended.png', full_page=True)

        print("\n✅ Testes completados!")
        print("Screenshots salvos em /tmp/0*.png")

        browser.close()

if __name__ == '__main__':
    test_fallback_presets()
