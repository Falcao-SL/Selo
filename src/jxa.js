/**
 * Ponte com o Mail.app via osascript (JavaScript for Automation).
 *
 * A função roda dentro do osascript. O resultado volta em JSON. Nada do Node
 * atravessa essa fronteira.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 50_000;
const MAX_BUFFER = 32 * 1024 * 1024;

export class JXAError extends Error {
  constructor(message, { code = null, hint = null, stderr = null } = {}) {
    super(message);
    this.name = 'JXAError';
    this.code = code;
    this.hint = hint;
    this.stderr = stderr;
  }
}

function interpretError(rawMessage, stderr) {
  const text = `${rawMessage || ''} ${stderr || ''}`;

  if (text.includes('-1743') || /not authoriz/i.test(text)) {
    return new JXAError(
      'O macOS bloqueou o acesso ao Mail.app por falta de permissão de automação.',
      {
        code: -1743,
        hint:
          'Abra Ajustes do Sistema → Privacidade e Segurança → Automação e ative o Mail ' +
          'para o app que roda este servidor. Se o pedido não aparecer, rode `npm run doctor`.',
        stderr,
      },
    );
  }

  if (text.includes('-600') || /isn'?t running/i.test(text)) {
    return new JXAError('O Mail.app não está em execução.', {
      code: -600,
      hint: 'Abra o Mail e tente de novo.',
      stderr,
    });
  }

  if (text.includes('-1728')) {
    return new JXAError('Conta, caixa ou mensagem não encontrada no Mail.', {
      code: -1728,
      hint: 'Confira o nome com list_accounts e list_mailboxes.',
      stderr,
    });
  }

  return new JXAError(rawMessage || 'Falha ao executar o script no Mail.app', { stderr });
}

function buildScript(fn, args, prelude) {
  return `
    ${prelude}
    var ARGS = ${JSON.stringify(args)};
    var __run = ${fn.toString()};
    var __out;
    try {
      __out = { ok: true, data: __run(ARGS) };
    } catch (err) {
      __out = {
        ok: false,
        error: String((err && err.message) || err),
        errorNumber: (err && err.errorNumber) || null
      };
    }
    JSON.stringify(__out);
  `;
}

export async function runJXA(fn, args = {}, { timeout = DEFAULT_TIMEOUT_MS, prelude = '' } = {}) {
  const script = buildScript(fn, args, prelude);
  let stdout;
  try {
    ({ stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], {
      timeout,
      maxBuffer: MAX_BUFFER,
    }));
  } catch (err) {
    if (err.killed || err.signal === 'SIGTERM') {
      throw new JXAError(`A operação passou de ${Math.round(timeout / 1000)}s e foi cancelada.`, {
        hint: 'Reduza o limit ou aponte para uma caixa específica.',
      });
    }
    throw interpretError(err.message, err.stderr);
  }

  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    throw new JXAError('O Mail.app não retornou nada.', {
      hint: 'Verifique se o Mail está aberto e se a conta existe.',
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new JXAError('Resposta do Mail.app em formato inesperado.', { stderr: trimmed.slice(0, 500) });
  }

  if (!parsed.ok) throw interpretError(parsed.error, null);
  return parsed.data;
}

export async function assertMacOS() {
  try {
    await execFileAsync('osascript', ['-e', 'return 1']);
  } catch {
    throw new JXAError('O Selo só funciona no macOS: o comando osascript não foi encontrado.');
  }
}
