#!/usr/bin/env bash
# Prueba de humo de la imagen web. La usan el job `container` de ci-web.yml,
# release-web.yml y el desarrollador en local:
#
#   bash deploy/docker/smoke-test.sh sportapp/web:local
#
# Arranca el contenedor con las mismas restricciones que Kubernetes (usuario 101:101,
# raíz de solo lectura salvo /tmp, sin capacidades) y verifica el contrato del
# contenedor. Termina con código distinto de cero ante el primer fallo y elimina
# siempre los contenedores que creó.
set -euo pipefail

IMAGE="${1:?Uso: smoke-test.sh <imagen>}"
BFF_URL="http://localhost:18080"
CONTAINERS=()

cleanup() {
  if [ "${#CONTAINERS[@]}" -gt 0 ]; then
    docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

pass() { echo "ok   - $*"; }
fail() {
  echo "FAIL - $*" >&2
  exit 1
}

# Arranca un contenedor endurecido en segundo plano e imprime su id.
# MSYS_NO_PATHCONV evita que Git Bash en Windows convierta `/tmp` en una ruta de Windows;
# no se exporta porque curl en Windows sí necesita la conversión de /dev/null.
start() {
  MSYS_NO_PATHCONV=1 docker run -d \
    --user 101:101 \
    --read-only \
    --tmpfs /tmp:rw,size=16m \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -p 127.0.0.1::8080 \
    "$@" "$IMAGE"
}

# Espera hasta 15 s a que el contenedor termine e imprime su código de salida;
# imprime "running" si sigue en ejecución.
exit_code_of() {
  local id="$1"
  for _ in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$id")" = "false" ]; then
      docker inspect -f '{{.State.ExitCode}}' "$id"
      return
    fi
    sleep 0.5
  done
  echo running
}

# Docker Desktop puede tardar en publicar el puerto después de `docker run -d`.
base_url_of() {
  local port
  for _ in $(seq 1 30); do
    port="$(docker port "$1" 8080/tcp 2>/dev/null | head -n 1 | sed 's/.*://')"
    if [ -n "$port" ]; then
      echo "http://127.0.0.1:${port}"
      return
    fi
    sleep 0.5
  done
  docker logs "$1" >&2 || true
  fail "el puerto 8080 del contenedor no se publicó en 15 s"
}

wait_healthy() {
  local url="$1" id="$2"
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$url/healthz" 2>/dev/null; then
      return
    fi
    sleep 0.5
  done
  docker logs "$id" >&2 || true
  fail "/healthz no respondió en 15 s"
}

# header <url> <nombre>: valor del encabezado (sin CR final).
header() {
  curl -fsS -D - -o /dev/null "$1" | tr -d '\r' | awk -v name="$2" \
    '!found && tolower($0) ~ "^" tolower(name) ":" { sub(/^[^:]*:[ ]*/, ""); print; found = 1 }'
}

echo "Imagen: $IMAGE"

# Usuario declarado en la imagen.
user="$(docker image inspect -f '{{.Config.User}}' "$IMAGE")"
[ "$user" = "101:101" ] || fail "la imagen debe declarar USER 101:101 (tiene '$user')"
pass "la imagen se ejecuta como 101:101 (no root)"

# --- Configuración local válida -------------------------------------------------
id="$(start -e APP_ENV=local -e BFF_WEB_BASE_URL="$BFF_URL")"
CONTAINERS+=("$id")
url="$(base_url_of "$id")"
wait_healthy "$url" "$id"
pass "GET /healthz -> 200 con raíz de solo lectura y /tmp con escritura"

[ "$(docker exec "$id" id -u)" = "101" ] || fail "el proceso no corre con UID 101"
pass "el proceso corre con UID 101"

status="$(curl -sS -o /dev/null -w '%{http_code}' "$url/")"
[ "$status" = "200" ] || fail "GET / devolvió $status"
pass "GET / -> 200"

config="$(curl -fsS "$url/app-config.json")"
expected="{\"environment\":\"local\",\"bffWebBaseUrl\":\"$BFF_URL\"}"
[ "$config" = "$expected" ] || fail "app-config.json inesperado: $config"
pass "GET /app-config.json -> $config"

cache="$(header "$url/app-config.json" Cache-Control)"
[ "$cache" = "no-store" ] || fail "app-config.json con Cache-Control '$cache'"
pass "app-config.json con Cache-Control: no-store"

cache="$(header "$url/" Cache-Control)"
[ "$cache" = "no-store" ] || fail "index.html con Cache-Control '$cache'"
pass "index.html con Cache-Control: no-store"

deep="$(curl -fsS "$url/ruta/profunda/de-la-spa")"
grep -q '<app-root' <<<"$deep" || fail "una ruta profunda no devolvió index.html"
pass "ruta profunda de la SPA -> index.html"

asset="$(grep -oE 'main-[A-Z0-9]{8}\.js' <<<"$deep" | head -n 1)"
[ -n "$asset" ] || fail "no se encontró el bundle main-<hash>.js en index.html"
cache="$(header "$url/$asset" Cache-Control)"
[ "$cache" = "public, max-age=31536000, immutable" ] || fail "$asset con Cache-Control '$cache'"
pass "$asset con caché larga e inmutable"

status="$(curl -sS -o /dev/null -w '%{http_code}' "$url/main-AAAAAAAA.js")"
[ "$status" = "404" ] || fail "un archivo con hash inexistente devolvió $status (se esperaba 404)"
pass "archivo con hash inexistente -> 404 (no index.html)"

# --- BFF sin definir: se publica null ---------------------------------------------
id="$(start -e APP_ENV=production -e BFF_WEB_BASE_URL=)"
CONTAINERS+=("$id")
url="$(base_url_of "$id")"
wait_healthy "$url" "$id"
config="$(curl -fsS "$url/app-config.json")"
[ "$config" = '{"environment":"production","bffWebBaseUrl":null}' ] ||
  fail "con BFF_WEB_BASE_URL vacía app-config.json fue: $config"
pass "BFF_WEB_BASE_URL vacía -> bffWebBaseUrl: null"

# --- Configuración inválida: el contenedor no arranca -----------------------------
reject() {
  local description="$1"
  shift
  local id code
  id="$(start "$@")"
  CONTAINERS+=("$id")
  code="$(exit_code_of "$id")"
  if [ "$code" = "running" ] || [ "$code" = "0" ]; then
    fail "$description: el contenedor debía terminar con error (estado: $code)"
  fi
  pass "$description -> termina con código $code"
}

reject "APP_ENV ausente" -e BFF_WEB_BASE_URL="$BFF_URL"
reject "APP_ENV=otro" -e APP_ENV=otro -e BFF_WEB_BASE_URL="$BFF_URL"
reject "BFF_WEB_BASE_URL=ftp://x" -e APP_ENV=local -e BFF_WEB_BASE_URL=ftp://x
reject "BFF_WEB_BASE_URL relativa" -e APP_ENV=local -e BFF_WEB_BASE_URL=/api
reject "BFF_WEB_BASE_URL con comillas" -e APP_ENV=local -e 'BFF_WEB_BASE_URL=http://x"y'

echo "Prueba de humo del contenedor: OK"
