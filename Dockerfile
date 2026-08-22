FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm install --no-save @typescript/typescript-linux-x64@7.0.2
COPY tsconfig.json ./
COPY src ./src
RUN npm run check

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY agent ./agent
COPY config/cloud.example.json ./config/cloud.example.json
RUN mkdir -p /app/.agent-runtime
CMD ["npm","start"]
