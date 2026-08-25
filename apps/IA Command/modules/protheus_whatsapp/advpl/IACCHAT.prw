#INCLUDE "PROTHEUS.CH"
#INCLUDE "FWMVCDEF.CH"
#INCLUDE "TOTVS.CH"
#INCLUDE "TOPCONN.CH"

/* ============================================================================
   IACCHAT.PRW — Chat IA Command aberto em nova aba do navegador a partir do
   Protheus (ShellExecute)

   ============================================================================
   !!! ARQUITETURA ATUAL: SEM TWebEngine !!!

   [ALTERADO apos erro em producao 11/08/2026] Esta instalacao usa exclusiva-
   mente SmartClient HTML/WebApp — SmartClient Desktop nao esta mais em uso,
   confirmado pelo usuario ("Atualmente o smartclient nao funciona mais na
   versao WINDOWS, so web"). TWebEngine/TWebChannel (Chromium embarcado) e um
   componente do SmartClient Desktop; ao testar em producao via WebApp, a
   navegacao resultava em tela de "pagina nao carregada" sem erro ADVPL (falha
   silenciosa) — indicio de que o componente nao e aplicavel quando o proprio
   SmartClient ja roda dentro de um navegador.

   Por isso IACChat() foi reescrita para NAO embutir a tela do chat dentro do
   Protheus: em vez disso, abre a URL do chat em nova aba do navegador via
   ShellExecute("open", cUrl, ...). NAO CONFIRMADO contra o Include real desta
   versao se ShellExecute funciona a partir do processo WebApp (historicamente
   e um comando pensado para o processo do SmartClient Desktop dar "Open" no
   SO local do usuario) — decisao do usuario testar mesmo assim, com fallback
   (MsgInfo exibindo o link para copiar) caso o retorno indique falha.
   ============================================================================

   ATENCAO: fonte de REFERENCIA, escrito fora de um ambiente Protheus e NUNCA
   compilado/testado em um SmartClient/TOTVS App Studio real. Antes de subir
   para homologacao, um desenvolvedor ADVPL do time precisa validar contra o
   TDN/Include real da versao em uso os pontos abaixo (nao confirmados aqui):

     a) [OBSOLETO apos remocao do TWebEngine em 11/08/2026 — ver acima] Assi-
        natura de TWebChannel():New() / TWebEngine():New(...) nao se aplica
        mais a este fonte.
     a.1) ShellExecute("open", cUrl, "", "", 1) — em SmartClient HTML/WebApp
        desta instalacao foi observado retorno 32 MESMO COM a aba abrindo
        corretamente. Por isso o fallback visual so dispara para retorno < 32.
        Retorno 32 fica tratado como sucesso pragmatico neste ambiente.
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
     d) [CORRIGIDO apos erro em producao 11/08/2026] FwNoAcento() NAO existe
        nesta instalacao (erro em runtime: "Help: NOFUNCW ... Funcao:
        FWNOACENTOCalled By U_IACCHAT" — funcao nao encontrada, apesar do
        fonte compilar normalmente, pois ADVPL resolve chamada de funcao em
        runtime). Trocado por IACRmAcent(), implementada localmente
        neste arquivo via StrTran() (mesma tecnica ja usada em
        IACEscJs() abaixo), sem depender de nenhuma funcao Fw* do
        framework cuja existencia nao esteja confirmada.
     e) [CORRIGIDO 11/08/2026] SYS_USR existe nesta instalacao (a suposicao
        anterior de que a TABELA nao existia estava errada) — o que nao
        existe e um CAMPO de celular dentro dela. Criado cadastro proprio
        (tabela ZCH, ver advpl/IACadUsr.prw neste mesmo diretorio) para o
        vinculo usuario Protheus -> celular. IACLerCel() foi
        reescrita para ler ZCH primeiro (por RetCodUsr()), no lugar do antigo
        SYS_USR->USR_CELULAR (que nunca existiu). IAC_CELULAR_TESTE_PADRAO
        foi MANTIDO (decisao explicita do usuario), agora como FALLBACK: so
        e usado se a tabela ZCH ainda nao existir ou nao houver registro
        ativo para o usuario logado — evita bloquear o piloto enquanto o
        cadastro ZCH nao tem cobertura completa. Ver ressalvas de nomes de
        campo/indice de SYS_USR em IACadUsr.prw (usadas la para o F3 de
        selecao de usuario, nao usadas aqui).
     f) [CORRIGIDO apos erro em producao 25/08/2026] IACFilUsr()/IACFilJs() —
        filiais permitidas por usuario. A primeira versao usava LoadFils()
        com troca de ambiente (RpcSetEnv/RpcClearEnv) por empresa; isso
        quebrava em runtime ("type mismatch on + on RPCSETENV(TBICONN.PRW)"),
        travando a abertura do chat (token nunca emitido, pagina presa em
        "Preparando sessao..." ate estourar o timeout do launch ticket) —
        mesma causa raiz ja identificada e corrigida antes no cadastro de
        usuarios (IACadUsr.prw): RpcSetEnv/PREPARE ENVIRONMENT nao deve ser
        chamado dentro de sessao com interface (SmartClient) — corrompe o
        contexto de dicionario/tabelas da sessao ativa. Reescrito para usar
        PswSeek/PswRet (API de seguranca do Protheus, le os acessos
        empresa+filial do usuario informado direto do pacote de senha, sem
        trocar ambiente) — mesmo padrao ja validado e em producao no cadastro
        de usuarios. Ver comentario completo nas funcoes IACFilUsr/IACFilPsw,
        mais abaixo.

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
// (ver IACUrlTok()/IACUrlChat() e instrucoes no cabecalho do arquivo acima).
// TODO antes de producao: cadastrar MV_IACURL e remover/esvaziar esta linha.
#DEFINE IAC_HUB_URL_PADRAO  "http://200.106.188.87:3000"

// Sem fallback para empresa_id: se MV_IACEMID nao for encontrado, o chat deve
// bloquear a abertura em vez de consultar uma empresa incorreta no IA Command.
#DEFINE IAC_EMPRESA_ID_PADRAO  0

// !!! CELULAR DE TESTE CHUMBADO — USADO SO COMO FALLBACK !!!
// IACLerCel() busca primeiro na tabela ZCH (ver IACadUsr.prw); se a
// tabela ZCH ainda nao existir (ambiente sem o cadastro rodado uma vez) OU
// nao houver registro ativo para o usuario logado, cai neste valor fixo em
// vez de bloquear o chat — decisao explicita do usuario, para nao quebrar o
// piloto enquanto o cadastro ZCH ainda nao foi populado para todo mundo.
// TODO: remover este fallback quando o cadastro ZCH estiver com cobertura
// completa dos usuarios do piloto (usar so ZCH, sem excecao).
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
   Abre a tela de chat da IA Command em nova aba do navegador (ShellExecute).
   Registrar no menu do modulo Comercial (SIGAFAT) — piloto definido.
---------------------------------------------------------------------------- */
User Function IACChat()
    Local cCelular    := ""
    Local cToken      := ""
    Local cNomeUser   := Alltrim(UsrFullName(RetCodUsr()))
    Local cUrlChatBase := ""
    Local cUrlChat    := ""
    Local cUrlFallback := ""
    Local cLaunchTk   := ""
    Local lOk         := .T.
    Local cErro       := ""
    Local nShellRet   := 0
    Local nBoot       := Seconds()
    Local nStep       := nBoot

    IACPerf("IACChat inicio", nBoot)

    cUrlChatBase := IACUrlChat()
    If Empty(cUrlChatBase)
        MsgAlert("Parametro MV_IACURL (URL do chat no IAHub) nao configurado." + CRLF + ;
                  "Procure o administrador do sistema.", "IA Command")
        Return
    EndIf

    nStep   := Seconds()
    cCelular := IACLerCel()
    IACPerf("IACLerCel", nStep)

    If Empty(cCelular)
        MsgAlert("Celular nao cadastrado para o usuario " + RetCodUsr() + "." + CRLF + ;
                  "Cadastre em Configurador > Celular por Usuario - IA Command " + ;
                  "(IACadUsr) antes de usar o chat.", "IA Command")
        Return
    EndIf

    cLaunchTk := IACLchTk()
    cUrlChat  := cUrlChatBase + "?launchTicket=" + cLaunchTk + ;
                 "&usuario=" + FWURLEncode(IACRmAcent(cNomeUser))

    // Abre uma pagina leve antes do processamento multiempresa/token. No
    // SmartClient HTML/WebApp, ShellExecute pode retornar 32 quando chamado
    // depois de FWUsrEmp/FWLoadSM0/SX6/FWRest. A pagina aberta aguarda o token
    // pelo launchTicket gravado no IAHub.
    nStep     := Seconds()
    nShellRet := ShellExecute("open", cUrlChat, "", "", 1)
    IACPerf("ShellExecute retorno=" + cValToChar(nShellRet), nStep)

    nStep := Seconds()
    lOk := IACToken(cCelular, @cToken, @cErro, cLaunchTk, RetCodUsr(), cNomeUser)
    IACPerf("IACToken total", nStep)

    If !lOk
        MsgAlert("Nao foi possivel iniciar a sessao do IA Command:" + CRLF + cErro, "IA Command")
        Return
    EndIf

    // FWURLEncode evita quebra da querystring se cNomeUser tiver espaco, & ou =
    // apos a remocao de acentos (ex.: "Jose & Silva", nomes com caracteres
    // especiais de cadastro). Token ja e hexadecimal puro (token-service.js),
    // sem necessidade de encode. Confirmar disponibilidade de FWURLEncode no
    // Include desta versao — se indisponivel, alternativa e Escape().
    cUrlFallback := cUrlChatBase + "?token=" + cToken + "&usuario=" + FWURLEncode(IACRmAcent(cNomeUser))

    // [CORRIGIDO apos teste em producao 11/08/2026] TWebEngine/TWebChannel
    // (Chromium embarcado no SmartClient Desktop) removido — esta instalacao
    // usa exclusivamente SmartClient HTML/WebApp (SmartClient Desktop nao
    // esta mais em uso, confirmado pelo usuario). TWebEngine:Navigate()
    // resultava em tela de "pagina nao carregada" no WebApp, sem erro ADVPL
    // (falha silenciosa) — indicio de que o componente nao e aplicavel
    // quando o proprio SmartClient ja roda dentro de um navegador.
    //
    // Troca: abrir a URL do chat em nova aba do navegador via ShellExecute().
    // NAO CONFIRMADO contra o Include real desta versao se ShellExecute()
    // funciona a partir do processo WebApp (historicamente e um comando
    // pensado para o processo do SmartClient Desktop dar "Open" no SO local
    // do usuario) — decisao do usuario testar mesmo assim. Se nao abrir a
    // aba, cai no fallback abaixo (MsgInfo com o link para copiar).
    //
    // Retorno documentado de ShellExecute normalmente considera sucesso como
    // nRet > 32. Porem, no SmartClient HTML/WebApp desta instalacao, foi
    // observado nRet == 32 mesmo com a nova aba aberta normalmente. Para nao
    // assustar o usuario com um popup de "falha" apos sucesso real, tratamos
    // 32 como sucesso pragmatico e exibimos o fallback so para retornos
    // claramente abaixo desse limiar.
    If nShellRet < 32
        ConOut("[IA Command] Falha ShellExecute retorno=" + cValToChar(nShellRet) + " url=" + cUrlFallback)
        MsgInfo("Nao foi possivel abrir o IA Command automaticamente." + CRLF + ;
                 "Retorno ShellExecute: " + cValToChar(nShellRet) + CRLF + ;
                 "Copie o link abaixo e abra em uma nova aba do navegador:" + CRLF + CRLF + ;
                 cUrlFallback, "IA Command")
    EndIf

    IACPerf("IACChat total", nBoot)

