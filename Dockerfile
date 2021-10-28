FROM node:fermium-alpine

MAINTAINER cronic@zensystem.io

RUN apk add --no-cache git python build-base bash tini

USER node

ENV NODE_ENV=production

WORKDIR /home/node

COPY . .

RUN npm ci

ENTRYPOINT ["/sbin/tini", "-e 143", "--"]

CMD ["npm", "run", "prod"]

