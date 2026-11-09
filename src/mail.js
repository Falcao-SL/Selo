/**
 * Operações no Mail.app.
 *
 * Cada propriedade lida em JXA é um Apple Event. Listagens grandes leem em
 * lote (msgs.subject() devolve a coluna inteira num evento só).
 */

import { runJXA } from './jxa.js';

const PRELUDE = `
function getMail() {
  var Mail = Application('Mail');
  Mail.includeStandardAdditions = true;
  return Mail;
}

function resolveAccount(Mail, accountName) {
  var accounts = Mail.accounts;
  var names = accounts.name();
  var wanted = String(accountName).toLowerCase();
  for (var i = 0; i < names.length; i++) {
    if (String(names[i]).toLowerCase() === wanted) return accounts[i];
  }
  for (var j = 0; j < names.length; j++) {
    var addrs = accounts[j].emailAddresses();
    for (var k = 0; k < addrs.length; k++) {
      if (String(addrs[k]).toLowerCase() === wanted) return accounts[j];
    }
  }
  throw new Error('Conta "' + accountName + '" não encontrada. Disponíveis: ' + names.join(', '));
}

function resolveMailbox(Mail, accountName, mailboxName) {
  var acct = resolveAccount(Mail, accountName);
  var wanted = mailboxName || 'INBOX';
  var boxes = acct.mailboxes;
  try {
    var direct = boxes.byName(wanted);
    direct.name();
    return direct;
  } catch (e) { /* busca tolerante abaixo */ }

  var names = boxes.name();
  var hit = -1;
  for (var i = 0; i < names.length; i++) {
    if (String(names[i]).toLowerCase() === String(wanted).toLowerCase()) { hit = i; break; }
  }
  if (hit === -1 && /^(inbox|caixa de entrada)$/i.test(wanted)) {
    for (var j = 0; j < names.length; j++) {
      if (/^(inbox|caixa de entrada)$/i.test(String(names[j]))) { hit = j; break; }
    }
  }
  if (hit === -1) {
    throw new Error('Caixa "' + wanted + '" não existe em "' + accountName + '". Disponíveis: ' + names.join(', '));
  }
  return boxes.byName(names[hit]);
}

function findMessage(box, id) {
  var found = box.messages.whose({ id: id });
  if (found.length === 0) throw new Error('Mensagem id=' + id + ' não encontrada nesta caixa.');
  return found[0];
}

function iso(d) {
  try { return d ? new Date(d).toISOString() : null; } catch (e) { return null; }
}

var BULK_MAX = 1500;

function sortByDateDesc(rows) {
  rows.sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  return rows;
}

function bulkRows(msgs, accountName, mailboxName) {
  var ids = msgs.id();
  var subjects = msgs.subject();
  var senders = msgs.sender();
  var dates = msgs.dateReceived();
  var reads = msgs.readStatus();
  var rows = [];
  for (var i = 0; i < ids.length; i++) {
    rows.push({
      id: ids[i],
      account: accountName,
      mailbox: mailboxName,
      subject: subjects[i] || '(sem assunto)',
      from: senders[i] || '',
      date: iso(dates[i]),
      unread: reads[i] === false
    });
  }
  return rows;
}

function collectMessages(msgs, limit, accountName, mailboxName, unreadOnly) {
  var total = msgs.length;
  if (total === 0) return { total: 0, matched: 0, items: [] };

  if (total <= BULK_MAX) {
    var rows = bulkRows(msgs, accountName, mailboxName);
    if (unreadOnly) rows = rows.filter(function (r) { return r.unread; });
    return { total: total, matched: rows.length, items: sortByDateDesc(rows).slice(0, limit) };
  }

  var ids = msgs.id();
  var dates = msgs.dateReceived();
  var reads = msgs.readStatus();
  var light = [];
  for (var i = 0; i < ids.length; i++) {
    if (unreadOnly && reads[i] !== false) continue;
    light.push({ idx: i, id: ids[i], date: iso(dates[i]), unread: reads[i] === false });
  }
  var chosen = sortByDateDesc(light).slice(0, limit);
  var items = [];
  for (var k = 0; k < chosen.length; k++) {
    var r = chosen[k];
    var subject = '(indisponível)';
    var from = '';
    try {
      var m = msgs[r.idx];
      subject = m.subject() || '(sem assunto)';
      from = m.sender() || '';
    } catch (e) {}
    items.push({
      id: r.id,
      account: accountName,
      mailbox: mailboxName,
      subject: subject,
      from: from,
      date: r.date,
      unread: r.unread
    });
  }
  return { total: total, matched: light.length, items: items };
}

function senderAddress(Mail, from) {
  if (!from) return null;
  var accounts = Mail.accounts;
  var names = accounts.name();
  var wanted = String(from).toLowerCase();
  for (var i = 0; i < names.length; i++) {
    var addrs = accounts[i].emailAddresses();
    for (var j = 0; j < addrs.length; j++) {
      if (String(addrs[j]).toLowerCase() === wanted) return addrs[j];
    }
  }
  throw new Error('"' + from + '" não é um endereço configurado no Mail.');
}

function pause(seconds) {
  try {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.delay(seconds);
  } catch (e) {}
}

function sendOutgoing(Mail, out) {
  try {
    out.send();
    return 'out.send()';
  } catch (e) {
    Mail.send(out);
    return 'Mail.send(out)';
  }
}

function attachAll(Mail, out, paths) {
  for (var i = 0; i < paths.length; i++) {
    try {
      out.attachments.push(Mail.Attachment({ fileName: Path(paths[i]) }));
    } catch (e1) {
      try {
        Mail.make({ new: 'attachment', withProperties: { fileName: Path(paths[i]) }, at: out });
      } catch (e2) {
        throw new Error('Não foi possível anexar ' + paths[i] + '.');
      }
    }
  }
}

function fillRecipients(Mail, out, to, cc, bcc) {
  for (var t = 0; t < to.length; t++) out.toRecipients.push(Mail.ToRecipient({ address: to[t] }));
  for (var c = 0; c < cc.length; c++) out.ccRecipients.push(Mail.CcRecipient({ address: cc[c] }));
  for (var b = 0; b < bcc.length; b++) out.bccRecipients.push(Mail.BccRecipient({ address: bcc[b] }));
}

function verifyMoved(box, countBefore, ids) {
  var now = box.messages.id();
  var set = {};
  for (var i = 0; i < now.length; i++) set[now[i]] = true;
  var left = [];
  for (var j = 0; j < ids.length; j++) if (set[ids[j]]) left.push(ids[j]);
  var gone = Math.min(ids.length - left.length, Math.max(0, countBefore - now.length));
  return { left: left, gone: gone };
}

var MOVE_IGNORED = 'O Mail aceitou o comando, mas a mensagem não saiu da caixa. Em algumas contas Microsoft o script não move; no Gmail a mensagem pode continuar na entrada.';

function resolveTrash(Mail, accountName) {
  var acct = resolveAccount(Mail, accountName);
  var boxes = acct.mailboxes;
  var names = boxes.name();
  var candidates = ['trash', 'deleted messages', 'deleted items', 'lixeira', 'itens excluídos', 'itens excluidos', 'lixo', 'bin'];
  for (var i = 0; i < names.length; i++) {
    if (candidates.indexOf(String(names[i]).toLowerCase()) !== -1) return boxes.byName(names[i]);
  }
  return null;
}

function resolveArchive(Mail, accountName) {
  var acct = resolveAccount(Mail, accountName);
  var boxes = acct.mailboxes;
  var names = boxes.name();
  var candidates = ['archive', 'arquivo'];
  for (var i = 0; i < names.length; i++) {
    if (candidates.indexOf(String(names[i]).toLowerCase()) !== -1) return boxes.byName(names[i]);
  }
  throw new Error('A conta não tem caixa Archive ou Arquivo. Caixas: ' + names.join(', '));
}

function fileExtension(name) {
  var dot = String(name || '').lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  var raw = name.slice(dot + 1).toLowerCase();
  if (raw.length > 16) return '';
  for (var i = 0; i < raw.length; i++) {
    var c = raw.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) return '';
  }
  return raw;
}
`;

