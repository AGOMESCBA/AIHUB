#Include "TOTVS.ch"
#Include "PROTHEUS.ch"
#Include "FWMVCDef.ch"

/*/{Protheus.doc} IACadUsr
    Cadastro de celular por usuario Protheus - IA Command.
    Tabela: ZCH
    A estrutura fisica e o dicionario ja devem existir no ambiente.
/*/

User Function IACadUsr()

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
    ADD OPTION aRotina TITLE "Incluir"    ACTION "U_IACZInc()" OPERATION 3 ACCESS 0
    ADD OPTION aRotina TITLE "Alterar"    ACTION "VIEWDEF.IACADUSR" OPERATION 4 ACCESS 0
    ADD OPTION aRotina TITLE "Excluir"    ACTION "VIEWDEF.IACADUSR" OPERATION 5 ACCESS 0

Return aRotina

/*/{Protheus.doc} IACZInc
    Abre a inclusao do cadastro ZCH.
/*/

User Function IACZInc()
    Local aArea := FWGetArea()
    Local cFunBkp := FunName()

    DbSelectArea("ZCH")
    ZCH->(DbSetOrder(1))

    SetFunName("IACADUSR")
    FWExecView("Incluir celular por usuario", "IACADUSR", MODEL_OPERATION_INSERT)
    SetFunName(cFunBkp)

    FWRestArea(aArea)

Return

/*/{Protheus.doc} ModelDef
    Modelo de dados MVC da tabela ZCH.
/*/

Static Function ModelDef()

    Local oModel   := Nil
    Local oStruZCH := FWFormStruct(1, "ZCH")

    oModel := MPFormModel():New("IACADUSRM")

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
