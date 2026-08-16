# ============================================
# Silelo 💯✨ — Dockerfile
# ติดตั้งทุกอย่างตอน build: Node + Python + Java + C/C++ + Go + Rust + Ruby + PHP
# ============================================
FROM node:20-slim

# ติดตั้ง compilers + เครื่องมือระบบทั้งหมด (ครั้งเดียวตอน build — รันเร็ว ไม่มีปัญหา permission)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    build-essential gcc g++ \
    default-jdk-headless \
    golang-go \
    rustc \
    ruby \
    php-cli \
    git curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/render/project/src

COPY . .

RUN npm install --omit=dev || npm install

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# รันเป็น root (default) — ให้ /api/run ใช้ apt-get/pip/npm ได้เต็มที่
CMD ["node", "server.js"]