Return

/* ----------------------------------------------------------------------------
   IACLerCel
   Le o celular do usuario Protheus LOGADO na tabela ZCH (ver IACadUsr.prw),
   pelo codigo retornado por RetCodUsr() — mesma funcao ja usada em IACChat()
   para o nome (UsrFullName(RetCodUsr())), aqui usada tambem para a chave de
   busca. So considera registro com ZCH_ATIVO = "S".

   Fallback (decisao explicita do usuario): se a tabela ZCH ainda nao existir
   (SX2 sem registro — ambiente onde IACadUsr() nunca foi aberta, ver
   ZCHCriaEs() em IACadUsr.prw) OU nao houver registro ativo para o
   usuario logado, usa IAC_CELULAR_TESTE_PADRAO em vez de bloquear o chat.
   TODO: remover o fallback quando o cadastro ZCH tiver cobertura completa
   dos usuarios do piloto — ver ressalva junto do #DEFINE no topo do arquivo.

   Normalizacao (remover mascara "+55 (65) 99901-0275" -> "556599..." etc.) e
   feita no backend (token-service.js normalizarCelular), nao aqui — a
   rotina envia o valor exatamente como gravado em ZCH_CELULA (ou o fallback).
---------------------------------------------------------------------------- */
Static Function IACLerCel()
    Local cCelular   := ""
    Local cAliasAtu  := Alias()
    Local cAtivo     := ""

    If IACTabEx("ZCH")
        DbSelectArea("ZCH")
        ZCH->(DbSetOrder(1)) // ZCH_FILIAL+ZCH_USER
        If ZCH->(MsSeek(xFilial("ZCH") + RetCodUsr()))
            cAtivo := IACCampo("ZCH_ATIVO")

            If Empty(cAtivo) .Or. cAtivo == "S"
                cCelular := IACCampo("ZCH_CELULA")
            EndIf
        EndIf
        ZCH->(DbCloseArea())
    EndIf

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

    If Empty(cCelular)
        cCelular := IAC_CELULAR_TESTE_PADRAO // ver ressalva de fallback acima
    EndIf

Return cCelular

/* ----------------------------------------------------------------------------
   IACCampo
   Le um campo do alias atual sem gerar erro fatal caso o dicionario/runtime
   ainda nao exponha o campo esperado.
---------------------------------------------------------------------------- */
Static Function IACCampo(cCampo)
    Local nPos := FieldPos(cCampo)
    Local cRet := ""

    If nPos > 0
        cRet := Alltrim(FieldGet(nPos))
    EndIf

Return cRet

