FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app
RUN chown node:node /app
USER node

ENV NODE_ENV=production

COPY --chown=node:node package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# React Router bakes the app's own origin into the build; Render passes service env vars as build args.
ARG SHOPIFY_APP_URL
RUN npm run build

CMD ["npm", "run", "docker-start"]
