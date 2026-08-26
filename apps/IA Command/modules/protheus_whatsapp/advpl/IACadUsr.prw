#Include "TOTVS.ch"
#Include "PROTHEUS.ch"
#Include "FWMVCDef.ch"

#Define IAC_HUB_URL_PADRAO  "http://200.106.188.87:3000"

/*/{Protheus.doc} IACadUsr
    Cadastro de celular por usuario Protheus - IA Command.
    Tabela: ZCH
    A estrutura fisica e o dicionario ja devem existir no ambiente.

    IMPORTANTE — cache do login web: o login web (acesso direto pelo
    telefone, sem passar pelo Protheus) le empresas/filiais permitidas de um
    CACHE gravado no IAHub (tabela protheus_web_user_permissions), nao
    consulta o Protheus em tempo real. Esse cache nao expira sozinho — so e
    atualizado quando o usuario abre o chat pelo Protheus (POST /token) OU
    quando alguem roda a opcao de menu "Sincronizar cadastro e acessos" aqui
    (varre toda a ZCH e atualiza todos de uma vez via IACEnvSync/IACUrlSync).
    SEMPRE que o acesso (empresa/filial/grupo) de algum usuario mudar no
    Protheus, rode "Sincronizar cadastro e acessos" novamente — senao quem
    usa login web direto continua vendo o escopo antigo ate a proxima
    sincronizacao.
/*/

User Function IACADUSR()

    Private oBrowse := FWMBrowse():New()
    Private aRotina := {}

    oBrowse:SetAlias("ZCH")
    oBrowse:SetDescription("Celular por usuario - IA Command")
    oBrowse:DisableDetails()
    oBrowse:SetMenuDef("IACADUSR")
    oBrowse:Activate()

Return

/*/{Protheus.doc} MenuDef
    Menu padrao MVC para o cadastro ZCH.
/*/

Static Function MenuDef()

    Local aRotina := {}

    ADD OPTION aRotina TITLE "Visualizar" ACTION "VIEWDEF.IACADUSR" OPERATION 2 ACCESS 0
    ADD OPTION aRotina TITLE "Incluir"    ACTION "VIEWDEF.IACADUSR" OPERATION 3 ACCESS 0
    ADD OPTION aRotina TITLE "Alterar"    ACTION "VIEWDEF.IACADUSR" OPERATION 4 ACCESS 0
    ADD OPTION aRotina TITLE "Excluir"    ACTION "VIEWDEF.IACADUSR" OPERATION 5 ACCESS 0
    ADD OPTION aRotina TITLE "Sincronizar cadastro e acessos" ACTION "U_IACUSRSYNC" OPERATION 6 ACCESS 0
    ADD OPTION aRotina TITLE "Ver Acessos Sincronizados" ACTION "U_IACUSRVER" OPERATION 6 ACCESS 0

Return aRotina

/*/{Protheus.doc} ModelDef
    Modelo de dados MVC da tabela ZCH.
/*/

Static Function ModelDef()

    Local oModel   := Nil
    Local oStruZCH := FWFormStruct(1, "ZCH")

    oModel := MPFormModel():New("IACDSRM")

    oModel:AddFields("ZCH_MASTER", , oStruZCH)
    oModel:SetPrimaryKey({"ZCH_FILIAL", "ZCH_USER"})

    oModel:SetDescription("Celular por usuario - IA Command")
    oModel:GetModel("ZCH_MASTER"):SetDescription("Dados do usuario")

Return oModel

/*/{Protheus.doc} ViewDef
    View MVC da tabela ZCH.
/*/

Static Function ViewDef()

    Local oView    := Nil
    Local oModel   := ModelDef()
    Local oStruZCH := FWFormStruct(2, "ZCH")

    oView := FWFormView():New()
    oView:SetModel(oModel)
    oView:AddField("ZCH_VIEW", oStruZCH, "ZCH_MASTER")
    oView:CreateHorizontalBox("TELA", 100)
    oView:SetOwnerView("ZCH_VIEW", "TELA")
    oView:SetDescription("Celular por usuario - IA Command")

Return oView

/*/{Protheus.doc} ZCHVldUsr
    Valida usuario e preenche nome quando o campo ZCH_NOME existir na memoria.
/*/

User Function ZCHVldUsr()

    Local aArea := FWGetArea()
    Local cUser := M->ZCH_USER
    Local lRet  := .T.

    If !Empty(cUser)
        DbSelectArea("SYS_USR")
        SYS_USR->(DbSetOrder(1))

        If !SYS_USR->(MsSeek(cUser))
            Help(" ", 1, "ZCH_USER_INVALIDO", , "Usuario " + cUser + " nao encontrado em SYS_USR.", 1, 0)
            lRet := .F.
        ElseIf Type("M->ZCH_NOME") != "U"
            M->ZCH_NOME := Alltrim(SYS_USR->USR_NOME)
        EndIf
    EndIf

    FWRestArea(aArea)

Return lRet