const run = (fn, args, opts = {}) => runJXA(fn, args, { ...opts, prelude: PRELUDE });

export function listAccounts() {
  return run(function () {
    var Mail = getMail();
    var accounts = Mail.accounts;
    var names = accounts.name();
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var account = accounts[i];
      out.push({
        name: names[i],
        emails: account.emailAddresses(),
        enabled: account.enabled(),
      });
    }
    return out;
  });
}

export function listMailboxes({ account } = {}) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var accountNames = ARGS.account ? [ARGS.account] : Mail.accounts.name();
      var result = [];
      for (var i = 0; i < accountNames.length; i++) {
        var acct = resolveAccount(Mail, accountNames[i]);
        var boxes = acct.mailboxes;
        var names = boxes.name();
        var unread = boxes.unreadCount();
        var list = [];
        for (var j = 0; j < names.length; j++) {
          list.push({ name: names[j], unread: unread[j] || 0 });
        }
        result.push({ account: acct.name(), mailboxes: list });
      }
      return result;
    },
    { account: account || null },
  );
}

export function unreadSummary() {
  return run(function () {
    var Mail = getMail();
    var accounts = Mail.accounts;
    var names = accounts.name();
    var out = [];
    var grandTotal = 0;

    for (var i = 0; i < names.length; i++) {
      var acct = accounts[i];
      var boxes = acct.mailboxes;
      var boxNames = boxes.name();
      var counts = boxes.unreadCount();
      var accountTotal = 0;
      var inboxUnread = 0;
      var hot = [];

      for (var j = 0; j < boxNames.length; j++) {
        var count = counts[j] || 0;
        accountTotal += count;
        if (/^(inbox|caixa de entrada)$/i.test(String(boxNames[j]))) inboxUnread = count;
        if (count > 0) hot.push({ mailbox: boxNames[j], unread: count });
      }

      hot.sort(function (a, b) { return b.unread - a.unread; });
      grandTotal += accountTotal;
      out.push({
        account: names[i],
        emails: acct.emailAddresses(),
        inboxUnread: inboxUnread,
        totalUnread: accountTotal,
        mailboxesWithUnread: hot.slice(0, 8),
      });
    }

    return { totalUnread: grandTotal, accounts: out };
  });
}

