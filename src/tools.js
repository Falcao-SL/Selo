/**
 * Contrato do Selo: a caixa de correio do Mail.app neste Mac.
 * Enviar, responder, encaminhar, excluir e descadastrar acontecem de verdade.
 */

import path from 'node:path';
import { assessMessage } from './inspect.js';
import { BLOCKED_EXTENSIONS, MAX_ATTACHMENT_BYTES, attachmentWarning, prepareSaveDir, quarantine, resolveAttachmentPaths } from './files.js';
import { unsubscribeMessage } from './unsubscribe.js';

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const emails = (description) => ({ type: 'array', items: { type: 'string' }, description });
const paths = (description) => ({ type: 'array', items: { type: 'string' }, description });

const EMAIL = /^[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+$/;

function requiredString(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`"${field}" é obrigatório.`);
  if (value.length > max) throw new Error(`"${field}" passa de ${max} caracteres.`);
  return value;
}

function optionalString(value, field, max) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`"${field}" precisa ser texto.`);
  if (value.length > max) throw new Error(`"${field}" passa de ${max} caracteres.`);
  return value;
}

function addressList(value, field, { required }) {
  if (value == null) {
    if (required) throw new Error(`"${field}" é obrigatório.`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`"${field}" precisa ser uma lista de endereços.`);
  if (required && value.length === 0) throw new Error(`"${field}" precisa de ao menos um endereço.`);
  if (value.length > 20) throw new Error(`"${field}" aceita no máximo 20 endereços.`);
  return value.map((item) => {
    if (typeof item !== 'string' || item.length > 320 || !EMAIL.test(item)) {
      throw new Error(`Endereço inválido em "${field}".`);
    }
    return item;
  });
}

function limitOf(value) {
  if (value == null) return 25;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('"limit" é um inteiro de 1 a 50.');
  }
  return value;
}

function messageRef(args) {
  if (typeof args.id !== 'number' || !Number.isInteger(args.id)) {
    throw new Error('"id" precisa ser o número da mensagem.');
  }
  return {
    account: requiredString(args.account, 'account', 200),
    mailbox: optionalString(args.mailbox, 'mailbox', 200) || 'INBOX',
    id: args.id,
  };
}

function letter(args, { fromRequired }) {
  const from = optionalString(args.from, 'from', 320);
  if (fromRequired && !from) throw new Error('"from" é obrigatório.');
  if (from && !EMAIL.test(from)) throw new Error('Endereço inválido em "from".');
  return {
    from,
    to: addressList(args.to, 'to', { required: true }),
    cc: addressList(args.cc, 'cc', { required: false }),
    bcc: addressList(args.bcc, 'bcc', { required: false }),
    subject: requiredString(args.subject, 'subject', 200),
    body: requiredString(args.body, 'body', 100_000),
    attachments: resolveAttachmentPaths(args.attachments),
  };
}

const where = {
  account: str('Nome ou e-mail da conta no Mail.'),
  mailbox: str('Caixa. Padrão: INBOX.'),
  id: num('Id numérico da mensagem, vindo de list_messages ou search_messages.'),
};

