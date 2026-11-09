import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMessage, parseMailto, parseUnsubscribe, publicHttpsUrl } from '../src/inspect.js';
import { handleMessage } from '../src/protocol.js';
import { resolveAttachmentPaths } from '../src/files.js';
import { createTools } from '../src/tools.js';
import { unsubscribeMessage } from '../src/unsubscribe.js';

const NAMES = [
  'list_accounts', 'list_mailboxes', 'unread_summary', 'list_messages', 'search_messages',
  'read_message', 'list_attachments', 'save_attachment', 'check_message', 'create_draft',
  'send_message', 'reply_message', 'reply_all', 'forward_message', 'mark_message',
  'move_message', 'archive_message', 'trash_message', 'trash_messages', 'create_mailbox',
  'unsubscribe',
];

function tools() {
  return createTools({
    listAccounts: async () => [{ name: 'Casa', emails: ['eu@casa.test'] }],
    sendMessage: async () => { throw new Error('não deveria enviar'); },
    inspectMessage: async () => ({ headers: '', subject: 'oi' }),
  });
}

test('o contrato público tem a caixa de correio inteira', () => {
  const names = tools().map((tool) => tool.name);
  assert.deepEqual(names, NAMES);
});

test('initialize apresenta o Selo como o Mail deste Mac', async () => {
  const response = await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { tools: tools() },
  );
  assert.equal(response.result.serverInfo.name, 'selo');
  assert.match(response.result.instructions, /envia/i);
  assert.match(response.result.instructions, /Lixeira/);
});

test('tools/list devolve as 21 ferramentas', async () => {
  const response = await handleMessage(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { tools: tools() },
  );
  assert.equal(response.result.tools.length, 21);
  assert.equal(response.result.tools.some((tool) => tool.call), false);
});

test('notificação não recebe resposta', async () => {
  const response = await handleMessage(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { tools: tools() },
  );
  assert.equal(response, null);
});

test('send_message recusa destinatário vazio sem chamar o Mail', () => {
  assert.throws(
    () => tools().find((tool) => tool.name === 'send_message').call({ from: 'eu@casa.test', to: [], subject: 'Oi', body: 'Texto' }),
    /ao menos um endereço/,
  );
});

test('anexo relativo é recusado', () => {
  assert.throws(() => resolveAttachmentPaths(['relativo.txt']), /absoluto/);
});

test('anexo fora da pasta pessoal é recusado', () => {
  assert.throws(() => resolveAttachmentPaths(['/etc/passwd']), /pasta pessoal/);
});

test('List-Unsubscribe One-Click separa https e mailto, e o mailto perde bcc', () => {
  const parsed = parseUnsubscribe([
    'List-Unsubscribe: <https://listas.test/sair>,',
    ' <mailto:sair@listas.test?subject=Unsubscribe&bcc=outro@evil.test>',
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  ].join('\r\n'));
  assert.equal(parsed.oneClick, true);
  assert.equal(parsed.http, 'https://listas.test/sair');
  const mail = parseMailto(parsed.mailto);
  assert.equal(mail.to, 'sair@listas.test');
  assert.equal(mail.subject, 'Unsubscribe');
  assert.equal(JSON.stringify(mail).includes('evil'), false);
});

test('descadastro automático recusa http e endereço local', () => {
  assert.throws(() => publicHttpsUrl('http://listas.test/sair'), /https/);
  assert.throws(() => publicHttpsUrl('https://127.0.0.1/sair'), /local/);
  assert.throws(() => publicHttpsUrl('https://10.1.1.1/sair'), /local/);
});

test('unsubscribe faz o POST One-Click e não envia outro e-mail', async () => {
  let posted = null;
  const result = await unsubscribeMessage({
    inspectMessage: async () => ({
      subject: 'Boletim',
      headers: 'List-Unsubscribe: <https://listas.test/sair>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n',
    }),
    sendMessage: async () => { throw new Error('não deveria enviar'); },
  }, { account: 'Casa', mailbox: 'INBOX', id: 7 }, {
    assertHost: async (url) => url,
    post: async (url) => {
      posted = url.href;
      return { status: 200, ok: true };
    },
  });
  assert.equal(posted, 'https://listas.test/sair');
  assert.equal(result.method, 'one-click');
  assert.equal(result.unsubscribed, true);
});

test('mensagem com falha de autenticação e anexo executável é suspicious', () => {
  const report = assessMessage({
    from: 'Apple <aviso@conta-segura.test>',
    subject: 'Urgente: verify your account',
    body: 'Clique http://10.1.1.1/login',
    headers: 'Authentication-Results: spf=fail\r\nReply-To: <golpe@outro.test>\r\n',
    attachmentNames: ['fatura.exe'],
  });
  assert.equal(report.verdict, 'suspicious');
  assert.ok(report.signals.some((signal) => signal.code === 'auth_fail'));
  assert.ok(report.signals.some((signal) => signal.code === 'risky_attachment'));
  assert.match(report.note, /não é antivírus/i);
});

test('mensagem sem sinal fica ok', () => {
  const report = assessMessage({
    from: 'Ana <ana@casa.test>',
    subject: 'Almoço',
    body: 'Meio-dia na padaria.',
    headers: 'Authentication-Results: spf=pass dkim=pass dmarc=pass\r\n',
    attachmentNames: ['nota.pdf'],
  });
  assert.equal(report.verdict, 'ok');
});
