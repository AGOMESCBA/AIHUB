#INCLUDE "PROTHEUS.CH"
#INCLUDE "FWMVCDEF.CH"
#INCLUDE "TOTVS.CH"

/* ============================================================================
   IACCHAT.PRW — Chat IA Command embutido no Protheus (TWebEngine)

   ATENCAO: fonte de REFERENCIA, escrito fora de um ambiente Protheus e NUNCA
   compilado/testado em um SmartClient/TOTVS App Studio real. Antes de subir
   para homologacao, um desenvolvedor ADVPL do time precisa:
     1. Compilar e revisar contra o Include padrao da versao de Protheus em uso
        (nomes de classe/metodo podem variar entre releases).
     2. Confirmar que FwRest() esta disponivel e configurada (Host).
     3. Validar tratamento de erro de rede/timeout em cenario real.
     4. Ajustar cIAHubUrl e cProthSecret para os valores do ambiente.

   Depende de (lado servidor, ja implementado e testado em Node.js):
     POST /api/ia-command/protheus/token   (modules/protheus_whatsapp/routes.js)
     GET  /api/ia-command/protheus/chat    (serve o frontend do chat)

   Documentacao completa do contrato de API:
     apps/IA Command/modules/protheus_whatsapp/README.md
   ============================================================================ */

// ── Configuracao do ambiente — AJUSTAR antes de compilar em cada instalacao ──
#DEFINE IAC_HUB_URL       "https://SEU-HOST-IAHUB/api/ia-command/protheus/token"
#DEFINE IAC_HUB_CHAT_URL  "https://SEU-HOST-IAHUB/api/ia-command/protheus/chat"
#DEFINE IAC_HTTP_TIMEOUT  8000  // ms

/* ----------------------------------------------------------------------------
   IACChat
   Abre a tela de chat da IA Command embutida no Protheus via TWebEngine.
   Registrar no menu do modulo Comercial (SIGAFAT) — piloto definido.
---------------------------------------------------------------------------- */
User Function IACChat()
    Local oDialog
    Local oWebEngine
    Local oWebChannel
    Local cCelular   := ""
    Local cToken     := ""
    Local cNomeUser  := Alltrim(UsrFullName(RetCodUsr()))
    Local cUrlChat   := ""
    Local lOk        := .T.
    Local cErro      := ""

    cCelular := IACLerCelularUsuario()

    If Empty(cCelular)
        MsgAlert("Seu cadastro de usuario nao possui celular configurado (SYS_USR->USR_CELULAR)." + CRLF + ;
                  "Procure o administrador do sistema para configurar antes de usar o IA Command.", "IA Command")
        Return
    EndIf

    lOk := IACSolicitarToken(cCelular, @cToken, @cErro)

    If !lOk
        MsgAlert("Nao foi possivel iniciar a sessao do IA Command:" + CRLF + cErro, "IA Command")
        Return
    EndIf

    cUrlChat := IAC_HUB_CHAT_URL + "?token=" + cToken + "&usuario=" + FwNoAcento(cNomeUser)

    DEFINE MSDIALOG oDialog TITLE "IA Command" FROM 0, 0 TO 700, 1000 PIXEL

    oWebChannel := TWebChannel():New()
    oWebEngine  := TWebEngine():New(oDialog, 0, 0, 700, 1000, , oWebChannel:nPort)
    oWebEngine:Align := CONTROL_ALIGN_ALLCLIENT
    oWebEngine:Navigate(cUrlChat)

    ACTIVATE MSDIALOG oDialog CENTERED

Return

/* ----------------------------------------------------------------------------
   IACLerCelularUsuario
   Le o celular do usuario logado a partir de SYS_USR->USR_CELULAR.
   Retorna string vazia se nao encontrado ou campo vazio.
   Normalizacao (remover mascara) e feita no backend (token-service.js),
   nao e necessaria aqui — a rotina pode enviar o valor como estiver gravado.
---------------------------------------------------------------------------- */
Static Function IACLerCelularUsuario()
    Local cCelular := ""
    Local cAliasAtu := Alias()

    DbSelectArea("SYS_USR")
    SYS_USR->(DbSetOrder(1)) // ajustar indice conforme dicionario de dados real
    If SYS_USR->(MsSeek(xFilial("SYS_USR") + RetCodUsr()))
        cCelular := Alltrim(SYS_USR->USR_CELULAR)
    EndIf

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return cCelular

