/**
 * Leitura do cabeçalho, descadastro e sinais de mensagem suspeita.
 * Roda no Node, em cima do texto que o Mail devolveu. Não é antivírus.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BRANDS = [
  'apple', 'icloud', 'paypal', 'nubank', 'itau', 'bradesco', 'microsoft',
  'google', 'amazon', 'correios', 'receita', 'banco',
];

const URGENT = [
  'urgente', 'acao necessaria', 'ação necessária', 'sua conta sera', 'sua conta será',
  'confirme sua senha', 'atualize seu pagamento', 'verificar sua conta',
  'urgent', 'action required', 'verify your account', 'password expires',
  'wire transfer', 'gift card', 'suspend your account', 'unusual sign-in', 'unusual sign in',
];

const RISKY_EXTENSIONS = new Set([
  'app', 'pkg', 'dmg', 'iso', 'exe', 'msi', 'scr', 'bat', 'cmd', 'com', 'js', 'jse',
  'vbs', 'ps1', 'sh', 'command', 'apk', 'jar', 'html', 'htm', 'svg',
]);

export function unfoldHeaders(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
  }
  return out;
}

function headerValue(lines, name) {
  const prefix = `${name.toLowerCase()}:`;
  const found = lines.find((line) => line.toLowerCase().startsWith(prefix));
  return found ? found.slice(found.indexOf(':') + 1).trim() : '';
}

export function parseUnsubscribe(headerText) {
  const lines = unfoldHeaders(headerText);
  const value = headerValue(lines, 'list-unsubscribe');
  const post = headerValue(lines, 'list-unsubscribe-post');
  const out = { http: null, mailto: null, oneClick: /one-click/i.test(post) };
  const targets = value.match(/<([^>]+)>/g) || [];
  for (const target of targets) {
    const raw = target.slice(1, -1).trim();
    if (/^mailto:/i.test(raw) && !out.mailto) out.mailto = raw.replace(/^mailto:/i, '');
    else if (/^https:/i.test(raw) && !out.http) out.http = raw;
  }
  return out;
}

export function parseMailto(value) {
  const cleaned = String(value || '').replace(/^mailto:/i, '');
  const [addressPart, query = ''] = cleaned.split('?');
  const to = decodeURIComponent(addressPart || '').trim();
  const params = new URLSearchParams(query);
  params.delete('bcc');
  params.delete('cc');
  return {
    to,
    subject: params.get('subject') || 'Unsubscribe',
    body: params.get('body') || 'Unsubscribe',
  };
}

function privateAddress(host) {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (name === 'localhost' || name.endsWith('.local') || name.endsWith('.internal') || name.endsWith('.localhost')) {
    return true;
  }
  const kind = isIP(name);
  if (kind === 4) {
    const [a, b] = name.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (kind === 6) {
    if (name === '::1' || name.startsWith('fe80:') || name.startsWith('fc') || name.startsWith('fd')) return true;
  }
  return false;
}

export function publicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('O link de descadastro não é um endereço válido.');
  }
  if (url.protocol !== 'https:') throw new Error('O descadastro automático só aceita https.');
  if (url.username || url.password) throw new Error('O link de descadastro não pode trazer usuário ou senha.');
  if (url.port && url.port !== '443') throw new Error('O descadastro automático só aceita a porta 443.');
  if (privateAddress(url.hostname)) throw new Error('O link de descadastro aponta para um endereço local. Ele não foi chamado.');
  return url;
}

export async function assertPublicHost(url) {
  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((record) => privateAddress(record.address))) {
    throw new Error('O link de descadastro resolve para um endereço local. Ele não foi chamado.');
  }
  return url;
}

function senderParts(from) {
  const text = String(from || '').trim();
  const start = text.lastIndexOf('<');
  const end = text.lastIndexOf('>');
  if (start >= 0 && end > start) {
    return {
      name: text.slice(0, start).replaceAll('"', '').trim().toLowerCase(),
      address: text.slice(start + 1, end).trim().toLowerCase(),
    };
  }
  return { name: '', address: text.toLowerCase() };
}

function domainOf(address) {
  const at = String(address || '').lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

function fold(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

export function assessMessage({ from = '', subject = '', body = '', headers = '', attachmentNames = [] } = {}) {
  const lines = unfoldHeaders(headers);
  const sender = senderParts(from);
  const replyTo = senderParts(headerValue(lines, 'reply-to'));
  const auth = fold(headerValue(lines, 'authentication-results'));
  const signals = [];

  if (/spf=fail|dkim=fail|dmarc=fail/.test(auth)) {
    signals.push({ code: 'auth_fail', detail: 'O cabeçalho de autenticação traz SPF, DKIM ou DMARC com falha.' });
  } else if (/spf=softfail|dmarc=quarantine/.test(auth)) {
    signals.push({ code: 'auth_softfail', detail: 'A autenticação do remetente ficou em softfail ou quarantine.' });
  }

  const fromDomain = domainOf(sender.address);
  const replyDomain = domainOf(replyTo.address);
  if (replyDomain && fromDomain && replyDomain !== fromDomain) {
    signals.push({ code: 'reply_to_differs', detail: `A resposta iria para ${replyDomain}, e o remetente é ${fromDomain}.` });
  }

  const embedded = sender.name.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (embedded && embedded[0].toLowerCase() !== sender.address) {
    signals.push({ code: 'display_name_address', detail: 'O nome exibido traz um e-mail diferente do endereço de verdade.' });
  }

  const foldedName = fold(sender.name);
  const brand = BRANDS.find((item) => foldedName.includes(fold(item)));
  if (brand && fromDomain && !fromDomain.includes(brand.replace('í', 'i'))) {
    signals.push({ code: 'brand_name', detail: `O nome exibido cita "${brand}" e o domínio do remetente é ${fromDomain}.` });
  }

  const haystack = fold(`${subject}\n${body}`);
  const hits = URGENT.filter((phrase) => haystack.includes(fold(phrase)));
  if (hits.length) {
    signals.push({ code: 'urgent_language', detail: `O texto pressiona: ${hits.slice(0, 3).join(', ')}.` });
  }

  const urls = String(body).match(/https?:\/\/[^\s<>"']+/gi) || [];
  if (urls.some((url) => /^http:\/\//i.test(url))) {
    signals.push({ code: 'plain_http', detail: 'O corpo tem um link http, sem https.' });
  }
  if (urls.some((url) => /xn--|\d{1,3}(?:\.\d{1,3}){3}/.test(url))) {
    signals.push({ code: 'odd_link', detail: 'O corpo tem um link com IP cru ou punycode.' });
  }

  const risky = attachmentNames.filter((name) => {
    const ext = String(name).split('.').pop()?.toLowerCase();
    return ext && RISKY_EXTENSIONS.has(ext);
  });
  if (risky.length) {
    signals.push({ code: 'risky_attachment', detail: `Anexo de tipo arriscado: ${risky.join(', ')}.` });
  }

  let verdict = 'ok';
  const codes = new Set(signals.map((signal) => signal.code));
  if (codes.has('auth_fail') || codes.has('risky_attachment') || (codes.has('reply_to_differs') && codes.has('urgent_language')) || codes.has('display_name_address')) {
    verdict = 'suspicious';
  } else if (signals.length) {
    verdict = 'review';
  }

  return {
    verdict,
    signals,
    note: 'Heurística local, lida nesta mensagem. Não é antivírus e não prova que a mensagem seja segura.',
  };
}
