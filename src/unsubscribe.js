/**
 * Descadastro pelo cabeçalho da lista (RFC 2369 / RFC 8058).
 * One-Click é um POST https. Sem One-Click, manda o mailto pelo Mail.
 * Não abre um link solto do corpo da mensagem.
 */

import { assertPublicHost, parseMailto, parseUnsubscribe, publicHttpsUrl } from './inspect.js';

export async function postOneClick(url) {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, ok: response.status >= 200 && response.status < 300 };
}

export async function unsubscribeMessage(mail, { account, mailbox, id }, { post = postOneClick, assertHost = assertPublicHost } = {}) {
  const message = await mail.inspectMessage({ account, mailbox, id });
  const parsed = parseUnsubscribe(message.headers);
  if (!parsed.http && !parsed.mailto) {
    throw new Error('Esta mensagem não tem o cabeçalho List-Unsubscribe. Não há descadastro automático.');
  }

  if (parsed.oneClick && parsed.http) {
    const url = publicHttpsUrl(parsed.http);
    await assertHost(url);
    const result = await post(url);
    if (!result.ok) {
      throw new Error(`A lista respondeu HTTP ${result.status}. O descadastro não foi confirmado.`);
    }
    return {
      unsubscribed: true,
      method: 'one-click',
      host: url.hostname,
      status: result.status,
      subject: message.subject,
    };
  }

  if (parsed.mailto) {
    const target = parseMailto(parsed.mailto);
    if (!target.to || !target.to.includes('@')) {
      throw new Error('O mailto de descadastro não tem um endereço válido.');
    }
    const accounts = await mail.listAccounts();
    const from = senderFor(accounts, account);
    await mail.sendMessage({
      from,
      to: [target.to],
      cc: [],
      bcc: [],
      subject: target.subject,
      body: target.body,
      attachments: [],
    });
    return {
      unsubscribed: true,
      method: 'mailto',
      to: target.to,
      from,
      subject: message.subject,
    };
  }

  return {
    unsubscribed: false,
    method: 'link',
    host: publicHttpsUrl(parsed.http).hostname,
    note: 'A lista publicou um link https sem One-Click. O Selo não abre esse link. Conclua o descadastro no Mail.',
  };
}

function senderFor(accounts, account) {
  const wanted = String(account).toLowerCase();
  const match = accounts.find((item) => {
    if (String(item.name).toLowerCase() === wanted) return true;
    return (item.emails || []).some((email) => String(email).toLowerCase() === wanted);
  });
  const email = match?.emails?.[0];
  if (!email) throw new Error('Não achei um endereço desta conta para enviar o descadastro.');
  return email;
}
