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

RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV DB_PATH=/app/data/db/sitevigil.db
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

RUN echo '#!/bin/sh' > /docker-entrypoint.sh && \
    echo 'mkdir -p /app/data/db /app/data/uploads' >> /docker-entrypoint.sh && \
    echo 'chown -R node:node /app/data' >> /docker-entrypoint.sh && \
    echo 'exec su -s /bin/sh node -c "node server.js"' >> /docker-entrypoint.sh && \
    chmod +x /docker-entrypoint.sh

CMD ["/bin/sh", "/docker-entrypoint.sh"]
