# Imagen única del frontend web para Kubernetes local y Cloud Run (ADR-022).
#   docker build -t sportapp/web:local .
# La configuración de ambiente no se compila: el arranque genera app-config.json
# desde APP_ENV y BFF_WEB_BASE_URL (ver deploy/docker/start.sh).
# Las imágenes base están fijadas por digest; se actualizan mediante PR revisado.

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public ./public
COPY src ./src
# El app-config.json de desarrollo no viaja en la imagen: lo genera el arranque.
RUN npm run build \
    && rm dist/sport-app-frontend/browser/app-config.json

FROM ${NGINX_IMAGE} AS runtime
ARG VERSION=0.0.0-local
ARG REVISION=unknown
LABEL org.opencontainers.image.title="sportapp-web" \
      org.opencontainers.image.description="SportApp - aplicación web Angular" \
      org.opencontainers.image.source="https://github.com/lfnavarroj1/sport-app-frontend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
COPY --chmod=0444 deploy/docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0555 deploy/docker/start.sh /usr/local/bin/sportapp-web-start
COPY --from=build /src/dist/sport-app-frontend/browser /usr/share/nginx/html
USER 101:101
EXPOSE 8080
# Reemplaza /docker-entrypoint.sh de nginx: sus scripts escriben en /etc/nginx/conf.d,
# que es de solo lectura con readOnlyRootFilesystem.
ENTRYPOINT ["/usr/local/bin/sportapp-web-start"]
CMD ["nginx", "-g", "daemon off;"]
