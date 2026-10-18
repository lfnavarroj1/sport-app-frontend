#!/usr/bin/env bash
# Extrae de una imagen web ya construida el sitio que sirve nginx y lo empaqueta de
# forma reproducible, para que el checksum describa exactamente lo que va en la
# imagen (no una compilación aparte):
#
#   bash deploy/release/web-artifact.sh <imagen> <directorio-de-salida>
#
# Deja en el directorio `web.tgz` y `web.tgz.sha256` (formato de sha256sum) e
# imprime el checksum. Usa la misma normalización que el job `build` de ci-web.yml.
set -euo pipefail

IMAGE="${1:?Uso: web-artifact.sh <imagen> <directorio-de-salida>}"
OUT="${2:?Uso: web-artifact.sh <imagen> <directorio-de-salida>}"
SITE=/usr/share/nginx/html

mkdir -p "$OUT"
staging="$(mktemp -d)"
container=""
cleanup() {
  [ -z "$container" ] || docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$staging"
}
trap cleanup EXIT

# `docker create` no arranca el contenedor: solo permite copiar su sistema de archivos.
container="$(docker create "$IMAGE")"
# En Git Bash (Windows) docker.exe necesita la ruta local en formato Windows; la del
# contenedor no debe convertirse.
destination="$staging"
if command -v cygpath >/dev/null 2>&1; then
  destination="$(cygpath -w "$staging")"
fi
MSYS_NO_PATHCONV=1 docker cp "${container}:${SITE}/." "$destination"
[ -f "$staging/index.html" ] || {
  echo "web-artifact: la imagen no contiene ${SITE}/index.html" >&2
  exit 1
}

# Permisos normalizados: el checksum no depende del sistema de archivos del anfitrión.
tar --sort=name --mtime='1970-01-01 00:00Z' --owner=0 --group=0 --numeric-owner \
  --mode='u=rwX,go=rX' -C "$staging" -cf - . | gzip -n > "$OUT/web.tgz"
(cd "$OUT" && sha256sum web.tgz > web.tgz.sha256)
cut -d' ' -f1 "$OUT/web.tgz.sha256"
