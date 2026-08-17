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
        Idempotente: se SX2 ja existe, inclui somente SX3/SIX faltantes, sem
        alterar registros existentes; isso cobre ambientes que ficaram com
        dicionario parcial sem arriscar update em chave fisica do dicionario.
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
    Private oBrowse := FWMBrowse():New()

    DbSelectArea("ZCH")
    ZCH->(DbSetOrder(1))
    ZCH->(DbGoTop())

    // [CORRIGIDO 14/08/2026, restaurado com base em fonte real — a remocao
    // anterior deste SetMenuDef foi um palpite sem confirmacao, e estava
    // errada] Confirmado via documentacao/exemplos reais de FWMBrowse: o
    // padrao e chamar SetMenuDef() passando o NOME DO FONTE/FUNCAO (nao um
    // codigo de dicionario de menu externo) — e assim que o framework liga
    // o browse a MenuDef()/ModelDef()/ViewDef() deste mesmo arquivo.
    oBrowse:SetAlias("ZCH")
    oBrowse:SetDescription("Celular por usuario - IA Command")
    oBrowse:SetFields(ZCHBrwFields())
    oBrowse:DisableDetails()
    oBrowse:SetSeeAll(.T.)
    oBrowse:SetChgAll(.T.)
    oBrowse:SetMenuDef("IACADUSR")
    oBrowse:Activate()

Return

/* ----------------------------------------------------------------------------
   ZCHDbg — diagnostico simples para confirmar se o alias ZCH enxerga dados
   fora do FWMBrowse.
---------------------------------------------------------------------------- */
User Function ZCHDbg()
    Local cMsg := ""

    DbSelectArea("ZCH")
    ZCH->(DbGoTop())

    cMsg += "xFilial(ZCH): [" + xFilial("ZCH") + "]" + Chr(13) + Chr(10)
    cMsg += "Eof: " + IIf(ZCH->(Eof()), "S", "N") + Chr(13) + Chr(10)
    cMsg += "LastRec: " + Alltrim(Str(ZCH->(LastRec()))) + Chr(13) + Chr(10)
    cMsg += "FieldPos ZCH_NOME: " + Alltrim(Str(ZCH->(FieldPos("ZCH_NOME")))) + Chr(13) + Chr(10)

    If !ZCH->(Eof())
        cMsg += "Filial: [" + ZCH->ZCH_FILIAL + "]" + Chr(13) + Chr(10)
        cMsg += "Usuario: [" + ZCH->ZCH_USER + "]" + Chr(13) + Chr(10)
        cMsg += "Celular: [" + ZCH->ZCH_CEL + "]" + Chr(13) + Chr(10)
        cMsg += "Ativo: [" + ZCH->ZCH_ATIVO + "]" + Chr(13) + Chr(10)
        cMsg += "Del: [" + ZCH->D_E_L_E_T_ + "]"
    EndIf

    MsgInfo(cMsg, "Debug ZCH")

Return .T.

/* ----------------------------------------------------------------------------
   ZCHInsTst — inclui dois registros de teste usando o proprio alias ZCH.
   Serve para validar se registros gravados pelo AppServer aparecem no browse.
---------------------------------------------------------------------------- */
User Function ZCHInsTst()
    Local cFilZCH := ""
    Local nIncl := 0
    Local cMsg := ""

    cFilZCH := xFilial("ZCH")

    DbSelectArea("ZCH")
    ZCH->(DbSetOrder(1))

    If !ZCH->(MsSeek(cFilZCH + "TST000001"))
        RecLock("ZCH", .T.)
            ZCH->ZCH_FILIAL := cFilZCH
            ZCH->ZCH_USER   := "TST000001"
            ZCH->ZCH_NOME   := "Teste IA Command 1"
            ZCH->ZCH_CEL    := "5565999900001"
            ZCH->ZCH_ATIVO  := "S"
        ZCH->(MsUnlock())

        nIncl := nIncl + 1
    EndIf

    If !ZCH->(MsSeek(cFilZCH + "TST000002"))
        RecLock("ZCH", .T.)
            ZCH->ZCH_FILIAL := cFilZCH
            ZCH->ZCH_USER   := "TST000002"
            ZCH->ZCH_NOME   := "Teste IA Command 2"
            ZCH->ZCH_CEL    := "5565999900002"
            ZCH->ZCH_ATIVO  := "S"
        ZCH->(MsUnlock())

        nIncl := nIncl + 1
    EndIf

    cMsg := "Registros de teste incluidos: " + Alltrim(Str(nIncl)) + Chr(13) + Chr(10)
    cMsg += "Filial usada: [" + cFilZCH + "]"

    MsgInfo(cMsg, "Teste ZCH")

