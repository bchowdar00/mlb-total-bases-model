# Dockerfile for mlb-total-bases-model
# Node 20 + Python 3 base image: the Node server shells out to the Python
# projection engine and box-score grader, so both runtimes are installed.

FROM node:20-slim

# Install Python 3 + pip (slim image has neither)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps first (layer-cached unless package-lock changes)
COPY package*.json ./
RUN npm ci

# Install Python deps
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy source and build
COPY . .
RUN npm run build

# Expose the app port
EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "dist/index.cjs"]
