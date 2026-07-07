# --- build stage: Next.js standalone server bundle ---
# glibc (not alpine/musl) avoids Turbopack native-binary surprises during build.
FROM node:22 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# next.config.ts has output:'standalone' -> .next/standalone/server.js.
# The minimal server doesn't bundle public/ or .next/static — copy them in.
RUN npm run build \
    && cp -r .next/static .next/standalone/.next/static \
    && cp -r public .next/standalone/public

# --- run stage: just Node + the self-contained bundle (no node_modules install) ---
FROM node:22 AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8086
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
EXPOSE 8086
CMD ["node", "server.js"]