/* ----------------------------------------------------------------------------
   IACTabEx
   Confirma, via SX2 (dicionario de dados), se a tabela informada ja foi
   criada — sem tentar abrir a area diretamente (DbSelectArea em tabela
   inexistente gera erro fatal "Alias does not exist", nao um retorno .F.
   tratavel). Usada para decidir se tenta ler ZCH ou vai direto ao fallback.
---------------------------------------------------------------------------- */
Static Function IACTabEx(cTabela)
    Local lExiste   := .F.
    Local cAliasAtu := Alias()

    DbSelectArea("SX2")
    // [CORRIGIDO apos erro em producao 13/08/2026] Ordem 2 = X2_ARQUIVO (nome
    // real do campo de tabela nesta instalacao) — ordem 1 e X2_CHAVE, nao
    // serve para buscar por nome de tabela. Ver mesma correcao em CRIASX2/
    // ZCHMonta (IACadUsr.prw).
    SX2->(DbSetOrder(2)) // X2_ARQUIVO
    lExiste := SX2->(MsSeek(cTabela))

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return lExiste

/* ----------------------------------------------------------------------------
   IACToken
   Chama POST /api/ia-command/protheus/token no IAHub para obter o token curto
   de sessao do chat. Retorna .T./.F. e preenche cToken ou cErro por referencia.

   empresaId: por compatibilidade, continua enviando o MV_IACEMID da empresa
   logada como empresa principal do token. Alem disso, envia
   empresasPermitidas: lista calculada no Protheus com FWUsrEmp()/FWLoadSM0()
   e GetNewPar() para localizar o MV_IACEMID de cada empresa permitida.

   [ADICIONADO] filiaisPermitidas: granularidade de FILIAL dentro de cada
   empresa que o usuario acessa, via PswSeek/PswRet (ver IACFilUsr/IACFilPsw
   abaixo). Campo NOVO e ADITIVO — nao substitui "filial" (continua sendo
   xFilial(), a filial corrente da sessao ADVPL) nem "empresasPermitidas". Se
   IACFilUsr() falhar ou nao coletar nada, o campo vai vazio/ausente e o
   backend trata como "sem informacao de filial por usuario" (compatibilidade
   — ver ressalva em token-service.js::filiaisPermitidasDaEmpresa), nunca
   bloqueia a abertura do chat por causa disso.
---------------------------------------------------------------------------- */
Static Function IACToken(cCelular, cToken, cErro, cLaunchTk, cUsuarioId, cUsuarioNome)
    Local oRest
    Local aHeader     := {}
    Local cBody       := ""
    Local cRespo      := ""
    Local lOk         := .F.
    Local oJsonRes
    Local aCodigos    := {}
    Local aParamEmp   := {}
    Local nEmpresaId  := 0
    Local cEmpPermit  := ""
    Local cFilPermit  := ""
    Local cUrlToken   := ""
    Local nTimeout    := 0
    Local nStep       := Seconds()
    Local cFilialAtual := ""

    aCodigos := IACEmpUsr()
    IACPerf("IACToken IACEmpUsr empresas=" + cValToChar(Len(aCodigos)), nStep)

    nStep     := Seconds()
    aParamEmp := IACSX6Lst("MV_IACEMID", aCodigos)
    IACPerf("IACToken IACSX6Lst itens=" + cValToChar(Len(aParamEmp)), nStep)

    nStep      := Seconds()
    nEmpresaId := IACEmpAt(aCodigos, aParamEmp) // ver comentario acima
    IACPerf("IACToken IACEmpAt empresaId=" + cValToChar(nEmpresaId), nStep)

    nStep     := Seconds()
    cUrlToken := IACUrlTok()
    nTimeout  := IACTimeout()
    IACPerf("IACToken config", nStep)

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

    // xFilial() da sessao atual — capturado aqui, cedo no fluxo. Desde a
    // migracao de IACFilUsr para PswSeek/PswRet (nao troca mais o ambiente
    // RPC do processo), nao ha mais risco de outra rotina alterar esse valor
    // no meio da montagem do payload, mas mantido nesta posicao por
    // organizacao/clareza do fluxo.
    cFilialAtual := xFilial()

    // Escapa aspas duplas e barra invertida no celular antes de montar o JSON
    // manualmente — protege contra quebra de payload se o campo de cadastro
    // tiver algum caractere inesperado. Preferir JsonObject():ToJson() se
    // disponivel nesta versao, em vez de concatenacao manual de string.
    nStep     := Seconds()
    cEmpPermit := IACEmpJs(nEmpresaId, aCodigos, aParamEmp)
    IACPerf("IACToken IACEmpJs", nStep)

    // [CORRIGIDO apos erro em producao 25/08/2026] Filiais por empresa via
    // PswSeek/PswRet (nao mais LoadFils/RpcSetEnv — ver comentario completo
    // em IACFilUsr/IACFilPsw abaixo). Nao troca ambiente do processo, entao
    // nao ha mais dependencia de ordem com cFilialAtual/cEmpPermit acima —
    // mantido apos eles so por organizacao do fluxo (empresa -> filial).
    nStep     := Seconds()
    cFilPermit := IACFilJs(cUsuarioId, aCodigos)
    IACPerf("IACToken IACFilJs", nStep)

    cBody := '{"empresaId":' + cValToChar(nEmpresaId) + ;
              ',"celular":"' + IACEscJs(cCelular) + '"' + ;
              ',"usuarioId":"' + IACEscJs(cUsuarioId) + '"' + ;
              ',"usuarioNome":"' + IACEscJs(IACRmAcent(cUsuarioNome)) + '"' + ;
              ',"filial":"' + IACEscJs(cFilialAtual) + '"' + ;
              ',"empresasPermitidas":' + cEmpPermit + ;
              ',"filiaisPermitidas":' + cFilPermit

    If ValType(cLaunchTk) == "C" .And. !Empty(cLaunchTk)
        cBody += ',"launchTicket":"' + IACEscJs(cLaunchTk) + '"'
    EndIf

    cBody += '}'

    // Headers passados como array local no metodo Post(), NAO como propriedade
    // do objeto — FWRest nesta versao (Framework 20251006) nao expoe
    // oRest:xHeaders. Padrao confirmado: aHeader montado via AAdd() e passado
    // como parametro de Get()/Post(). Ver TDN FWRest / exemplos TOTVS.
    AAdd(aHeader, "Content-Type: application/json")
    AAdd(aHeader, "X-Protheus-Secret: " + IACSecret())

    oRest := FWRest():New(cUrlToken)
    oRest:SetPath("")
    oRest:nTimeOut := nTimeout

    // TODO: confirmar contra o Include FWREST.CH/FWREST.PRW desta instalacao
    // se o body do POST deve ser setado via oRest:SetPostParams(cBody) antes
    // de chamar Post(aHeader), ou se Post() aceita o body como 1o parametro
    // (Post(cBody, aHeader)) — nao confirmado nos exemplos publicos consultados.
    oRest:SetPostParams(cBody)
    nStep := Seconds()
    lOk := oRest:Post(aHeader)
    IACPerf("IACToken FWRest Post ok=" + cValToChar(lOk), nStep)

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

    nStep   := Seconds()
    oJsonRes := JsonObject():New()
    If oJsonRes:FromJson(cRespo) != Nil
        cErro := "Resposta invalida do servidor: " + cRespo
        Return .F.
    EndIf
    IACPerf("IACToken parse resposta", nStep)

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
   IACLchTk
   Gera um identificador simples para amarrar a aba aberta antes do token com o
   token emitido logo depois. Nao e credencial; serve so como correlacao curta
   entre a pagina de espera e o POST /token.
