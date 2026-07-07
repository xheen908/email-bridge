require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 3000;
const REMOTE_SERVER_URL = process.env.REMOTE_SERVER_URL || 'http://localhost:3001/api/v1';
const REMOTE_API_KEY = process.env.REMOTE_API_KEY || '';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Optionale lokale Authentifizierung (für openPOS internes Netzwerk)
const localAuth = (req, res, next) => {
  const localKey = process.env.LOCAL_API_KEY;
  if (!localKey) return next();

  const apiKey = req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
  if (apiKey !== localKey) {
    return res.status(401).json({ error: 'Nicht autorisiert im lokalen openPOS Netzwerk.' });
  }
  next();
};

// Axios Instanz mit Standard-Headern für die Remote Bridge
const remoteClient = axios.create({
  baseURL: REMOTE_SERVER_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': REMOTE_API_KEY,
  },
  timeout: 30000, // 30 Sekunden Timeout
});

/**
 * Hilfsfunktion: Führt einen HTTP-Request mit automatischem Retry (Exponential Backoff) aus.
 */
async function requestWithRetry(requestFn, retries = MAX_RETRIES, delay = 1000) {
  try {
    return await requestFn();
  } catch (error) {
    const isNetworkOr5xx = !error.response || error.response.status >= 500;
    if (retries > 0 && isNetworkOr5xx) {
      console.warn(`[Retry] Fehler bei Verbindungsaufbau zur Bridge (${error.message}). Retries übrig: ${retries}. Warte ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return requestWithRetry(requestFn, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Health Check Endpunkt (prüft auch Verbindung zum Remote Server)
app.get('/health', async (req, res) => {
  let remoteStatus = 'UNKNOWN';
  try {
    const resp = await remoteClient.get('/health', { timeout: 5000 });
    remoteStatus = resp.data?.status || 'OK';
  } catch (err) {
    remoteStatus = `UNREACHABLE (${err.message})`;
  }

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'email-bridge-client (openPOS)',
    remoteBridge: remoteStatus,
  });
});

// Zod Validierungsschema für E-Mail-Versand
const sendSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  from: z.string().optional(),
  subject: z.string().min(1, 'Betreff erforderlich'),
  text: z.string().optional(),
  html: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  appendToSent: z.boolean().optional().default(true),
}).refine(data => data.text || data.html, {
  message: 'Text oder HTML Inhalt muss vorhanden sein.',
});

/**
 * @route POST /send (sowie Alias /api/email/send)
 * @desc Nimmt E-Mail-Aufträge aus openPOS entgegen und leitet sie mit Retry an die Bridge weiter
 */
const sendHandler = async (req, res) => {
  try {
    const validated = sendSchema.parse(req.body);

    if (!validated.from && process.env.DEFAULT_FROM_EMAIL) {
      validated.from = process.env.DEFAULT_FROM_EMAIL;
    }

    console.log(`[Email Client] Sende E-Mail "${validated.subject}" an ${validated.to}...`);

    const response = await requestWithRetry(() => remoteClient.post('/send', validated));

    res.status(200).json({
      success: true,
      forwarded: true,
      remoteResponse: response.data,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validierungsfehler im Client', details: error.errors });
    }
    
    const status = error.response?.status || 502;
    const details = error.response?.data || error.message;
    console.error(`[Email Client Fehler] Weiterleitung gescheitert:`, details);
    
    res.status(status).json({
      error: 'Fehler beim E-Mail-Versand über den Bridge Server',
      details,
    });
  }
};

app.post('/send', localAuth, sendHandler);
app.post('/api/email/send', localAuth, sendHandler);

/**
 * @route GET /imap/mailboxes
 * @desc Proxy: Abrufen der verfügbaren IMAP Ordner von Stalwart
 */
app.get('/imap/mailboxes', localAuth, async (req, res) => {
  try {
    const response = await requestWithRetry(() => remoteClient.get('/imap/mailboxes'));
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 502;
    res.status(status).json({ error: 'Fehler beim IMAP Mailbox Abruf', details: error.response?.data || error.message });
  }
});

/**
 * @route GET /imap/messages
 * @desc Proxy: Abrufen von Nachrichten aus dem Postfach
 */
app.get('/imap/messages', localAuth, async (req, res) => {
  try {
    const response = await requestWithRetry(() => remoteClient.get('/imap/messages', { params: req.query }));
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 502;
    res.status(status).json({ error: 'Fehler beim IMAP Nachrichten Abruf', details: error.response?.data || error.message });
  }
});

/**
 * @route GET /imap/message/:uid
 * @desc Proxy: Abrufen einer spezifischen Nachricht via UID
 */
app.get('/imap/message/:uid', localAuth, async (req, res) => {
  try {
    const response = await requestWithRetry(() => remoteClient.get(`/imap/message/${req.params.uid}`, { params: req.query }));
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 502;
    res.status(status).json({ error: 'Fehler beim IMAP Nachricht Abruf', details: error.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🛰️ email-bridge-client gestartet auf Port ${PORT}`);
  console.log(`🔗 Remote Bridge URL: ${REMOTE_SERVER_URL}`);
  console.log(`🔄 Max Retries bei Netzwerkfehler: ${MAX_RETRIES}`);
  console.log(`====================================================`);
});
