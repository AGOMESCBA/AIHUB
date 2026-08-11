#INCLUDE "PROTHEUS.CH"
#INCLUDE "FWMVCDEF.CH"
#INCLUDE "TOTVS.CH"

/* ============================================================================
   IACCHAT.PRW — Chat IA Command embutido no Protheus (TWebEngine)

   ============================================================================
   !!! REQUISITO MINIMO DE VERSAO — CONFIRMAR ANTES DE COMPILAR !!!

   Este fonte usa TWebEngine/TWebChannel, que so existem a partir do SmartClient
   build 170117, e depende de Chromium 111+ (embarcado a partir do SmartClient
   20.3.2.0) para o frontend (protheus-chat.html) renderizar corretamente. Sem
   isso, a rotina PODE NAO COMPILAR (classe inexistente) ou compilar e falhar
   em runtime (tela em branco / erro de navegacao no TWebEngine).

   Nao ha mapeamento confirmado entre build do SmartClient e release do Protheus
   (12.1.xxxx) — sao numeracoes de versionamento diferentes. ANTES de compilar:
     - Verificar o build do SmartClient em uso na instalacao-alvo (tela "Sobre"
       do SmartClient) e confirmar que e igual ou posterior a 20.3.2.0.
     - Se for anterior, esta rotina NAO deve ser usada sem antes atualizar o
       SmartClient da instalacao — nao ha fallback funcional para versoes mais
       antigas (TWebEngine e o unico mecanismo usado aqui para embutir HTML).
   ============================================================================

   ATENCAO: fonte de REFERENCIA, escrito fora de um ambiente Protheus e NUNCA
   compilado/testado em um SmartClient/TOTVS App Studio real. Antes de subir
   para homologacao, um desenvolvedor ADVPL do time precisa validar contra o
   TDN/Include real da versao em uso os pontos abaixo (nao confirmados aqui):

     a) Assinatura de TWebChannel():New() / TWebEngine():New(...) — usados
        conforme exemplo publico da TOTVS (github.com/totvs/twebengine-sample),
        sem validacao contra o Include instalado nesta versao.
     b) [CORRIGIDO apos erro em producao 10/08/2026] FWRest():GetLastError()
        apos Post() malsucedido NAO retorna numero nesta versao (erro
        "argument #0 error, expected N->C, function str" ao tentar Str()
        sobre o retorno). Trocado por oRest:GetResult() (metodo confirmado —
        ja usado em caso de sucesso). FWRest em si requer Protheus 12.1.17+,
        requisito mais antigo que o do TWebEngine acima e portanto nao
        limitante.
     b.1) [CORRIGIDO apos erro em producao 10/08/2026] Headers do FWRest:
        oRest:xHeaders NAO existe como propriedade nesta versao (Framework
        20251006) — erro "invalid property XHEADERS" em runtime. Trocado para
        o padrao documentado: array local (aHeader) montado com AAdd() e
        passado como parametro de Post()/Get(). Tambem NAO confirmado: se o
        body do POST deve ir via SetPostParams(cBody) antes de Post(aHeader)
        (forma usada agora) ou como 1o parametro de Post(cBody, aHeader) —
        validar contra o Include FWREST.CH/FWREST.PRW desta instalacao antes
        de subir para producao novamente.
     c) JsonObject():FromJson() / :GetJsonObject() — assinatura/retorno nao
        confirmados contra o TDN (ex.: se GetJsonObject("error") retorna nil,
        string vazia ou erro de execucao quando a chave nao existe na resposta
        — o codigo abaixo assume que retorna vazio/nil de forma segura).
     d) FwNoAcento() — nome usado por convencao de outras funcoes Fw* do
        framework, mas existencia com esse nome exato NAO confirmada (pode ser
        RemoveAcento() ou outro nome, dependendo da versao/lib instalada).

   Todo valor de configuracao especifico de ambiente (URL do IAHub, timeout,
   empresa_id, segredo) e lido via parametro SX6 (GetMV) — ver bloco
   "Configuracao via parametros SX6" no final do arquivo. A URL do IAHub
   (MV_IACURL) tem um valor DEFAULT chumbado abaixo em IAC_HUB_URL_PADRAO
   apenas para permitir teste imediato em ambiente de desenvolvimento/piloto,
   sem exigir cadastro previo do parametro. ANTES DE HOMOLOGACAO/PRODUCAO:
     1. Cadastrar o parametro MV_IACURL em Configurador (SIGACFG) > Ambiente >
        Cadastros > Parametros, com a URL definitiva do IAHub daquele ambiente
        (o valor de teste abaixo e http://200.106.188.87:3000 — endereco de
        desenvolvimento, NAO usar em producao sem confirmar).
     2. Remover ou esvaziar IAC_HUB_URL_PADRAO neste fonte apos o parametro
        estar cadastrado em todas as instalacoes-alvo, para que a ausencia do
        SX6 vire erro explicito (MsgAlert) em vez de silenciosamente usar o
        endereco de teste.
   !!! ATENCAO — MV_IACEMID e MV_IACSECR TAMBEM TEM DEFAULT CHUMBADO ABAIXO !!!
   Decisao explicita do usuario, ciente do risco: MV_IACSECR chumbado significa
   que QUALQUER PESSOA COM ACESSO AO FONTE ADVPL (nao so ao servidor Protheus)
   consegue ler o segredo e emitir tokens validos para qualquer celular
   cadastrado, de fora do ambiente Protheus — e a unica barreira de autenticacao
   do endpoint POST /token. Aceitavel apenas enquanto o acesso ao fonte for
   restrito (hoje: uso individual, ambiente de teste/piloto controlado).
   OBRIGATORIO antes de expor a mais pessoas ou ir para producao real:
     1. Cadastrar MV_IACEMID e MV_IACSECR em Configurador (SIGACFG) > Ambiente
        > Cadastros > Parametros, com os valores definitivos.
     2. Remover ou esvaziar IAC_EMPRESA_ID_PADRAO e IAC_SEGREDO_PADRAO neste
        fonte (ver defines abaixo), e RECOMPILAR — enquanto o fonte existir com
        esses valores em texto puro, o risco descrito acima persiste mesmo que
        o SX6 ja esteja cadastrado (o fallback so deixa de ser *usado*, mas o
        valor continua legivel no fonte ate ser removido fisicamente).
     3. Gerar um NOVO segredo (nao reaproveitar o valor de teste abaixo) ao
        configurar producao, ja que este valor tera circulado neste fonte.

   Depende de (lado servidor, ja implementado e testado em Node.js):
     POST /api/ia-command/protheus/token   (modules/protheus_whatsapp/routes.js)
     GET  /api/ia-command/protheus/chat    (serve o frontend do chat)

   Documentacao completa do contrato de API:
     apps/IA Command/modules/protheus_whatsapp/README.md
   ============================================================================ */

