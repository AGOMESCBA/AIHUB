#INCLUDE "PROTHEUS.CH"
#INCLUDE "FWMVCDEF.CH"
#INCLUDE "TOTVS.CH"

/* ============================================================================
   IACadUsr.PRW — Cadastro de celular por usuario Protheus (tabela ZCH)

   ============================================================================
   ATENCAO: fonte de REFERENCIA, escrito fora de um ambiente Protheus e NUNCA
   compilado/testado em um SmartClient/TOTVS App Studio real — mesma ressalva
   de IACCHAT.prw. Antes de subir para homologacao, um desenvolvedor ADVPL do
   time precisa validar contra o TDN/Include real da versao em uso:

     a) Tamanho e tipo real do campo codigo de usuario em SYS_USR (aqui
        assumido C(10), padrao mais comum de RetCodUsr()/USR_ID) — CONFIRMAR
        contra o dicionario de dados real antes de compilar. Se divergir,
        ajustar o tamanho de ZCH_USER (e do indice) para bater exatamente.
     b) Alias e campos de SYS_USR usados no F3/pesquisa (USR_ID, USR_NOME) —
        nomes usados por convencao do dicionario padrao SIGACFG; CONFIRMAR
        contra SX3 real antes de compilar (nomes de campo podem variar por
        versao/instalacao).

   Motivo de existir: SYS_USR (cadastro de usuarios Protheus) NAO tem campo
   de celular nesta instalacao (confirmado pelo usuario). Em vez de tentar
   alterar a estrutura de uma tabela padrao TOTVS (arriscado, pode ser
   sobrescrito em update de pacote), criamos uma tabela propria (ZCH,
   prefixo reservado ao cliente) so com o vinculo usuario -> celular,
   consultada por IACCHAT.prw no lugar do antigo SYS_USR->USR_CELULAR
   (que nunca existiu).

   [ALTERADO apos ciclo de erros em producao 13/08/2026] A criacao automatica
   da TABELA FISICA e do INDICE FISICO via codigo (DbCreate()/OrdCreate()) foi
   REMOVIDA deste fonte. Motivo: tres tentativas sucessivas de gerar a
   estrutura fisica via linha de codigo falharam neste ambiente (TOPCONN,
   Framework 20251006) por divergencias de assinatura/comportamento que so
   apareciam em runtime, cada uma exigindo um ciclo completo de
   compilar-testar-reportar-corrigir sem qualquer forma de validar localmente
   antes (este repositorio e Node.js, sem acesso a um ambiente Protheus real).
   Decisao explicita do usuario: usar o caminho garantido — o proprio
   Configurador (SIGACFG > Base de Dados > Dicionarios) gera a tabela fisica
   e o indice fisico a partir do SX2/SX3/SIX quando o usuario abre o
   dicionario e confirma ("OK") a inclusao da tabela ZCH.

   Fluxo atual, em duas etapas:
     1. ZCHMonta() (chamada automaticamente por IACadUsr(), ver abaixo) grava
        SOMENTE os registros de DICIONARIO (SX2, SX3, SIX) via codigo — isso
        SEMPRE funcionou nos testes (confirmado pelos dumps de erro: os
        registros gravados batem exatamente com o que foi lido de volta).
        Idempotente: se o registro em SX2 ja existe, nao faz nada.
     2. Um desenvolvedor ADVPL PRECISA, uma unica vez por ambiente, abrir
        Configurador (SIGACFG) > Base de Dados > Dicionarios > Base de Dados,
        localizar a tabela ZCH (ja aparece no dicionario gracas ao passo 1) e
        confirmar/gerar a estrutura fisica pela tela — isso cria a tabela e o
        indice fisico de forma garantida, sem depender de nenhuma API de
        codigo cujo comportamento nao pudemos validar neste ambiente.

   Ate o passo 2 ser feito, abrir IACadUsr() vai falhar ao tentar exibir o
   browse (tabela/indice fisico ainda nao existem) — erro esperado, nao um
   bug: e exatamente o sinal de que o passo 2 ainda precisa ser feito.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   IACadUsr
   Tela de cadastro (MVC/AxCadastro padrao) do vinculo usuario Protheus ->
   celular. Registrar no menu do Configurador (SIGACFG), conforme decidido.
---------------------------------------------------------------------------- */
User Function IACadUsr()
    Local oBrowse

    // Garante os registros de DICIONARIO (SX2/SX3/SIX) antes de abrir a tela
    // — idempotente, ver comentario em ZCHMonta(). NAO cria mais tabela nem
    // indice fisico (ver ressalva no cabecalho do arquivo) — isso e feito
    // uma unica vez pelo Configurador, por um desenvolvedor ADVPL.
    ZCHMonta()

    oBrowse := FWMBrowse():New()
    oBrowse:SetAlias("ZCH")
    oBrowse:SetDescription("Celular por usuario - IA Command")
    oBrowse:SetMenuDef("IACADUSR")
    oBrowse:Activate()