/*/{Protheus.doc} IACUSRSYNC
    Sincroniza usuarios da ZCH com o IA Command em modo upsert.
/*/
User Function IACUSRSYNC()

    Local aArea     := FWGetArea()
    Local aUsuarios := {}
    Local cErro     := ""
    Local nTotal    := 0
    Local lSyncOk   := .F.

    If !MsgYesNo("Sincronizar os usuarios da ZCH com o IA Command?" + CRLF + ;
                 "Registros existentes serao atualizados e novos usuarios serao criados.", ;
                 "IA Command")
        Return
    EndIf

    nTotal := IACZCHUsr(@aUsuarios)
    If nTotal <= 0
        MsgAlert("Nenhum usuario com celular encontrado na tabela ZCH.", "IA Command")
        FWRestArea(aArea)
        Return
    EndIf

    Processa({|| lSyncOk := IACEnvSync(aUsuarios, @cErro)}, ;
             "IA Command", ;
             "Sincronizando usuarios com o IA Command...", ;
             .F.)

    If lSyncOk
        MsgInfo("Sincronizacao enviada ao IA Command." + CRLF + ;
                "Usuarios processados: " + cValToChar(nTotal), "IA Command")
    Else
        MsgAlert("Nao foi possivel sincronizar o cadastro:" + CRLF + cErro, "IA Command")
    EndIf

    FWRestArea(aArea)

Return

/*/{Protheus.doc} IACUSRVER
    "Ver Acessos Sincronizados" — consulta no IA Command o que foi gravado
    para o usuario da linha selecionada no browse ZCH, e mostra empresas e
    filiais liberadas de forma legivel (nome, nao so codigo). Le o mesmo
    cache que o login web usa (protheus_web_user_permissions) — reflete
    exatamente o que a proxima sessao web veria, nao consulta o ERP de novo.
/*/
User Function IACUSRVER()

    Local aArea     := FWGetArea()
    Local cUser     := Alltrim(IACCampo("ZCH_USER"))
    Local cCelular  := IACDigitos(IACCampo("ZCH_CELULA"))
    Local cErro     := ""
    Local aDados    := {}
    Local cCabecalho:= ""
    Local lOk       := .F.

    If Empty(cUser) .And. Empty(cCelular)
        MsgAlert("Selecione um usuario na lista antes de consultar.", "IA Command")
        FWRestArea(aArea)
        Return
    EndIf

    Processa({|| lOk := IACConsultaVer(cUser, cCelular, @aDados, @cCabecalho, @cErro)}, ;
             "IA Command", ;
             "Consultando acessos sincronizados...", ;
             .F.)

    If lOk
        If Empty(aDados)
            MsgStop("Nenhuma empresa/filial liberada para este usuario." + CRLF + cCabecalho, "IA Command")
        Else
            IACGridAcessos(aDados, cCabecalho, "Acessos sincronizados - " + cUser)
        EndIf
    Else
        MsgAlert("Nao foi possivel consultar os acessos:" + CRLF + cErro, "IA Command")
    EndIf

    FWRestArea(aArea)

Return

/*/{Protheus.doc} IACGridAcessos
    Janela com grid (TWBrowse) somente-leitura mostrando uma linha por
    filial liberada — Empresa Protheus | Codigo | Filial | Chave — mais
    legivel que texto corrido quando o usuario tem muitas empresas/filiais.
/*/
Static Function IACGridAcessos(aDados, cCabecalho, cTitulo)

    Local oDlg      := Nil
    Local oBrowse   := Nil
    Local aHeader   := { "Empresa Protheus", "Codigo", "Filial", "Chave" }
    Local aColSizes := { 180, 70, 340, 120 }
    // Dialog 700x900 PIXEL: TWBrowse:New() recebe (nRow, nCol, nWidth,
    // nHeight, ...) — largura/altura, NAO um segundo ponto de coordenada
    // (bottom/right). [CORRIGIDO apos grid aparecer cortada/fora do dialog:
    // versao anterior passava 355,730 como se fossem bottom/right, mas
    // TWBrowse interpreta como largura=355/altura=730, estourando um dialog
    // de 400px de altura.] [AUMENTADO apos usuario reportar coluna Filial
    // cortada — dialog e larguras de coluna maiores.]
    Local nDlgAltura  := 700
    Local nDlgLargura := 900
    Local nGridTop    := 040
    Local nGridLeft   := 008
    Local nGridLargura:= nDlgLargura - 020
    Local nGridAltura := nDlgAltura - 100

    DEFINE MSDIALOG oDlg TITLE cTitulo FROM 0, 0 TO nDlgAltura, nDlgLargura PIXEL

    IF !Empty(cCabecalho)
        @ 008, 008 SAY cCabecalho SIZE nGridLargura, 024 OF oDlg PIXEL
    ENDIF

    oBrowse := TWBrowse():New(nGridTop, nGridLeft, nGridLargura, nGridAltura, , aHeader, aColSizes, oDlg,,,,,{||},,,,,,,.F.,,.T.,,.F.,,, )
    oBrowse:SetArray(aDados)
    oBrowse:bLine := {|| { aDados[oBrowse:nAt, 1], ;
                           aDados[oBrowse:nAt, 2], ;
                           aDados[oBrowse:nAt, 3], ;
                           aDados[oBrowse:nAt, 4] } }

    DEFINE SBUTTON FROM (nDlgAltura - 040), (nDlgLargura - 070) TYPE 1 ACTION oDlg:End() ENABLE OF oDlg

    ACTIVATE MSDIALOG oDlg CENTERED

