#!/bin/sh
mkdir -p /app/data/db /app/data/uploads
chown -R node:node /app/data
if [ ! -f /app/data/db/sitevigil.db ]; then
  cp /app/seed/sitevigil.db /app/data/db/sitevigil.db
  echo "Seed database copied to volume"
fi
chown -R node:node /app/data
exec su -s /bin/sh node -c "node server.js"