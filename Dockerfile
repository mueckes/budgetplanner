FROM node:20-alpine

# Build-Tools für better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src ./src

EXPOSE 3000
CMD ["npm", "start"]