Return

// Monta aDados no formato { {empresa, codigo, filial, chave}, ... } — uma
// linha por filial liberada; empresa com "todas as filiais" gera uma unica
// linha com Filial="(Todas as filiais)"/Chave="-". cCabecalho traz
// usuario/celular/ultimo sync como texto simples acima da grid.
Static Function IACConsultaVer(cUser, cCelular, aDados, cCabecalho, cErro)
    Local oRest      := Nil
    Local aHeader    := {}
    Local cUrl       := IACUrlConsulta()
    Local cBody      := ""
    Local cResp      := ""
    Local oJsonRes   := Nil
    Local oEmpresas  := Nil
    Local oEmp       := Nil
    Local oFiliais   := Nil
    Local oFil       := Nil
    Local lOk        := .F.
    Local nI         := 0
    Local nJ         := 0
    Local lTodasFil  := .F.
    Local cNomeEmp   := ""
    Local cCodEmp    := ""

    If Empty(cUrl)
        cErro := "Parametro MV_IACURL (URL do IAHub) nao configurado."
        Return .F.
    EndIf

    cBody := '{"usuarioId":"' + IACEscJs(cUser) + '","celular":"' + IACEscJs(cCelular) + '"}'

    AAdd(aHeader, "Content-Type: application/json")
    AAdd(aHeader, "X-Protheus-Secret: " + IACSecret())

    oRest := FWRest():New(cUrl)
    oRest:SetPath("")
    oRest:nTimeOut := IACTimeout()
    oRest:SetPostParams(cBody)
    lOk := oRest:Post(aHeader)

    If !lOk
        cErro := "Falha de comunicacao com o IAHub: " + cValToChar(oRest:GetResult())
        Return .F.
    EndIf

    cResp := oRest:GetResult()
    oJsonRes := JsonObject():New()
    If oJsonRes:FromJson(cResp) != Nil
        cErro := "Resposta invalida do servidor: " + cResp
        Return .F.
    EndIf
    If !Empty(oJsonRes:GetJsonObject("error"))
        cErro := oJsonRes:GetJsonObject("error")
        Return .F.
    EndIf

    cCabecalho := "Usuario: " + cValToChar(oJsonRes:GetJsonObject("usuarioNome")) + " (" + cValToChar(oJsonRes:GetJsonObject("usuarioId")) + ")" + ;
                  "   |   Celular: " + cValToChar(oJsonRes:GetJsonObject("celular")) + ;
                  "   |   Ultima sincronizacao: " + cValToChar(oJsonRes:GetJsonObject("ultimoSyncEm"))

    oEmpresas := oJsonRes:GetJsonObject("empresas")
    If ValType(oEmpresas) != "A" .Or. Len(oEmpresas) == 0
        Return .T. // aDados fica vazio — grid mostra "sem registros"
    EndIf

    For nI := 1 To Len(oEmpresas)
        oEmp     := oEmpresas[nI]
        cNomeEmp := cValToChar(oEmp:GetJsonObject("nome"))
        cCodEmp  := cValToChar(oEmp:GetJsonObject("codigoProtheus"))

        lTodasFil := oEmp:GetJsonObject("todasFiliais") == .T.
        If lTodasFil
            AAdd(aDados, { cNomeEmp, cCodEmp, "(Todas as filiais)", "-" })
        Else
            oFiliais := oEmp:GetJsonObject("filiais")
            If ValType(oFiliais) == "A" .And. Len(oFiliais) > 0
                For nJ := 1 To Len(oFiliais)
                    oFil := oFiliais[nJ]
                    AAdd(aDados, { cNomeEmp, cCodEmp, cValToChar(oFil:GetJsonObject("nome")), cValToChar(oFil:GetJsonObject("chave")) })
                Next nJ
            Else
                AAdd(aDados, { cNomeEmp, cCodEmp, "(Nenhuma filial liberada)", "-" })
            EndIf
        EndIf
    Next nI

Return .T.

Static Function IACUrlConsulta()
    Local cBase := IACUrlBase()
    If Empty(cBase)
        Return ""
    EndIf
Return cBase + "/api/ia-command/protheus/user-permissions/consulta"

Static Function IACZCHUsr(aUsuarios)
    Local cAliasAtu := Alias()
    Local cUser     := ""
    Local cNome     := ""
    Local cCelular  := ""
    Local nTotal    := 0

    DbSelectArea("ZCH")
    ZCH->(DbGoTop())

    While !ZCH->(Eof())
        cUser    := Alltrim(IACCampo("ZCH_USER"))
        cCelular := IACDigitos(IACCampo("ZCH_CELULA"))
        cNome    := Alltrim(IACCampo("ZCH_NOME"))

        If !Empty(cUser) .And. !Empty(cCelular)
            If Empty(cNome)
                cNome := IACNomeUsr(cUser)
            EndIf
            AAdd(aUsuarios, { cUser, cNome, cCelular })
            nTotal++
        EndIf
        ZCH->(DbSkip())
    EndDo

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return nTotal