export function searchMessages({ query, account, mailbox, limit = 25, searchBody = false }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var accountNames = ARGS.account ? [ARGS.account] : Mail.accounts.name();
      var all = [];
      var scanned = [];

      for (var i = 0; i < accountNames.length; i++) {
        var acctName = accountNames[i];
        var boxNames = ARGS.mailbox ? [ARGS.mailbox] : ['INBOX'];
        for (var j = 0; j < boxNames.length; j++) {
          var box;
          try {
            box = resolveMailbox(Mail, acctName, boxNames[j]);
          } catch (e) {
            continue;
          }
          var condition = {
            _or: [
              { subject: { _contains: ARGS.query } },
              { sender: { _contains: ARGS.query } },
            ],
          };
          if (ARGS.searchBody) condition._or.push({ content: { _contains: ARGS.query } });
          var msgs = box.messages.whose(condition);
          var res = collectMessages(msgs, ARGS.limit, acctName, box.name(), false);
          scanned.push(acctName + '/' + box.name());
          all = all.concat(res.items);
        }
      }

      all.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      return {
        query: ARGS.query,
        scanned: scanned,
        found: all.length,
        messages: all.slice(0, ARGS.limit),
      };
    },
    { query, account: account || null, mailbox: mailbox || null, limit, searchBody },
    { timeout: 55_000 },
  );
}

export function readMessage({ account, mailbox = 'INBOX', id, maxChars = 20000 }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var body = '';
      try { body = msg.content() || ''; } catch (e) { body = '(não foi possível ler o corpo)'; }

      var truncated = false;
      if (body.length > ARGS.maxChars) {
        body = body.slice(0, ARGS.maxChars);
        truncated = true;
      }

      var attachments = [];
      try {
        var atts = msg.mailAttachments;
        var attNames = atts.name();
        var attSizes = atts.fileSize();
        for (var i = 0; i < attNames.length; i++) {
          attachments.push({ name: attNames[i], bytes: attSizes[i] });
        }
      } catch (e) {}

      var recipients = [];
      try { recipients = msg.toRecipients.address(); } catch (e) {}

      return {
        id: ARGS.id,
        account: ARGS.account,
        mailbox: box.name(),
        subject: msg.subject(),
        from: msg.sender(),
        to: recipients,
        date: iso(msg.dateReceived()),
        unread: msg.readStatus() === false,
        messageId: msg.messageId(),
        attachments: attachments,
        bodyTruncated: truncated,
        body: body,
      };
    },
    { account, mailbox, id, maxChars },
  );
}

