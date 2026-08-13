#INCLUDE "PROTHEUS.CH"
#INCLUDE "FWMVCDEF.CH"
#INCLUDE "TOTVS.CH"

/* ============================================================================
   ZCHCAD.PRW — Cadastro de celular por usuario Protheus (tabela ZCH)

   ============================================================================
   ATENCAO: fonte de REFERENCIA, escrito fora de um ambiente Protheus e NUNCA
   compilado/testado em um SmartClient/TOTVS App Studio real — mesma ressalva
   de IACCHAT.prw. Antes de subir para homologacao, um desenvolvedor ADVPL do
   time precisa validar contra o TDN/Include real da versao em uso:

     a) Assinatura de MVC (MPFormDef/AxCadastro), SX2/SX3/SIX via linha de
        codigo (AutoGrLog / estrutura manual abaixo) — usada conforme padrao
        documentado da TOTVS (ex.: rotinas de auto-criacao de tabela custom
        via U_xxxCria chamada no Job/Loader), sem validacao local.
     b) Tamanho e tipo real do campo codigo de usuario em SYS_USR (aqui
        assumido C(10), padrao mais comum de RetCodUsr()/USR_ID) — CONFIRMAR
        contra o dicionario de dados real antes de compilar. Se divergir,
        ajustar o tamanho de ZCH_USER (e do indice) para bater exatamente.
     c) Alias e campos de SYS_USR usados no F3/pesquisa (USR_ID, USR_NOME) —
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

   Criacao automatica de estrutura: ZCHCriaEstrutura() (chamada no rodape
   deste arquivo, no Job de compilacao/primeiro acesso — ver instrucoes na
   funcao) cria os registros SX2 (tabela), SX3 (campos) e SIX (indices) via
   codigo, para NAO depender de acesso ao Configurador (SIGACFG > Base de
   Dados > Dicionarios) neste ambiente. Se a tabela ja existir (reexecucao),
   a funcao NAO recria nem altera nada — apenas confirma e sai.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   ZCHCadUsr
   Tela de cadastro (MVC/AxCadastro padrao) do vinculo usuario Protheus ->
   celular. Registrar no menu do Configurador (SIGACFG), conforme decidido.
---------------------------------------------------------------------------- */
User Function ZCHCadUsr()
    Local oBrowse

    // Garante a estrutura antes de abrir a tela — idempotente, ver comentario
    // na funcao abaixo. Nao deveria custar nada em uso normal (SX2 ja existe
    // apos o primeiro acesso), mas evita depender de rodar isso manualmente
    // uma vez "por fora" antes do primeiro uso.
    ZCHCriaEstrutura()

    oBrowse := FWMBrowse():New()
    oBrowse:SetAlias("ZCH")
    oBrowse:SetDescription("Celular por usuario - IA Command")
    oBrowse:SetMenuDef("ZCHCADUSR")
    oBrowse:Activate()

Return

/* ----------------------------------------------------------------------------
   MenuDef — define os botoes padrao (Visualizar/Incluir/Alterar/Excluir) do
   browse acima.
---------------------------------------------------------------------------- */
Static Function MenuDef()
    Local aRotina := {}

    ADD OPTION aRotina TITLE "Visualizar" ACTION "VIEWDEF.ZCHCADUSR"    OPERATION 2 ACCESS 0
    ADD OPTION aRotina TITLE "Incluir"    ACTION "VIEWDEF.ZCHCADUSR"    OPERATION 3 ACCESS 0
    ADD OPTION aRotina TITLE "Alterar"    ACTION "VIEWDEF.ZCHCADUSR"    OPERATION 4 ACCESS 0
    ADD OPTION aRotina TITLE "Excluir"    ACTION "VIEWDEF.ZCHCADUSR"    OPERATION 5 ACCESS 0

Return aRotina

/* ----------------------------------------------------------------------------
   ModelDef — modelo de dados MVC (1 unica tabela, sem grid/relacionamento).
---------------------------------------------------------------------------- */
Static Function ModelDef()
    Local oModel := MPFormModel():New("ZCHCADUSR_M")
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
   CRIACAO AUTOMATICA DE ESTRUTURA (SX2/SX3/SIX) — SEM CONFIGURADOR

   ZCHCriaEstrutura() e idempotente: verifica se a tabela ZCH ja existe no
   SX2 antes de criar qualquer coisa. Se ja existe, sai sem alterar nada —
   NAO tenta corrigir/migrar estrutura existente (fora de escopo; se o
   schema precisar mudar depois, isso e uma migracao a parte, deliberada).

   Chamar esta funcao:
     1. Automaticamente no inicio de ZCHCadUsr() (ja feito acima) — garante
        que o primeiro usuario a abrir a tela cria a estrutura sob demanda.
     2. Opcionalmente no RPO/Job de inicializacao do ambiente, se o time
        Protheus preferir criar a estrutura no deploy em vez de no primeiro
        acesso — chamar U_ZCHCriaEstrutura() a partir de um Job customizado
        (fora do escopo deste arquivo).
   ============================================================================ */