// lDebugTela (opcional): quando .T., mostra uma grid ANTES de enviar cada
// usuario, com empresa/filial que serao gravadas — usado por IACUSRSYNC
// para conferencia manual, um usuario por vez. So faz sentido no fluxo
// manual de sincronizacao (aqui); o chat (IACCHAT.prw) nao pode bloquear
// esperando clique, entao la o mesmo diagnostico fica so no ConOut.
Static Function IACEnvSync(aUsuarios, cErro, lDebugTela)
    Local oRest      := Nil
    Local aHeader    := {}
    Local cUrl       := IACUrlSync()
    Local cBody      := '{"modo":"upsert","usuarios":['
    Local cResp      := ""
    Local oJsonRes   := Nil
    Local lOk        := .F.
    Local nI         := 0
    Local nJ         := 0
    Local cUser      := ""
    Local cNome      := ""
    Local cCelular   := ""
    Local aCodigos   := {}
    Local aParamEmp  := {}
    Local nEmpresaId := 0
    Local cEmpPermit := ""
    Local cFilPermit := ""
    Local nEnviados   := 0
    Local aDebugGrid  := {}
    Local oJsonDbg    := Nil
    Local oEmpDbg     := Nil
    Local oFilDbg     := Nil
    Local nK          := 0

    If Empty(cUrl)
        cErro := "Parametro MV_IACURL (URL do IAHub) nao configurado."
        Return .F.
    EndIf

    ProcRegua(Len(aUsuarios))

    For nI := 1 To Len(aUsuarios)
        cUser    := aUsuarios[nI, 1]
        cNome    := aUsuarios[nI, 2]
        cCelular := aUsuarios[nI, 3]

        IncProc(cValToChar(nI) + "/" + cValToChar(Len(aUsuarios)) + " - " + ;
                IACRmAcent(cNome) + " (" + cUser + ")")

        aCodigos   := IACEmpUsr(cUser)
        aParamEmp  := IACSX6Lst("MV_IACEMID", aCodigos)
        nEmpresaId := IACEmpId(aCodigos, aParamEmp)
        cEmpPermit := IACEmpJs(nEmpresaId, aCodigos, aParamEmp)
        cFilPermit := IACFilJs(cUser, aCodigos)
        ConOut("[IA Command] SYNC usuario=" + cUser + " empresas=" + cEmpPermit + " filiais=" + cFilPermit)

        // [DEBUG EM TELA] monta uma grid com o que SERA enviado para este
        // usuario (empresa | codigo | filial) a partir do JSON ja montado
        // acima (cEmpPermit/cFilPermit — exatamente o payload real do POST,
        // nao uma reconstrucao paralela) e mostra ANTES de seguir para o
        // proximo usuario.
        If lDebugTela
            aDebugGrid := {}
            oJsonDbg := JsonObject():New()
            If oJsonDbg:FromJson(cFilPermit) == Nil
                For nJ := 1 To Len(oJsonDbg)
                    oEmpDbg := oJsonDbg[nJ]
                    oFilDbg := oEmpDbg:GetJsonObject("filiais")
                    If ValType(oFilDbg) == "A" .And. Len(oFilDbg) > 0
                        For nK := 1 To Len(oFilDbg)
                            AAdd(aDebugGrid, { cUser + " - " + IACRmAcent(cNome), cValToChar(oEmpDbg:GetJsonObject("codigoProtheus")), cValToChar(oFilDbg[nK]), cValToChar(oFilDbg[nK]) })
                        Next nK
                    Else
                        AAdd(aDebugGrid, { cUser + " - " + IACRmAcent(cNome), cValToChar(oEmpDbg:GetJsonObject("codigoProtheus")), "(Nenhuma filial)", "-" })
                    EndIf
                Next nJ
            EndIf
            If Len(aDebugGrid) == 0
                MsgStop("Nenhuma empresa/filial resolvida para este usuario." + CRLF + ;
                        "Usuario: " + cUser + " - " + IACRmAcent(cNome), "IA Command - Debug SYNC")
            Else
                IACGridAcessos(aDebugGrid, "ANTES DE ENVIAR - Usuario: " + cUser + " - " + IACRmAcent(cNome), ;
                                "Debug SYNC (" + cValToChar(nI) + "/" + cValToChar(Len(aUsuarios)) + ")")
            EndIf
        EndIf

        If nEmpresaId <= 0
            Loop
        EndIf

        nEnviados++

        If nEnviados > 1
            cBody += ","
        EndIf

        cBody += '{"empresaId":' + cValToChar(nEmpresaId) + ;
                 ',"usuarioId":"' + IACEscJs(cUser) + '"' + ;
                 ',"usuarioNome":"' + IACEscJs(IACRmAcent(cNome)) + '"' + ;
                 ',"celular":"' + IACEscJs(cCelular) + '"' + ;
                 ',"empresasPermitidas":' + cEmpPermit + ;
                 ',"filiaisPermitidas":' + cFilPermit + '}'
    Next nI

    cBody += "]} "

    If nEnviados <= 0
        cErro := "Nenhum usuario possui MV_IACEMID configurado nas empresas permitidas."
        Return .F.
    EndIf

    AAdd(aHeader, "Content-Type: application/json")
    AAdd(aHeader, "X-Protheus-Secret: " + IACSecret())

    oRest := FWRest():New(cUrl)
    oRest:SetPath("")
    oRest:nTimeOut := IACTimeout()
    oRest:SetPostParams(cBody)
    lOk := oRest:Post(aHeader)

    If !lOk
        cErro := "Falha de comunicacao com o IAHub: " + cValToChar(oRest:GetResult())
        Return .F.
    EndIf

    cResp := oRest:GetResult()
    oJsonRes := JsonObject():New()
    If oJsonRes:FromJson(cResp) != Nil
        cErro := "Resposta invalida do servidor: " + cResp
        Return .F.
    EndIf
    If !Empty(oJsonRes:GetJsonObject("error"))
        cErro := oJsonRes:GetJsonObject("error")
        Return .F.
    EndIf

