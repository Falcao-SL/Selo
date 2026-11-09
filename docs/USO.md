# Como usar o Selo

O Selo é o Mail da Apple, deste Mac, para um agente de código. Claude, Cursor, Codex e qualquer cliente MCP pedem, e o Selo executa no aplicativo Mail que você já usa.

As contas são as que já estão no Mail. Não há senha para colar, nem IMAP, nem OAuth. O macOS pede, uma vez, permissão de Automação.

Enviar, responder, responder a todos, encaminhar, excluir e descadastrar acontecem de verdade. Excluir move a mensagem para a Lixeira do Mail. Dá para recuperar por lá. Nada neste servidor apaga uma mensagem para sempre.

## O que você precisa

- macOS, com o aplicativo Mail instalado.
- Pelo menos uma conta já configurada no Mail.
- Node.js 18 ou mais novo (`node -v`).

O Mail precisa estar aberto na primeira vez. Se estiver fechado, o Selo responde que o Mail não está em execução.

## 1. Pegar o código

```bash
git clone https://github.com/Falcao-SL/Selo.git
cd Selo
```

Não há `npm install`. O servidor não tem dependência.

## 2. Dar permissão ao macOS

```bash
npm run doctor
```

O comando lista as contas que o Mail deixou ver. Se o macOS bloquear, aparece um aviso, ou um pedido de permissão.

Caminho manual: Ajustes do Sistema → Privacidade e Segurança → Automação. Ative o Mail para o programa que está rodando o Selo (Terminal, Cursor, Claude ou node).

`npm run doctor` só lê a lista de contas. Não envia e não apaga.

## 3. Ligar no agente

Troque o caminho pelo lugar onde você clonou o repositório.

### Cursor

Em `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "selo": {
      "command": "node",
      "args": ["/Users/voce/Github/Falcao-SL/Selo/src/index.js"]
    }
  }
}
```

Recarregue os servidores MCP do Cursor. O Selo passa a aparecer como `selo`.

### Claude Code

