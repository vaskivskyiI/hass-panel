FROM docker.io/node:20-bullseye AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM docker.io/nginx:1.27-alpine

RUN apk add --no-cache python3

COPY podman/nginx.conf /etc/nginx/conf.d/default.conf
COPY podman/runtime_config_server.py /usr/local/bin/runtime_config_server.py
COPY podman/start.sh /usr/local/bin/start.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN printf '{}\n' > /usr/share/nginx/html/runtime-config.json

EXPOSE 8080

CMD ["sh", "/usr/local/bin/start.sh"]