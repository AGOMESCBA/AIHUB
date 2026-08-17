# Lobo Guara - Consenso de Arquitetura

Data: 2026-08-17

Este documento registra o consenso de arquitetura para suportar bases Protheus no modelo tradicional e no modelo Lobo Guara/Dicionario no Banco dentro do IA COMMAND.

## Decisao Central

O IA COMMAND deve manter o fluxo que ja funciona para o Protheus tradicional:

```text
IA gera SQL canonico simples
SX2 resolve tabela fisica
SX3 valida campos
backend aplica normalizacoes e guards
middleware executa protecoes finais
```

O Lobo Guara nao deve ser tratado como um prompt complexo que ensina a IA a montar joins com `SYS_COMPANY` ou `SYS_COMPANY_CFG`. A regra acordada e:

```text
A IA continua gerando SQL canonico como se fosse tradicional.
O backend resolve o escopo organizacional de forma deterministica, usando metadados importados e validados.
```

## SX2 Continua Sendo Predominante

O `SX2` da empresa continua sendo a fonte primaria para descobrir qual tabela fisica deve ser usada.

Exemplo:

```text
SD2 -> SD2010
SF2 -> SF2010
```

`SYS_COMPANY` e `SYS_COMPANY_CFG` nao substituem o `SX2`. Elas entram como mapa organizacional para interpretar grupo, empresa, unidade de negocio e filial.

## Metadados Organizacionais Lobo Guara

Quando `modelo_dados = LOBO_GUARA`, o IA COMMAND deve importar e manter cache local das estruturas:

```text
SYS_COMPANY
SYS_COMPANY_CFG
```

Esses dados devem virar metadados internos normalizados, separados de `SX2/SX3`, por exemplo:

```text
protheus_company_profile
protheus_company_tree
protheus_company_sync_log
```

O perfil deve ser configuravel por conexao/empresa, pois nomes de campos e codigos podem variar entre ambientes.

Exemplo de perfil:

```json
{
  "modelo_dados": "LOBO_GUARA",
  "company_cfg": {
    "tabela": "SYS_COMPANY_CFG",
    "campos": {
      "grupo": "XX8_GRPEMP",
      "empresa": "XX8_EMPR",
      "unidade": "XX8_UNID",
      "filial": "XX8_CODIGO",
      "tipo_no": "XX8_TIPO",
      "descricao": "XX8_DESCRI"
    },
    "tipo_no_filial": "3"
  },
  "branch_key_strategy": {
    "modo": "descoberto",
    "validado": true
  }
}
```

Nao devemos fixar `XX8_*`, `CFG_*`, `CFG_TPNODE = '4'` ou `XX8_TIPO = '3'` como constantes universais no codigo. Esses elementos pertencem ao perfil importado/configurado.

## Descoberta e Validacao

Antes de ativar qualquer automacao Lobo Guara, o importador deve descobrir e validar a estrategia de correspondencia entre o codigo interno de filial das tabelas de negocio e a hierarquia corporativa.

Estrategias candidatas:

```text
igualdade direta
concatenacao de campos configurados
estrategia nao descoberta
```

A validacao deve confirmar com dados reais:

- se `SYS_COMPANY` existe;
- se `SYS_COMPANY_CFG` existe;
- quais campos existem de fato;
- qual campo representa tipo de no;
- qual valor representa filial operacional;
- se a chave de filial bate com campos `XX_FILIAL` reais das tabelas de negocio;
- se existem duplicidades ou filiais sem chave confiavel.

Na primeira versao, o modo automatico so deve ser liberado quando o perfil inteiro da conexao estiver validado:

```text
profile.validated = true
```

Pode existir status por filial para auditoria, mas se houver validacao parcial, o comportamento automatico deve falhar fechado e entrar em modo assistido.

## Filial Como Dimensao Do Pipeline

Filial deve ser uma dimensao oficial do pipeline de intencao/contexto existente, junto de periodo, entidades e agrupamentos.

Nao criar um mecanismo paralelo no normalizer para interpretar texto livre.

Fluxo correto:

```text
usuario pergunta
pipeline de intencao/contexto extrai possivel mencao de filial/unidade/empresa organizacional
backend resolve contra protheus_company_tree
estado conversacional guarda a filial resolvida
IA gera SQL canonico
normalizer Lobo Guara aplica o escopo resolvido
```

Exemplo de estado estruturado:

```json
{
  "filial": {
    "modo": "todas",
    "texto": null,
    "chaves": [],
    "nomes": [],
    "origem": "padrao"
  }
}
```

Exemplo com filial especifica:

```json
{
  "filial": {
    "modo": "especifica",
    "texto": "Cuiaba",
    "chaves": ["010101"],
    "nomes": ["CUIABA"],
    "origem": "mensagem_atual"
  }
}
```

