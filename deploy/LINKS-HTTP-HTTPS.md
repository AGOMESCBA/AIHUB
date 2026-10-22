# Links HTTP e HTTPS em paralelo

O endereço público é opcional e geral para todas as empresas. Cadastrar esse
endereço gera links adicionais; não redireciona, desativa ou substitui as rotas
existentes. HTTP e HTTPS, e nomes de host diferentes, têm armazenamento e login
próprios no navegador. É normal precisar entrar novamente ao mudar de endereço.

## Uso na Administração

Em IA Administração → IAHub Platform → Link de acesso:

1. O apelido continua por empresa, salvo em **Salvar configurações**.
2. **Link atual — interface anterior** mantém `/entrar-servico/{apelido}` no
   endereço usado para abrir a Administração.
3. **Nova interface — endereço deste acesso** usa `/iaservice/{apelido}` nesse
   mesmo endereço, inclusive por IP e porta HTTP.
4. **Endereço público do IAHub** aceita uma origem HTTP ou HTTPS, com porta
   opcional, sem caminhos. Exemplo: `https://ia.c3isystems.com.br`.
   Ele tem botão próprio, **Salvar endereço público**, e vale para todas as empresas.
5. **Nova interface — endereço público** combina a origem configurada com o
   apelido da empresa. Vazio significa que nenhum endereço público foi configurado.
6. **Abrir para testar** abre o endereço real em outra aba. A tela não declara
   disponibilidade automática: confirme a página, o certificado, o login e o chat.

Salvar o endereço público não configura DNS, NAT, certificados ou firewall.
Não é feita nenhuma chamada do servidor para a URL cadastrada.
Edições concorrentes do endereço são recusadas para evitar sobrescritas silenciosas.

## Compatibilidade

- `/entrar-servico`, `/entrar-servico/{apelido}` e `/radar-externo/{apelido}`
  permanecem com a interface anterior.
- `/iaservice` abre a nova interface sem identidade visual prévia de empresa.
- `/iaservice/{apelido}`, `/iaservice/{apelido}/acesso` e
  `/iaservice/{apelido}/radar` abrem a nova interface para apelidos cadastrados.
- `/iaservice/j2a` e seus caminhos antigos de assets permanecem válidos.
- `/iaservice/guia` continua reservado ao manual; `assets` também é reservado.
- O apelido identifica visualmente a empresa, sem substituir OTP, token ou
  autorização multiempresa. A empresa efetiva continua sendo a da sessão.
- `/iacommand` é um atalho adicional para a entrada autenticada do IA Command,
  com as mesmas permissões de `/app/ia-command`. Não modifica o agente Python.

## Implantação

Esta alteração é de código e não deve ser aplicada com cópia indiscriminada de
pastas `data/`, bancos, `.env` ou arquivos de sessão sobre a produção.

Antes da atualização, obtenha backup consistente do SQLite da Platform usando
um mecanismo compatível com WAL (API de backup SQLite ou parada programada).
A atualização cria somente a tabela `platform_access_config` por
`CREATE TABLE IF NOT EXISTS`, sem inserir URL padrão ou reescrever empresas.

Use o procedimento de atualização e janela acordados para o serviço Node.
A alteração não fornece implantação sem interrupção: reiniciar um processo
único pode interromper requisições. Não reinicie o IIS inteiro para aplicar código.

Depois, valide primeiro os links antigos e só compartilhe o domínio novo após
validar DNS, HTTPS, login e WebSocket. Para voltar ao uso exclusivo dos links
atuais na Administração, limpe o endereço público e salve. Isso não desativa os
acessos antigos nem exige mudanças nos cadastros de empresa.

## Validação isolada

```powershell
node --test "apps/IAHUB/tests/access-links.test.js" "apps/IAHUB/tests/access-links-ui.test.js"
```

Os testes usam SQLite em memória e serviços locais simulados, sem inicializar
o servidor principal ou modificar o banco real da Platform.
