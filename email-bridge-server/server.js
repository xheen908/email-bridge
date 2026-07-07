require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const smtpService = require('./services/smtpService');
const imapService = require('./services/imapService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' })); // Größere Payloads für E-Mail Anhänge erlauben

// Rate Limiting (Schutz vor Spam / DoS auf dem Mail-VPS)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 300, // max 300 Anfragen pro IP pro Fenster
  message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
});
app.use('/api/', limiter);

// Authentifizierungs-Middleware via X-API-Key Header oder Authorization Bearer Token
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
  const expectedKey = process.env.BRIDGE_API_KEY;

  if (!expectedKey) {
    console.warn('[Security Warnung] BRIDGE_API_KEY ist in .env nicht gesetzt!');
    return next();
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Nicht autorisiert. Ungültiger oder fehlender API-Key.' });
  }

  next();
};

// Health Check (ohne Auth für Docker / Loadbalancer)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), server: 'email-bridge-server (Stalwart)' });
});

// Zod Validierungsschema für den Versand
const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  from: z.string().optional(),
  subject: z.string().min(1, 'Betreff darf nicht leer sein'),
  text: z.string().optional(),
  html: z.string().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.string().optional(), // Base64 kodierter String oder Text
    path: z.string().optional(),
    contentType: z.string().optional(),
  })).optional(),
  appendToSent: z.boolean().optional().default(true),
}).refine(data => data.text || data.html, {
  message: 'Es muss entweder ein Text- (text) oder ein HTML-Inhalt (html) angegeben werden.',
});

/**
 * @route POST /api/v1/send
 * @desc Versendet eine E-Mail via Stalwart SMTP und speichert sie optional per IMAP im Sent-Ordner
 */
app.post('/api/v1/send', authenticate, async (req, res) => {
  try {
    const validated = sendEmailSchema.parse(req.body);

    // 1. E-Mail über SMTP (Port 25/587) versenden
    const info = await smtpService.sendMail({
      to: validated.to,
      from: validated.from,
      subject: validated.subject,
      text: validated.text,
      html: validated.html,
      attachments: validated.attachments,
    });

    // 2. Optional: E-Mail per IMAP in den Stalwart "\Sent" Ordner kopieren
    let imapResult = null;
    if (validated.appendToSent) {
      try {
        const rawMessage = await smtpService.getRawMessage({
          to: validated.to,
          from: validated.from,
          subject: validated.subject,
          text: validated.text,
          html: validated.html,
          attachments: validated.attachments,
        });
        imapResult = await imapService.appendToSent(rawMessage);
      } catch (imapErr) {
        console.error('[Warnung] E-Mail gesendet, aber Speichern im IMAP Sent-Ordner fehlgeschlagen:', imapErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'E-Mail erfolgreich versendet',
      messageId: info.messageId,
      imapSent: !!imapResult,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validierungsfehler', details: error.errors });
    }
    console.error('[API Fehler /send]:', error);
    res.status(500).json({ error: 'Fehler beim E-Mail-Versand', details: error.message });
  }
});

/**
 * @route GET /api/v1/imap/mailboxes
 * @desc Listet alle verfügbaren IMAP-Ordner in Stalwart auf
 */
app.get('/api/v1/imap/mailboxes', authenticate, async (req, res) => {
  try {
    const mailboxes = await imapService.getMailboxes();
    res.json({ success: true, count: mailboxes.length, mailboxes });
  } catch (error) {
    console.error('[API Fehler /imap/mailboxes]:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Mailboxen', details: error.message });
  }
});

/**
 * @route GET /api/v1/imap/messages
 * @desc Ruft Nachrichten aus einem bestimmten Ordner (Default: INBOX) ab
 */
app.get('/api/v1/imap/messages', authenticate, async (req, res) => {
  try {
    const folder = req.query.folder || 'INBOX';
    const limit = parseInt(req.query.limit || '20', 10);

    const messages = await imapService.getMessages(folder, limit);
    res.json({ success: true, folder, count: messages.length, messages });
  } catch (error) {
    console.error('[API Fehler /imap/messages]:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Nachrichten', details: error.message });
  }
});

/**
 * @route GET /api/v1/imap/message/:uid
 * @desc Ruft eine spezifische E-Mail (inkl. Body) per UID ab
 */
app.get('/api/v1/imap/message/:uid', authenticate, async (req, res) => {
  try {
    const uid = parseInt(req.params.uid, 10);
    const folder = req.query.folder || 'INBOX';

    if (isNaN(uid)) {
      return res.status(400).json({ error: 'Ungültige UID.' });
    }

    const message = await imapService.getMessageByUid(uid, folder);
    if (!message) {
      return res.status(404).json({ error: `Nachricht mit UID ${uid} in '${folder}' nicht gefunden.` });
    }

    res.json({ success: true, message });
  } catch (error) {
    console.error(`[API Fehler /imap/message/${req.params.uid}]:`, error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Nachricht', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 email-bridge-server gestartet auf Port ${PORT}`);
  console.log(`🔒 API-Key Absicherung: ${process.env.BRIDGE_API_KEY ? 'AKTIV' : 'WARNUNG (nicht konfiguriert)'}`);
  console.log(`📬 Ziel Mail-Server: Stalwart auf ${process.env.STALWART_HOST || 'localhost'}`);
  console.log(`====================================================`);
});