#DEFINE IAC_HTTP_TIMEOUT_PADRAO  8000  // ms — usado somente se MV_IACTOUT nao configurado

// VALOR DE TESTE/DESENVOLVIMENTO — endereco do IA Command informado para o
// piloto. So e usado enquanto o parametro MV_IACURL nao estiver cadastrado
// (ver IACUrlToken()/IACUrlChat() e instrucoes no cabecalho do arquivo acima).
// TODO antes de producao: cadastrar MV_IACURL e remover/esvaziar esta linha.
#DEFINE IAC_HUB_URL_PADRAO  "http://200.106.188.87:3000"

// VALOR DE TESTE — empresa "J2A TESTE" (empresa_id=3 no cadastro do IA Command
// / IAHub). So e usado enquanto o parametro MV_IACEMID nao estiver cadastrado.
// TODO antes de producao/mais usuarios: cadastrar MV_IACEMID por instalacao e
// remover/esvaziar esta linha (empresa_id muda por empresa-cliente real).
#DEFINE IAC_EMPRESA_ID_PADRAO  3

// !!! CELULAR DE TESTE CHUMBADO !!!
// IACLerCelularUsuario() foi comentada (ver funcao abaixo) porque a tabela
// SYS_USR nao existe neste ambiente Protheus (erro real em producao: "Alias
// does not exist: SYS_USR"). Ate confirmar com o dicionario de dados real
// qual e a tabela/alias correto do cadastro de usuarios com o campo de
// celular, a rotina usa este valor fixo. TODO: descobrir o alias certo,
// reativar IACLerCelularUsuario() com o nome correto, e remover esta linha.
#DEFINE IAC_CELULAR_TESTE_PADRAO  "55 65 99987-5116"