/* ----------------------------------------------------------------------------
   IACSolicitarToken
   Chama POST /api/ia-command/protheus/token no IAHub para obter o token curto
   de sessao do chat. Retorna .T./.F. e preenche cToken ou cErro por referencia.

   empresaId: NAO existe hoje nenhuma traducao automatica entre codigo de
   empresa/filial Protheus (cEmpresaAnt/cFilAnt) e o empresa_id interno do
   IA Command (inteiro gerado pelo cadastro de empresas do IAHub). Decisao
   confirmada: parametro fixo por instalacao, configurado manualmente uma vez
   por empresa-cliente via SX6 MV_IACEMID (ver IACEmpresaIdIaCommand abaixo).
   Nao inferir esse valor automaticamente a partir de cEmpresaAnt/cFilAnt —
   sao namespaces diferentes (codigo ADVPL vs. id sequencial do IAHub) sem
   relacao implicita entre si.
---------------------------------------------------------------------------- */
Static Function IACSolicitarToken(cCelular, cToken, cErro)
    Local oRest
    Local cBody    := ""
    Local cRespo   := ""
    Local lOk      := .F.
    Local oJsonRes
    Local nEmpresaId := IACEmpresaIdIaCommand() // ver comentario acima

    If nEmpresaId <= 0
        cErro := "Parametro MV_IACEMID nao configurado. Cadastre-o em Configurador (SIGACFG) > " + ;
                  "Ambiente > Cadastros > Parametros, com o empresa_id do IA Command " + ;
                  "correspondente a esta empresa/filial Protheus."
        Return .F.
    EndIf

    cBody := '{"empresaId":' + cValToChar(nEmpresaId) + ;
              ',"celular":"' + cCelular + '"' + ;
              ',"filial":"' + xFilial() + '"}'

    oRest := FWRest():New(IAC_HUB_URL)
    oRest:SetPath("")
    oRest:xHeaders := {}
    AAdd(oRest:xHeaders, "Content-Type: application/json")
    AAdd(oRest:xHeaders, "X-Protheus-Secret: " + IACSegredoProtheusChat())

    lOk := oRest:Post(cBody, IAC_HTTP_TIMEOUT)

    If !lOk
        cErro := "Falha de comunicacao com o IAHub (" + AllTrim(Str(oRest:GetLastError())) + ")."
        Return .F.
    EndIf

    cRespo := oRest:GetResult()

    oJsonRes := JsonObject():New()
    If oJsonRes:FromJson(cRespo) != Nil
        cErro := "Resposta invalida do servidor: " + cRespo
        Return .F.
    EndIf

    If !Empty(oJsonRes:GetJsonObject("error"))
        cErro := oJsonRes:GetJsonObject("error")
        Return .F.
    EndIf

    cToken := oJsonRes:GetJsonObject("token")

    If Empty(cToken)
        cErro := "Servidor nao retornou token."
        Return .F.
    EndIf

Return .T.

/* ----------------------------------------------------------------------------
   IACEmpresaIdIaCommand / IACSegredoProtheusChat

   Parametros de configuracao (SX6) — CADASTRO MANUAL OBRIGATORIO, uma vez por
   empresa/filial Protheus, antes do primeiro uso. Nao ha valor padrao valido:
   MV_IACEMID = 0 bloqueia o uso (ver IACSolicitarToken); MV_IACSECR vazio faz
   o backend rejeitar a chamada com 401 (ver routes.js — X-Protheus-Secret).

   MV_IACEMID (numerico) — empresa_id do IA Command correspondente a esta
     empresa/filial Protheus. Obter na tela de administracao do IA Command
     (cadastro de empresas do IAHub) ANTES de configurar este parametro —
     nao existe lookup automatico (ver comentario em IACSolicitarToken).
   MV_IACSECR (caractere) — mesmo valor de IAC_PROTHEUS_CHAT_SECRET configurado
     no ambiente do IAHub (.env). Repassar por canal seguro entre os times,
     nunca commitar em texto puro.

   Cadastro: Configurador (SIGACFG) > Ambiente > Cadastros > Parametros (CFGX013).
---------------------------------------------------------------------------- */
Static Function IACEmpresaIdIaCommand()
Return GetMV("MV_IACEMID", , 0)

Static Function IACSegredoProtheusChat()
Return GetMV("MV_IACSECR", , "")