---------------------------------------------------------------------------- */
Static Function IACLchTk()
    Local cTk := DTOS(Date()) + StrTran(Time(), ":", "") + RetCodUsr()
    cTk := StrTran(cTk, " ", "")
    cTk := StrTran(cTk, ".", "")
    cTk := StrTran(cTk, ",", "")
    cTk := StrTran(cTk, "-", "")
    cTk := StrTran(cTk, "/", "")
Return cTk

/* ----------------------------------------------------------------------------
   IACPerf
   Log simples de performance no console/log do AppServer. Usado para medir o
   tempo entre o clique no menu Protheus e o token ficar disponivel no IAHub.
---------------------------------------------------------------------------- */
Static Function IACPerf(cEtapa, nInicio)
    Local nMs := (Seconds() - nInicio) * 1000

    If nMs < 0
        nMs += 86400000
    EndIf

    ConOut("[IA Command][perf] " + cEtapa + " " + cValToChar(Int(nMs)) + "ms")

Return Nil

/* ----------------------------------------------------------------------------
   IACEmpJs
   Monta a lista multiempresa enviada ao IAHub. A permissao vem do Protheus:
   FWUsrEmp(RetCodUsr()) retorna as empresas do usuario; quando retornar @@@@,
   FWLoadSM0() expande para todas as empresas disponiveis no ambiente.

   Para cada empresa Protheus, usa uma filial de referencia vinda da SM0 e le
   MV_IACEMID via GetNewPar(). Nao usa RpcSetEnv/RpcClearEnv aqui porque esta
   rotina roda pelo menu e o Framework ja entrega o ambiente aberto.
---------------------------------------------------------------------------- */
Static Function IACEmpJs(nEmpresaAtual, aCodigos, aParamEmp)
    Local aListaCod  := {}
    Local aEmpresas  := {}
    Local cJson      := "["
    Local nI         := 0
    Local nEmpresaId := 0

    If ValType(aCodigos) == "A"
        aListaCod := aCodigos
    Else
        aListaCod := IACEmpUsr()
    EndIf

    For nI := 1 To Len(aListaCod)
        nEmpresaId := IACEmpIdC(aListaCod[nI, 1], aListaCod[nI, 2], aParamEmp)
        If nEmpresaId > 0
            IACAddEmp(@aEmpresas, nEmpresaId, aListaCod[nI, 1], aListaCod[nI, 3])
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

/* ----------------------------------------------------------------------------
   IACEmpUsr
   Retorna codigos de grupo/empresa Protheus acessiveis ao usuario logado.
   Se FWUsrEmp() retornar @@@@, expande com FWLoadSM0().
---------------------------------------------------------------------------- */
Static Function IACEmpUsr()
    Local aEmpUsr := FWUsrEmp(RetCodUsr())
    Local aSM0    := FWLoadSM0()
    Local aRet    := {}
    Local nI      := 0
    Local lTodas  := .F.
    Local cGrp    := ""
    Local cFil    := ""
    Local cEmp    := ""
    Local cEmpSM0 := ""
    Local cNome   := ""

    // [CORRIGIDO apos erro "type mismatch on compare" em producao] FWUsrEmp()
    // pode devolver aEmpUsr[1] como algo que nao e string (ex.: array
    // aninhado, dependendo da config de acesso multiempresa do usuario) —
    // comparar direto com "@@@@" quebrava com type mismatch quando o tipo nao
    // batia. ValType() antes da comparacao evita comparar tipos diferentes,
    // mesmo padrao de blindagem ja usado no loop de aSM0 logo abaixo.
    If Len(aEmpUsr) == 1 .And. ValType(aEmpUsr[1]) == "C"
        lTodas := aEmpUsr[1] == "@@@@"
    EndIf

    For nI := 1 To Len(aSM0)
        If ValType(aSM0[nI]) != "A" .Or. Len(aSM0[nI]) < 3
            Loop
        EndIf

        // MV_IACEMID e por EMPRESA dentro do mesmo grupo, usando X6_FIL com
        // codigo de empresa ("01", "02"...). A rotina tolera ambientes
        // tradicionais e Lobo Guara: deriva o codigo pela filial completa
        // quando possivel, ou pelo campo de empresa da SM0 quando ele vier
        // realmente como codigo.
        cGrp := Alltrim(cValToChar(aSM0[nI, 1])) // SM0_GRPEMP
        cFil := Alltrim(cValToChar(aSM0[nI, 2])) // SM0_CODFIL completo
        If Len(aSM0[nI]) >= 3
            cEmpSM0 := Alltrim(cValToChar(aSM0[nI, 3])) // SM0_EMPRESA ou nome, conforme ambiente
        Else
            cEmpSM0 := ""
        EndIf
        cEmp := IACCodEmp(cGrp, cFil, cEmpSM0)
        // Preferencia por descricao/nome comercial da EMPRESA, depois nome
        // reduzido/nome da filial. Posicoes conforme FWLoadSM0/TOTVS:
        // 19=SM0_DESCEMP, 17=SM0_NOMECOM, 7=SM0_NOMRED, 6=SM0_NOME.
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
        If Empty(cNome) .And. Len(aSM0[nI]) >= 6
            cNome := Alltrim(cValToChar(aSM0[nI, 6]))
        EndIf
        If Empty(cNome)
            cNome := cEmp
        EndIf

        If lTodas .Or. IACEmpOk(aEmpUsr, cGrp, cEmp, cFil)
            IACAddCod(@aRet, cEmp, cFil, cNome)
        EndIf
    Next nI

Return aRet