Return .T.

/* ----------------------------------------------------------------------------
   ZCHBrwFields — colunas explicitas do browse. FWMBrowse normalmente usa o
   SX3/X3_BROWSE, mas declarar as colunas aqui evita tela vazia se o dicionario
   do ambiente estiver cacheado ou tiver sido criado parcialmente.
---------------------------------------------------------------------------- */
Static Function ZCHBrwFields()
    Local aFields := {}

    AAdd(aFields, {"Usuario", {|| ZCH->ZCH_USER  }, "C", "", 1, 10, 0, .F., Nil, .F., Nil, "ZCH_USER",  Nil, .F., .T., Nil})
    If ZCHTemCampo("ZCH_NOME")
        AAdd(aFields, {"Nome", {|| ZCH->ZCH_NOME }, "C", "", 1, 60, 0, .F., Nil, .F., Nil, "ZCH_NOME", Nil, .F., .T., Nil})
    EndIf
    AAdd(aFields, {"Celular", {|| ZCH->ZCH_CEL   }, "C", "", 1, 20, 0, .F., Nil, .F., Nil, "ZCH_CEL",   Nil, .F., .T., Nil})
    AAdd(aFields, {"Ativo",   {|| ZCH->ZCH_ATIVO }, "C", "", 0, 01, 0, .F., Nil, .F., Nil, "ZCH_ATIVO", Nil, .F., .T., Nil})

Return aFields

/* ----------------------------------------------------------------------------
   MenuDef — define os botoes padrao (Visualizar/Incluir/Alterar/Excluir).
   O FWMBrowse chama a ViewDef() pelo fluxo MVC padrao; chamar FWExecView()
   manualmente no WebApp pode deslocar a tela de edicao para fora da area util.
---------------------------------------------------------------------------- */
Static Function MenuDef()
    Local aRotina := {}

    ADD OPTION aRotina TITLE "Visualizar" ACTION "VIEWDEF.IACADUSR" OPERATION 2 ACCESS 0
    ADD OPTION aRotina TITLE "Incluir"    ACTION "VIEWDEF.IACADUSR" OPERATION 3 ACCESS 0
    ADD OPTION aRotina TITLE "Alterar"    ACTION "VIEWDEF.IACADUSR" OPERATION 4 ACCESS 0
    ADD OPTION aRotina TITLE "Excluir"    ACTION "VIEWDEF.IACADUSR" OPERATION 5 ACCESS 0

Return aRotina

/* ----------------------------------------------------------------------------
   ModelDef — modelo de dados MVC (1 unica tabela, sem grid/relacionamento).
---------------------------------------------------------------------------- */
Static Function ModelDef()
    Local oModel := MPFormModel():New("IACADUSRM")
    Local oStruZCH := FWFormStruct(1, "ZCH")

    oModel:AddFields("ZCH_MASTER", , oStruZCH)
    oModel:SetPrimaryKey({"ZCH_FILIAL", "ZCH_USER"})

    oModel:SetDescription("Celular por usuario - IA Command")
    oModel:GetModel("ZCH_MASTER"):SetDescription("Dados do vinculo")

Return oModel

/* ----------------------------------------------------------------------------
   ViewDef — view MVC (1 unico formulario, sem abas).

   Padrao MVC simples: o browse chama ViewDef(), a View monta seu proprio
   ModelDef() e o unico Field fica dono de um box com 100% da tela.
---------------------------------------------------------------------------- */
Static Function ViewDef()
    Local oModel := ModelDef()
    Local oView  := FWFormView():New()
    Local oStruZCH := FWFormStruct(2, "ZCH")

    oView:SetModel(oModel)
    oView:AddField("ZCH_VIEW", oStruZCH, "ZCH_MASTER")
    oView:CreateHorizontalBox("TELA", 100)
    oView:SetOwnerView("ZCH_VIEW", "TELA")
    oView:SetDescription("Celular por Usuario - IA Command")

Return oView

/* ----------------------------------------------------------------------------
   ZCHTemCampo — confirma se o alias ZCH aberto pelo runtime enxerga o campo.
---------------------------------------------------------------------------- */
Static Function ZCHTemCampo(cCampo)
    Local cAliasAtu := Alias()
    Local lTem := .F.

    If Select("ZCH") > 0
        DbSelectArea("ZCH")
        lTem := FieldPos(cCampo) > 0

        If !Empty(cAliasAtu)
            DbSelectArea(cAliasAtu)
        EndIf
    EndIf

Return lTem

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

    If !lJaExiste
        CRIASX2()
    Else
        ZCHCorrigeSX2()
    EndIf

    // Mesmo com SX2 existente, cria apenas SX3/SIX faltantes.
    CRIASX3()
    CRIASIX()

