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

RUN mkdir -p data/db data/uploads && chown -R node:node /app

ENV NODE_ENV=production
ENV DB_PATH=/app/data/db/sitevigil.db
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

USER node

CMD ["node", "server.js"]
