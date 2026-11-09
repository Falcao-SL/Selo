#!/usr/bin/env node
/**
 * Selo — servidor MCP local para o Mail.app.
 *
 * É o Mail.app deste Mac para um agente: ler, responder, encaminhar,
 * anexar, enviar, excluir para a Lixeira e descadastrar. Não pede senha.
 */

import readline from 'node:readline';
import { assertMacOS, JXAError } from './jxa.js';
import * as mail from './mail.js';
import { createTools } from './tools.js';
import { handleMessage } from './protocol.js';

const tools = createTools(mail);

function fail(err) {
  const message = err instanceof JXAError ? err.message : err.message;
  console.error(message);
  if (err.hint) console.error(err.hint);
  process.exit(1);
}

if (process.argv.includes('--doctor')) {
  try {
    await assertMacOS();
    const accounts = await mail.listAccounts();
    console.log(`Mail.app respondeu: ${accounts.length} conta${accounts.length === 1 ? '' : 's'}.`);
    for (const account of accounts) {
      const emails = Array.isArray(account.emails) ? account.emails.join(', ') : '';
      console.log(`- ${account.name}${emails ? ` (${emails})` : ''}`);
    }
    console.log('O Selo está pronto: ler, responder, encaminhar, enviar, anexar, excluir e descadastrar.');
  } catch (err) {
    fail(err);
  }
  process.exit(0);
}

try {
  await assertMacOS();
} catch (err) {
  fail(err);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido.' } });
    return;
  }

  handleMessage(message, { tools })
    .then((response) => {
      if (response) write(response);
    })
    .catch((err) => {
      write({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: err.message } });
    });
});

console.error(`selo pronto — ${tools.length} ferramentas`);

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}
