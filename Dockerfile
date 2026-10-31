FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/var && chown node:node /app/var
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node data ./data
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/var
EXPOSE 3000
CMD ["node", "--use-env-proxy", "src/server.mjs"]
