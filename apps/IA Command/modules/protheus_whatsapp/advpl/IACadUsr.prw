#Include "TOTVS.ch"
#Include "PROTHEUS.ch"
#Include "FWMVCDef.ch"

#Define IAC_HUB_URL_PADRAO  "http://200.106.188.87:3000"

/*/{Protheus.doc} IACadUsr
    Cadastro de celular por usuario Protheus - IA Command.
    Tabela: ZCH
    A estrutura fisica e o dicionario ja devem existir no ambiente.
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
    ADD OPTION aRotina TITLE "Sincronizar cadastro" ACTION "U_IACUSRSYNC" OPERATION 6 ACCESS 0

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

Static Function IACEnvSync(aUsuarios, cErro)
    Local oRest      := Nil
    Local aHeader    := {}
    Local cUrl       := IACUrlSync()
    Local cBody      := '{"modo":"upsert","usuarios":['
    Local cResp      := ""
    Local oJsonRes   := Nil
    Local lOk        := .F.
    Local nI         := 0
    Local cUser      := ""
    Local cNome      := ""
    Local cCelular   := ""
    Local aCodigos   := {}
    Local aParamEmp  := {}
    Local nEmpresaId := 0
    Local cEmpPermit := ""
    Local cFilPermit := ""
    Local nEnviados   := 0

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
    Local cFil    := ""
    Local cEmp    := ""
    Local cEmpSM0 := ""
    Local cNome   := ""

    If Len(aEmpUsr) == 1 .And. ValType(aEmpUsr[1]) == "C"
        lTodas := aEmpUsr[1] == "@@@@"
    EndIf

    For nI := 1 To Len(aSM0)
        If ValType(aSM0[nI]) != "A" .Or. Len(aSM0[nI]) < 3
            Loop
        EndIf
        cGrp    := Alltrim(cValToChar(aSM0[nI, 1]))
        cFil    := Alltrim(cValToChar(aSM0[nI, 2]))
        cEmpSM0 := Alltrim(cValToChar(aSM0[nI, 3]))
        cEmp    := IACCodEmp(cGrp, cFil, cEmpSM0)
        cNome   := ""
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
        If lTodas .Or. IACEmpOk(aEmpUsr, cGrp, cEmp, cFil)
            IACAddCod(@aRet, cEmp, cFil, cNome)
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

Static Function IACFilJs(cUsuario, aCodigos)
    Local cJson    := "["
    Local nI       := 0
    Local nJ       := 0
    Local cCod     := ""
    Local aFiliais := {}

    For nI := 1 To Len(aCodigos)
        cCod     := Alltrim(cValToChar(aCodigos[nI, 1]))
        aFiliais := IACFilUsr(cUsuario, cCod, aCodigos)
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

Static Function IACFilUsr(cUsuario, cCodigo, aCodigos)
    Local aFiliais := {}
    Local aUsrData := {}
    Local aAcessos := {}
    Local cFilRef  := ""
    Local nI       := 0
    Local nJ       := 0
    Local cEmp     := ""
    Local cFil     := ""
    Local lExiste  := .F.

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

    Begin Sequence
        PswOrder(1)
        If PswSeek(cUsuario, .T.)
            aUsrData := PswRet(1)
            If ValType(aUsrData) == "A" .And. Len(aUsrData) >= 25 .And. ValType(aUsrData[25]) == "A"
                aAcessos := aUsrData[25]
                For nI := 1 To Len(aAcessos)
                    If ValType(aAcessos[nI]) == "A" .And. Len(aAcessos[nI]) >= 2
                        cEmp := Alltrim(cValToChar(aAcessos[nI, 1]))
                        cFil := Alltrim(cValToChar(aAcessos[nI, 2]))
                        If cEmp == cCodigo .And. !Empty(cFil) .And. cFil != "@@@@" .And. cFil != "@@"
                            lExiste := .F.
                            For nJ := 1 To Len(aFiliais)
                                If Alltrim(cValToChar(aFiliais[nJ])) == cFil
                                    lExiste := .T.
                                    Exit
                                EndIf
                            Next nJ
                            If !lExiste
                                AAdd(aFiliais, cFil)
                            EndIf
                        EndIf
                    EndIf
                Next nI
            EndIf
        EndIf
    Recover
        aFiliais := {}
        ConOut("[IA Command] IACUSRSYNC: falha ao consultar permissoes via PswRet para empresa " + cCodigo + " usuario " + cUsuario)
    End Sequence

    If Len(aFiliais) == 0
        AAdd(aFiliais, cFilRef)
    EndIf

Return aFiliais

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

Static Function IACCodEmp(cGrp, cFil, cEmpSM0)
    Local cRet := ""
    If !Empty(cFil)
        cRet := Left(Alltrim(cFil), 2)
    EndIf
    If Empty(cRet) .And. !Empty(cEmpSM0) .And. Len(Alltrim(cEmpSM0)) <= 2
        cRet := Alltrim(cEmpSM0)
    EndIf
    If Empty(cRet)
        cRet := Left(Alltrim(cGrp), 2)
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