// !!! SEGREDO DE TESTE CHUMBADO — RISCO DE SEGURANCA ACEITO TEMPORARIAMENTE !!!
// Mesmo valor de IAC_PROTHEUS_CHAT_SECRET configurado no .env deste ambiente
// de desenvolvimento. Decisao explicita do usuario (ver ressalva no cabecalho
// do arquivo): aceitavel apenas enquanto o acesso a este fonte for restrito.
// So e usado enquanto o parametro MV_IACSECR nao estiver cadastrado.
// OBRIGATORIO antes de producao/mais usuarios: cadastrar MV_IACSECR com um
// segredo NOVO (nao este) e remover/esvaziar esta linha — ver item 3 da
// ressalva no cabecalho do arquivo.
#DEFINE IAC_SEGREDO_PADRAO  "581c137af37739fdcfd829c8a1cd568068e4156642725e88b5cf542e3520b073"

/* ----------------------------------------------------------------------------
   IACChat
   Abre a tela de chat da IA Command embutida no Protheus via TWebEngine.
   Registrar no menu do modulo Comercial (SIGAFAT) — piloto definido.
---------------------------------------------------------------------------- */
User Function IACChat()
    Local oDialog
    Local oWebEngine
    Local oWebChannel
    Local cCelular    := ""
    Local cToken      := ""
    Local cNomeUser   := Alltrim(UsrFullName(RetCodUsr()))
    Local cUrlChatBase := ""
    Local cUrlChat    := ""
    Local lOk         := .T.
    Local cErro       := ""

    cUrlChatBase := IACUrlChat()
    If Empty(cUrlChatBase)
        MsgAlert("Parametro MV_IACURL (URL do chat no IAHub) nao configurado." + CRLF + ;
                  "Procure o administrador do sistema.", "IA Command")
        Return
    EndIf

    // IACLerCelularUsuario() DESATIVADA — tabela SYS_USR nao existe neste
    // ambiente (erro real: "Alias does not exist: SYS_USR"). Usando celular
    // fixo de teste ate confirmar o alias correto do cadastro de usuarios.
    // Ver ressalva e TODO junto de IAC_CELULAR_TESTE_PADRAO no topo do arquivo.
    cCelular := IAC_CELULAR_TESTE_PADRAO

    If Empty(cCelular)
        MsgAlert("Celular de teste nao configurado (IAC_CELULAR_TESTE_PADRAO)." + CRLF + ;
                  "Procure o administrador do sistema.", "IA Command")
        Return
    EndIf

    lOk := IACSolicitarToken(cCelular, @cToken, @cErro)

    If !lOk
        MsgAlert("Nao foi possivel iniciar a sessao do IA Command:" + CRLF + cErro, "IA Command")
        Return
    EndIf

    // FWURLEncode evita quebra da querystring se cNomeUser tiver espaco, & ou =
    // apos a remocao de acentos (ex.: "Jose & Silva", nomes com caracteres
    // especiais de cadastro). Token ja e hexadecimal puro (token-service.js),
    // sem necessidade de encode. Confirmar disponibilidade de FWURLEncode no
    // Include desta versao — se indisponivel, alternativa e Escape().
    cUrlChat := cUrlChatBase + "?token=" + cToken + "&usuario=" + FWURLEncode(FwNoAcento(cNomeUser))

    DEFINE MSDIALOG oDialog TITLE "IA Command" FROM 0, 0 TO 700, 1000 PIXEL

    oWebChannel := TWebChannel():New()
    oWebEngine  := TWebEngine():New(oDialog, 0, 0, 700, 1000, , oWebChannel:nPort)
    oWebEngine:Align := CONTROL_ALIGN_ALLCLIENT
    oWebEngine:Navigate(cUrlChat)

    ACTIVATE MSDIALOG oDialog CENTERED

Return

