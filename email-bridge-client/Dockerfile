# Leichtgewichtige Node.js Alpine-Version
FROM node:20-alpine

# Arbeitsverzeichnis im Container
WORKDIR /usr/src/app

# Abhängigkeiten kopieren und installieren
COPY package*.json ./
RUN npm ci --only=production

# Anwendungs-Code kopieren
COPY . .

# Port freigeben
EXPOSE 3000

# Client-Service starten
CMD [ "npm", "start" ]
