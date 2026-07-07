# 🛰️ Email Bridge (Node.js & Stalwart Mail Server)

Dieses Repository beinhaltet eine eigenständige, robuste **Email Bridge Architektur** zur Entkopplung und sicheren Übermittlung von E-Mails aus geschlossenen Docker-Netzwerken oder lokalen Umgebungen über einen externen Mail-VPS, auf dem der **Stalwart Mail Server** betrieben wird.

## 🏗️ Architektur

Die Architektur besteht aus zwei Kern-Komponenten:

```
[ Lokaler Docker Stack / Client App ]                [ Internet / HTTPS ]                         [ Mail VPS ]
+-----------------------------------+                                                           +--------------------+
|  microservice-a                   | ---\                                                      |                    |
|  microservice-b                   | ----> [ email-bridge-client ] === (POST /send via HTTPS) => [ email-bridge-server ] ---> [ Stalwart SMTP / IMAP ]
|  weitere Container                | ---/    (Port 3000 intern)                                |  (Port 3000 intern)|
+-----------------------------------+                                                           +--------------------+
```

### 1. `email-bridge-server` (Für den Mail VPS)
Ein Express.js REST-Service, der direkt auf dem Mail-VPS läuft und lokal mit dem **Stalwart Mail Server** kommuniziert:
- **SMTP**: Versendet E-Mails sicher via STARTTLS / TLS.
- **IMAP**: Synchronisiert versendete E-Mails automatisch in den Stalwart Special-Use Ordner `\Sent` (Gesendet).
- **API-Sicherheit**: Absicherung aller Endpunkte über einen geheimen Header (`X-API-Key`) sowie integriertes Rate-Limiting gegen Brute-Force und DDoS.

### 2. `email-bridge-client` (Für lokale Docker Stacks / App-Netzwerke)
Ein leichtgewichtiger Express.js Proxy-Service als Microservice für dein lokales Docker-Netzwerk:
- **Lokale API**: Nimmt Sendeaufträge unter `POST http://email-bridge-client:3000/send` entgegen, ohne dass benachbarte Services im Container-Netzwerk externen SSL-Zertifikate oder Stalwart-Passwörtern ausgesetzt werden müssen.
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

### 2. Client im lokalen Docker Stack einbinden
Füge den Client in deine lokale `docker-compose.yml` ein:
```yaml
services:
  email-bridge-client:
    build: ./email-bridge-client
    environment:
      PORT: 3000
      REMOTE_SERVER_URL: https://mail.deinedomain.de/api/v1
      REMOTE_API_KEY: dein_geheimer_bridge_api_key
    restart: unless-stopped
```

Andere Container in deinem Stack können nun ganz einfach Mails über HTTP versenden:
```bash
curl -X POST http://email-bridge-client:3000/send \
     -H "Content-Type: application/json" \
     -d '{"to":"empfaenger@example.com", "subject":"Test", "text":"Hallo Welt"}'
```

---

## 🔒 Sicherheit & Datenschutz
Alle sensiblen `.env` Dateien sind per `.gitignore` ausgeschlossen und werden niemals in Versioning-Systeme hochgeladen. Nutze ausschließlich `.env.example` als Vorlage für neue Deployments.
