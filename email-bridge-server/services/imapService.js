const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

class ImapService {
  /**
   * Erzeugt eine neue ImapFlow Client Instanz für Stalwart.
   */
  getClient() {
    const host = process.env.STALWART_HOST || 'localhost';
    const port = parseInt(process.env.STALWART_IMAP_PORT || '143', 10);
    const secure = process.env.STALWART_IMAP_SECURE === 'true' || port === 993;
    const user = process.env.STALWART_USER;
    const pass = process.env.STALWART_PASS;

    if (!user || !pass) {
      throw new Error('STALWART_USER und STALWART_PASS müssen in den Umgebungsvariablen konfiguriert sein.');
    }

    return new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
      logger: false, // Auf true setzen für ausführliches IMAP Debug-Logging
    });
  }

  /**
   * Sucht im Stalwart Postfach nach dem Gesendet-Ordner über das Special-Use Attribut '\Sent'.
   * Falls keines gefunden wird, wird IMAP_SENT_FOLDER oder 'Sent' als Fallback genutzt.
   */
  async findSentFolder(client) {
    const list = await client.list();
    for (const box of list) {
      if (box.specialUse && box.specialUse === '\\Sent') {
        return box.path;
      }
    }
    return process.env.IMAP_SENT_FOLDER || 'Sent';
  }

  /**
   * Speichert eine versendete E-Mail (RFC822 Buffer/String) im Gesendet-Ordner von Stalwart.
   * @param {Buffer|string} rawMessage RFC822 formatierte Nachricht
   */
  async appendToSent(rawMessage) {
    const client = this.getClient();
    try {
      await client.connect();
      const sentPath = await this.findSentFolder(client);
      
      const result = await client.append(sentPath, rawMessage, ['\\Seen']);
      console.log(`[IMAP Service] E-Mail erfolgreich im Ordner '${sentPath}' gespeichert. UID: ${result?.uid}`);
      return result;
    } catch (error) {
      console.error('[IMAP Service] Fehler beim Speichern in den Sent-Ordner:', error.message);
      throw error;
    } finally {
      await client.logout().catch(() => {});
    }
  }

  /**
   * Listet alle IMAP-Ordner / Mailboxes in Stalwart auf.
   */
  async getMailboxes() {
    const client = this.getClient();
    try {
      await client.connect();
      const list = await client.list();
      return list.map(box => ({
        path: box.path,
        name: box.name,
        delimiter: box.delimiter,
        specialUse: box.specialUse || null,
      }));
    } finally {
      await client.logout().catch(() => {});
    }
  }

  /**
   * Ruft Nachrichten aus einem Ordner (Standard: INBOX) ab.
   * @param {string} folder Ordnername (z.B. 'INBOX')
   * @param {number} limit Maximale Anzahl abzurufender Nachrichten
   */
  async getMessages(folder = 'INBOX', limit = 20) {
    const client = this.getClient();
    const messages = [];
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const total = client.mailbox.exists;
        if (total === 0) return [];

        const start = Math.max(1, total - limit + 1);
        const range = `${start}:${total}`;

        for await (const msg of client.fetch(range, { envelope: true, flags: true, uid: true })) {
          messages.push({
            uid: msg.uid,
            seq: msg.seq,
            flags: Array.from(msg.flags || []),
            subject: msg.envelope.subject || '(kein Betreff)',
            from: msg.envelope.from || [],
            to: msg.envelope.to || [],
            date: msg.envelope.date,
          });
        }
      } finally {
        lock.release();
      }
      // Neueste Nachrichten zuerst
      return messages.reverse();
    } finally {
      await client.logout().catch(() => {});
    }
  }

  /**
   * Ruft eine spezifische Nachricht per UID ab und parsed ihren Inhalt (Text, HTML, Anhänge).
   */
  async getMessageByUid(uid, folder = 'INBOX') {
    const client = this.getClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const msg = await client.fetchOne(uid, { source: true, flags: true, uid: true }, { uid: true });
        if (!msg) {
          return null;
        }

        const parsed = await simpleParser(msg.source);
        return {
          uid: msg.uid,
          flags: Array.from(msg.flags || []),
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          date: parsed.date,
          text: parsed.text,
          html: parsed.html || null,
          attachments: (parsed.attachments || []).map(att => ({
            filename: att.filename,
            contentType: att.contentType,
            size: att.size,
          })),
        };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }
}

module.exports = new ImapService();