Return

/* ----------------------------------------------------------------------------
   MenuDef — define os botoes padrao (Visualizar/Incluir/Alterar/Excluir) do
   browse acima.
---------------------------------------------------------------------------- */
Static Function MenuDef()
    Local aRotina := {}

    ADD OPTION aRotina TITLE "Visualizar" ACTION "VIEWDEF.IACADUSR"    OPERATION 2 ACCESS 0
    ADD OPTION aRotina TITLE "Incluir"    ACTION "VIEWDEF.IACADUSR"    OPERATION 3 ACCESS 0
    ADD OPTION aRotina TITLE "Alterar"    ACTION "VIEWDEF.IACADUSR"    OPERATION 4 ACCESS 0
    ADD OPTION aRotina TITLE "Excluir"    ACTION "VIEWDEF.IACADUSR"    OPERATION 5 ACCESS 0

Return aRotina

/* ----------------------------------------------------------------------------
   ModelDef — modelo de dados MVC (1 unica tabela, sem grid/relacionamento).
---------------------------------------------------------------------------- */
Static Function ModelDef()
    Local oModel := MPFormModel():New("IACADUSR_M")
    Local oStruZCH := FWFormStruct(1, "ZCH")

    oModel:AddFields("ZCHMASTER", , oStruZCH)
    oModel:SetPrimaryKey({"ZCH_FILIAL", "ZCH_USER"})

    oModel:SetDescription("Celular por usuario - IA Command")
    oModel:GetModel("ZCHMASTER"):SetDescription("Dados do vinculo")

Return oModel

/* ----------------------------------------------------------------------------
   ViewDef — view MVC (1 unico formulario, sem abas).
---------------------------------------------------------------------------- */
Static Function ViewDef()
    Local oModel := ModelDef()
    Local oView  := FWFormView():New()
    Local oStruZCH := FWFormStruct(2, "ZCH")

    oView:SetModel(oModel)
    oView:AddField("VIEW_ZCH", oStruZCH, "ZCHMASTER")
    oView:CreateHorizontalBox("TELA", 100)
    oView:SetOwnerView("VIEW_ZCH", "TELA")

Return oView

/* ============================================================================
   REGISTRO NO DICIONARIO (SX2/SX3/SIX) — SOMENTE DICIONARIO, SEM ESTRUTURA
   FISICA (ver ressalva extensa no cabecalho do arquivo sobre por que a
   criacao fisica foi removida deste fonte).
   ============================================================================ */
User Function ZCHCriaEs()
Return ZCHMonta()

Static Function ZCHMonta()
    Local lJaExiste := .F.

    DbSelectArea("SX2")
    // Campo real de nome de tabela e X2_ARQUIVO (nao X2_TABELA); indice
    // correspondente e ordem 2 (**SX20101=X2_CHAVE, SX20102=X2_ARQUIVO) —
    // confirmado contra dump de erro real desta instalacao.
    SX2->(DbSetOrder(2)) // ordem 2 = X2_ARQUIVO
    lJaExiste := SX2->(MsSeek("ZCH"))

    If lJaExiste
        Return .T. // idempotente — registro de dicionario ja existe
    EndIf

    CRIASX2()
    CRIASX3()
    CRIASIX()

Return .T.

/* ----------------------------------------------------------------------------
   CRIASX2 — registro da tabela no dicionario (SX2). Campos confirmados
   contra dump de erro real desta instalacao (X2_ARQUIVO, nao X2_TABELA;
   sem X2_MULTIREG/X2_MODUCPO, que nao existem aqui).
---------------------------------------------------------------------------- */
Static Function CRIASX2()
    DbSelectArea("SX2")
    RecLock("SX2", .T.)
        SX2->X2_ARQUIVO  := "ZCH"
        SX2->X2_CHAVE    := "ZCH_FILIAL+ZCH_USER"
        SX2->X2_NOME     := "Celular por Usuario - IA Command"
        SX2->X2_NOMESPA  := "Celular por Usuario - IA Command"
        SX2->X2_NOMEENG  := "Cellphone by User - IA Command"
        SX2->X2_MODO     := "C"    // Compartilhada entre empresas/filiais
        SX2->X2_PATH     := "SYS"
    SX2->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   CRIASX3 — registro dos campos no dicionario (SX3).
   Ordem dos campos: ZCH_FILIAL (padrao Protheus, sempre 1o campo), ZCH_USER,
   ZCH_NOME, ZCH_CEL, ZCH_ATIVO.
