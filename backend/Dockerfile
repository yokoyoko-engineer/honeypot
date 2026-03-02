FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache bash python3 make g++ curl
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
