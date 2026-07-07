const nodemailer = require('nodemailer');

class SmtpService {
  constructor() {
    this.transporter = null;
    this.init();
  }

  init() {
    const host = process.env.STALWART_HOST || 'localhost';
    const port = parseInt(process.env.STALWART_SMTP_PORT || '25', 10);
    const secure = process.env.STALWART_SMTP_SECURE === 'true' || port === 465;
    const user = process.env.STALWART_USER;
    const pass = process.env.STALWART_PASS;

    const config = {
      host,
      port,
      secure,
      tls: {
        // Bei Stalwart STARTTLS / TLS: Vertraue sauberen TLS-Zertifikaten (für Dev ggf. anpassbar)
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    };

    if (user && pass) {
      config.auth = { user, pass };
    }

    this.transporter = nodemailer.createTransport(config);
    console.log(`[SMTP Service] Initialisiert für Stalwart auf ${host}:${port} (Secure: ${secure})`);
  }

  /**
   * Versendet eine E-Mail über den Stalwart SMTP Server.
   * @param {Object} options
   * @returns {Promise<Object>} info Nodemailer Versandinfo
   */
  async sendMail({ to, from, subject, text, html, attachments }) {
    if (!this.transporter) {
      this.init();
    }

    const sender = from || process.env.DEFAULT_FROM_EMAIL || process.env.STALWART_USER;

    const mailOptions = {
      from: sender,
      to,
      subject,
      text,
      html,
      attachments,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[SMTP Service] E-Mail erfolgreich gesendet an ${to}. MessageId: ${info.messageId}`);
      return info;
    } catch (error) {
      console.error(`[SMTP Service] Fehler beim Senden an ${to}:`, error.message);
      throw error;
    }
  }

  /**
   * Erstellt eine RFC822 formatierte Mime-Nachricht (z.B. für IMAP Append in den Sent-Ordner).
   */
  async getRawMessage({ to, from, subject, text, html, attachments }) {
    const MailComposer = require('nodemailer/lib/mail-composer');
    const sender = from || process.env.DEFAULT_FROM_EMAIL || process.env.STALWART_USER;
    
    const mail = new MailComposer({
      from: sender,
      to,
      subject,
      text,
      html,
      attachments,
    });

    return new Promise((resolve, reject) => {
      mail.compile().build((err, message) => {
        if (err) return reject(err);
        resolve(message);
      });
    });
  }
}

module.exports = new SmtpService();
