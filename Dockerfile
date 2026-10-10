FROM node:20-alpine AS build
WORKDIR /app
# npm ci requires package-lock.json to be present and committed - it
# installs exactly what the lockfile resolved, not whatever `npm install`
# would freshly resolve from the registry today. Faster and reproducible,
# but it means package-lock.json is not optional (see README setup steps).
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Carried in this stage (not the slim production stage below) so the
# one-off "migrate" service can run them with tsx - devDependencies
# (tsx, typescript) are only installed here, not in the production image.
COPY scripts ./scripts
COPY migrations ./migrations

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
