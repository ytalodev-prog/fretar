FROM node:24-alpine AS validation
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server/ ./server/
COPY public/ ./public/
COPY test/ ./test/
RUN npm test

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
WORKDIR /app
COPY --from=validation --chown=node:node /app/package.json ./
COPY --from=validation --chown=node:node /app/node_modules/ ./node_modules/
COPY --from=validation --chown=node:node /app/server/ ./server/
COPY --from=validation --chown=node:node /app/public/ ./public/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
