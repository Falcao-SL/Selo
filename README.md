# Selo

O Selo é o Mail da Apple, deste Mac, para um agente de código.

Ele fala com o aplicativo Mail que já está aberto na máquina, pelas contas que já estão configuradas lá. Não pede senha, não abre IMAP e não tem servidor na rede. O processo fica no Mac e conversa com o agente pelo protocolo MCP, em stdio.

Ele faz a caixa de correio: listar, buscar, ler, baixar anexo, criar e-mail, anexar arquivo, responder, responder a todos, encaminhar, enviar, marcar, mover, arquivar, excluir e descadastrar de uma lista. Também aponta sinais de uma mensagem suspeita.

Enviar, responder, encaminhar, excluir e descadastrar acontecem de verdade. Excluir move para a Lixeira do Mail, de onde dá para recuperar. A checagem de suspeita é uma heurística local, não um antivírus.

Licença MIT. Código aberto. Só macOS.

A conversa com o Mail usa JavaScript for Automation, no mesmo caminho do [NotchForge](https://github.com/Falcao-SL/NotchForge). O Selo é outro programa: sem entalhe e sem plugin.

## Como usar

O guia completo está em [docs/USO.md](docs/USO.md). English: [docs/USE.md](docs/USE.md).

Resumo, para o Cursor, o Claude Code ou o Claude Desktop:

```json
{
  "mcpServers": {
    "selo": {
      "command": "node",
      "args": ["/CAMINHO/Selo/src/index.js"]
    }
  }
}
```

Na primeira chamada, o macOS pede permissão de Automação para o Mail. Confira com `npm run doctor`.

## Ferramentas

| | Ferramenta | O que faz |
|---|---|---|
| Ler | `list_accounts` | Contas do Mail |
| Ler | `list_mailboxes` | Caixas e não lidas |
| Ler | `unread_summary` | Resumo do que está parado |
| Ler | `list_messages` | Mensagens de uma caixa |
| Ler | `search_messages` | Busca por assunto, remetente ou corpo |
| Ler | `read_message` | Abre uma mensagem |
| Ler | `list_attachments` | Anexos, sem baixar |
| Ler | `save_attachment` | Baixa um anexo para `~/Downloads/Selo` |
| Ler | `check_message` | Sinais de mensagem suspeita |
| Escrever | `create_draft` | Abre um rascunho. Não envia |
| Escrever | `send_message` | Cria e envia |
| Escrever | `reply_message` | Responde ao remetente e envia |
| Escrever | `reply_all` | Responde a todos e envia |
| Escrever | `forward_message` | Encaminha e envia |
| Caixa | `mark_message` | Lida, não lida, sinalizada |
| Caixa | `move_message` | Move para outra caixa |
| Caixa | `archive_message` | Move para Archive ou Arquivo |
| Caixa | `trash_message` | Exclui: vai para a Lixeira |
| Caixa | `trash_messages` | Exclui várias |
| Caixa | `create_mailbox` | Cria uma caixa |
| Lista | `unsubscribe` | Descadastro One-Click ou mailto |

Programa, instalador e script não são baixados. O descadastro usa o cabeçalho `List-Unsubscribe` da lista. O Selo não abre um link solto no corpo da mensagem.

## O que fica de fora

Não apaga para sempre: a Lixeira do Mail continua com a mensagem. Não é antivírus. Não mexe no Mail do iPhone direto, só no Mail deste Mac. Não guarda senha em arquivo.
