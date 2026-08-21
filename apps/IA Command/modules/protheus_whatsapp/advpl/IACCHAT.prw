#INCLUDE "PROTHEUS.CH"
#INCLUDE "FWMVCDEF.CH"
#INCLUDE "TOTVS.CH"

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
     a.1) ShellExecute("open", cUrl, "", "", 1) — retorno esperado nRet > 32
        para sucesso, conforme documentacao/exemplos ADVPL consultados; NAO
        confirmado contra o Include real desta instalacao. Se o retorno real
        divergir, o fallback (MsgInfo com link) dispara incorretamente mesmo
        com a aba tendo aberto — ajustar o limiar de comparacao se confirmado.
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

// VALOR DE TESTE — empresa "J2A TESTE" (empresa_id=3 no cadastro do IA Command
// / IAHub). So e usado enquanto o parametro MV_IACEMID nao estiver cadastrado.
// TODO antes de producao/mais usuarios: cadastrar MV_IACEMID por instalacao e
// remover/esvaziar esta linha (empresa_id muda por empresa-cliente real).
#DEFINE IAC_EMPRESA_ID_PADRAO  3

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
    Local lOk         := .T.
    Local cErro       := ""

    cUrlChatBase := IACUrlChat()
    If Empty(cUrlChatBase)
        MsgAlert("Parametro MV_IACURL (URL do chat no IAHub) nao configurado." + CRLF + ;
                  "Procure o administrador do sistema.", "IA Command")
        Return
    EndIf

    cCelular := IACLerCel()

    If Empty(cCelular)
        MsgAlert("Celular nao cadastrado para o usuario " + RetCodUsr() + "." + CRLF + ;
                  "Cadastre em Configurador > Celular por Usuario - IA Command " + ;
                  "(IACadUsr) antes de usar o chat.", "IA Command")
        Return
    EndIf

    lOk := IACToken(cCelular, @cToken, @cErro)

    If !lOk
        MsgAlert("Nao foi possivel iniciar a sessao do IA Command:" + CRLF + cErro, "IA Command")
        Return
    EndIf

    // FWURLEncode evita quebra da querystring se cNomeUser tiver espaco, & ou =
    // apos a remocao de acentos (ex.: "Jose & Silva", nomes com caracteres
    // especiais de cadastro). Token ja e hexadecimal puro (token-service.js),
    // sem necessidade de encode. Confirmar disponibilidade de FWURLEncode no
    // Include desta versao — se indisponivel, alternativa e Escape().
    cUrlChat := cUrlChatBase + "?token=" + cToken + "&usuario=" + FWURLEncode(IACRmAcent(cNomeUser))

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
    // Retorno de ShellExecute (fonte: documentacao/exemplos ADVPL): nRet > 32
    // indica sucesso; nRet == -1 quando chamado fora de contexto SmartClient
    // (ex.: Job); nRet == 2 quando o "arquivo"/protocolo nao e encontrado.
    // Portanto sucesso e nRet > 32, nao apenas nRet != 0.
    If ShellExecute("open", cUrlChat, "", "", 1) <= 32
        MsgInfo("Nao foi possivel abrir o IA Command automaticamente." + CRLF + ;
                 "Copie o link abaixo e abra em uma nova aba do navegador:" + CRLF + CRLF + ;
                 cUrlChat, "IA Command")
    EndIf

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
---------------------------------------------------------------------------- */
Static Function IACToken(cCelular, cToken, cErro)
    Local oRest
    Local aHeader     := {}
    Local cBody       := ""
    Local cRespo      := ""
    Local lOk         := .F.
    Local oJsonRes
    Local nEmpresaId  := IACEmpId() // ver comentario acima
    Local cEmpPermit  := ""
    Local cUrlToken   := IACUrlTok()
    Local nTimeout    := IACTimeout()

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
    cEmpPermit := IACEmpJs(nEmpresaId)

    cBody := '{"empresaId":' + cValToChar(nEmpresaId) + ;
              ',"celular":"' + IACEscJs(cCelular) + '"' + ;
              ',"filial":"' + IACEscJs(xFilial()) + '"' + ;
              ',"empresasPermitidas":' + cEmpPermit + '}'

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
   IACEmpJs
   Monta a lista multiempresa enviada ao IAHub. A permissao vem do Protheus:
   FWUsrEmp(RetCodUsr()) retorna as empresas do usuario; quando retornar @@@@,
   FWLoadSM0() expande para todas as empresas disponiveis no ambiente.

   Para cada empresa Protheus, usa uma filial de referencia vinda da SM0 e le
   MV_IACEMID via GetNewPar(). Nao usa RpcSetEnv/RpcClearEnv aqui porque esta
   rotina roda pelo menu e o Framework ja entrega o ambiente aberto.