Return .T.

Static Function IACEmpUsr(cUsuario)
    Local aEmpUsr := FWUsrEmp(cUsuario)
    Local aSM0    := FWLoadSM0()
    Local aRet    := {}
    Local nI      := 0
    Local lTodas  := .F.
    Local cGrp    := ""
    Local cCodFil := ""
    Local cEmp    := ""
    Local cEmpSM0 := ""
    Local cNome   := ""

    If ValType(aEmpUsr) == "A"
        For nI := 1 To Len(aEmpUsr)
            If ValType(aEmpUsr[nI]) == "C"
                If Alltrim(aEmpUsr[nI]) == "@@@@" .Or. Alltrim(aEmpUsr[nI]) == "@@"
                    lTodas := .T.
                    Exit
                EndIf
            EndIf
        Next nI
    EndIf

    For nI := 1 To Len(aSM0)
        If ValType(aSM0[nI]) != "A" .Or. Len(aSM0[nI]) < 3
            Loop
        EndIf

        cGrp    := Alltrim(cValToChar(aSM0[nI, 1]))
        cCodFil := Alltrim(cValToChar(aSM0[nI, 2]))
        cEmpSM0 := Alltrim(cValToChar(aSM0[nI, 3]))

        // [DIAGNOSTICO TEMPORARIO — so leitura, nao muda nenhuma logica]
        // confirma se SM0_EMPOK (pos 10) / SM0_USEROK (pos 11) ja vem util
        // (variando .T./.F. por filial) mesmo com FWLoadSM0() chamado sem
        // parametro (como ja usamos hoje) — se sim, pode virar fonte real
        // de granularidade por usuario no lugar do fallback atual. Remover
        // apos confirmar.
        // If Len(aSM0[nI]) >= 11
        //     ConOut("[IA Command][DIAG-SM0] usuario=" + cUsuario + ;
        //            " empresa=" + cEmpSM0 + " filial=" + cCodFil + ;
        //            " SM0_EMPOK=" + cValToChar(aSM0[nI, 10]) + ;
        //            " SM0_USEROK=" + cValToChar(aSM0[nI, 11]))
        // EndIf

        If !Empty(cEmpSM0)
            cEmp := cEmpSM0
        Else
            cEmp := cGrp
        EndIf

        cNome := ""
        If Len(aSM0[nI]) >= 19
            cNome := Alltrim(cValToChar(aSM0[nI, 19]))
        EndIf
        If Empty(cNome) .And. Len(aSM0[nI]) >= 17
            cNome := Alltrim(cValToChar(aSM0[nI, 17]))
        EndIf
        If Empty(cNome) .And. Len(aSM0[nI]) >= 7
            cNome := Alltrim(cValToChar(aSM0[nI, 7]))
        EndIf
        If Empty(cNome)
            cNome := cEmp
        EndIf

        If lTodas .Or. IACEmpOk(aEmpUsr, cGrp, cEmp, cCodFil)
            IACAddCod(@aRet, cEmp, cCodFil, cNome)
        EndIf
    Next nI

Return aRet


Static Function IACEmpJs(nEmpresaAtual, aCodigos, aParamEmp)
    Local aEmpresas  := {}
    Local cJson      := "["
    Local nI         := 0
    Local nEmpresaId := 0

    For nI := 1 To Len(aCodigos)
        nEmpresaId := IACEmpIDC(aCodigos[nI, 1], aParamEmp)
        If nEmpresaId > 0
            IACAddEmp(@aEmpresas, nEmpresaId, aCodigos[nI, 1], aCodigos[nI, 3])
        EndIf
    Next nI
    If nEmpresaAtual > 0
        IACAddEmp(@aEmpresas, nEmpresaAtual, "", "")
    EndIf
    For nI := 1 To Len(aEmpresas)
        If nI > 1
            cJson += ","
        EndIf
        cJson += '{"empresaId":' + cValToChar(aEmpresas[nI, 1]) + ;
                 ',"codigoProtheus":"' + IACEscJs(aEmpresas[nI, 2]) + '"' + ;
                 ',"nomeProtheus":"' + IACEscJs(aEmpresas[nI, 3]) + '"}'
    Next nI
    cJson += "]"

