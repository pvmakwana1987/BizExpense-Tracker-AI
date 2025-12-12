# 1. Build the React Frontend
FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 2. Setup the Node.js Backend
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
# Copy the built React app from step 1
COPY --from=builder /app/dist ./dist

# 3. Start the server
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
