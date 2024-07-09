# Use the latest Node.js version from the official Node.js Alpine image
FROM node:alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available) to the working directory
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the application files to the working directory
COPY . .

# Expose port 4000 to be accessible from outside the container
EXPOSE 4000

# Command to run the application
CMD ["node", "app.js"]