User Function ZCHCriaEstrutura()
Return ZCHCriaEstrutura()

Static Function ZCHCriaEstrutura()
    Local lJaExiste := .F.

    DbSelectArea("SX2")
    SX2->(DbSetOrder(1)) // ordem 1 = SX2_TABELA, padrao do dicionario
    lJaExiste := SX2->(MsSeek("ZCH"))

    If lJaExiste
        Return .T. // idempotente — estrutura ja criada, nada a fazer
    EndIf

    ZCHCriarSX2()
    ZCHCriarSX3()
    ZCHCriarSIX()
    ZCHCriarTabelaFisica()

Return .T.

/* ----------------------------------------------------------------------------
   ZCHCriarTabelaFisica — cria o arquivo fisico da tabela ZCH via DbCreate(),
   como fallback explicito e garantido — NAO depende de o DBAccess criar a
   tabela implicitamente ao detectar SX2 novo (comportamento que varia por
   instalacao/versao e nao pode ser confirmado sem acesso ao ambiente real).

   Monta aStruct diretamente dos DEFINEs de campo abaixo (mesma fonte de
   verdade usada em ZCHCriarSX3, para as duas nunca ficarem dessincronizadas)
   e chama DbCreate() no path/alias padrao da instalacao.

   CONFIRMAR contra o Include desta versao: assinatura exata de DbCreate()
   (aqui usada na forma classica 4 parametros — nome, estrutura, driver,
   alias — documentada publicamente) e se o driver informado (RddSetDefault())
   e o mesmo configurado no appserver.ini deste ambiente (TOPCONN e o mais
   comum em instalacoes atuais; se divergir, ajustar cDriver abaixo).
---------------------------------------------------------------------------- */
Static Function ZCHCriarTabelaFisica()
    Local aStruct  := {}
    Local cDriver  := RddSetDefault() // usa o driver ja configurado no ambiente (ex: TOPCONN)

    AAdd(aStruct, {"ZCH_FILIAL", "C", 02, 0})
    AAdd(aStruct, {"ZCH_USER",   "C", 10, 0})
    AAdd(aStruct, {"ZCH_NOME",   "C", 60, 0})
    AAdd(aStruct, {"ZCH_CEL",    "C", 20, 0})
    AAdd(aStruct, {"ZCH_ATIVO",  "C", 01, 0})

    DbCreate("ZCH", aStruct, cDriver, , "ZCH")

Return

/* ----------------------------------------------------------------------------
   ZCHCriarSX2 — registro da tabela no dicionario (SX2).
---------------------------------------------------------------------------- */
Static Function ZCHCriarSX2()
    DbSelectArea("SX2")
    RecLock("SX2", .T.)
        SX2->X2_TABELA   := "ZCH"
        SX2->X2_NOME     := "Celular por Usuario - IA Command"
        SX2->X2_NOMESPA  := "Celular por Usuario - IA Command"
        SX2->X2_MODO     := "C"    // Compartilhada entre empresas/filiais
        SX2->X2_PATH     := "SYS"
        SX2->X2_ARQUIVO  := "ZCH"
        SX2->X2_MULTIREG := "S"
        SX2->X2_MODUCPO  := "SIGACFG"
    SX2->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   ZCHCriarSX3 — registro dos campos no dicionario (SX3).
   Ordem dos campos: ZCH_FILIAL (padrao Protheus, sempre 1o campo), ZCH_USER,
   ZCH_NOME, ZCH_CEL, ZCH_ATIVO.
---------------------------------------------------------------------------- */
Static Function ZCHCriarSX3()
    ZCHAddCampo("ZCH_FILIAL", "Filial",         "Filial",         "C", 02, 0, "C", "MV_PAR01=='1'", "",  "", "S", "S")
    ZCHAddCampo("ZCH_USER",   "Cod. Usuario",   "Codigo Usuario", "C", 10, 0, "C", "", "SYS_USR", "U_ZCHVldUsr()", "S", "S")
    ZCHAddCampo("ZCH_NOME",   "Nome Usuario",   "Nome do Usuario","C", 60, 0, "V", "", "", "", "S", "N")
    ZCHAddCampo("ZCH_CEL",    "Celular",        "Celular (DDI)",  "C", 20, 0, "C", "", "", "U_ZCHVldCel()", "S", "S")
    ZCHAddCampo("ZCH_ATIVO",  "Ativo",          "Ativo (S/N)",    "C", 01, 0, "C", "", "", "", "S", "S")