Return cJson

// [CORRIGIDO apos investigacao confirmar que PswRet() nao expoe a lista de
// acessos empresa+filial nesta instalacao] FWUsrEmp(cUsuario) ja e a fonte
// usada por IACEmpUsr() para resolver quais empresas o usuario acessa, e ja
// detecta corretamente o coringa de grupo inteiro ("@@@@"/"@@" — usuario
// admin/master, cadastrado so com "Grupo de empresas"). Reaproveita a MESMA
// consulta aqui (uma vez, nao por empresa) para decidir se o usuario tem
// acesso total: nesse caso, mostra TODAS as filiais reais de cada empresa
// (SM0), em vez de so a filial de referencia.
Static Function IACFilJs(cUsuario, aCodigos)
    Local aEmpUsr  := FWUsrEmp(cUsuario)
    Local lTodas   := .F.
    Local cJson    := "["
    Local nI       := 0
    Local nJ       := 0
    Local cCod     := ""
    Local aFiliais := {}

    If ValType(aEmpUsr) == "A"
        For nI := 1 To Len(aEmpUsr)
            If ValType(aEmpUsr[nI]) == "C" .And. ;
               (Alltrim(aEmpUsr[nI]) == "@@@@" .Or. Alltrim(aEmpUsr[nI]) == "@@")
                lTodas := .T.
                Exit
            EndIf
        Next nI
    EndIf

    For nI := 1 To Len(aCodigos)
        cCod     := Alltrim(cValToChar(aCodigos[nI, 1]))
        aFiliais := IACFilUsr(cCod, aCodigos, lTodas)
        // [DEBUG] mostra, no instante em que o vetor de filiais foi
        // preenchido, qual funcao preencheu (IACFilUsr, chamada por
        // IACFilJs), o usuario, a empresa e a lista resultante.
        // ConOut("[IA Command][DEBUG] IACFilJs -> IACFilUsr preencheu vetor" + ;
        //        " | usuario=" + cUsuario + " empresa=" + cCod + " lTodas=" + cValToChar(lTodas) + ;
        //        " filiais=" + IACArrTxt(aFiliais))
        If ValType(aFiliais) != "A"
            Loop
        EndIf
        If nI > 1
            cJson += ","
        EndIf
        cJson += '{"codigoProtheus":"' + IACEscJs(cCod) + '","filiais":['
        For nJ := 1 To Len(aFiliais)
            If nJ > 1
                cJson += ","
            EndIf
            cJson += '"' + IACEscJs(Alltrim(cValToChar(aFiliais[nJ]))) + '"'
        Next nJ
        cJson += ']}'
    Next nI
    cJson += "]"

Return cJson

// [DECISAO DE PRODUCAO apos investigacao extensa confirmar que PswRet() nao
// expoe, nesta instalacao, a lista de acessos empresa+filial do usuario em
// NENHUMA posicao do array de retorno (confirmado varrendo TODAS as 26
// posicoes de PswRet(1)[1] para 3 usuarios diferentes, incluindo um com
// acesso de grupo inteiro cadastrado — nenhuma posicao contem um array de
// pares {empresa,filial} nem o coringa "@@@@"). Abandonada a leitura via
// PswRet para granularidade de filial. Em vez disso, reaproveita lTodas
// (ja calculado uma vez em IACFilJs via FWUsrEmp(), a MESMA fonte que ja
// resolve corretamente o coringa de grupo para as empresas em IACEmpUsr):
// se o usuario tem acesso de grupo/empresa inteira, mostra TODAS as
// filiais reais dessa empresa na SM0; senao, so a filial de referencia
// (comportamento seguro/fail-closed quando nao ha mais informacao).
Static Function IACFilUsr(cCodigo, aCodigos, lTodas)
    Local aFiliais := {}
    Local cFilRef  := ""
    Local nI       := 0

    For nI := 1 To Len(aCodigos)
        If Alltrim(cValToChar(aCodigos[nI, 1])) == Alltrim(cValToChar(cCodigo))
            cFilRef := Alltrim(cValToChar(aCodigos[nI, 2]))
            Exit
        EndIf
    Next nI

    cCodigo := Alltrim(cValToChar(cCodigo))

    If Empty(cCodigo) .Or. Empty(cFilRef)
        Return aFiliais
    EndIf

    If lTodas
        aFiliais := IACAllFilEmp(cCodigo)
    EndIf

    If Len(aFiliais) == 0
        AAdd(aFiliais, cFilRef)
    EndIf

Return aFiliais