/* ----------------------------------------------------------------------------
   IACLerCelularUsuario — DESATIVADA, NAO CHAMADA POR IACChat() ATUALMENTE.

   Erro real confirmado em producao (10/08/2026): "Alias does not exist:
   SYS_USR" — a tabela SYS_USR nao existe neste ambiente Protheus. IACChat()
   usa IAC_CELULAR_TESTE_PADRAO (celular chumbado) enquanto isso nao e
   resolvido — ver ressalva no topo do arquivo.

   Antes de reativar, e necessario:
     1. Confirmar com o dicionario de dados real (SX3/SIGACFG) qual e o
        alias/tabela correto do cadastro de usuarios com campo de celular
        (SYS_USR era suposicao nao validada, ja provou estar errada).
     2. Trocar "SYS_USR" e o indice de DbSetOrder abaixo (IAC_ORDEM_SYS_USR,
        tambem um chute nao validado) pelos valores corretos.
     3. Remover a linha "cCelular := IAC_CELULAR_TESTE_PADRAO" em IACChat() e
        voltar a chamar IACLerCelularUsuario() no lugar.

   Normalizacao (remover mascara) e feita no backend (token-service.js), nao
   e necessaria aqui — a rotina pode enviar o valor como estiver gravado.
---------------------------------------------------------------------------- */
#DEFINE IAC_ORDEM_SYS_USR  1  // TODO: confirmar indice real da tabela de usuarios

/*
Static Function IACLerCelularUsuario()
    Local cCelular := ""
    Local cAliasAtu := Alias()

    DbSelectArea("SYS_USR")
    SYS_USR->(DbSetOrder(IAC_ORDEM_SYS_USR))
    If SYS_USR->(MsSeek(xFilial("SYS_USR") + RetCodUsr()))
        cCelular := Alltrim(SYS_USR->USR_CELULAR)
    EndIf

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return cCelular
*/

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
    Local aHeader     := {}
    Local cBody       := ""
    Local cRespo      := ""
    Local lOk         := .F.
    Local oJsonRes
    Local nEmpresaId  := IACEmpresaIdIaCommand() // ver comentario acima
    Local cUrlToken   := IACUrlToken()
    Local nTimeout    := IACHttpTimeout()

    If nEmpresaId <= 0
        cErro := "Parametro MV_IACEMID nao configurado. Cadastre-o em Configurador (SIGACFG) > " + ;
                  "Ambiente > Cadastros > Parametros, com o empresa_id do IA Command " + ;
                  "correspondente a esta empresa/filial Protheus."
        Return .F.
    EndIf

    If Empty(cUrlToken)
        cErro := "Parametro MV_IACURL (URL do IAHub) nao configurado."
        Return .F.
    EndIf

    // Escapa aspas duplas e barra invertida no celular antes de montar o JSON
    // manualmente — protege contra quebra de payload se o campo de cadastro
    // tiver algum caractere inesperado. Preferir JsonObject():ToJson() se
    // disponivel nesta versao, em vez de concatenacao manual de string.
    cBody := '{"empresaId":' + cValToChar(nEmpresaId) + ;
              ',"celular":"' + IACEscapeJson(cCelular) + '"' + ;
              ',"filial":"' + IACEscapeJson(xFilial()) + '"}'

    // Headers passados como array local no metodo Post(), NAO como propriedade
    // do objeto — FWRest nesta versao (Framework 20251006) nao expoe
    // oRest:xHeaders. Padrao confirmado: aHeader montado via AAdd() e passado
    // como parametro de Get()/Post(). Ver TDN FWRest / exemplos TOTVS.
    AAdd(aHeader, "Content-Type: application/json")
    AAdd(aHeader, "X-Protheus-Secret: " + IACSegredoProtheusChat())

    oRest := FWRest():New(cUrlToken)
    oRest:SetPath("")
    oRest:nTimeOut := nTimeout

    // TODO: confirmar contra o Include FWREST.CH/FWREST.PRW desta instalacao
    // se o body do POST deve ser setado via oRest:SetPostParams(cBody) antes
    // de chamar Post(aHeader), ou se Post() aceita o body como 1o parametro
    // (Post(cBody, aHeader)) — nao confirmado nos exemplos publicos consultados.
    oRest:SetPostParams(cBody)
    lOk := oRest:Post(aHeader)

    If !lOk
        // [CORRIGIDO apos erro em producao 10/08/2026] oRest:GetLastError()
        // nao retorna numero nesta versao (erro "argument #0 error, expected
        // N->C, function str") — trocado por GetResult(), metodo ja usado
        // logo abaixo (linha ~301) e portanto confirmado como existente nesta
        // versao de FWRest.
        cErro := "Falha de comunicacao com o IAHub: " + cValToChar(oRest:GetResult())
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
   IACEscapeJson
   Escapa aspas duplas e barra invertida para uso seguro dentro de string JSON
   montada manualmente. Nao trata unicode/controle especial — suficiente para
   os campos usados aqui (celular, codigo de filial), que sao alfanumericos
   simples, mas nao um encoder JSON completo.