Essa decisao e importante para preservar heranca multi-turn:

```text
"vendas de Cuiaba"
-> filial = 010101

"agora por produto"
-> herda filial = 010101
```

## UX de Filial

Regra de uso acordada:

```text
sem filial mencionada -> consultar todas as filiais permitidas
filial especifica mencionada -> resolver e filtrar
"por filial" -> agrupar por filial
"da filial" sem especificar qual -> perguntar, oferecendo opcao Todas
filial ambigua -> perguntar, oferecendo opcao Todas
```

O sistema nao deve perguntar filial por padrao. Perguntar filial toda vez cria atrito e prejudica o uso por WhatsApp.

## Normalizer Lobo Guara

O normalizer Lobo Guara deve consumir estado estruturado, nao texto livre.

Responsabilidades:

- receber SQL canonico;
- respeitar tabela fisica resolvida por SX2;
- identificar aliases e campos de filial por base Protheus;
- aplicar `IN (...)` quando houver escopo de filiais;
- nao depender de `JOIN SYS_COMPANY_CFG` para isolamento;
- aplicar a mesma regra nos caminhos individuais, direto/reuso/cache e cross-module.

Exemplo:

```sql
-- IA gera
FROM SD2 SD2
WHERE SD2.D_E_L_E_T_ = ' '

-- backend adapta
FROM SD2010 SD2
WHERE SD2.D_E_L_E_T_ = ' '
  AND SD2.D2_FILIAL IN ('010101', '010102')
```

`SYS_COMPANY_CFG` so deve aparecer no SQL final quando for realmente necessario exibir nome/descricao de filial ou fazer agrupamento enriquecido por filial. Para isolamento, preferir filtro deterministico em `XX_FILIAL`.

## Prompt Minimo

O prompt nao deve ensinar a IA a montar `SYS_COMPANY_CFG`.

Quando a empresa estiver em Lobo Guara, o contexto deve ser minimo:

```text
modeloDados = LOBO_GUARA
Gere SQL canonico usando as tabelas de negocio e os aliases SX2/SX3.
Nao monte hierarquia SYS_COMPANY/SYS_COMPANY_CFG manualmente.
O backend aplicara escopo de filial/empresa/unidade quando necessario.
```

## Guards

Em modo Lobo Guara automatico, os guards devem ser rigidos:

```text
SUBSTRING em campo de filial -> rejeita e retry com instrucao corretiva
SYS_COMPANY_CFG manual sem necessidade -> rejeita e retry
filtro por CNPJ como se fosse filial -> rejeita e retry
escopo obrigatorio sem filtro aplicado -> rejeita
```

Cada guard precisa ter mensagem corretiva especifica para evitar loop de retry.

Exemplo:

```text
Nao use SUBSTRING em campo filial. Gere SQL canonico sem tentar decompor filial; o backend aplicara o escopo Lobo Guara.
```

Apos limite de tentativas, retornar erro tecnico controlado, nao loop infinito.

## Cross-Module

O normalizer Lobo Guara deve ser aplicado tambem no fluxo cross-module.

Isso e requisito obrigatorio de seguranca. Se ficar apenas nos specs individuais, uma consulta cruzando faturamento/compras/financeiro pode escapar do isolamento e consultar filiais indevidas.

Pontos de entrada que devem receber a camada comum:

```text
ia-owner runner
systemprompt runner
executarSqlDireto / reuso / cache
cross-module
```

## Middleware Atual

O comportamento atual do middleware:

```text
modelo_dados = LOBO_GUARA + tenant_id -> injeta WHERE campo_empresa = tenant_id
```

deve ser tratado como legado.

Ele nao deve ser a estrategia principal para Protheus Lobo Guara, pois e generico demais e pode inserir filtro em campo, alias ou escopo incorreto.

## Fases De Desenvolvimento

1. Blindar o tradicional.
2. Adicionar descoberta de estrategia de chave de filial.
3. Evoluir cadastro do middleware para perfil Lobo Guara.
4. Importar/cachear `SYS_COMPANY` e `SYS_COMPANY_CFG`.
5. Validar perfil globalmente antes de liberar automatico.
6. Incluir filial como dimensao do pipeline de intencao/contexto.
7. Criar normalizer Lobo Guara comum.
8. Reduzir prompt para SQL canonico.
9. Adicionar guards com retry corretivo.
10. Cobrir specs individuais, direto/reuso/cache e cross-module com testes.
11. Migrar por empresa/conexao, sem big-bang.

## Principio Final

```text
SX2 decide tabela.
SYS_COMPANY/SYS_COMPANY_CFG explicam organizacao.
Pipeline decide contexto.
Normalizer aplica escopo.
IA gera SQL canonico.
```

