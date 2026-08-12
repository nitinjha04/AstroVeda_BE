FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
# npm ci requires a lockfile fully in sync with package.json (use npm install locally after dep changes)
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p uploads logs

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5000/api/v1/health || exit 1

CMD ["node", "src/server.js"]