Return .T.

/* ----------------------------------------------------------------------------
   ZCHCorrigeSX2 — garante que o alias ZCH use a tabela fisica padrao da
   empresa (ZCH010 no SQL Server), sem apontar para pasta/tabela SYS.
---------------------------------------------------------------------------- */
Static Function ZCHCorrigeSX2()
    DbSelectArea("SX2")
    If !Empty(SX2->X2_PATH) .Or. Alltrim(SX2->X2_CHAVE) != "ZCH"
        RecLock("SX2", .F.)
            SX2->X2_CHAVE := "ZCH"
            SX2->X2_PATH := ""
        SX2->(MsUnlock())
    EndIf

Return

/* ----------------------------------------------------------------------------
   CRIASX2 — registro da tabela no dicionario (SX2). Campos confirmados
   contra dump de erro real desta instalacao (X2_ARQUIVO, nao X2_TABELA;
   sem X2_MULTIREG/X2_MODUCPO, que nao existem aqui).
---------------------------------------------------------------------------- */
Static Function CRIASX2()
    DbSelectArea("SX2")
    RecLock("SX2", .T.)
        SX2->X2_ARQUIVO  := "ZCH"
        SX2->X2_CHAVE    := "ZCH"
        SX2->X2_NOME     := "Celular por Usuario - IA Command"
        SX2->X2_NOMESPA  := "Celular por Usuario - IA Command"
        SX2->X2_NOMEENG  := "Cellphone by User - IA Command"
        SX2->X2_MODO     := "C"    // Compartilhada entre empresas/filiais
        SX2->X2_PATH     := ""
    SX2->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   CRIASX3 — registro dos campos no dicionario (SX3).
   Ordem dos campos: ZCH_FILIAL (padrao Protheus, sempre 1o campo), ZCH_USER,
   ZCH_NOME, ZCH_CEL, ZCH_ATIVO.
---------------------------------------------------------------------------- */
Static Function CRIASX3()
    ZCHAddCpo("ZCH_FILIAL", "Filial",         "Filial",         "C", 06, 0, "C", "MV_PAR01=='1'", "",  "", "S", "S")
    ZCHAddCpo("ZCH_USER",   "Cod. Usuario",   "Codigo Usuario", "C", 10, 0, "C", "", "SYS_USR", "U_ZCHVldUsr()", "S", "S")
    ZCHAddCpo("ZCH_NOME",   "Nome Usuario",   "Nome do Usuario","C", 60, 0, "V", "", "", "", "S", "N")
    ZCHAddCpo("ZCH_CEL",    "Celular",        "Celular (DDI)",  "C", 20, 0, "C", "", "", "U_ZCHVldCel()", "S", "S")
    ZCHAddCpo("ZCH_ATIVO",  "Ativo",          "Ativo (S/N)",    "C", 01, 0, "C", "", "", "", "S", "S")

Return

/* ----------------------------------------------------------------------------
   ZCHAddCpo — grava 1 linha de SX3 para o campo informado, somente se ainda
   nao existir. Isolado para nao repetir RecLock/MsUnlock 5 vezes em CRIASX3.

   cPictInput: mascara de entrada do campo (usada em ZCH_CEL para forcar o
   formato "+DDI (DD) NNNNN-NNNN" na digitacao, ex: "@R +99 (99) 99999-9999").
   ---------------------------------------------------------------------------- */
Static Function ZCHAddCpo(cCampo, cTitulo, cDescricao, cTipo, nTam, nDec, cContext, cValid, cF3, cValidUser, cVisual, cObriga)
    Local lExiste := ZCHPosSX3(cCampo)
    Local nOrdem  := ZCHOrdCampo(cCampo)

    If lExiste
        Return
    EndIf

    If nOrdem <= 0
        nOrdem := ZCHProxOrd()
    EndIf

    DbSelectArea("SX3")
    RecLock("SX3", .T.)
        SX3->X3_ARQUIVO  := "ZCH"
        SX3->X3_CAMPO    := cCampo
        SX3->X3_TIPO     := cTipo
        SX3->X3_TAMANHO  := nTam
        SX3->X3_DECIMAL  := nDec
        SX3->X3_TITULO   := cTitulo
        SX3->X3_DESCRIC  := cDescricao
        SX3->X3_BROWSE   := IIf(cCampo == "ZCH_FILIAL", "N", "S")
        SX3->X3_NIVEL    := 1
        SX3->X3_USADO    := "S"
        SX3->X3_CONTEXT  := cContext
        SX3->X3_VISUAL   := IIf(Empty(cVisual), "S", cVisual)
        SX3->X3_OBRIGAT  := IIf(Empty(cObriga), "N", cObriga)
        SX3->X3_ORDEM    := StrZero(nOrdem, 2)
        SX3->X3_F3       := cF3
        SX3->X3_VALID    := IIf(!Empty(cValidUser), cValidUser, cValid)
        SX3->X3_PICTURE  := IIf(cCampo == "ZCH_CEL", "@R +99 (99) 99999-9999", "")
        SX3->X3_PICTVAR  := ""
        SX3->X3_RESERV   := "" // nome real e X3_RESERV, nao X3_RESERVA
        SX3->X3_GRPSXG   := ""
        SX3->X3_RELACAO  := ""
        SX3->X3_CBOX     := IIf(cCampo == "ZCH_ATIVO", "S=Sim;N=Nao", "")
    SX3->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   ZCHOrdCampo — ordem fixa dos campos da tabela ZCH no SX3.