---------------------------------------------------------------------------- */
Static Function CRIASX3()
    ZCHAddCpo("ZCH_FILIAL", "Filial",         "Filial",         "C", 02, 0, "C", "MV_PAR01=='1'", "",  "", "S", "S")
    ZCHAddCpo("ZCH_USER",   "Cod. Usuario",   "Codigo Usuario", "C", 10, 0, "C", "", "SYS_USR", "U_ZCHVldUsr()", "S", "S")
    ZCHAddCpo("ZCH_NOME",   "Nome Usuario",   "Nome do Usuario","C", 60, 0, "V", "", "", "", "S", "N")
    ZCHAddCpo("ZCH_CEL",    "Celular",        "Celular (DDI)",  "C", 20, 0, "C", "", "", "U_ZCHVldCel()", "S", "S")
    ZCHAddCpo("ZCH_ATIVO",  "Ativo",          "Ativo (S/N)",    "C", 01, 0, "C", "", "", "", "S", "S")

Return

/* ----------------------------------------------------------------------------
   ZCHAddCpo — grava 1 linha de SX3 para o campo informado. Isolado em
   funcao auxiliar para nao repetir RecLock/MsUnlock 5 vezes em CRIASX3.

   cPictInput: mascara de entrada do campo (usada em ZCH_CEL para forcar o
   formato "+DDI (DD) NNNNN-NNNN" na digitacao, ex: "@R +99 (99) 99999-9999").
   ---------------------------------------------------------------------------- */
Static Function ZCHAddCpo(cCampo, cTitulo, cDescricao, cTipo, nTam, nDec, cContext, cValid, cF3, cValidUser, cVisual, cObriga)
    Local nOrdem := ZCHProxOrd()

    DbSelectArea("SX3")
    RecLock("SX3", .T.)
        SX3->X3_ARQUIVO  := "ZCH"
        SX3->X3_CAMPO    := cCampo
        SX3->X3_TIPO     := cTipo
        SX3->X3_TAMANHO  := nTam
        SX3->X3_DECIMAL  := nDec
        SX3->X3_TITULO   := cTitulo
        SX3->X3_DESCRIC  := cDescricao
        SX3->X3_USADO    := "S"
        SX3->X3_CONTEXT  := cContext
        SX3->X3_VISUAL   := IIf(Empty(cVisual), "S", cVisual)
        SX3->X3_OBRIGAT  := IIf(Empty(cObriga), "N", cObriga)
        SX3->X3_ORDEM    := StrZero(nOrdem, 3)
        SX3->X3_F3       := cF3
        SX3->X3_VALID    := cValid
        SX3->X3_PICTURE  := IIf(cCampo == "ZCH_CEL", "@R +99 (99) 99999-9999", "")
        SX3->X3_PICTVAR  := ""
        SX3->X3_RESERV   := "" // nome real e X3_RESERV, nao X3_RESERVA
        SX3->X3_GRPSXG   := ""
        SX3->X3_RELACAO  := ""
        SX3->X3_CBOX     := IIf(cCampo == "ZCH_ATIVO", "S=Sim;N=Nao", "")
    SX3->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   ZCHProxOrd — calcula a proxima ordem sequencial de campo para a
   tabela ZCH (SX3->X3_ORDEM), evitando colisao entre chamadas sucessivas de
   ZCHAddCpo.
---------------------------------------------------------------------------- */
Static Function ZCHProxOrd()
    Local nMaior := 0

    DbSelectArea("SX3")
    SX3->(DbSetOrder(1)) // ordem 1 = X3_ARQUIVO+X3_ORDEM, padrao do dicionario
    SX3->(MsSeek("ZCH"))
    While !SX3->(Eof()) .And. SX3->X3_ARQUIVO == "ZCH"
        If Val(SX3->X3_ORDEM) > nMaior
            nMaior := Val(SX3->X3_ORDEM)
        EndIf
        SX3->(DbSkip())
    End

Return nMaior + 1

