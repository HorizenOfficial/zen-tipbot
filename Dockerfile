FROM node:erbium-alpine

MAINTAINER cronic@zensystem.io

RUN apk add --no-cache git python build-base bash

USER node

ENV NODE_ENV=production

WORKDIR /home/node

COPY . .

RUN npm install \
    && npm run build

CMD ["npm","run","prod"]

