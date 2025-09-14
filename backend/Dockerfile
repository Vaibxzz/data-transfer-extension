# Use an official Node.js runtime as the base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy the rest of the backend code
COPY . .

# Expose the port your app runs on
EXPOSE 8080

# Run the server
CMD ["node", "index.js"]