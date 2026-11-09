import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = MAX_FILE_BYTES;

export const BLOCKED_EXTENSIONS = [
  'app', 'action', 'workflow', 'pkg', 'mpkg', 'dmg', 'iso', 'img', 'jar',
  'exe', 'msi', 'scr', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'js', 'jse', 'sh',
  'command', 'scpt', 'applescript', 'html', 'htm', 'svg', 'webloc', 'inetloc',
];

const ACTIVE_EXTENSIONS = new Set(['zip', '7z', 'rar', 'docm', 'xlsm', 'pptm']);

const CLOSED_DIRS = [
  `${path.sep}Library${path.sep}Keychains`,
  `${path.sep}Library${path.sep}Mail`,
  `${path.sep}.ssh`,
  `${path.sep}.aws`,
  `${path.sep}.gnupg`,
];

function insideHome(target) {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(target);
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new Error('Este caminho precisa estar dentro da sua pasta pessoal.');
  }
  if (CLOSED_DIRS.some((dir) => resolved.includes(dir))) {
    throw new Error('Este caminho fica numa pasta fechada (Mail, chaves ou segredos).');
  }
  return resolved;
}

export function resolveAttachmentPaths(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('"attachments" precisa ser uma lista de caminhos.');
  if (value.length > MAX_FILES) throw new Error(`No máximo ${MAX_FILES} anexos.`);
  let total = 0;
  return value.map((item) => {
    if (typeof item !== 'string' || !path.isAbsolute(item)) {
      throw new Error('Cada anexo precisa ser um caminho absoluto.');
    }
    const resolved = insideHome(item);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error(`Arquivo não encontrado: ${resolved}`);
    }
    if (!stat.isFile()) throw new Error(`Anexo não é um arquivo: ${resolved}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Anexo passa de 20 MB: ${resolved}`);
    total += stat.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('A soma dos anexos passa de 25 MB.');
    return resolved;
  });
}

export function prepareSaveDir(directory) {
  const dir = directory
    ? insideHome(directory)
    : path.join(os.homedir(), 'Downloads', 'Selo');
  insideHome(dir);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, token: randomBytes(8).toString('hex') };
}

export function attachmentWarning(extension) {
  if (!extension) return null;
  if (ACTIVE_EXTENSIONS.has(extension)) {
    return `Arquivo .${extension}: compactado ou com macro. Abra só se você esperava este anexo.`;
  }
  return null;
}

export async function quarantine(file) {
  const stamp = `0081;${Math.floor(Date.now() / 1000).toString(16)};Selo;`;
  await execFileAsync('xattr', ['-w', 'com.apple.quarantine', stamp, file]);
}
