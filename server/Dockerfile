FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json eslint.config.js ./
COPY sql ./sql
COPY src ./src
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/sql ./sql
CMD ["node","dist/index.js"]