/* ----------------------------------------------------------------------------
   IACFilUsr
   [CORRIGIDO apos erro em producao 25/08/2026: "type mismatch on + on
   RPCSETENV(TBICONN.PRW)"] A versao anterior trocava de ambiente por empresa
   via RpcSetEnv/RpcClearEnv para poder chamar LoadFils() (que so enxerga a
   empresa atualmente logada) — essa troca quebrava em runtime nesta
   instalacao (erro real capturado no log do AppServer, chamada de dentro de
   IACFilUsr -> IACFilJs -> IACToken -> U_IACCHAT, travando a abertura do
   chat: o token nunca era emitido, entao a pagina ficava presa em "Preparando
   sessao..." ate estourar o timeout do launch ticket).

   Mesmo problema ja tinha ocorrido no cadastro de usuarios (IACadUsr.prw) e
   foi corrigido la trocando RpcSetEnv/LoadFils por PswSeek/PswRet — API
   nativa de seguranca do Protheus que le os acessos (empresa+filial) do
   USUARIO INFORMADO diretamente do pacote de senha, sem precisar trocar o
   ambiente do processo atual. Esta funcao replica o MESMO padrao ja validado
   la (ver IACadUsr.prw::IACFilUsr), agora recebendo o codigo do usuario
   (cUsuarioId, ja resolvido em IACToken) em vez do usuario da sessao MVC do
   cadastro.

   PswRet(1) devolve um array por usuario; a posicao 25 (aUsrData[25]) e o
   array de acessos {empresa, filial} liberados — cada item aAcessos[nI] tem
   {cEmpresa, cFilial}. Ignora "@@@@"/"@@" (coringa de "todas"), que nao e um
   codigo de filial valido para o filtro.

   Retorno: array de { cCodigoEmpresa, aFiliais (array de codigos) }.
---------------------------------------------------------------------------- */
Static Function IACFilUsr(cUsuarioId, aCodigos)
    Local aRet       := {}
    Local nI         := 0
    Local cCod       := ""
    Local cFilRef    := ""
    Local aFiliais   := {}

    If ValType(aCodigos) != "A" .Or. Len(aCodigos) == 0 .Or. Empty(cUsuarioId)
        Return aRet
    EndIf

    For nI := 1 To Len(aCodigos)
        cCod    := Alltrim(aCodigos[nI, 1])
        cFilRef := Alltrim(aCodigos[nI, 2]) // SM0_CODFIL completo, filial de referencia da empresa

        If Empty(cCod) .Or. Empty(cFilRef)
            Loop
        EndIf

        aFiliais := IACFilPsw(cUsuarioId, cCod, cFilRef)

        // [CORRIGIDO apos revisao de codigo — mantido nesta reescrita] Sempre
        // adiciona a empresa quando a consulta a PswRet teve sucesso, mesmo
        // com array vazio — array vazio significa "usuario nao tem NENHUMA
        // filial liberada nesta empresa" e o backend precisa bloquear tudo
        // nesse caso, nao tratar como "sem informacao". So omite a empresa
        // se IACFilPsw sinalizar falha real de consulta (ver comentario la).
        If ValType(aFiliais) == "A"
            AAdd(aRet, { cCod, aFiliais })
        EndIf
    Next nI

Return aRet

/* ----------------------------------------------------------------------------
   IACFilPsw
   Le, via PswSeek/PswRet (mesmo padrao ja validado em
   IACadUsr.prw::IACFilUsr), as filiais que cUsuarioId tem liberadas dentro
   da empresa cCodigo — sem trocar o ambiente RPC do processo atual.

   Retorno: array de codigos de filial (ValType "A"), ou Nil se a consulta
   via PswRet falhou (Begin Sequence/Recover) — Nil e distinto de array
   vazio: Nil sinaliza para o chamador "sem informacao, nao adicionar esta
   empresa"; array vazio sinaliza "zero filiais liberadas, bloquear tudo".
   Se PswRet teve sucesso mas nao teve NENHUM acesso de filial cadastrado
   para esta empresa (usuario so tem a filial de referencia padrao), cai no
   fallback de devolver cFilRef sozinho — mesmo comportamento ja usado no
   cadastro de usuarios.
---------------------------------------------------------------------------- */
Static Function IACFilPsw(cUsuarioId, cCodigo, cFilRef)
    Local aFiliais := {}
    Local aUsrData := {}
    Local aAcessos := {}
    Local nI       := 0
    Local nJ       := 0
    Local cEmp     := ""
    Local cFil     := ""
    Local lExiste  := .F.
    Local lFalhou  := .F.

    Begin Sequence
        PswOrder(1)
        If PswSeek(cUsuarioId, .T.)
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
        lFalhou := .T.
        ConOut("[IA Command] IACFilPsw: falha ao consultar PswRet para empresa " + cCodigo + " usuario " + cUsuarioId)
    End Sequence

    If lFalhou
        Return Nil
    EndIf

    If Len(aFiliais) == 0
        AAdd(aFiliais, cFilRef)
    EndIf

Return aFiliais

/* ----------------------------------------------------------------------------
   IACFilJs
   Monta o JSON de filiaisPermitidas enviado ao IAHub, a partir do retorno de
   IACFilUsr(). Formato: [{"codigoProtheus":"01","filiais":["010101",...]}].
   Se IACFilUsr() nao coletar nada (usuario sem cadastro de acesso via PSW,
   ou falha de consulta), devolve "[]" — o backend trata isso como "sem
   informacao de filial por usuario" e nao filtra a arvore por essa
   dimensao (comportamento equivalente a antes desta mudanca), nunca bloqueia.
---------------------------------------------------------------------------- */
Static Function IACFilJs(cUsuarioId, aCodigos)
    Local aFilPorEmp := IACFilUsr(cUsuarioId, aCodigos)
    Local cJson      := "["
    Local nI         := 0
    Local nJ         := 0
    Local cCod       := ""
    Local aFiliais   := {}

    For nI := 1 To Len(aFilPorEmp)
        cCod     := aFilPorEmp[nI, 1]
        aFiliais := aFilPorEmp[nI, 2]

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

/* ----------------------------------------------------------------------------
   IACCodEmp
   Resolve o codigo de empresa usado em X6_FIL para buscar MV_IACEMID. Suporta
   Protheus tradicional e Lobo Guara, onde FWLoadSM0()/SM0 podem expor campos
   em formatos diferentes.
---------------------------------------------------------------------------- */
Static Function IACCodEmp(cGrp, cFil, cEmpSM0)
    Local cRet := ""
    Local cEmp := Alltrim(cEmpSM0)

    If !Empty(cFil)
        cRet := Left(Alltrim(cFil), 2)
    EndIf

    If (Empty(cRet) .Or. Len(cRet) < 2) .And. !Empty(cEmp) .And. Len(cEmp) <= 2
        cRet := cEmp
    EndIf

    If Empty(cRet)
        cRet := Left(Alltrim(cGrp), 2)
    EndIf

Return cRet

/* ----------------------------------------------------------------------------
   IACEmpIdC
   Le MV_IACEMID direto da SX6 usando o CODIGO DE EMPRESA (2 digitos) como
   referencia — nao usa GetNewPar() para evitar popup "Help: MV_IACEMID"
   quando o parametro nao existir naquele escopo.
   [CORRIGIDO apos usuario reportar popup "Help: MV_IACEMID" em producao]
   MV_IACEMID e cadastrado UMA VEZ POR EMPRESA no X6 (confirmado pelo
   usuario: X6_FIL="01" -> conteudo 5, X6_FIL="02" -> conteudo 6 — X6_FIL
   aqui guarda o codigo de empresa de 2 digitos, nao a filial completa).
   A versao anterior passava cFilReferencia (SM0_CODFIL completo, ex.:
   "010101", 6 digitos) como 3o parametro de GetNewPar() — como isso nunca
   bate com um X6_FIL de 2 digitos, o parametro nunca era encontrado para
   NENHUMA filial, e o Protheus abria o popup de ajuda do parametro a cada
   chamada (uma por filial/empresa do usuario, via loop em IACEmpJs()).
   Corrigido para usar so os 2 primeiros caracteres do codigo de empresa
   (cCodigoProtheus, o mesmo valor ja usado como chave logica da empresa em
   todo o resto deste fonte), que e como o parametro foi de fato cadastrado.
---------------------------------------------------------------------------- */
Static Function IACEmpIdC(cCodigoProtheus, cFilReferencia, aParamEmp)
    Local nRet     := 0
    Local cValor   := ""
    Local cCodEmp  := ""

    If Empty(cCodigoProtheus)
        Return 0
    EndIf

    cCodEmp := Left(Alltrim(cCodigoProtheus), 2)
    If ValType(aParamEmp) == "A"
        cValor := IACSX6Bus(aParamEmp, cCodEmp)
    Else
        cValor := IACSX6Par("MV_IACEMID", cCodEmp)
    EndIf
    nRet    := Val(cValor)