---------------------------------------------------------------------------- */
Static Function IACEmpJs(nEmpresaAtual)
    Local aCodigos   := IACEmpUsr()
    Local aEmpresas  := {}
    Local cJson      := "["
    Local nI         := 0
    Local nEmpresaId := 0

    For nI := 1 To Len(aCodigos)
        nEmpresaId := IACEmpIdC(aCodigos[nI, 1], aCodigos[nI, 2])
        If nEmpresaId > 0
            IACAddEmp(@aEmpresas, nEmpresaId, aCodigos[nI, 1])
        EndIf
    Next nI

    If nEmpresaAtual > 0
        IACAddEmp(@aEmpresas, nEmpresaAtual, "")
    EndIf

    For nI := 1 To Len(aEmpresas)
        If nI > 1
            cJson += ","
        EndIf
        cJson += '{"empresaId":' + cValToChar(aEmpresas[nI, 1]) + ;
                 ',"codigoProtheus":"' + IACEscJs(aEmpresas[nI, 2]) + '"}'
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

        cGrp := Alltrim(cValToChar(aSM0[nI, 1])) // SM0_GRPEMP
        cFil := Alltrim(cValToChar(aSM0[nI, 2])) // SM0_CODFIL completo
        cEmp := Alltrim(cValToChar(aSM0[nI, 3])) // SM0_EMPRESA
        If Empty(cEmp)
            cEmp := cGrp
        EndIf

        If lTodas .Or. IACEmpOk(aEmpUsr, cGrp, cEmp, cFil)
            IACAddCod(@aRet, cEmp, cFil)
        EndIf
    Next nI

Return aRet

/* ----------------------------------------------------------------------------
   IACEmpIdC
   Le MV_IACEMID com GetNewPar usando a filial completa de referencia da SM0.
   O Framework de parametros aplica a hierarquia de filial/empresa/grupo e
   evita leitura direta da SX6.
---------------------------------------------------------------------------- */
Static Function IACEmpIdC(cCodigoProtheus, cFilReferencia)
    Local nRet   := 0
    Local cValor := ""

    If Empty(cCodigoProtheus) .Or. Empty(cFilReferencia)
        Return 0
    EndIf

    cValor := Alltrim(cValToChar(GetNewPar("MV_IACEMID", "", cFilReferencia)))
    nRet   := Val(cValor)

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
   filial de referencia da SM0. Evita duplicidade para nao ler MV_IACEMID mais
   de uma vez para a mesma empresa.
---------------------------------------------------------------------------- */
Static Function IACAddCod(aLista, cCodigo, cFilReferencia)
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

    AAdd(aLista, { cCod, Alltrim(cFilReferencia) })

Return

/* ----------------------------------------------------------------------------
   IACAddEmp
   Adiciona uma empresa permitida no formato usado pelo JSON enviado ao IAHub.
   Evita repetir o mesmo empresa_id do IA Command quando mais de um codigo
   Protheus apontar para o mesmo MV_IACEMID.
---------------------------------------------------------------------------- */
Static Function IACAddEmp(aEmpresas, nEmpresaId, cCodigoProtheus)
    Local nI := 0

    For nI := 1 To Len(aEmpresas)
        If aEmpresas[nI, 1] == nEmpresaId
            Return
        EndIf
    Next nI

    AAdd(aEmpresas, { nEmpresaId, Alltrim(cCodigoProtheus) })

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
    Local aDe   := {"á","à","â","ã","ä","é","è","ê","ë","í","ì","î","ï",;
                     "ó","ò","ô","õ","ö","ú","ù","û","ü","ç","ñ",;
                     "Á","À","Â","Ã","Ä","É","È","Ê","Ë","Í","Ì","Î","Ï",;
                     "Ó","Ò","Ô","Õ","Ö","Ú","Ù","Û","Ü","Ç","Ñ"}
    Local aPara := {"a","a","a","a","a","e","e","e","e","i","i","i","i",;
                     "o","o","o","o","o","u","u","u","u","c","n",;
                     "A","A","A","A","A","E","E","E","E","I","I","I","I",;
                     "O","O","O","O","O","U","U","U","U","C","N"}
    Local cSaida := cTexto
    Local nI

    For nI := 1 To Len(aDe)
        cSaida := StrTran(cSaida, aDe[nI], aPara[nI])
    Next nI

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
   IACParamNum
   Le um parametro SX6 (GetMV) que deve ser tratado como numero, mas SEM
   confiar no tipo em que foi cadastrado no dicionario. Motivo: MV_IACEMID
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
Static Function IACParamNum(cParam, nPadrao)
    Local uValor := GetMV(cParam, , "")
    Local nRet   := nPadrao

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
Return IACParamNum("MV_IACTOUT", IAC_HTTP_TIMEOUT_PADRAO)

/* ----------------------------------------------------------------------------
   IACEmpId
   Le MV_IACEMID da empresa logada para descobrir o empresa_id correspondente
   no IA Command. Esse valor continua sendo enviado como empresa principal do
   token; a lista multiempresa e montada separadamente por IACEmpJs().
---------------------------------------------------------------------------- */
Static Function IACEmpId()
Return IACParamNum("MV_IACEMID", IAC_EMPRESA_ID_PADRAO)

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
