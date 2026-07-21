FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'mkdir -p /app/data/db /app/data/uploads' >> /entrypoint.sh && \
    echo 'chown -R node:node /app/data' >> /entrypoint.sh && \
    echo 'if [ ! -f /app/data/db/sitevigil.db ]; then' >> /entrypoint.sh && \
    echo '  cp /app/seed/sitevigil.db /app/data/db/sitevigil.db' >> /entrypoint.sh && \
    echo '  echo "Seed database: no existing DB, copied fresh"' >> /entrypoint.sh && \
    echo 'else' >> /entrypoint.sh && \
    echo '  result=$(sqlite3 /app/data/db/sitevigil.db "PRAGMA integrity_check;" 2>&1)' >> /entrypoint.sh && \
    echo '  if [ "$result" != "ok" ]; then' >> /entrypoint.sh && \
    echo '    cp /app/seed/sitevigil.db /app/data/db/sitevigil.db' >> /entrypoint.sh && \
    echo '    echo "Seed database: corrupt DB replaced with fresh copy"' >> /entrypoint.sh && \
    echo '  else' >> /entrypoint.sh && \
    echo '    echo "Seed database: existing DB is healthy, keeping it"' >> /entrypoint.sh && \
    echo '  fi' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo 'chown -R node:node /app/data' >> /entrypoint.sh && \
    echo 'exec su -s /bin/sh node -c "node server.js"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV DB_PATH=/app/data/db/sitevigil.db
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

CMD ["/bin/sh", "/entrypoint.sh"]
