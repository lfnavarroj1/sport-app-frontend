#!/bin/sh
# Arranque del contenedor web: valida el ambiente, genera /tmp/sportapp/app-config.json
# y ejecuta nginx. Si la configuración es inválida termina con error y nginx no arranca,
# para que el contenedor nunca quede sano con una configuración que la aplicación rechaza.
#
#   APP_ENV                        obligatoria: local, development, staging o production.
#   BFF_WEB_BASE_URL               URL http(s) absoluta del BFF web; vacía o ausente publica null.
#   REGISTRATION_POLICIES_VERSION  versión vigente de las políticas de registro (HU001), la misma
#                                  que usa users-management; vacía o ausente publica null.
set -eu

CONFIG_DIR=/tmp/sportapp

fail() {
  echo "sportapp-web: configuración inválida: $*" >&2
  exit 64
}

app_env="${APP_ENV:-}"
case "$app_env" in
  local | development | staging | production) ;;
  '') fail "APP_ENV es obligatoria (local, development, staging o production)" ;;
  *) fail "APP_ENV debe ser local, development, staging o production" ;;
esac

bff_url="${BFF_WEB_BASE_URL:-}"
if [ -z "$bff_url" ]; then
  bff_json=null
else
  # esquema://host[:puerto][/ruta]. El juego de caracteres excluye espacios, comillas,
  # barra invertida y caracteres de control, así que el valor se inserta en el JSON
  # sin necesidad de escapar.
  if ! printf '%s' "$bff_url" \
    | grep -Eq '^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'; then
    fail "BFF_WEB_BASE_URL debe ser una URL http(s) absoluta (esquema://host[:puerto][/ruta]) o estar vacía"
  fi
  bff_json="\"$bff_url\""
fi

policies_version="${REGISTRATION_POLICIES_VERSION:-}"
if [ -z "$policies_version" ]; then
  policies_json=null
else
  # De 1 a 32 caracteres (límite de accepted_policies_version en el contrato bff-web);
  # el juego de caracteres permite insertarlo en el JSON sin escapar.
  if ! printf '%s' "$policies_version" | grep -Eq '^[A-Za-z0-9._:+-]{1,32}$'; then
    fail "REGISTRATION_POLICIES_VERSION debe tener de 1 a 32 caracteres entre letras, dígitos y . _ : + -"
  fi
  policies_json="\"$policies_version\""
fi

mkdir -p "$CONFIG_DIR"
printf '{"environment":"%s","bffWebBaseUrl":%s,"registrationPoliciesVersion":%s}\n' \
  "$app_env" "$bff_json" "$policies_json" > "$CONFIG_DIR/app-config.json.tmp"
mv "$CONFIG_DIR/app-config.json.tmp" "$CONFIG_DIR/app-config.json"
echo "sportapp-web: app-config.json generado (environment=$app_env, bffWebBaseUrl=${bff_url:-null}, registrationPoliciesVersion=${policies_version:-null})" >&2

exec "$@"