Na pasta do projeto, ou em `~/.claude.json`, o bloco é o mesmo nome `mcpServers`.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`, dentro de `mcpServers`, com o mesmo `command` e `args`. Feche e abra o Claude Desktop.

O servidor fala só por stdin/stdout. Não escolha uma porta. Não coloque senha no JSON.

## 4. Pedir em português

O agente escolhe a ferramenta. Estes pedidos cobrem a caixa:

- Quantas contas tem no Mail, e quais os endereços?
- O que está não lido?
- Lista as últimas 10 da caixa de entrada da conta pessoal.
- Busca mensagens da Apple sobre recibo.
- Lê a mensagem 12345 da conta pessoal.
- Essa mensagem é suspeita?
- Quais os anexos dela? Baixa o PDF.
- Abre um rascunho para ana@example.com, assunto "Amanhã", texto "Confirmado.", sem enviar.
- Envia esse e-mail da conta eu@example.com.
- Responde a mensagem 12345 com "Pode ser na sexta."
- Responde a todos na mensagem 12345.
- Encaminha a mensagem 12345 para joao@example.com.
- Anexa `/Users/voce/Documents/nota.pdf` nesse envio.
- Marca a mensagem 12345 como lida.
- Move a mensagem 12345 para a caixa Arquivo.
- Arquiva a mensagem 12345.
- Exclui a mensagem 12345.
- Descadastra a lista dessa mensagem.

Para enviar, responder, encaminhar ou excluir, diga isso com todas as letras. `create_draft` abre a janela e para. `send_message`, `reply_message`, `reply_all` e `forward_message` mandam o e-mail embora.

## 5. As ferramentas

O `id` da mensagem vem de `list_messages` ou `search_messages`. Ele é o número do Mail, não a posição na lista. A conta aceita o nome ("Pessoal") ou o e-mail.

`limit` vai de 1 a 50. O padrão é 25. O corpo lido corta em 20.000 caracteres, no máximo 40.000.

### Ler

`list_accounts` não recebe argumento.

`list_mailboxes` aceita `account`. Sem ela, lista todas as contas.

`unread_summary` não recebe argumento. Devolve o total, a entrada e até oito caixas com não lidas.

`list_messages` exige `account`. Opcionais: `mailbox` (padrão `INBOX`), `limit`, `unreadOnly`.

`search_messages` exige `query`. Opcionais: `account`, `mailbox`, `limit`, `searchBody`. Sem caixa, a busca fica na entrada. `searchBody: true` também olha o texto e demora mais. A resposta não traz o corpo; use `read_message`.

`read_message` exige `account` e `id`. Opcionais: `mailbox`, `maxChars`. Devolve assunto, remetente, destinatários, data, nomes e tamanhos dos anexos, e o corpo. Não grava o anexo em disco.

`list_attachments` exige `account` e `id`. Devolve `index`, nome, bytes e tipo.

`save_attachment` exige `account`, `id` e `index`. Opcionais: `expectName` (o nome que você viu na lista; se mudou, a chamada falha) e `directory` (pasta absoluta dentro da sua pasta pessoal). O padrão é `~/Downloads/Selo`. O arquivo salvo se chama `selo-` mais um identificador, com a extensão original. O macOS marca quarentena nele. O Selo não executa o arquivo.

Não são baixados: programa, instalador, imagem de disco, script e HTML (`.app`, `.dmg`, `.pkg`, `.exe`, `.js`, `.sh`, `.html`, `.svg` e a lista vizinha em `src/files.js`). Zip e planilha com macro baixam, com um aviso na resposta.

`check_message` exige `account` e `id`. Devolve `verdict`: `ok`, `review` ou `suspicious`, mais a lista de sinais. Olha falha de SPF, DKIM ou DMARC, reply-to de outro domínio, e-mail diferente escondido no nome exibido, nome de marca conhecido num domínio que não é o da marca, texto de urgência, link `http` ou com IP, e anexo de tipo arriscado. Uma mensagem sem esses sinais volta `ok`. Isso não prova que ela seja segura, nem que uma `suspicious` seja golpe.

### Escrever

Endereços vão em lista: `"to": ["ana@example.com"]`. No máximo 20 por campo. Anexos são caminhos absolutos dentro da sua pasta pessoal, no máximo 10 arquivos, 20 MB cada, 25 MB somados.

`create_draft` exige `to`, `subject` e `body`. Opcionais: `from`, `cc`, `bcc`, `attachments`. Abre a janela do Mail. A resposta traz `sent: false`.

`send_message` exige `from`, `to`, `subject` e `body`. Opcionais: `cc`, `bcc`, `attachments`. `from` tem de ser um endereço que já existe numa conta do Mail. A mensagem sai.

`reply_message` exige `account`, `id` e `body`. Opcional: `mailbox`, `attachments`. Responde só ao remetente e envia. O texto original entra citado abaixo do seu.

`reply_all` tem os mesmos argumentos e inclui os outros destinatários.

`forward_message` exige `account`, `id`, `to` e `body`. Opcionais: `cc`, `mailbox`, `attachments`. Envia o encaminhamento.

### Organizar a caixa

`mark_message` exige `account` e `id`, e pelo menos um entre `read` e `flagged` (`true` ou `false`).

`move_message` exige `account`, `id` e `targetMailbox`. A caixa de destino precisa existir na mesma conta. Em algumas contas Microsoft o Mail aceita o comando e não move; a resposta volta `moved: false` com o motivo. No Gmail, a mensagem pode ganhar o marcador e continuar na entrada.

`archive_message` exige `account` e `id`. Procura uma caixa chamada Archive ou Arquivo. Se não houver, não move nada.

`trash_message` exige `account` e `id`. Move para a Lixeira (Trash, Deleted Messages, Lixeira, Lixo, e os nomes vizinhos). A resposta traz `recoverable: true`.

`trash_messages` exige `account` e `ids` (até 100 números). Opcional: `mailbox`.

`create_mailbox` exige `account` e `name`.

### Descadastro

`unsubscribe` exige `account` e `id`.

O Selo lê o cabeçalho `List-Unsubscribe` da mensagem.

- Se a lista anuncia One-Click (`List-Unsubscribe-Post`), o Selo faz o POST `https` padronizado, na porta 443, e para quando a lista responde entre 200 e 299. Não segue redirecionamento. Recusa link `http`, porta diferente, usuário e senha no link, e endereço que seja local ou que resolva para a sua rede.
- Se não há One-Click e há um `mailto`, o Selo envia esse descadastro pela sua conta, pelo Mail. Parâmetros `bcc` e `cc` desse mailto são ignorados.
- Se a lista só publicou um link `https`, sem One-Click, o Selo não abre o link. A resposta diz para concluir no Mail.

Uma mensagem sem esse cabeçalho não é descadastrada. O Selo não caça o link de "sair" no corpo.

## Quando algo falha

| O que você vê | O que fazer |
|---|---|
| Permissão de automação, erro -1743 | Ajustes → Privacidade e Segurança → Automação → Mail. Rode `npm run doctor` de novo. |
| O Mail não está em execução, erro -600 | Abra o Mail. |
| Conta ou caixa não encontrada | `list_accounts` e `list_mailboxes`. O nome da entrada muda: INBOX, Inbox, Caixa de Entrada. |
| A mensagem não saiu da caixa | Conta em que o Mail ignora mover por script. Mova no próprio Mail. |
| Anexo `.exe`, `.dmg`, `.html`… | O Selo não baixa esse tipo. Abra a mensagem no Mail. |
| Descadastro sem `List-Unsubscribe` | Essa mensagem não é uma lista com cabeçalho padrão. |
| A operação passou de 50s | Diminua o `limit` ou aponte uma caixa. |

Os testes locais, que não abrem o Mail, são `npm test`.

## Privacidade

O Selo roda na sua máquina. Não há conta Selo, não há telemetria e não há arquivo de senha. O que sai para a internet é o que você pediu para sair: um e-mail enviado pelo Mail, ou o POST de descadastro One-Click para o endereço que a própria lista publicou.

Quem lê a mensagem é o agente que você ligou no Selo. Esse agente passa a ver assunto, corpo e anexos que você pedir.