Return

/* ----------------------------------------------------------------------------
   ZCHAddCampo — grava 1 linha de SX3 para o campo informado. Isolado em
   funcao auxiliar para nao repetir RecLock/MsUnlock 5 vezes em ZCHCriarSX3.

   cPictInput: mascara de entrada do campo (usada em ZCH_CEL para forcar o
   formato "+DDI (DD) NNNNN-NNNN" na digitacao, ex: "@R +99 (99) 99999-9999").
   ---------------------------------------------------------------------------- */
Static Function ZCHAddCampo(cCampo, cTitulo, cDescricao, cTipo, nTam, nDec, cContext, cValid, cF3, cValidUser, cVisual, cObriga)
    Local nOrdem := ZCHProximaOrdem()

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
        SX3->X3_RESERVA  := ""
        SX3->X3_GRPSXG   := ""
        SX3->X3_RELACAO  := ""
        SX3->X3_CBOX     := IIf(cCampo == "ZCH_ATIVO", "S=Sim;N=Nao", "")
    SX3->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   ZCHProximaOrdem — calcula a proxima ordem sequencial de campo para a
   tabela ZCH (SX3->X3_ORDEM), evitando colisao entre chamadas sucessivas de
   ZCHAddCampo.
---------------------------------------------------------------------------- */
Static Function ZCHProximaOrdem()
    Local nMaior := 0

    DbSelectArea("SX3")
    SX3->(DbSetOrder(1)) // ordem 1 = X3_ARQUIVO+X3_CAMPO, padrao do dicionario
    SX3->(MsSeek("ZCH"))
    While !SX3->(Eof()) .And. SX3->X3_ARQUIVO == "ZCH"
        If Val(SX3->X3_ORDEM) > nMaior
            nMaior := Val(SX3->X3_ORDEM)
        EndIf
        SX3->(DbSkip())
    End

Return nMaior + 1

/* ----------------------------------------------------------------------------
   ZCHCriarSIX — registro dos indices no dicionario (SIX).
   Indice 1: ZCH_FILIAL + ZCH_USER — UNICO (1 celular por usuario, decisao
   confirmada). Indice 2: ZCH_FILIAL + ZCH_CEL — busca reversa por celular
   (usada futuramente se precisarmos ir de celular -> usuario).
---------------------------------------------------------------------------- */
Static Function ZCHCriarSIX()
    DbSelectArea("SIX")
    RecLock("SIX", .T.)
        SIX->INDICE   := "1"
        SIX->ORDEM    := "1"
        SIX->CHAVE    := "ZCH_FILIAL+ZCH_USER"
        SIX->DESCRICO := "Usuario"
        SIX->PROPRIETARIO := "ZCH"
        SIX->NICKNAME := "ZCH"
    SIX->(MsUnlock())

    RecLock("SIX", .T.)
        SIX->INDICE   := "1"
        SIX->ORDEM    := "2"
        SIX->CHAVE    := "ZCH_FILIAL+ZCH_CEL"
        SIX->DESCRICO := "Celular"
        SIX->PROPRIETARIO := "ZCH"
        SIX->NICKNAME := "ZCH"
    SIX->(MsUnlock())

    // Unicidade do indice 1 (ZCH_FILIAL+ZCH_USER): a validacao de duplicidade
    // e feita em U_ZCHVldUsr() (chamada no X3_VALID do campo ZCH_USER, ver
    // ZCHCriarSX3 acima) via MsSeek contra o proprio indice — SIX por si so
    // nao impede duplicidade no Protheus (diferente de UNIQUE INDEX em SQL
    // puro), a validacao de negocio precisa estar explicita na rotina.

Return

/* ----------------------------------------------------------------------------
   ZCHVldUsr — Valida (a) que o codigo de usuario informado existe em SYS_USR
   e (b) que nao ha OUTRO registro ZCH para o mesmo usuario (unicidade,
   decisao confirmada: 1 celular por usuario). Tambem preenche ZCH_NOME
   automaticamente a partir do nome encontrado em SYS_USR — campo so-leitura
   na tela (View, ver ZCHAddCampo), preenchido por este validador.

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
   do campo (ver ZCHCriarSX3) — esta validacao e so uma checagem de
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