/* ----------------------------------------------------------------------------
   CRIASIX — registro dos indices no dicionario (SIX).
   Indice 1: ZCH_FILIAL + ZCH_USER — UNICO (1 celular por usuario, decisao
   confirmada). Indice 2: ZCH_FILIAL + ZCH_CEL — busca reversa por celular
   (usada futuramente se precisarmos ir de celular -> usuario).
   Nomes de campo confirmados contra dump de erro real desta instalacao
   (DESCRICAO, nao DESCRICO; PROPRI, nao PROPRIETARIO).
---------------------------------------------------------------------------- */
Static Function CRIASIX()
    DbSelectArea("SIX")
    RecLock("SIX", .T.)
        SIX->INDICE    := "1"
        SIX->ORDEM     := "1"
        SIX->CHAVE     := "ZCH_FILIAL+ZCH_USER"
        SIX->DESCRICAO := "Usuario"
        SIX->PROPRI    := "S"
        SIX->NICKNAME  := "ZCH"
    SIX->(MsUnlock())

    RecLock("SIX", .T.)
        SIX->INDICE    := "1"
        SIX->ORDEM     := "2"
        SIX->CHAVE     := "ZCH_FILIAL+ZCH_CEL"
        SIX->DESCRICAO := "Celular"
        SIX->PROPRI    := "S"
        SIX->NICKNAME  := "ZCH"
    SIX->(MsUnlock())

    // Unicidade do indice 1 (ZCH_FILIAL+ZCH_USER): a validacao de duplicidade
    // e feita em U_ZCHVldUsr() (chamada no X3_VALID do campo ZCH_USER, ver
    // CRIASX3 acima) via MsSeek contra o proprio indice — SIX por si so
    // nao impede duplicidade no Protheus (diferente de UNIQUE INDEX em SQL
    // puro), a validacao de negocio precisa estar explicita na rotina.

Return

/* ----------------------------------------------------------------------------
   ZCHVldUsr — Valida (a) que o codigo de usuario informado existe em SYS_USR
   e (b) que nao ha OUTRO registro ZCH para o mesmo usuario (unicidade,
   decisao confirmada: 1 celular por usuario). Tambem preenche ZCH_NOME
   automaticamente a partir do nome encontrado em SYS_USR — campo so-leitura
   na tela (View, ver ZCHAddCpo), preenchido por este validador.

   CONFIRMAR contra o dicionario real: nomes de campo USR_ID/USR_NOME em
   SYS_USR (usados aqui por convencao do cadastro padrao SIGACFG) e o indice
   correto para MsSeek (assumido ordem 1 = USR_ID).
---------------------------------------------------------------------------- */
User Function ZCHVldUsr()
    Local cUser    := M->ZCH_USER
    Local lAchou   := .F.
    Local cAliasAtu := Alias()

    If Empty(cUser)
        Return .T. // campo obrigatorio ja barra vazio via X3_OBRIGAT
    EndIf

    DbSelectArea("SYS_USR")
    SYS_USR->(DbSetOrder(1)) // TODO: confirmar ordem real de USR_ID em SYS_USR
    lAchou := SYS_USR->(MsSeek(cUser))

    If !lAchou
        Help(" ", 1, "ZCH_USER_INVALIDO", , "Usuario " + cUser + " nao encontrado em SYS_USR.", 1, 0)
        RestArea(cAliasAtu)
        Return .F.
    EndIf

    M->ZCH_NOME := Alltrim(SYS_USR->USR_NOME) // TODO: confirmar nome do campo (USR_NOME assumido)

    // Unicidade: bloqueia se ja existe OUTRO registro ZCH para este usuario
    // (exceto o proprio registro em edicao, identificado por RecNo()).
    DbSelectArea("ZCH")
    ZCH->(DbSetOrder(1)) // ZCH_FILIAL+ZCH_USER
    If ZCH->(MsSeek(xFilial("ZCH") + cUser))
        If ZCH->(RecNo()) != M->_RECNO_ZCHMASTER  // nao e o proprio registro em edicao
            Help(" ", 1, "ZCH_USER_DUPLICADO", , "Ja existe celular cadastrado para o usuario " + cUser + ".", 1, 0)
            RestArea(cAliasAtu)
            Return .F.
        EndIf
    EndIf

    RestArea(cAliasAtu)

Return .T.

/* ----------------------------------------------------------------------------
   ZCHVldCel — Validacao basica do celular: exige ao menos DDI + DDD + numero
   (minimo de digitos), sem validar operadora/formato regional especifico.
   Mascara de digitacao (+DDI (DD) NNNNN-NNNN) ja e aplicada pelo X3_PICTURE
   do campo (ver CRIASX3) — esta validacao e so uma checagem de
   quantidade minima de digitos, para pegar celular incompleto.
---------------------------------------------------------------------------- */
User Function ZCHVldCel()
    Local cCel     := M->ZCH_CEL
    Local cSoDig   := ""
    Local nI

    For nI := 1 To Len(cCel)
        If SubStr(cCel, nI, 1) $ "0123456789"
            cSoDig += SubStr(cCel, nI, 1)
        EndIf
    Next nI

    // DDI (2) + DDD (2) + numero (8 ou 9) = minimo 12, maximo 13 digitos.
    // Ex.: 55 65 999010275 = 13 digitos (celular com 9). Aceita 12 ou 13.
    If Len(cSoDig) < 12 .Or. Len(cSoDig) > 13
        Help(" ", 1, "ZCH_CEL_INVALIDO", , "Celular incompleto. Informe DDI + DDD + numero, ex: +55 (65) 99901-0275.", 1, 0)
        Return .F.
    EndIf

Return .T.