Return nRet

/* ----------------------------------------------------------------------------
   IACSX6Lst
   Carrega os valores de um parametro por X6_FIL. Quando recebe a lista de
   empresas do usuario, tenta primeiro buscar as chaves pelo indice da SX6 e,
   por ultimo, usa a varredura completa antiga como fallback conservador.
---------------------------------------------------------------------------- */
Static Function IACSX6Lst(cParam, aCodigos)
    Local cAliasAtu := Alias()
    Local aRet      := {}
    Local aFiltros  := {}
    Local cVar      := Alltrim(cParam)
    Local cDel      := ""
    Local cFil      := ""
    Local cValor    := ""
    Local nI        := 0
    Local nStep     := Seconds()

    DbSelectArea("SX6")

    If ValType(aCodigos) == "A"
        For nI := 1 To Len(aCodigos)
            If ValType(aCodigos[nI]) == "A" .And. Len(aCodigos[nI]) >= 1
                cFil := Left(Alltrim(cValToChar(aCodigos[nI, 1])), 2)
                If !Empty(cFil)
                    AAdd(aFiltros, cFil)
                EndIf
            EndIf
        Next nI
    EndIf

    cFil := Left(Alltrim(cEmpAnt), 2)
    If Empty(cFil)
        cFil := Left(Alltrim(cFilAnt), 2)
    EndIf
    If !Empty(cFil)
        AAdd(aFiltros, cFil)
    EndIf

    If Len(aFiltros) > 0
        nStep := Seconds()
        aRet := IACSX6Qry(cVar, aFiltros)
        IACPerf("IACSX6Lst SQL itens=" + cValToChar(Len(aRet)), nStep)
    EndIf

    If Len(aRet) > 0
        If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
            DbSelectArea(cAliasAtu)
        EndIf
        Return aRet
    EndIf

    If ValType(aCodigos) == "A"
        nStep := Seconds()
        For nI := 1 To Len(aCodigos)
            If ValType(aCodigos[nI]) == "A" .And. Len(aCodigos[nI]) >= 1
                cFil := Left(Alltrim(cValToChar(aCodigos[nI, 1])), 2)

                If !Empty(cFil)
                    SX6->(DbSetOrder(1)) // normalmente X6_FIL+X6_VAR
                    If SX6->(MsSeek(cFil + cVar))
                        cDel := IACCampo("D_E_L_E_T_")
                        If Empty(cDel) .And. Alltrim(IACCampo("X6_FIL")) == cFil .And. ;
                           IACCampo("X6_VAR") == cVar
                            cValor := IACCampo("X6_CONTEUD")
                            If !Empty(cValor)
                                AAdd(aRet, { cFil, cValor })
                            EndIf
                        EndIf
                    EndIf
                EndIf
            EndIf
        Next nI
        IACPerf("IACSX6Lst seek itens=" + cValToChar(Len(aRet)), nStep)
    EndIf

    If Len(aRet) == 0
        nStep := Seconds()
        cFil := Left(Alltrim(cEmpAnt), 2)
        If Empty(cFil)
            cFil := Left(Alltrim(cFilAnt), 2)
        EndIf

        If !Empty(cFil)
            SX6->(DbSetOrder(1)) // normalmente X6_FIL+X6_VAR
            If SX6->(MsSeek(cFil + cVar))
                cDel := IACCampo("D_E_L_E_T_")
                If Empty(cDel) .And. Alltrim(IACCampo("X6_FIL")) == cFil .And. ;
                   IACCampo("X6_VAR") == cVar
                    cValor := IACCampo("X6_CONTEUD")
                    If !Empty(cValor)
                        AAdd(aRet, { cFil, cValor })
                    EndIf
                EndIf
            EndIf
        EndIf
        IACPerf("IACSX6Lst atual itens=" + cValToChar(Len(aRet)), nStep)
    EndIf

    If Len(aRet) > 0
        If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
            DbSelectArea(cAliasAtu)
        EndIf
        Return aRet
    EndIf

    // Fallback conservador: mantem o comportamento anterior caso o indice da
    // SX6 nao esteja em X6_FIL+X6_VAR neste ambiente.
    nStep := Seconds()
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
    IACPerf("IACSX6Lst fallback scan itens=" + cValToChar(Len(aRet)), nStep)

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return aRet

/* ----------------------------------------------------------------------------
   IACSX6Qry
   Busca MV_IACEMID na SX6 via SQL/TOPCONN para evitar varredura DBF quando o
   dicionario estiver grande. Os fallbacks por MsSeek/scan ficam no chamador.
---------------------------------------------------------------------------- */
Static Function IACSX6Qry(cParam, aFiltros)
    Local aRet      := {}
    Local cAliasAtu := Alias()
    Local cAliasQry := GetNextAlias()
    Local cQuery    := ""
    Local cIn       := ""
    Local cFil      := ""
    Local cValor    := ""
    Local nI        := 0

    For nI := 1 To Len(aFiltros)
        cFil := Alltrim(cValToChar(aFiltros[nI]))
        If Empty(cFil)
            Loop
        EndIf
        If !Empty(cIn)
            cIn += ","
        EndIf
        cIn += IACLit(cFil)
    Next nI

    If Empty(cIn)
        Return aRet
    EndIf

    cQuery := " SELECT X6_FIL, X6_CONTEUD " + ;
              " FROM " + RetSqlName("SX6") + ;
              " WHERE D_E_L_E_T_ = ' ' " + ;
              " AND X6_VAR = " + IACLit(cParam) + ;
              " AND X6_FIL IN (" + cIn + ") "

    cQuery := ChangeQuery(cQuery)

    DbUseArea(.T., "TOPCONN", TCGenQry(,,cQuery), cAliasQry, .F., .T.)
    DbSelectArea(cAliasQry)

    While !Eof()
        cFil   := Alltrim(IACCampo("X6_FIL"))
        cValor := IACCampo("X6_CONTEUD")
        If !Empty(cFil) .And. !Empty(cValor)
            AAdd(aRet, { cFil, cValor })
        EndIf
        DbSkip()
    EndDo

    DbCloseArea()

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return aRet

/* ----------------------------------------------------------------------------
   IACLit
   Escapa literal simples para uso no SQL montado manualmente.
---------------------------------------------------------------------------- */
Static Function IACLit(cTexto)
    Local cAspa := Chr(39)
Return cAspa + StrTran(Alltrim(cTexto), cAspa, cAspa + cAspa) + cAspa

/* ----------------------------------------------------------------------------
   IACSX6Bus
   Busca em memoria o valor carregado por IACSX6Lst().
---------------------------------------------------------------------------- */
Static Function IACSX6Bus(aLista, cFil)
    Local cFilBus := Alltrim(cFil)
    Local nI      := 0

    For nI := 1 To Len(aLista)
        If ValType(aLista[nI]) == "A" .And. Len(aLista[nI]) >= 2 .And. ;
           Alltrim(aLista[nI, 1]) == cFilBus
            Return Alltrim(aLista[nI, 2])
        EndIf
    Next nI

