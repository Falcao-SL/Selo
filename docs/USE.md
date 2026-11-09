# How to use Selo

Selo is Apple Mail, on this Mac, for a coding agent. Cursor, Claude, Codex, or any MCP client asks, and Selo runs it in the Mail app you already use.

The accounts are the ones already set up in Mail. There is no password to paste, no IMAP, and no OAuth. macOS asks once for Automation permission.

Sending, replying, replying to all, forwarding, deleting, and unsubscribing really happen. Delete moves the message to Mail's Trash. You can recover it there. This server never erases a message permanently.

## What you need

- macOS, with the Mail app.
- At least one account already configured in Mail.
- Node.js 18 or newer (`node -v`).

Mail has to be open the first time. If it is quit, Selo says Mail is not running.

## 1. Get the code

```bash
git clone https://github.com/Falcao-SL/Selo.git
cd Selo
```

There is no `npm install`. The server has no dependencies.

## 2. Grant macOS permission

```bash
npm run doctor
```

The command lists the accounts Mail allowed it to see. If macOS blocks it, you get a warning or a permission prompt.

Manual path: System Settings → Privacy & Security → Automation. Enable Mail for the program that runs Selo (Terminal, Cursor, Claude, or node).

`npm run doctor` only reads the account list. It does not send or delete.

## 3. Connect an agent

Replace the path with the folder where you cloned the repository.

### Cursor

In `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "selo": {
      "command": "node",
      "args": ["/Users/you/Github/Falcao-SL/Selo/src/index.js"]
    }
  }
}
```

Reload Cursor's MCP servers. Selo shows up as `selo`.

### Claude Code