// Lista TODAS as filiais reais (SM0_CODFIL) cadastradas no ambiente para uma
// empresa — usada quando o usuario tem acesso de grupo/empresa inteira.
Static Function IACAllFilEmp(cCodigo)
    Local aSM0    := FWLoadSM0()
    Local aRet    := {}
    Local nI      := 0
    Local cGrp    := ""
    Local cEmp    := ""
    Local cCodFil := ""

    cCodigo := Alltrim(cValToChar(cCodigo))

    For nI := 1 To Len(aSM0)
        If ValType(aSM0[nI]) != "A" .Or. Len(aSM0[nI]) < 3
            Loop
        EndIf

        cGrp    := Alltrim(cValToChar(aSM0[nI, 1]))
        cEmp    := IACCodEmp(cGrp, Alltrim(cValToChar(aSM0[nI, 3])))
        cCodFil := Alltrim(cValToChar(aSM0[nI, 2]))

        // [DIAGNOSTICO TEMPORARIO] confirma bruto SM0_GRPEMP vs SM0_EMPRESA
        // por filial, para investigar vazamento de filial entre empresas.
        // If cCodigo == "01"
        //     ConOut("[IA Command][DIAG-ALLFIL] cCodigo=" + cCodigo + ;
        //            " filial=" + cCodFil + " SM0_GRPEMP=" + cGrp + ;
        //            " SM0_EMPRESA=" + Alltrim(cValToChar(aSM0[nI, 3])) + ;
        //            " cEmpResolvido=" + cEmp + " match=" + IIf(cEmp == cCodigo, "SIM", "nao"))
        // EndIf

        If cEmp == cCodigo .And. !Empty(cCodFil)
            AAdd(aRet, cCodFil)
        EndIf
    Next nI

Return aRet

// Formata um array simples como texto "[item1,item2,...]" — usado so para
// mensagens de debug (ConOut), nao gera JSON valido (sem aspas).
Static Function IACArrTxt(aValores)
    Local cRet := "["
    Local nI   := 0

    If ValType(aValores) != "A"
        Return "[]"
    EndIf

    For nI := 1 To Len(aValores)
        If nI > 1
            cRet += ","
        EndIf
        cRet += Alltrim(cValToChar(aValores[nI]))
    Next nI

    cRet += "]"
Return cRet

Static Function IACSX6Lst(cParam, aCodigos)
    Local cAliasAtu := Alias()
    Local aRet      := {}
    Local nI        := 0
    Local cFil      := ""
    Local cValor    := ""
    Local cVar      := Alltrim(cParam)
    Local cDel      := ""

    DbSelectArea("SX6")

    For nI := 1 To Len(aCodigos)
        cFil   := Left(Alltrim(cValToChar(aCodigos[nI, 1])), 2)
        cValor := ""
        If !Empty(cFil)
            SX6->(DbSetOrder(1))
            If SX6->(MsSeek(cFil + cVar))
                cDel := IACCampo("D_E_L_E_T_")
                If Empty(cDel) .And. Alltrim(IACCampo("X6_FIL")) == cFil .And. ;
                   IACCampo("X6_VAR") == cVar
                    cValor := IACCampo("X6_CONTEUD")
                EndIf
            EndIf
        EndIf
        If !Empty(cFil) .And. !Empty(cValor)
            AAdd(aRet, { cFil, cValor })
        EndIf
    Next nI

    If Len(aRet) == 0
        SX6->(DbGoTop())
        While !SX6->(Eof())
            cDel := IACCampo("D_E_L_E_T_")
            If Empty(cDel) .And. IACCampo("X6_VAR") == cVar
                cFil   := Alltrim(IACCampo("X6_FIL"))
                cValor := IACCampo("X6_CONTEUD")
                If !Empty(cFil) .And. !Empty(cValor)
                    AAdd(aRet, { cFil, cValor })
                EndIf
            EndIf
            SX6->(DbSkip())
        EndDo
    EndIf

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return aRet

Static Function IACEmpId(aCodigos, aParamEmp)
    Local nRet    := 0
    Local cEmpAtu := Alltrim(cValToChar(cEmpAnt))
    Local cFilAtu := Alltrim(cValToChar(cFilAnt))
    Local cCod    := ""
    Local cFil    := ""
    Local nI      := 0

    For nI := 1 To Len(aCodigos)
        cCod := Alltrim(cValToChar(aCodigos[nI, 1]))
        cFil := Alltrim(cValToChar(aCodigos[nI, 2]))

        If (!Empty(cEmpAtu) .And. cCod == cEmpAtu) .Or. ;
           (!Empty(cFilAtu) .And. cFil == cFilAtu) .Or. ;
           (!Empty(cCod) .And. !Empty(cFilAtu) .And. Left(cFilAtu, Len(cCod)) == cCod) .Or. ;
           (!Empty(cFilAtu) .And. !Empty(cFil) .And. Left(cFil, Len(cFilAtu)) == cFilAtu)
            nRet := IACEmpIDC(cCod, aParamEmp)
            If nRet > 0
                Return nRet
            EndIf
        EndIf
    Next nI

    If Len(aCodigos) > 0
        nRet := IACEmpIDC(aCodigos[1, 1], aParamEmp)
    EndIf