export function createTools(mail) {
  return [
    {
      name: 'list_accounts',
      description: 'Lista as contas do Mail.app, com nome, endereços e se estão ativas. Comece por aqui quando não souber o nome da conta.',
      inputSchema: { type: 'object', properties: {} },
      call: () => mail.listAccounts(),
    },
    {
      name: 'list_mailboxes',
      description: 'Lista as caixas de uma conta, ou de todas, com a quantidade de não lidas.',
      inputSchema: { type: 'object', properties: { account: str('Nome ou e-mail da conta. Omita para listar todas.') } },
      call: (args) => mail.listMailboxes({ account: optionalString(args.account, 'account', 200) }),
    },
    {
      name: 'unread_summary',
      description: 'Resume o que está não lido: total, caixa de entrada e as pastas com mais acúmulo.',
      inputSchema: { type: 'object', properties: {} },
      call: () => mail.unreadSummary(),
    },
    {
      name: 'list_messages',
      description: 'Lista mensagens de uma caixa, da mais recente para a mais antiga. Devolve metadados, sem o corpo.',
      inputSchema: {
        type: 'object',
        properties: {
          account: where.account,
          mailbox: where.mailbox,
          limit: num('De 1 a 50. Padrão: 25.'),
          unreadOnly: bool('Só as não lidas. Padrão: false.'),
        },
        required: ['account'],
      },
      call: (args) => mail.listMessages({
        account: requiredString(args.account, 'account', 200),
        mailbox: optionalString(args.mailbox, 'mailbox', 200) || 'INBOX',
        limit: limitOf(args.limit),
        unreadOnly: args.unreadOnly === true,
      }),
    },
    {
      name: 'search_messages',
      description: 'Busca por assunto ou remetente. Sem conta, percorre a entrada de todas. Sem caixa, fica na entrada. searchBody também olha o corpo e é mais lento.',
      inputSchema: {
        type: 'object',
        properties: {
          query: str('Texto a procurar.'),
          account: str('Restringe a uma conta.'),
          mailbox: str('Restringe a uma caixa. Padrão: a entrada.'),
          limit: num('De 1 a 50. Padrão: 25.'),
          searchBody: bool('Procurar também no corpo. Padrão: false.'),
        },
        required: ['query'],
      },
      call: (args) => mail.searchMessages({
        query: requiredString(args.query, 'query', 200),
        account: optionalString(args.account, 'account', 200),
        mailbox: optionalString(args.mailbox, 'mailbox', 200),
        limit: limitOf(args.limit),
        searchBody: args.searchBody === true,
      }),
    },
    {
      name: 'read_message',
      description: 'Lê uma mensagem: assunto, remetente, destinatários, data, anexos (nome e tamanho) e corpo em texto. Não baixa o arquivo do anexo.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          maxChars: num('Corta o corpo neste tamanho. Padrão: 20000. Máximo: 40000.'),
        },
        required: ['account', 'id'],
      },
      call: (args) => {
        let maxChars = 20_000;
        if (args.maxChars != null) {
          if (typeof args.maxChars !== 'number' || !Number.isInteger(args.maxChars) || args.maxChars < 200 || args.maxChars > 40_000) {
            throw new Error('"maxChars" é um inteiro de 200 a 40000.');
          }
          maxChars = args.maxChars;
        }
        return mail.readMessage({ ...messageRef(args), maxChars });
      },
    },
    {
      name: 'list_attachments',
      description: 'Lista os anexos de uma mensagem: índice, nome, tamanho e tipo. Use o índice em save_attachment.',
      inputSchema: { type: 'object', properties: where, required: ['account', 'id'] },
      call: (args) => mail.listAttachments(messageRef(args)),
    },
    {
      name: 'save_attachment',
      description:
        'Baixa um anexo para a pasta pessoal, por padrão ~/Downloads/Selo. O arquivo recebe quarentena do macOS. ' +
        'Programa, instalador e script não são baixados. Não executa o arquivo.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          index: num('Índice do anexo, vindo de list_attachments.'),
          expectName: str('Nome visto em list_attachments. Se a lista mudou, a chamada falha.'),
          directory: str('Pasta absoluta dentro da pasta pessoal. Padrão: ~/Downloads/Selo.'),
        },
        required: ['account', 'id', 'index'],
      },
      call: async (args) => {
        if (typeof args.index !== 'number' || !Number.isInteger(args.index) || args.index < 0) {
          throw new Error('"index" precisa ser o índice do anexo.');
        }
        const place = prepareSaveDir(optionalString(args.directory, 'directory', 500));
        const saved = await mail.saveAttachment({
          ...messageRef(args),
          index: args.index,
          expectName: optionalString(args.expectName, 'expectName', 255) || null,
          dir: place.dir,
          token: place.token,
          maxBytes: MAX_ATTACHMENT_BYTES,
          blockedExtensions: BLOCKED_EXTENSIONS,
        });
        const file = path.resolve(saved.saved);
        if (file !== place.dir && !file.startsWith(place.dir + path.sep)) {
          throw new Error('O Mail gravou o anexo fora da pasta pedida.');
        }
        let quarantined = true;
        try {
          await quarantine(file);
        } catch {
          quarantined = false;
        }
        return {
          path: file,
          originalName: saved.originalName,
          bytes: saved.bytes,
          quarantined,
          warning: attachmentWarning(saved.extension),
        };
      },
    },
    {
      name: 'check_message',
      description:
        'Aponta sinais de uma mensagem suspeita: autenticação, reply-to, nome exibido, texto de urgência, link estranho e anexo arriscado. ' +
        'O veredito é ok, review ou suspicious. É uma heurística local, não um antivírus.',
      inputSchema: { type: 'object', properties: where, required: ['account', 'id'] },
      call: async (args) => {
        const message = await mail.inspectMessage(messageRef(args));
        const report = assessMessage(message);
        return {
          id: message.id,
          from: message.from,
          subject: message.subject,
          verdict: report.verdict,
          signals: report.signals,
          note: report.note,
        };
      },
    },
    {
      name: 'create_draft',
      description: 'Cria um e-mail e abre a janela do Mail, com anexos se pedidos. Não envia.',
      inputSchema: {
        type: 'object',
        properties: {
          from: str('Remetente. Precisa ser uma conta do Mail. Omita para o Mail escolher.'),
          to: emails('Destinatários.'),
          cc: emails('Em cópia.'),
          bcc: emails('Cópia oculta.'),
          subject: str('Assunto.'),
          body: str('Corpo em texto puro.'),
          attachments: paths('Caminhos absolutos de arquivos na pasta pessoal.'),
        },
        required: ['to', 'subject', 'body'],
      },
      call: (args) => mail.createDraft(letter(args, { fromRequired: false })),
    },
    {
      name: 'send_message',
      description: 'Cria um e-mail novo e envia agora, pela conta do Mail. A mensagem sai de verdade. Pode levar anexos.',
      inputSchema: {
        type: 'object',
        properties: {
          from: str('Remetente. Precisa ser um endereço da conta no Mail.'),
          to: emails('Destinatários.'),
          cc: emails('Em cópia.'),
          bcc: emails('Cópia oculta.'),
          subject: str('Assunto.'),
          body: str('Corpo em texto puro.'),
          attachments: paths('Caminhos absolutos de arquivos na pasta pessoal.'),
        },
        required: ['from', 'to', 'subject', 'body'],
      },
      call: (args) => mail.sendMessage(letter(args, { fromRequired: true })),
    },
    {
      name: 'reply_message',
      description: 'Responde só ao remetente e envia agora, mantendo o fio da conversa. A resposta sai de verdade. Pode levar anexos.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          body: str('Texto da resposta. O original entra citado abaixo.'),
          attachments: paths('Caminhos absolutos de arquivos na pasta pessoal.'),
        },
        required: ['account', 'id', 'body'],
      },
      call: (args) => mail.replyMessage({
        ...messageRef(args),
        body: requiredString(args.body, 'body', 100_000),
        replyAll: false,
        attachments: resolveAttachmentPaths(args.attachments),
      }),
    },
    {
      name: 'reply_all',
      description: 'Responde ao remetente e a todos os destinatários, e envia agora. A resposta sai de verdade. Pode levar anexos.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          body: str('Texto da resposta. O original entra citado abaixo.'),
          attachments: paths('Caminhos absolutos de arquivos na pasta pessoal.'),
        },
        required: ['account', 'id', 'body'],
      },
      call: (args) => mail.replyMessage({
        ...messageRef(args),
        body: requiredString(args.body, 'body', 100_000),
        replyAll: true,
        attachments: resolveAttachmentPaths(args.attachments),
      }),
    },
    {
      name: 'forward_message',
      description: 'Encaminha a mensagem para outros endereços e envia agora. O encaminhamento sai de verdade. Pode levar anexos a mais.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          to: emails('Quem recebe o encaminhamento.'),
          cc: emails('Em cópia.'),
          body: str('Texto que entra acima da mensagem encaminhada.'),
          attachments: paths('Caminhos absolutos de arquivos na pasta pessoal.'),
        },
        required: ['account', 'id', 'to', 'body'],
      },
      call: (args) => mail.forwardMessage({
        ...messageRef(args),
        to: addressList(args.to, 'to', { required: true }),
        cc: addressList(args.cc, 'cc', { required: false }),
        body: requiredString(args.body, 'body', 100_000),
        attachments: resolveAttachmentPaths(args.attachments),
      }),
    },
    {
      name: 'mark_message',
      description: 'Marca a mensagem como lida ou não lida, e como sinalizada ou não.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          read: bool('true marca como lida. false marca como não lida.'),
          flagged: bool('true sinaliza. false tira a sinalização.'),
        },
        required: ['account', 'id'],
      },
      call: (args) => {
        if (args.read == null && args.flagged == null) {
          throw new Error('Informe "read", "flagged", ou os dois.');
        }
        return mail.markMessage({
          ...messageRef(args),
          read: args.read == null ? null : args.read === true,
          flagged: args.flagged == null ? null : args.flagged === true,
        });
      },
    },
    {
      name: 'move_message',
      description: 'Move a mensagem para outra caixa da mesma conta. A caixa de destino precisa existir.',
      inputSchema: {
        type: 'object',
        properties: { ...where, targetMailbox: str('Nome da caixa de destino.') },
        required: ['account', 'id', 'targetMailbox'],
      },
      call: (args) => mail.moveMessage({
        ...messageRef(args),
        targetMailbox: requiredString(args.targetMailbox, 'targetMailbox', 200),
      }),
    },
    {
      name: 'archive_message',
      description: 'Arquiva a mensagem: move para a caixa Archive ou Arquivo da conta. Se essa caixa não existir, a chamada falha e nada é movido.',
      inputSchema: { type: 'object', properties: where, required: ['account', 'id'] },
      call: (args) => mail.archiveMessage(messageRef(args)),
    },
    {
      name: 'trash_message',
      description: 'Exclui a mensagem: move para a Lixeira do Mail. Dá para recuperar no Mail. Não apaga para sempre.',
      inputSchema: { type: 'object', properties: where, required: ['account', 'id'] },
      call: (args) => mail.trashMessage(messageRef(args)),
    },
    {
      name: 'trash_messages',
      description: 'Exclui várias mensagens de uma vez, movendo para a Lixeira. Máximo de 100 ids. Dá para recuperar no Mail.',
      inputSchema: {
        type: 'object',
        properties: {
          account: where.account,
          mailbox: where.mailbox,
          ids: { type: 'array', items: { type: 'number' }, description: 'Ids das mensagens. Máximo 100.' },
        },
        required: ['account', 'ids'],
      },
      call: (args) => {
        if (!Array.isArray(args.ids) || args.ids.length === 0) throw new Error('Informe ao menos um id em "ids".');
        if (args.ids.length > 100) throw new Error('O máximo por chamada é 100 mensagens.');
        if (args.ids.some((id) => typeof id !== 'number' || !Number.isInteger(id))) {
          throw new Error('Cada item de "ids" precisa ser um número.');
        }
        return mail.trashMessages({
          account: requiredString(args.account, 'account', 200),
          mailbox: optionalString(args.mailbox, 'mailbox', 200) || 'INBOX',
          ids: args.ids,
        });
      },
    },
    {
      name: 'create_mailbox',
      description: 'Cria uma caixa nova dentro de uma conta.',
      inputSchema: {
        type: 'object',
        properties: {
          account: where.account,
          name: str('Nome da caixa nova.'),
        },
        required: ['account', 'name'],
      },
      call: (args) => mail.createMailbox({
        account: requiredString(args.account, 'account', 200),
        name: requiredString(args.name, 'name', 200),
      }),
    },
    {
      name: 'unsubscribe',
      description:
        'Descadastra de uma lista usando o cabeçalho List-Unsubscribe. ' +
        'Se a lista oferece One-Click, faz o POST https. Senão, envia o mailto pelo Mail. ' +
        'Não abre um link solto do corpo. A ação sai de verdade.',
      inputSchema: { type: 'object', properties: where, required: ['account', 'id'] },
      call: (args) => unsubscribeMessage(mail, messageRef(args)),
    },
  ];
}
