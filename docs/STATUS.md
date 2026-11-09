# Status — Selo

> Atualizado em 2026-11-09.

| Campo | Valor |
|---|---|
| **O que é** | O Mail da Apple, deste Mac, para um agente de código. Servidor MCP local. Lê, responde, responde a todos, encaminha, anexa, envia, baixa anexo, exclui para a Lixeira, descadastra lista e aponta sinais de mensagem suspeita. |
| **Estágio** | Em desenvolvimento. O servidor e o guia de uso estão no repositório. Ainda não há prova de aceitação em cada tipo de conta (Gmail, iCloud, Exchange, IMAP). |
| **Plataformas** | macOS, com o aplicativo Mail e Node.js 18 ou mais novo. |
| **Stack** | Node.js, MCP por stdio, JavaScript for Automation (`osascript`) dentro do Mail.app. Sem dependências. |
| **Site** | A ficha está em `site/`. O endereço público é o repositório. `selo.falcaosl.com` não está registrado. |
| **Licença** | MIT. Público. |
| **Monetização** | Nenhuma. |
| **Próximo marco** | `npm run doctor` numa máquina com o Mail aberto, e um envio de teste para o próprio endereço. |

## O que já está no repositório

- 21 ferramentas, listadas em `README.md` e explicadas em `docs/USO.md` e `docs/USE.md`.
- Excluir move para a Lixeira. Não há comando de apagar para sempre.
- Anexo baixado vai para `~/Downloads/Selo`, com quarentena, e programa, instalador e script ficam de fora.
- Descadastro usa `List-Unsubscribe`: POST One-Click, ou mailto pela própria conta. Link solto no corpo não é aberto.
- `check_message` devolve `ok`, `review` ou `suspicious`. A resposta diz que não é antivírus.
- Testes em `npm test` cobrem o contrato, a validação e a heurística. Não abrem o Mail.

## O que falta

- Rodar o doctor e um ciclo real: ler, rascunho, envio para si, lixeira, descadastro numa lista de teste.
- Registrar um domínio, se a ficha em `site/` for publicada.
