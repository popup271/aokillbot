# ---- Pin Node.js to 20 LTS (canvas-compatible) ----
FROM node:20-bookworm

# ---- Install system dependencies required by canvas ----
RUN apt-get update && apt-get install -y \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ---- Set the working directory ----
WORKDIR /usr/src/app

# ---- Copy package files first for better caching ----
COPY package*.json ./

# ---- Install npm dependencies ----
RUN npm install --prefer-offline --no-audit --cache /tmp/.npm

# ---- Copy the rest of the application code ----
COPY . .

# ---- Start the application ----
CMD ["npm", "start"]