Return nRet

Static Function IACEmpIDC(cCodigoProtheus, aParamEmp)
    Local cFilBus := Left(Alltrim(cValToChar(cCodigoProtheus)), 2)
    Local nI      := 0
    For nI := 1 To Len(aParamEmp)
        If ValType(aParamEmp[nI]) == "A" .And. Len(aParamEmp[nI]) >= 2 .And. ;
           Alltrim(cValToChar(aParamEmp[nI, 1])) == cFilBus
            Return Val(Alltrim(cValToChar(aParamEmp[nI, 2])))
        EndIf
    Next nI
Return 0

Static Function IACCodEmp(cGrp, cEmpSM0)
    Local cRet := ""

    cGrp    := Alltrim(cValToChar(cGrp))
    cEmpSM0 := Alltrim(cValToChar(cEmpSM0))

    If !Empty(cEmpSM0)
        cRet := cEmpSM0
    Else
        cRet := cGrp
    EndIf

Return cRet


Static Function IACEmpOk(aEmpUsr, cGrp, cEmp, cFil)
    Local nI   := 0
    Local cVal := ""
    For nI := 1 To Len(aEmpUsr)
        If ValType(aEmpUsr[nI]) != "C"
            Loop
        EndIf
        cVal := Alltrim(cValToChar(aEmpUsr[nI]))
        If cVal == cEmp .Or. cVal == cGrp .Or. cVal == cFil
            Return .T.
        EndIf
    Next nI
Return .F.

Static Function IACAddCod(aLista, cCodigo, cFilReferencia, cNome)
    Local nI := 0
    If Empty(cCodigo)
        Return
    EndIf
    For nI := 1 To Len(aLista)
        If aLista[nI, 1] == cCodigo
            Return
        EndIf
    Next nI
    AAdd(aLista, { Alltrim(cCodigo), Alltrim(cFilReferencia), Alltrim(cNome) })
Return

Static Function IACAddEmp(aEmpresas, nEmpresaId, cCodigoProtheus, cNomeProtheus)
    Local nI := 0
    For nI := 1 To Len(aEmpresas)
        If aEmpresas[nI, 1] == nEmpresaId
            Return
        EndIf
    Next nI
    AAdd(aEmpresas, { nEmpresaId, Alltrim(cCodigoProtheus), Alltrim(cNomeProtheus) })
Return

Static Function IACNomeUsr(cUsuario)
    Local cAliasAtu := Alias()
    Local cNome     := ""
    DbSelectArea("SYS_USR")
    SYS_USR->(DbSetOrder(1))
    If SYS_USR->(MsSeek(cUsuario))
        cNome := Alltrim(SYS_USR->USR_NOME)
    EndIf
    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf
Return cNome

Static Function IACCampo(cCampo)
    Local nPos := FieldPos(cCampo)
    Local cRet := ""
    If nPos > 0
        cRet := Alltrim(cValToChar(FieldGet(nPos)))
    EndIf
Return cRet

Static Function IACDigitos(cTexto)
    Local cRet := ""
    Local nI   := 0
    Local cChr := ""
    For nI := 1 To Len(cTexto)
        cChr := SubStr(cTexto, nI, 1)
        If cChr $ "0123456789"
            cRet += cChr
        EndIf
    Next nI
Return cRet

Static Function IACEscJs(cTexto)
    Local cSaida := StrTran(cValToChar(cTexto), '\', '\\')
    cSaida := StrTran(cSaida, '"', '\"')
Return cSaida

Static Function IACRmAcent(cTexto)
Return cValToChar(cTexto)

Static Function IACUrlBase()
    Local cBase := Alltrim(GetMV("MV_IACURL", , ""))
    If Empty(cBase)
        cBase := IAC_HUB_URL_PADRAO
    EndIf
Return cBase

Static Function IACUrlSync()
    Local cBase := IACUrlBase()
    If Empty(cBase)
        Return ""
    EndIf
Return cBase + "/api/ia-command/protheus/user-permissions/sync"

Static Function IACSecret()
Return Alltrim(GetMV("MV_IACSECR", , ""))

Static Function IACTimeout()
    Local nRet := Val(cValToChar(GetMV("MV_IACTOUT", , "8000")))
    If nRet <= 0
        nRet := 8000
    EndIf
Return nRet

/*/{Protheus.doc} ZCHVldCel
    Validacao simples do celular: DDI + DDD + numero.
/*/

User Function ZCHVldCel()

    Local cCel   := M->ZCH_CELULA
    Local cDig   := ""
    Local nI     := 0
    Local lRet   := .T.

    For nI := 1 To Len(cCel)
        If SubStr(cCel, nI, 1) $ "0123456789"
            cDig += SubStr(cCel, nI, 1)
        EndIf
    Next nI

    If Len(cDig) < 12 .Or. Len(cDig) > 13
        Help(" ", 1, "ZCH_CEL_INVALIDO", , "Celular incompleto. Informe DDI + DDD + numero, ex: +55 (65) 99901-0275.", 1, 0)
        lRet := .F.
    EndIf

Return lRet
