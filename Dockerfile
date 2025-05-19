# Use Node.js base image
FROM node:18-alpine

# Set working directory
WORKDIR ./

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app code
COPY . .

# Build the NestJS app
RUN npm run build

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "run", "start:prod"]