export function listMessages({ account, mailbox = 'INBOX', limit = 25, unreadOnly = false }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var res = collectMessages(box.messages, ARGS.limit, ARGS.account, box.name(), ARGS.unreadOnly);
      return {
        account: ARGS.account,
        mailbox: box.name(),
        mailboxTotal: res.total,
        matched: res.matched,
        messages: res.items,
      };
    },
    { account, mailbox, limit, unreadOnly },
  );
}

export function inspectMessage({ account, mailbox = 'INBOX', id }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var headers = '';
      try { headers = String(msg.allHeaders() || ''); } catch (e) {}
      if (headers.length > 80000) headers = headers.slice(0, 80000);
      var body = '';
      try { body = msg.content() || ''; } catch (e) {}
      if (body.length > 20000) body = body.slice(0, 20000);
      var attachmentNames = [];
      try {
        var names = msg.mailAttachments.name();
        for (var i = 0; i < names.length && i < 40; i++) attachmentNames.push(String(names[i] || ''));
      } catch (e) {}
      var recipients = [];
      try { recipients = msg.toRecipients.address(); } catch (e) {}
      return {
        id: ARGS.id,
        account: ARGS.account,
        mailbox: box.name(),
        subject: msg.subject() || '',
        from: msg.sender() || '',
        to: recipients,
        date: iso(msg.dateReceived()),
        headers: headers,
        body: body,
        attachmentNames: attachmentNames,
      };
    },
    { account, mailbox, id },
  );
}

export function listAttachments({ account, mailbox = 'INBOX', id }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var atts = msg.mailAttachments;
      var names = atts.name();
      var sizes = atts.fileSize();
      var downloaded = [];
      try { downloaded = atts.downloaded(); } catch (e) {}
      var out = [];
      for (var i = 0; i < names.length && i < 100; i++) {
        var mime = null;
        try { mime = atts[i].MIMEType(); } catch (e) {}
        out.push({
          index: i,
          name: names[i],
          bytes: sizes[i],
          mimeType: mime,
          downloaded: downloaded.length > i ? downloaded[i] === true : null,
        });
      }
      return { id: ARGS.id, count: names.length, attachments: out };
    },
    { account, mailbox, id },
  );
}

export function saveAttachment({ account, mailbox = 'INBOX', id, index, expectName = null, dir, token, maxBytes, blockedExtensions }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var atts = msg.mailAttachments;
      var names = atts.name();
      var sizes = atts.fileSize();
      if (ARGS.index < 0 || ARGS.index >= names.length) {
        throw new Error('A mensagem tem ' + names.length + ' anexo(s). O índice ' + ARGS.index + ' não existe.');
      }
      var name = String(names[ARGS.index] || '');
      if (ARGS.expectName && name !== ARGS.expectName) {
        throw new Error('O anexo ' + ARGS.index + ' agora se chama "' + name + '". Liste os anexos de novo.');
      }
      var size = sizes[ARGS.index];
      if (typeof size !== 'number' || size < 0) {
        throw new Error('O Mail não informou o tamanho do anexo.');
      }
      if (size > ARGS.maxBytes) {
        throw new Error('O anexo tem ' + size + ' bytes. O limite desta chamada é ' + ARGS.maxBytes + '.');
      }
      var ext = fileExtension(name);
      if (ext && ARGS.blockedExtensions.indexOf(ext) !== -1) {
        throw new Error('Anexo .' + ext + ' não é baixado (programa, instalador ou script). Abra a mensagem no Mail se precisar dele.');
      }
      if (!/^[a-f0-9]+$/.test(ARGS.token)) throw new Error('Pasta de destino inválida.');
      var file = ext ? 'selo-' + ARGS.token + '.' + ext : 'selo-' + ARGS.token;
      var dest = ARGS.dir + '/' + file;
      Mail.save(atts[ARGS.index], { in: Path(dest) });
      return { saved: dest, originalName: name, bytes: size, extension: ext };
    },
    { account, mailbox, id, index, expectName, dir, token, maxBytes, blockedExtensions },
    { timeout: 55_000 },
  );
}