Same `mcpServers` block, in the project or in `~/.claude.json`.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`, inside `mcpServers`, with the same `command` and `args`. Quit Claude Desktop and open it again.

The server speaks only over stdin/stdout. Do not pick a port. Do not put a password in the JSON.

## 4. Ask in plain language

The agent picks the tool. These requests cover the mailbox:

- Which accounts are in Mail, and what are the addresses?
- What is unread?
- List the last 10 messages in the personal inbox.
- Search Apple messages about a receipt.
- Read message 12345 on the personal account.
- Does that message look suspicious?
- What are its attachments? Save the PDF.
- Open a draft to ana@example.com, subject "Tomorrow", body "Confirmed." Do not send it.
- Send that mail from eu@example.com.
- Reply to message 12345 with "Friday works."
- Reply all on message 12345.
- Forward message 12345 to joao@example.com.
- Attach `/Users/you/Documents/note.pdf` to that send.
- Mark message 12345 as read.
- Move message 12345 to the Archive mailbox.
- Archive message 12345.
- Delete message 12345.
- Unsubscribe from that message's list.

Say send, reply, forward, or delete in so many words. `create_draft` opens a window and stops. `send_message`, `reply_message`, `reply_all`, and `forward_message` send the mail out.

## 5. The tools

A message `id` comes from `list_messages` or `search_messages`. It is Mail's number, not the row on screen. An account accepts its name ("Personal") or its email address.

`limit` is 1 to 50. The default is 25. A read body stops at 20,000 characters, 40,000 at most.

### Read

`list_accounts` takes no arguments.

`list_mailboxes` takes an optional `account`. Without it, every account is listed.

`unread_summary` takes no arguments. It returns the total, the inbox, and up to eight mailboxes that have unread mail.

`list_messages` requires `account`. Optional: `mailbox` (default `INBOX`), `limit`, `unreadOnly`.

`search_messages` requires `query`. Optional: `account`, `mailbox`, `limit`, `searchBody`. With no mailbox, search stays in the inbox. `searchBody: true` also scans the body and is slower. The result has no body; call `read_message`.

`read_message` requires `account` and `id`. Optional: `mailbox`, `maxChars`. It returns subject, sender, recipients, date, attachment names and sizes, and the body. It does not write the file to disk.

`list_attachments` requires `account` and `id`. It returns `index`, name, bytes, and type.

`save_attachment` requires `account`, `id`, and `index`. Optional: `expectName` (the name you just saw; if the list changed, the call fails) and `directory` (an absolute folder inside your home folder). The default is `~/Downloads/Selo`. The saved file is named `selo-` plus an id, with the original extension. macOS marks it quarantined. Selo does not run the file.

Programs, installers, disk images, scripts, and HTML are not saved (`.app`, `.dmg`, `.pkg`, `.exe`, `.js`, `.sh`, `.html`, `.svg`, and the rest of the list in `src/files.js`). Zip files and macro spreadsheets are saved, and the reply includes a warning.

`check_message` requires `account` and `id`. It returns `verdict`: `ok`, `review`, or `suspicious`, plus the signals. It looks at SPF, DKIM, or DMARC failure, a reply-to on another domain, a different email hidden in the display name, a known brand name on a domain that is not that brand, urgent wording, an `http` or raw-IP link, and a risky attachment type. A message with none of these comes back `ok`. That does not prove the message is safe, and `suspicious` does not prove it is a scam.

### Write

Addresses are arrays: `"to": ["ana@example.com"]`. At most 20 per field. Attachments are absolute paths inside your home folder, at most 10 files, 20 MB each, 25 MB together.

`create_draft` requires `to`, `subject`, and `body`. Optional: `from`, `cc`, `bcc`, `attachments`. It opens a Mail window. The reply has `sent: false`.

`send_message` requires `from`, `to`, `subject`, and `body`. Optional: `cc`, `bcc`, `attachments`. `from` must be an address that already exists on a Mail account. The message goes out.

`reply_message` requires `account`, `id`, and `body`. Optional: `mailbox`, `attachments`. It replies only to the sender and sends. The original text is quoted under yours.

`reply_all` takes the same arguments and includes the other recipients.

`forward_message` requires `account`, `id`, `to`, and `body`. Optional: `cc`, `mailbox`, `attachments`. It sends the forward.

### Organize

`mark_message` requires `account` and `id`, and at least one of `read` and `flagged` (`true` or `false`).

`move_message` requires `account`, `id`, and `targetMailbox`. The destination mailbox must already exist on the same account. On some Microsoft accounts Mail accepts the command and does not move; the reply comes back `moved: false` with the reason. On Gmail the message can gain the label and stay in the inbox.

`archive_message` requires `account` and `id`. It looks for a mailbox named Archive or Arquivo. If there is none, it moves nothing.

`trash_message` requires `account` and `id`. It moves the message to Trash (Trash, Deleted Messages, Lixeira, Lixo, and the neighboring names). The reply has `recoverable: true`.

`trash_messages` requires `account` and `ids` (up to 100 numbers). Optional: `mailbox`.

`create_mailbox` requires `account` and `name`.

### Unsubscribe

`unsubscribe` requires `account` and `id`.

Selo reads the message's `List-Unsubscribe` header.

- If the list advertises One-Click (`List-Unsubscribe-Post`), Selo sends the standard `https` POST, on port 443, and stops when the list answers 200–299. It does not follow a redirect. It refuses an `http` link, another port, a username or password in the link, and a host that is local or that resolves into your network.
- If there is no One-Click and there is a `mailto`, Selo sends that unsubscribe through your account, via Mail. `bcc` and `cc` parameters on that mailto are ignored.
- If the list only published an `https` link, with no One-Click, Selo does not open the link. The reply says to finish it in Mail.

A message without that header is not unsubscribed. Selo does not hunt for an "unsubscribe" link in the body.

## When something fails

| What you see | What to do |
|---|---|
| Automation permission, error -1743 | Settings → Privacy & Security → Automation → Mail. Run `npm run doctor` again. |
| Mail is not running, error -600 | Open Mail. |
| Account or mailbox not found | `list_accounts` and `list_mailboxes`. The inbox name varies: INBOX, Inbox, Caixa de Entrada. |
| The message stayed in the mailbox | An account where Mail ignores a scripted move. Move it in Mail. |
| Attachment `.exe`, `.dmg`, `.html`… | Selo does not download that type. Open the message in Mail. |
| Unsubscribe with no `List-Unsubscribe` | That message is not a list with the standard header. |
| The operation passed 50s | Lower `limit`, or point at one mailbox. |

Local tests, which do not open Mail, are `npm test`.

## Privacy

Selo runs on your machine. There is no Selo account, no telemetry, and no password file. What leaves for the network is what you asked to leave: a message sent by Mail, or the One-Click unsubscribe POST to the address the list itself published.

The agent you connected can see the subject, body, and attachments you ask it to read.