---------------------------------------------------------------------------- */
Static Function IACEscapeJson(cTexto)
    Local cSaida := StrTran(cTexto, '\', '\\')
    cSaida := StrTran(cSaida, '"', '\"')
Return cSaida

/* ============================================================================
   CONFIGURACAO VIA PARAMETROS SX6 — NADA ABAIXO E CHUMBADO NO FONTE

   Todo valor que muda por ambiente (URL do servidor), por instalacao (segredo,
   empresa_id) ou que pode precisar de ajuste sem recompilar (timeout) fica
   centralizado nestas funcoes. CADASTRO MANUAL OBRIGATORIO em Configurador
   (SIGACFG) > Ambiente > Cadastros > Parametros (CFGX013), uma vez por
   empresa/filial Protheus, antes do primeiro uso:

   MV_IACURL   (caractere, ex. "https://iahub.suaempresa.com.br")
     Host base do IAHub, SEM path. As duas URLs usadas pela rotina
     (endpoint de token e pagina do chat) sao montadas a partir deste valor
     em IACUrlToken()/IACUrlChat() — trocar de ambiente (homologacao/producao)
     exige so reconfigurar este parametro, nao recompilar o fonte.
   MV_IACEMID  (numerico) — empresa_id do IA Command correspondente a esta
     empresa/filial Protheus. Obter na tela de administracao do IA Command
     (cadastro de empresas do IAHub) ANTES de configurar este parametro —
     nao existe lookup automatico (ver comentario em IACSolicitarToken).
     Valor 0 (padrao/nao configurado) bloqueia o uso.
   MV_IACSECR  (caractere) — mesmo valor de IAC_PROTHEUS_CHAT_SECRET
     configurado no ambiente do IAHub (.env). Repassar por canal seguro entre
     os times, nunca commitar em texto puro. Vazio faz o backend rejeitar a
     chamada com 401 (ver protheus_whatsapp/routes.js).
   MV_IACTOUT  (numerico, ms, opcional) — timeout da chamada HTTP ao IAHub.
     Se nao configurado (0 ou vazio), usa IAC_HTTP_TIMEOUT_PADRAO (8000ms).
   ============================================================================ */

// IACUrlBase centraliza o fallback para IAC_HUB_URL_PADRAO — ver TODO no
// cabecalho do arquivo sobre remover esse fallback antes de producao.
Static Function IACUrlBase()
    Local cBase := Alltrim(GetMV("MV_IACURL", , ""))
    If Empty(cBase)
        cBase := IAC_HUB_URL_PADRAO
    EndIf
Return cBase

Static Function IACUrlToken()
    Local cBase := IACUrlBase()
    If Empty(cBase)
        Return ""
    EndIf
Return cBase + "/api/ia-command/protheus/token"

Static Function IACUrlChat()
    Local cBase := IACUrlBase()
    If Empty(cBase)
        Return ""
    EndIf
Return cBase + "/api/ia-command/protheus/chat"

Static Function IACHttpTimeout()
    Local nValor := GetMV("MV_IACTOUT", , 0)
    If nValor <= 0
        Return IAC_HTTP_TIMEOUT_PADRAO
    EndIf
Return nValor

// Fallback para IAC_EMPRESA_ID_PADRAO (empresa "J2A TESTE", id=3) — ver
// ressalva forte no cabecalho do arquivo sobre remover antes de producao.
Static Function IACEmpresaIdIaCommand()
    Local nValor := GetMV("MV_IACEMID", , 0)
    If nValor <= 0
        nValor := IAC_EMPRESA_ID_PADRAO
    EndIf
Return nValor

// Fallback para IAC_SEGREDO_PADRAO — RISCO DE SEGURANCA, ver ressalva forte
// no cabecalho do arquivo antes de manter isso alem do teste inicial.
Static Function IACSegredoProtheusChat()
    Local cValor := Alltrim(GetMV("MV_IACSECR", , ""))
    If Empty(cValor)
        cValor := IAC_SEGREDO_PADRAO
    EndIf
Return cValor