export function createDraft({ from, to, cc = [], bcc = [], subject, body, attachments = [] }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var sender = senderAddress(Mail, ARGS.from);
      var out = Mail.OutgoingMessage({ subject: ARGS.subject, content: ARGS.body, visible: true });
      Mail.outgoingMessages.push(out);
      if (sender) out.sender = sender;
      fillRecipients(Mail, out, ARGS.to, ARGS.cc, ARGS.bcc);
      attachAll(Mail, out, ARGS.attachments);
      return {
        draft: true,
        sent: false,
        from: sender,
        to: ARGS.to,
        cc: ARGS.cc,
        subject: ARGS.subject,
        attachments: ARGS.attachments.length,
        note: 'Rascunho aberto numa janela do Mail. Nada foi enviado.',
      };
    },
    { from: from || null, to, cc, bcc, subject, body, attachments },
  );
}

export function sendMessage({ from, to, cc = [], bcc = [], subject, body, attachments = [] }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var sender = senderAddress(Mail, ARGS.from);
      if (!sender) throw new Error('Informe o endereço remetente, que precisa ser uma conta do Mail.');
      var out = Mail.OutgoingMessage({ subject: ARGS.subject, content: ARGS.body, visible: false });
      Mail.outgoingMessages.push(out);
      out.sender = sender;
      fillRecipients(Mail, out, ARGS.to, ARGS.cc, ARGS.bcc);
      attachAll(Mail, out, ARGS.attachments);
      pause(0.3);
      var how = sendOutgoing(Mail, out);
      return {
        sent: true,
        via: how,
        from: sender,
        to: ARGS.to,
        cc: ARGS.cc,
        subject: ARGS.subject,
        attachments: ARGS.attachments.length,
      };
    },
    { from, to, cc, bcc, subject, body, attachments },
  );
}

export function replyMessage({ account, mailbox = 'INBOX', id, body, replyAll = false, attachments = [] }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var original = msg.subject();
      var recipient = msg.sender();
      var out = Mail.reply(msg, { openingWindow: false, replyToAll: ARGS.replyAll });
      pause(0.4);
      var quoted = '';
      try { quoted = out.content() || ''; } catch (e) {}
      out.content = ARGS.body + (quoted ? '\n\n' + quoted : '');
      attachAll(Mail, out, ARGS.attachments);
      pause(0.3);
      var how = sendOutgoing(Mail, out);
      return {
        sent: true,
        via: how,
        replyAll: ARGS.replyAll,
        to: recipient,
        subject: original,
        attachments: ARGS.attachments.length,
      };
    },
    { account, mailbox, id, body, replyAll, attachments },
  );
}

export function forwardMessage({ account, mailbox = 'INBOX', id, to, cc = [], body, attachments = [] }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var original = msg.subject();
      var out = Mail.forward(msg, { openingWindow: false });
      pause(0.4);
      var quoted = '';
      try { quoted = out.content() || ''; } catch (e) {}
      out.content = ARGS.body + (quoted ? '\n\n' + quoted : '');
      fillRecipients(Mail, out, ARGS.to, ARGS.cc, []);
      attachAll(Mail, out, ARGS.attachments);
      pause(0.3);
      var how = sendOutgoing(Mail, out);
      return { sent: true, via: how, to: ARGS.to, subject: original, attachments: ARGS.attachments.length };
    },
    { account, mailbox, id, to, cc, body, attachments },
  );
}

export function markMessage({ account, mailbox = 'INBOX', id, read = null, flagged = null }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var changed = [];
      if (ARGS.read !== null) { msg.readStatus = ARGS.read; changed.push(ARGS.read ? 'lida' : 'não lida'); }
      if (ARGS.flagged !== null) { msg.flaggedStatus = ARGS.flagged; changed.push(ARGS.flagged ? 'sinalizada' : 'sem sinalização'); }
      return { id: ARGS.id, subject: msg.subject(), changed: changed };
    },
    { account, mailbox, id, read, flagged },
  );
}

