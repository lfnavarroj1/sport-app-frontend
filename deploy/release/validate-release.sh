#!/usr/bin/env bash
# Valida las entradas de una release del frontend web. La usan release-web.yml
# (validación en GitHub, sin GCP) y cloudbuild.release.yaml (construcción y
# publicación iniciadas desde GCP):
#
#   bash deploy/release/validate-release.sh <tag> [commit] [registro] [repositorio]
#
#   tag          vX.Y.Z o vX.Y.Z-pre (SemVer 2.0 con prefijo v, sin metadatos +build).
#   commit       SHA-1 completo de 40 caracteres hexadecimales en minúsculas.
#   registro     host y proyecto de Artifact Registry: <región>-docker.pkg.dev/<proyecto>.
#   repositorio  nombre del repositorio de Artifact Registry (por ejemplo sportapp-frontend).
#
# Imprime la versión sin la v. Termina con código 64 ante la primera entrada inválida.
set -euo pipefail

fail() {
  echo "validate-release: $*" >&2
  exit 64
}

TAG="${1:-}"
COMMIT="${2:-}"
REGISTRY="${3:-}"
REPOSITORY="${4:-}"

SEMVER='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?$'

[ -n "$TAG" ] || fail "el tag es obligatorio"
printf '%s' "$TAG" | grep -Eq "$SEMVER" || fail "el tag '$TAG' no es SemVer vX.Y.Z o vX.Y.Z-pre"

if [ "$#" -ge 2 ]; then
  printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$' ||
    fail "el commit '$COMMIT' no es un SHA-1 completo de 40 caracteres en minúsculas"
fi

if [ "$#" -ge 3 ]; then
  printf '%s' "$REGISTRY" | grep -Eq '^[a-z][a-z0-9-]*-docker\.pkg\.dev/[a-z][a-z0-9-]{4,28}[a-z0-9]$' ||
    fail "el registro '$REGISTRY' no es <región>-docker.pkg.dev/<proyecto>"
fi

if [ "$#" -ge 4 ]; then
  printf '%s' "$REPOSITORY" | grep -Eq '^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' ||
    fail "el repositorio '$REPOSITORY' no es un nombre válido de Artifact Registry"
fi

echo "${TAG#v}"
