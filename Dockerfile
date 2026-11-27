FROM node:22-alpine AS client
WORKDIR /app
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --omit=dev
COPY server/ ./server/
COPY --from=client /app/dist ./client/dist
EXPOSE 3001
CMD ["node", "server/index.js"]
