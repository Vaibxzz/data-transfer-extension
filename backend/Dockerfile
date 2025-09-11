# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

# Runtime stage
FROM node:18-alpine
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8080
CMD ["node", "index.js"]
