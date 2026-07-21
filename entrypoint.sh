#!/bin/sh
mkdir -p /app/data/db /app/data/uploads
chown -R node:node /app/data
exec su -s /bin/sh node -c "node server.js"
