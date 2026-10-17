# Juego + servidor propio (server/) en una sola imagen.
#   docker compose up -d --build
# 1) Se empaqueta el juego como para publicarlo (tools/build.js, sin SEO: la web oficial es pokesurvivor.com).
FROM node:24-alpine AS juego
WORKDIR /src
COPY . .
RUN node tools/build.js --sin-seo \
 && rm -rf server tools docs .github dev.html *.md firebase.json firestore.* database.rules.json CNAME .firebaserc

# 2) El servidor sirve esa carpeta y la API.
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data STATIC_DIR=/app/site
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/*.js ./
COPY --from=juego /src /app/site
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "index.js"]
