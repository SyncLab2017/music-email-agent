FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm install tsx typescript --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV SQLITE_PATH=/data/state.db
ENV NODE_OPTIONS=--experimental-sqlite
EXPOSE 8080

CMD ["npx", "tsx", "src/index.ts"]
