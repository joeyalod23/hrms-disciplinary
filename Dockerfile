FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DB_PATH=/app/data/db/sitevigil.db
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

CMD ["sh", "-c", "mkdir -p /app/data/db /app/data/uploads && chown -R node:node /app/data && cp /app/seed/sitevigil.db /app/data/db/sitevigil.db && chown -R node:node /app/data && exec su -s /bin/sh node -c 'node server.js'"]