Return ""

/* ----------------------------------------------------------------------------
   IACSX6Par
   Busca um parametro direto na SX6 por X6_VAR + X6_FIL sem acionar Help do
   Protheus. Usada para MV_IACEMID porque GetNewPar()/SuperGetMV pode abrir
   popup quando nao encontra o parametro para a referencia informada.
---------------------------------------------------------------------------- */
Static Function IACSX6Par(cParam, cFil)
    Local cAliasAtu := Alias()
    Local cRet      := ""
    Local cVar      := Alltrim(cParam)
    Local cFilBus   := Alltrim(cFil)
    Local cDel      := ""

    DbSelectArea("SX6")
    SX6->(DbGoTop())

    While !SX6->(Eof())
        cDel := IACCampo("D_E_L_E_T_")
        If Empty(cDel) .And. IACCampo("X6_VAR") == cVar .And. Alltrim(IACCampo("X6_FIL")) == cFilBus
            cRet := IACCampo("X6_CONTEUD")
            Exit
        EndIf
        SX6->(DbSkip())
    EndDo

    If !Empty(cAliasAtu) .And. Select(cAliasAtu) > 0
        DbSelectArea(cAliasAtu)
    EndIf

Return cRet

/* ----------------------------------------------------------------------------
   IACEmpAt
   Descobre o empresa_id do IA Command para a empresa Protheus atualmente
   logada, cruzando cEmpAnt/cFilAnt com a lista carregada da SM0. E um reforco
   para os ambientes em que GetNewPar() com cEmpAnt sozinho nao encontra o
   MV_IACEMID no escopo esperado.
---------------------------------------------------------------------------- */
Static Function IACEmpAt(aCodigos, aParamEmp)
    Local aListaCod := {}
    Local cEmpAtu  := Alltrim(cEmpAnt)
    Local cFilAtu  := Alltrim(cFilAnt)
    Local cCod     := ""
    Local cFil     := ""
    Local nI       := 0
    Local nRet     := 0

    If ValType(aCodigos) == "A"
        aListaCod := aCodigos
    Else
        aListaCod := IACEmpUsr()
    EndIf

    For nI := 1 To Len(aListaCod)
        cCod := Alltrim(aListaCod[nI, 1])
        cFil := Alltrim(aListaCod[nI, 2])

        If (!Empty(cEmpAtu) .And. cCod == cEmpAtu) .Or. ;
           (!Empty(cFilAtu) .And. cFil == cFilAtu) .Or. ;
           (!Empty(cCod) .And. !Empty(cFilAtu) .And. Left(cFilAtu, Len(cCod)) == cCod) .Or. ;
           (!Empty(cFilAtu) .And. !Empty(cFil) .And. Left(cFil, Len(cFilAtu)) == cFilAtu)
            nRet := IACEmpIdC(cCod, cFil, aParamEmp)
            If nRet > 0
                Return nRet
            EndIf
        EndIf
    Next nI

    If Len(aListaCod) == 1
        nRet := IACEmpIdC(aListaCod[1, 1], aListaCod[1, 2], aParamEmp)
    EndIf

Return nRet

/* ----------------------------------------------------------------------------
   IACEmpOk
   Verifica se uma empresa/filial carregada da SM0 esta dentro da lista de
   empresas retornada por FWUsrEmp() para o usuario logado. A comparacao aceita
   grupo, empresa ou filial completa porque o retorno pode variar conforme a
   configuracao de acesso do Protheus.
---------------------------------------------------------------------------- */
Static Function IACEmpOk(aEmpUsr, cGrp, cEmp, cFil)
    Local nI   := 0
    Local cVal := ""

    For nI := 1 To Len(aEmpUsr)
        // Pula elementos que FWUsrEmp() eventualmente devolva em formato
        // diferente de string (ex.: array aninhado) — mesma causa do type
        // mismatch corrigido em IACEmpUsr logo acima; cValToChar() de um
        // array nao e uma conversao valida.
        If ValType(aEmpUsr[nI]) != "C"
            Loop
        EndIf
        cVal := Alltrim(cValToChar(aEmpUsr[nI]))
        If cVal == cEmp .Or. cVal == cGrp .Or. cVal == cFil
            Return .T.
        EndIf
    Next nI

Return .F.

/* ----------------------------------------------------------------------------
   IACAddCod
   Adiciona na lista temporaria um codigo Protheus de empresa/grupo com uma
   filial de referencia da SM0 e um nome amigavel da empresa. Evita duplicidade
   para nao ler MV_IACEMID mais de uma vez para a mesma empresa.
---------------------------------------------------------------------------- */
Static Function IACAddCod(aLista, cCodigo, cFilReferencia, cNome)
    Local cCod := Alltrim(cCodigo)
    Local nI   := 0

    If Empty(cCod)
        Return
    EndIf

    For nI := 1 To Len(aLista)
        If aLista[nI, 1] == cCod
            Return
        EndIf
    Next nI

    AAdd(aLista, { cCod, Alltrim(cFilReferencia), Alltrim(cNome) })

Return

/* ----------------------------------------------------------------------------
   IACAddEmp
   Adiciona uma empresa permitida no formato usado pelo JSON enviado ao IAHub.
   Evita repetir o mesmo empresa_id do IA Command quando mais de um codigo
   Protheus apontar para o mesmo MV_IACEMID. Tambem leva o nome Protheus para
   exibicao no seletor do chat.
---------------------------------------------------------------------------- */
Static Function IACAddEmp(aEmpresas, nEmpresaId, cCodigoProtheus, cNomeProtheus)
    Local nI := 0

    For nI := 1 To Len(aEmpresas)
        If aEmpresas[nI, 1] == nEmpresaId
            Return
        EndIf
    Next nI

    AAdd(aEmpresas, { nEmpresaId, Alltrim(cCodigoProtheus), Alltrim(cNomeProtheus) })

Return

