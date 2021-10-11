FROM node:fermium-alpine

MAINTAINER cronic@zensystem.io

RUN apk add --no-cache git python build-base bash

USER node

ENV NODE_ENV=production

WORKDIR /home/node

COPY . .

RUN npm ci

CMD ["npm","run","prod"]

