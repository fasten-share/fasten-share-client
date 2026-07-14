# --- build stage: Next.js standalone server bundle ---
# glibc (not alpine/musl) avoids Turbopack native-binary surprises during build.
FROM node:22 AS build
WORKDIR /repo

COPY packages/contracts ./packages/contracts
COPY fasten-share-client/package.json fasten-share-client/package-lock.json ./fasten-share-client/
WORKDIR /repo/fasten-share-client
RUN npm ci

COPY fasten-share-client/ .
# Monorepo tracing emits the app below .next/standalone/fasten-share-client.
# The minimal server doesn't bundle public/ or .next/static — copy them in.
RUN npm run build \
    && cp -r .next/static .next/standalone/fasten-share-client/.next/static \
    && cp -r public .next/standalone/fasten-share-client/public

# --- run stage: just Node + the self-contained bundle (no node_modules install) ---
FROM node:22 AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8086
ENV HOSTNAME=0.0.0.0
COPY --from=build /repo/fasten-share-client/.next/standalone/fasten-share-client ./
EXPOSE 8086
CMD ["node", "server.js"]
