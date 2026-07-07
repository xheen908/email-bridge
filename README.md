# 🛰️ Email Bridge (Node.js & Stalwart Mail Server)

Dieses Repository beinhaltet die **Email Bridge Architektur** zur Entkopplung und sicheren Übermittlung von E-Mails aus Docker-Netzwerken (wie **openPOS**) über einen externen Mail-VPS, auf dem der **Stalwart Mail Server** betrieben wird.

## 🏗️ Architektur

Die Architektur besteht aus zwei Kern-Komponenten:

```
[ openPOS Docker Stack ]                           [ Internet / HTTPS ]                         [ Mail VPS ]
+----------------------+                                                                      +--------------------+
|  auth-service        | ---\                                                                 |                    |
|  booking-service     | ----> [ email-bridge-client ] === (POST /send via HTTPS) ====> [ email-bridge-server ] ---> [ Stalwart SMTP / IMAP ]
|  weitere Microserv.  | ---/    (Port 3000 intern)                                           |  (Port 3000 intern)|
+----------------------+                                                                      +--------------------+
```

### 1. `email-bridge-server` (Für den Mail VPS)
Ein Express.js REST-Service, der direkt auf dem Mail-VPS läuft und lokal mit dem **Stalwart Mail Server** kommuniziert:
- **SMTP**: Versendet E-Mails via STARTTLS / TLS.
- **IMAP**: Synchronisiert versendete E-Mails automatisch in den Stalwart Special-Use Ordner `\Sent` (Gesendet).
- **API-Sicherheit**: Absicherung aller Endpunkte über einen geheimen Header (`X-API-Key`) sowie integriertes Rate-Limiting gegen Brute-Force und DDoS.

### 2. `email-bridge-client` (Für den Docker Stack / openPOS)
Ein leichtgewichtiger Express.js Proxy-Service im lokalen Docker-Netzwerk:
- **Lokale API**: Nimmt Sendeaufträge unter `POST http://email-bridge-client:3000/send` entgegen, ohne dass benachbarte Services Zugangsdaten oder SSL-Zertifikate kennen müssen.
- **Exponential Backoff**: Automatisches Wiederholen (Retry-Logik) bei kurzzeitigen Verbindungsabbrechen oder Netzwerkfehlern zum Mail-VPS.

---

## 🚀 Schnelleinrichtung

### 1. Server auf dem Mail-VPS starten
```bash
cd email-bridge-server
cp .env.example .env
# .env bearbeiten und Stalwart-Zugangsdaten sowie BRIDGE_API_KEY eintragen
docker compose up -d --build
```

### 2. Client im openPOS Stack integrieren
In openPOS ist der Client nativ im Backend verankert (`./backend/email-bridge-client`).
Konfiguriere in openPOS die Umgebungsvariablen:
```env
EMAIL_BRIDGE_REMOTE_URL=https://mail.deinedomain.de/api/v1
EMAIL_BRIDGE_API_KEY=dein_geheimer_bridge_api_key
```

---

## 🔒 Sicherheit & Datenschutz
Alle sensiblen `.env` Dateien sind per `.gitignore` ausgeschlossen und werden niemals in Versioning-Systeme (wie GitHub) hochgeladen. Bitte nutze ausschließlich `.env.example` als Vorlage für neue Deployments.
