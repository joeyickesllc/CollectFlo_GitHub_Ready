FROM node:18-alpine AS base

# Create app directory
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Production image, copy all the files and run the app
FROM base AS runner
WORKDIR /app

# Set to production environment
ENV NODE_ENV production

# Create a non-root user and switch to it for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 collectflo \
    && mkdir -p /app/logs /app/uploads \
    && chown -R collectflo:nodejs /app

# Copy only necessary files from builder
COPY --from=builder --chown=collectflo:nodejs /app/package.json ./
COPY --from=builder --chown=collectflo:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=collectflo:nodejs /app/index.js ./
COPY --from=builder --chown=collectflo:nodejs /app/backend ./backend
COPY --from=builder --chown=collectflo:nodejs /app/services ./services
COPY --from=builder --chown=collectflo:nodejs /app/public ./public
COPY --from=builder --chown=collectflo:nodejs /app/db ./db

# Switch to non-root user
USER collectflo

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the app
CMD ["node", "index.js"]