export function moveMessage({ account, mailbox = 'INBOX', id, targetMailbox }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var target = resolveMailbox(Mail, ARGS.account, ARGS.targetMailbox);
      var msg = findMessage(box, ARGS.id);
      var subject = msg.subject();
      var before = box.messages.length;
      Mail.move(msg, { to: target });
      pause(1);
      if (verifyMoved(box, before, [ARGS.id]).gone === 0) {
        return { id: ARGS.id, subject: subject, moved: false, error: MOVE_IGNORED };
      }
      return { id: ARGS.id, subject: subject, from: ARGS.mailbox, to: target.name(), moved: true };
    },
    { account, mailbox, id, targetMailbox },
  );
}

export function archiveMessage({ account, mailbox = 'INBOX', id }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var target = resolveArchive(Mail, ARGS.account);
      var msg = findMessage(box, ARGS.id);
      var subject = msg.subject();
      var before = box.messages.length;
      Mail.move(msg, { to: target });
      pause(1);
      if (verifyMoved(box, before, [ARGS.id]).gone === 0) {
        return { id: ARGS.id, subject: subject, archived: false, error: MOVE_IGNORED };
      }
      return { id: ARGS.id, subject: subject, archived: true, mailbox: target.name() };
    },
    { account, mailbox, id },
  );
}

export function trashMessage({ account, mailbox = 'INBOX', id }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var msg = findMessage(box, ARGS.id);
      var subject = msg.subject();
      var trash = resolveTrash(Mail, ARGS.account);
      if (trash) {
        var before = box.messages.length;
        Mail.move(msg, { to: trash });
        pause(1);
        if (verifyMoved(box, before, [ARGS.id]).gone === 0) {
          return { id: ARGS.id, subject: subject, trashed: false, error: MOVE_IGNORED };
        }
        return { id: ARGS.id, subject: subject, trashed: true, mailbox: trash.name(), recoverable: true };
      }
      msg.deletedStatus = true;
      return { id: ARGS.id, subject: subject, trashed: true, recoverable: true, via: 'deletedStatus' };
    },
    { account, mailbox, id },
  );
}

export function trashMessages({ account, mailbox = 'INBOX', ids }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var box = resolveMailbox(Mail, ARGS.account, ARGS.mailbox);
      var trash = resolveTrash(Mail, ARGS.account);
      var allIds = box.messages.id();
      var pos = {};
      for (var i = 0; i < allIds.length; i++) pos[allIds[i]] = i;
      var targets = [];
      var notFound = [];
      for (var k = 0; k < ARGS.ids.length; k++) {
        var id = ARGS.ids[k];
        if (Object.prototype.hasOwnProperty.call(pos, String(id))) targets.push({ id: id, idx: pos[id] });
        else notFound.push(id);
      }
      targets.sort(function (a, b) { return b.idx - a.idx; });
      var trashed = [];
      var failed = [];
      for (var t = 0; t < targets.length; t++) {
        try {
          var message = box.messages[targets[t].idx];
          if (trash) Mail.move(message, { to: trash });
          else message.deletedStatus = true;
          trashed.push(targets[t].id);
        } catch (e) {
          failed.push({ id: targets[t].id, error: String((e && e.message) || e) });
        }
      }
      return {
        requested: ARGS.ids.length,
        trashed: trashed.length,
        ids: trashed,
        failed: failed,
        notFound: notFound,
        recoverable: true,
        mailbox: trash ? trash.name() : null,
      };
    },
    { account, mailbox, ids },
    { timeout: 55_000 },
  );
}

export function createMailbox({ account, name }) {
  return run(
    function (ARGS) {
      var Mail = getMail();
      var acct = resolveAccount(Mail, ARGS.account);
      Mail.make({ new: 'mailbox', at: acct, withProperties: { name: ARGS.name } });
      return { account: acct.name(), created: ARGS.name };
    },
    { account, name },
  );
}
