#!/usr/bin/env bash
# Etapas de cloudbuild.release.yaml. Cada paso de Cloud Build invoca una etapa con
# las sustituciones como variables de entorno; así la lógica se prueba en local
# con las mismas imágenes:
#
#   bash deploy/release/cloudbuild-release.sh <etapa>
#
# Entradas (de las sustituciones de Cloud Build):
#   RELEASE_TAG     _RELEASE_TAG, por defecto $TAG_NAME (vX.Y.Z o vX.Y.Z-pre).
#   COMMIT_SHA      _COMMIT_SHA, por defecto $COMMIT_SHA (SHA-1 completo).
#   REGISTRY        _REGISTRY: <región>-docker.pkg.dev/<proyecto>.
#   REPOSITORY      _REPOSITORY: repositorio de Artifact Registry (sportapp-frontend).
#   RELEASE_BUCKET  _RELEASE_BUCKET: bucket del manifiesto; vacío, no se sube.
#   BUILTIN_TAG, BUILTIN_COMMIT, REPO_FULL_NAME, BUILD_ID, PROJECT_ID, LOCATION:
#                   sustituciones predeterminadas de Cloud Build.
#   SMOKE_TEST_NETWORK  red de Docker de los pasos (`cloudbuild` en Cloud Build).
#
# Flujo: validar → npm ci → formato, lint y tipos → unitarias → auditoría → build →
# construir la imagen UNA vez → prueba de humo de esa imagen → checksum del sitio de
# esa imagen → publicar esa misma imagen (sin reconstruir) y obtener su digest →
# manifiesto → guardar el manifiesto. Nunca despliega, nunca usa `latest` y no
# modifica infraestructura, IAM, redes, secretos ni servicios.
set -euo pipefail

STAGE="${1:?Uso: cloudbuild-release.sh <etapa>}"
OUT=release
IMAGE_ID_FILE="$OUT/image-id.txt"

fail() {
  echo "cloudbuild-release ($STAGE): $*" >&2
  exit 1
}

# Imagen sin etiqueta: <registro>/<repositorio>/web.
image_name() { echo "${REGISTRY}/${REPOSITORY}/web"; }

# La imagen local debe ser exactamente la construida en la etapa `image`.
assert_same_image() {
  local expected actual
  expected="$(cat "$IMAGE_ID_FILE")"
  actual="$(docker image inspect -f '{{.Id}}' "$(image_name):${RELEASE_TAG}")"
  [ "$actual" = "$expected" ] || fail "la imagen cambió después de construirse ($actual != $expected)"
}

mkdir -p "$OUT"

case "$STAGE" in
  validate)
    bash deploy/release/validate-release.sh "$RELEASE_TAG" "$COMMIT_SHA" "$REGISTRY" "$REPOSITORY"
    if [ -n "${BUILTIN_TAG:-}" ] && [ "$BUILTIN_TAG" != "$RELEASE_TAG" ]; then
      fail "_RELEASE_TAG ($RELEASE_TAG) no coincide con el tag del disparador ($BUILTIN_TAG)"
    fi
    if [ -n "${BUILTIN_COMMIT:-}" ] && [ "$BUILTIN_COMMIT" != "$COMMIT_SHA" ]; then
      fail "_COMMIT_SHA ($COMMIT_SHA) no coincide con el commit del disparador ($BUILTIN_COMMIT)"
    fi
    if [ -n "${REPO_FULL_NAME:-}" ] && [ "$REPO_FULL_NAME" != "lfnavarroj1/sport-app-frontend" ]; then
      fail "el repositorio del disparador ($REPO_FULL_NAME) no es lfnavarroj1/sport-app-frontend"
    fi
    if [ -n "${RELEASE_BUCKET:-}" ] &&
      ! printf '%s' "$RELEASE_BUCKET" | grep -Eq '^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$'; then
      fail "_RELEASE_BUCKET '$RELEASE_BUCKET' no es un nombre de bucket válido"
    fi
    echo "Release ${RELEASE_TAG} del commit ${COMMIT_SHA} hacia $(image_name)."
    ;;

  install)
    npm ci --no-audit --no-fund
    ;;

  checks)
    npm run format:check
    npm run lint
    npm run typecheck
    ;;

  unit-tests)
    # Karma necesita Chrome: se usa el Chromium de la versión de Playwright fijada
    # en package-lock.json, con sus dependencias del sistema.
    npx playwright install --with-deps chromium
    CHROME_BIN="$(node -e "console.log(require('@playwright/test').chromium.executablePath())")"
    export CHROME_BIN
    npm run test:ci
    ;;

  audit)
    npm run audit:prod
    ;;

  build)
    npm run build
    ;;

  image)
    # Única construcción de la imagen. La etiqueta de commit apunta a la misma imagen.
    docker build \
      --build-arg "VERSION=${RELEASE_TAG#v}" \
      --build-arg "REVISION=${COMMIT_SHA}" \
      -t "$(image_name):${RELEASE_TAG}" .
    docker tag "$(image_name):${RELEASE_TAG}" "$(image_name):${COMMIT_SHA}"
    docker image inspect -f '{{.Id}}' "$(image_name):${RELEASE_TAG}" > "$IMAGE_ID_FILE"
    echo "Imagen construida: $(cat "$IMAGE_ID_FILE")"
    ;;

  smoke)
    assert_same_image
    bash deploy/docker/smoke-test.sh "$(image_name):${RELEASE_TAG}" 2>&1 | tee "$OUT/smoke-test.log"
    ;;

  artifact)
    assert_same_image
    bash deploy/release/web-artifact.sh "$(image_name):${RELEASE_TAG}" "$OUT"
    ;;

  publish)
    # Se publica la imagen probada; con tags inmutables en Artifact Registry, un tag
    # existente hace fallar el push en lugar de sobrescribirlo.
    assert_same_image
    docker push "$(image_name):${RELEASE_TAG}"
    docker push "$(image_name):${COMMIT_SHA}"
    digests="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' \
      "$(image_name):${RELEASE_TAG}" | grep -F "$(image_name)@sha256:" | sort -u)"
    [ "$(printf '%s\n' "$digests" | grep -c .)" = "1" ] ||
      fail "se esperaba exactamente un digest para $(image_name); se obtuvo: ${digests:-ninguno}"
    printf '%s' "$digests" > "$OUT/image-uri.txt"
    echo "Imagen publicada: $(cat "$OUT/image-uri.txt")"
    ;;

  manifest)
    IMAGE_URI="$(cat "$OUT/image-uri.txt")" \
      ARTIFACT_SHA256_FILE="$OUT/web.tgz.sha256" \
      SMOKE_TEST_LOG="$OUT/smoke-test.log" \
      node deploy/release/release-manifest.mjs frontend-release dist/frontend-release.json
    ;;

  store)
    if [ -z "${RELEASE_BUCKET:-}" ]; then
      echo "Sin _RELEASE_BUCKET: el manifiesto no se sube; queda en el log de esta build."
      exit 0
    fi
    # Prefijo propio del frontend; --if-generation-match=0 impide sobrescribir
    # la evidencia de una release ya registrada.
    gcloud storage cp --if-generation-match=0 dist/frontend-release.json \
      "gs://${RELEASE_BUCKET}/frontend/${RELEASE_TAG}/frontend-release.json"
    ;;

  *)
    fail "etapa desconocida"
    ;;
esac