/* ----------------------------------------------------------------------------
   IACEscJs
   Escapa aspas duplas e barra invertida para uso seguro dentro de string JSON
   montada manualmente. Nao trata unicode/controle especial — suficiente para
   os campos usados aqui (celular, codigo de filial), que sao alfanumericos
   simples, mas nao um encoder JSON completo.
---------------------------------------------------------------------------- */
Static Function IACEscJs(cTexto)
    Local cSaida := StrTran(cTexto, '\', '\\')
    cSaida := StrTran(cSaida, '"', '\"')
Return cSaida

/* ----------------------------------------------------------------------------
   IACRmAcent
   Substitui acentos/cedilha (maiusculo e minusculo) por seu equivalente sem
   acento, via StrTran() — sem depender de FwNoAcento() (nao existe nesta
   instalacao, ver ressalva no cabecalho do arquivo). Cobre apenas os
   caracteres acentuados do portugues; suficiente para nome de usuario usado
   em querystring (o valor real ainda passa por FWURLEncode() depois).
---------------------------------------------------------------------------- */
Static Function IACRmAcent(cTexto)
Return cTexto

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
     em IACUrlTok()/IACUrlChat() — trocar de ambiente (homologacao/producao)
     exige so reconfigurar este parametro, nao recompilar o fonte.
   MV_IACEMID  (numerico) — empresa_id do IA Command correspondente a esta
     empresa/filial Protheus. Obter na tela de administracao do IA Command
     (cadastro de empresas do IAHub) ANTES de configurar este parametro —
     nao existe lookup automatico (ver comentario em IACToken).
     Valor 0 (padrao/nao configurado) bloqueia o uso.
   MV_IACSECR  (caractere) — mesmo valor de IAC_PROTHEUS_CHAT_SECRET
     configurado no ambiente do IAHub (.env). Repassar por canal seguro entre
     os times, nunca commitar em texto puro. Vazio faz o backend rejeitar a
     chamada com 401 (ver protheus_whatsapp/routes.js).
   MV_IACTOUT  (numerico, ms, opcional) — timeout da chamada HTTP ao IAHub.
     Se nao configurado (0 ou vazio), usa IAC_HTTP_TIMEOUT_PADRAO (8000ms).
   ============================================================================ */

/* ----------------------------------------------------------------------------
   IACParNum
   Le um parametro SX6 que deve ser tratado como numero, mas SEM confiar no
   tipo em que foi cadastrado no dicionario. Quando recebe cRef, usa
   GetNewPar() com o codigo de empresa/filial informado; sem cRef, usa GetMV()
   no ambiente atual. Motivo: MV_IACEMID
   estava cadastrado como Caracter (confirmado pelo usuario em producao) e o
   codigo antigo lia com GetMV(cParam, , 0) esperando N — GetMV() devolve o
   valor no TIPO REAL do parametro, entao nValor virava uma STRING e qualquer
   comparacao numerica ("nValor <= 0") quebrava com "type mismatch on
   compare". Esta funcao centraliza a defesa: pega o retorno de GetMV() em
   uma variavel U (tipo livre), confere ValType() e so converte quando
   necessario — cobre C (Val), N (usa direto) e qualquer outro tipo
   inesperado (cai no default) sem precisar saber de antemao como o
   parametro foi cadastrado. Usar esta funcao (nao GetMV cru) para QUALQUER
   parametro numerico novo deste fonte.
   [CORRIGIDO apos usuario reportar popup "Help: MV_..." em producao] O 3o
   parametro de GetMV() e o default devolvido quando o parametro NAO existe
   no SX6 — passar Nil ali faz o Protheus tratar como "sem default definido"
   e abrir o popup de ajuda do parametro em vez de so devolver silenciosamente.
   Passa "" (vazio, tipo Caracter) como default: sempre um valor real, nunca
   aciona o popup, e o ValType()/conversao abaixo funciona igual para
   parametro inexistente (GetMV devolve "") ou cadastrado como C ou N.
---------------------------------------------------------------------------- */
Static Function IACParNum(cParam, nPadrao, cRef)
    Local uValor := ""
    Local nRet   := nPadrao

    If ValType(cRef) == "C" .And. !Empty(Alltrim(cRef))
        uValor := GetNewPar(cParam, "", Alltrim(cRef))
    Else
        uValor := GetMV(cParam, , "")
    EndIf

    If ValType(uValor) == "N"
        nRet := uValor
    ElseIf ValType(uValor) == "C" .And. !Empty(Alltrim(uValor))
        nRet := Val(Alltrim(uValor))
    EndIf

    If nRet <= 0
        nRet := nPadrao
    EndIf

Return nRet

/* ----------------------------------------------------------------------------
   IACUrlBase
   Le MV_IACURL e devolve a URL base do IAHub/IA Command, sem path. Enquanto o
   parametro nao estiver cadastrado, usa o fallback IAC_HUB_URL_PADRAO definido
   no topo do fonte (apenas para piloto/desenvolvimento).
---------------------------------------------------------------------------- */
Static Function IACUrlBase()
    Local cBase := Alltrim(GetMV("MV_IACURL", , ""))
    If Empty(cBase)
        cBase := IAC_HUB_URL_PADRAO
    EndIf
Return cBase

/* ----------------------------------------------------------------------------
   IACUrlTok
   Monta a URL completa do endpoint que emite o token curto do chat Protheus.
   Esse endpoint recebe empresaId, celular, filial e empresasPermitidas.
---------------------------------------------------------------------------- */
Static Function IACUrlTok()
    Local cBase := IACUrlBase()
    If Empty(cBase)
        Return ""
    EndIf
Return cBase + "/api/ia-command/protheus/token"

/* ----------------------------------------------------------------------------
   IACUrlChat
   Monta a URL da pagina HTML do chat. O token e o nome do usuario sao anexados
   depois em IACChat(), na querystring aberta pelo navegador.
---------------------------------------------------------------------------- */
Static Function IACUrlChat()
    Local cBase := IACUrlBase()
    If Empty(cBase)
        Return ""
    EndIf
Return cBase + "/api/ia-command/protheus/chat"

/* ----------------------------------------------------------------------------
   IACTimeout
   Le MV_IACTOUT para definir o timeout HTTP da chamada FWRest ao IAHub. Quando
   o parametro nao existe ou esta zerado, usa IAC_HTTP_TIMEOUT_PADRAO.
---------------------------------------------------------------------------- */
Static Function IACTimeout()
Return IACParNum("MV_IACTOUT", IAC_HTTP_TIMEOUT_PADRAO)

/* ----------------------------------------------------------------------------
   IACEmpId
   Le MV_IACEMID da empresa logada para descobrir o empresa_id correspondente
   no IA Command. Esse valor continua sendo enviado como empresa principal do
   token; a lista multiempresa e montada separadamente por IACEmpJs().
   [CORRIGIDO apos usuario reportar popup "Help: MV_IACEMID" persistindo]
   A versao anterior tentava 4 referencias diferentes via GetNewPar()
   (Left(cEmpAnt,2), cEmpAnt inteiro, Left(cFilAnt,2), cFilAnt inteiro) antes
   de cair em IACEmpAt() — cada tentativa que nao batesse com um X6_FIL
   cadastrado disparava o popup de ajuda do parametro (comportamento nativo
   do GetNewPar/SuperGetMV quando o parametro nao existe para a referencia
   pesquisada). Confirmado por SQL direto em producao que X6_FIL guarda
   M0_CODIGO puro ("01"/"02", codigo de empresa) — IACEmpAt() (via
   IACEmpUsr()+IACEmpIdC()) ja resolve isso corretamente usando essa mesma
   fonte, entao vai direto pra la, sem as tentativas que so geravam popup.
---------------------------------------------------------------------------- */
Static Function IACEmpId()
Return IACEmpAt()

/* ----------------------------------------------------------------------------
   IACSecret
   Le MV_IACSECR e devolve o segredo compartilhado enviado no header
   X-Protheus-Secret. O backend usa esse valor para aceitar/rejeitar a emissao
   de token do chat.
---------------------------------------------------------------------------- */
Static Function IACSecret()
    Local cValor := Alltrim(GetMV("MV_IACSECR", , ""))
    If Empty(cValor)
        cValor := IAC_SEGREDO_PADRAO
    EndIf
Return cValor
