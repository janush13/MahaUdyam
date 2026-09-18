# syntax=docker/dockerfile:1

# ---- Base -----------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app

# ---- Dependencies (full, for building) -------------------------------------
FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# ---- Build ------------------------------------------------------------------
FROM base AS build
COPY package*.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Production dependencies only -------------------------------------------
FROM base AS production-dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Production runtime ------------------------------------------------------
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

RUN mkdir -p /app/storage && chown -R node:node /app/storage

EXPOSE 3000
USER node

CMD ["node", "dist/main.js"]