---------------------------------------------------------------------------- */
Static Function ZCHOrdCampo(cCampo)
    Local nOrdem := 0

    Do Case
    Case cCampo == "ZCH_FILIAL"
        nOrdem := 1
    Case cCampo == "ZCH_USER"
        nOrdem := 2
    Case cCampo == "ZCH_NOME"
        nOrdem := 3
    Case cCampo == "ZCH_CEL"
        nOrdem := 4
    Case cCampo == "ZCH_ATIVO"
        nOrdem := 5
    EndCase

Return nOrdem

/* ----------------------------------------------------------------------------
   ZCHPosSX3 — posiciona no campo SX3 da tabela ZCH, se ja existir.
---------------------------------------------------------------------------- */
Static Function ZCHPosSX3(cCampo)
    Local lAchou := .F.

    DbSelectArea("SX3")
    SX3->(DbSetOrder(1)) // ordem 1 = X3_ARQUIVO+X3_ORDEM
    SX3->(MsSeek("ZCH"))
    While !SX3->(Eof()) .And. SX3->X3_ARQUIVO == "ZCH"
        If Alltrim(SX3->X3_CAMPO) == cCampo
            lAchou := .T.
            Exit
        EndIf
        SX3->(DbSkip())
    End

Return lAchou

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
    ZCHAddIdx("1", "ZCH_FILIAL+ZCH_USER", "Usuario")
    ZCHAddIdx("2", "ZCH_FILIAL+ZCH_CEL",  "Celular")

    // Unicidade do indice 1 (ZCH_FILIAL+ZCH_USER): a validacao de duplicidade
    // e feita em U_ZCHVldUsr() (chamada no X3_VALID do campo ZCH_USER, ver
    // CRIASX3 acima) via MsSeek contra o proprio indice — SIX por si so
    // nao impede duplicidade no Protheus (diferente de UNIQUE INDEX em SQL
    // puro), a validacao de negocio precisa estar explicita na rotina.

Return

/* ----------------------------------------------------------------------------
   ZCHAddIdx — grava 1 indice no SIX somente se ainda nao existir.
---------------------------------------------------------------------------- */
Static Function ZCHAddIdx(cOrdem, cChave, cDescricao)
    Local lExiste := ZCHPosSIX(cOrdem)
    Local cNick := "IACADUSR" + StrZero(Val(cOrdem), 2)

    If lExiste
        Return
    EndIf

    DbSelectArea("SIX")
    RecLock("SIX", .T.)
        SIX->INDICE    := "ZCH"
        SIX->ORDEM     := cOrdem
        SIX->CHAVE     := cChave
        SIX->DESCRICAO := cDescricao
        SIX->PROPRI    := "U"
        SIX->NICKNAME  := cNick
    SIX->(MsUnlock())

Return

/* ----------------------------------------------------------------------------
   ZCHPosSIX — posiciona no indice SIX da tabela ZCH, se ja existir.
---------------------------------------------------------------------------- */
Static Function ZCHPosSIX(cOrdem)
    Local lAchou := .F.

    DbSelectArea("SIX")
    SIX->(DbGoTop())
    While !SIX->(Eof())
        If Alltrim(SIX->INDICE) == "ZCH" .And. Alltrim(SIX->ORDEM) == cOrdem
            lAchou := .T.
            Exit
        EndIf
        SIX->(DbSkip())
    End

Return lAchou

/* ----------------------------------------------------------------------------
   ZCHVldUsr — Valida (a) que o codigo de usuario informado existe em SYS_USR
   e (b) que nao ha OUTRO registro ZCH para o mesmo usuario (unicidade,
   decisao confirmada: 1 celular por usuario).

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

    If Type("M->ZCH_NOME") != "U"
        M->ZCH_NOME := Alltrim(SYS_USR->USR_NOME) // TODO: confirmar nome do campo (USR_NOME assumido)
    EndIf

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
