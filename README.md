# sport-app-frontend

Aplicación web Angular de SportApp (canal web, HU001–HU025). Es una sola aplicación organizada por dominio que se comunica **únicamente con el BFF web**; nunca llama microservicios, bases de datos ni Pub/Sub.

La arquitectura, las historias y los contratos viven en el repositorio de documentación central; este repositorio solo contiene código ejecutable.

## Requisitos

| Herramienta | Versión                                          |
| ----------- | ------------------------------------------------ |
| Node.js     | 24.14.0 (`.nvmrc`; `engines`: `^24.14.0`)        |
| npm         | 11.9.0 o superior (lockfile `package-lock.json`) |
| Chrome      | Para pruebas unitarias con Karma                 |

Stack fijado: Angular 21.2 (CLI 21.2.26), TypeScript 5.9.3, Angular Material 21.2, ngx-translate 18, Jasmine/Karma, Playwright 1.63, ESLint (angular-eslint) y Prettier. Las versiones exactas están en `package.json` (`save-exact`).

## Comandos

| Propósito                            | Comando                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Instalación reproducible             | `npm ci`                                                               |
| Ejecución local                      | `npm start` → http://localhost:4200                                    |
| Formato (corregir / verificar)       | `npm run format` / `npm run format:check`                              |
| Lint                                 | `npm run lint`                                                         |
| Tipos (TypeScript estricto)          | `npm run typecheck`                                                    |
| Unitarias y componentes (modo watch) | `npm test`                                                             |
| Unitarias y componentes + cobertura  | `npm run test:ci`                                                      |
| Build de producción                  | `npm run build` → `dist/sport-app-frontend/browser`                    |
| Playwright completo (local)          | `npm run e2e`                                                          |
| Playwright smoke (local)             | `npm run e2e:smoke`                                                    |
| Playwright integrado (ambiente)      | `PLAYWRIGHT_BASE_URL=<url> npm run e2e:integrated`                     |
| Smoke posterior a despliegue         | `PLAYWRIGHT_BASE_URL=<url> npm run smoke`                              |
| Vulnerabilidades de producción       | `npm run audit:prod`                                                   |
| Verificación rápida antes de commit  | `npm run precommit`                                                    |
| Verificación local equivalente a CI  | `npm run ci`                                                           |
| Imagen de contenedor                 | `npm run container:build` (ver [Contenedor](#contenedor-y-kubernetes)) |
| Prueba de humo de la imagen          | `bash deploy/docker/smoke-test.sh sportapp/web:local`                  |
| Scripts de release y pipelines       | `npm run release:test` (ver [CI/CD](docs/ci-cd.md))                    |

La primera vez que se ejecute Playwright: `npx playwright install chromium`.

## Estructura

```text
src/
  main.ts                 carga app-config.json y arranca; si falla, muestra un error explícito
  startup-failure.ts      mensaje de arranque fallido (sin detalles internos)
  app/
    core/                 capacidades técnicas transversales, sin reglas de negocio
      config/             configuración de ejecución y su validación
      api/                URL del BFF web y normalización segura de errores
      i18n/               ngx-translate + locale
      observability/      identificador técnico de diagnóstico
    shared/               componentes visuales/técnicos reutilizables
      ui/                 ViewState y <app-async-state> (carga, vacío, error, éxito)
      forms/              <app-field-error> (mensajes de validación localizados)
    features/             una carpeta por dominio: identity, affiliation, training, services, events
    shell/                áreas autenticadas por actor (ADR-025): menú lateral, inicios, guardas, registro de navegación
    technical/            ruta técnica /status (arranque y configuración; no es una HU)
  testing/                utilidades solo para pruebas
public/
  app-config.json         configuración de ejecución del ambiente local
  i18n/es.json            textos de la interfaz
e2e/                      pruebas Playwright
deploy/
  docker/                 nginx, script de arranque y prueba de humo de la imagen
  k8s/base/               Deployment y Service `web` (Kustomize)
Dockerfile                imagen única para Kubernetes local y Cloud Run
.github/workflows/        CI (ci-web.yml) y publicación de la imagen (release-web.yml)
```

## Configuración por ambiente

La aplicación lee `app-config.json` al arrancar, de modo que el mismo artefacto se promueve entre ambientes sin recompilar. El archivo no debe contener secretos.

```json
{
  "environment": "local",
  "bffWebBaseUrl": "http://localhost:18080",
  "registrationPoliciesVersion": "sportapp-c108-c108plus.v1",
  "healthDataConsentVersion": "local-dev"
}
```

| Campo                         | Obligatorio | Valores                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`                 | Sí          | `local`, `development`, `staging`, `production`                                                                                                                                                                                                                                                            |
| `bffWebBaseUrl`               | Sí          | URL http(s) absoluta del BFF web, o `null` si aún no está definida                                                                                                                                                                                                                                         |
| `registrationPoliciesVersion` | Sí          | Versión vigente de las políticas de registro (HU001), de 1 a 32 caracteres; debe coincidir con `REGISTRATION_POLICIES_VERSION` de users-management en el mismo ambiente y con la versión del aviso que muestra la web (`sportapp-c108-c108plus.v1`). `null` u otra versión dejan el registro no disponible |
| `healthDataConsentVersion`    | Sí          | Versión vigente del consentimiento de datos de salud (HU005, ADR-034), de 1 a 64 caracteres; debe coincidir con `HEALTH_DATA_CONSENT_VERSION` de users-management en el mismo ambiente. `null` deja el registro fisiológico no disponible                                                                  |

Si el archivo falta o es inválido, la aplicación **no arranca** y muestra un mensaje de error. Con `bffWebBaseUrl: null`, cualquier llamada al BFF falla con `BffNotConfiguredError` y la interfaz muestra el estado "servicio no disponible".

Con `npm start` se usa `public/app-config.json`, que apunta al BFF de la composición local (`http://localhost:18080`) a la versión aprobada de las políticas de registro (`sportapp-c108-c108plus.v1`) y a la versión `local-dev` del consentimiento de datos de salud. La plataforma aún publica `local-dev` como versión de las políticas: hasta que la cambie, users-management rechaza el registro con `422 policies_version_mismatch`. En el contenedor ese archivo no se incluye: el arranque lo genera a partir de variables de entorno (ver la sección siguiente).

## Estilo visual

Dirección «Energía deportiva» (decisión del responsable, 2026-10-11): naranja de marca `#F26B1D`, azul petróleo `#0E5E6F` de apoyo y azul noche `#0B1B2B` en la barra y en los fondos de ingreso y registro.

- **Tema:** `src/styles.scss` aplica `mat.theme()` con la paleta Material 3 de `src/styles/_theme-colors.scss`, generada con `ng generate @angular/material:theme-color --primary-color=#F26B1D --tertiary-color=#0E5E6F --directory=src/styles/ --include-high-contrast=true --is-scss=true`. Ese archivo no se edita a mano: se regenera.
- **Contraste:** Material aplica a botones y textos el tono accesible (`#a14000`). El naranja vivo y los `--sa-*` (colores de marca, radios y sombras) se usan solo en fondos y acentos. Con `prefers-contrast: more` se activa el alto contraste.
- **Tipografía:** Roboto para el texto y Barlow (600–800) para títulos y marca, ambas desde Google Fonts.
- **Fondos:** `<app-auth-shell>` (`shared/ui/auth-shell`) envuelve las pantallas sin sesión con el degradado de marca y trazos diagonales, solo con CSS. La tarjeta proyectada usa la clase `sa-auth-card`.
- **Barra superior:** sus colores se definen con `mat.toolbar-overrides`, que también dan color a los botones de navegación.

## Registro y aviso de tratamiento de datos (HU001)

Features `src/app/features/identity/registration` y `src/app/features/identity/privacy-notice`. Contrato `POST /v1/users` y `GET /v1/me/capabilities` de `bff-web` 0.13.0.

- **El aviso** está en `/aviso-de-privacidad` (pública) y también puede leerse dentro del formulario («Leer el aviso aquí»). Su versión, `sportapp-c108-c108plus.v1`, es la versión compartida de las políticas que aprobó el responsable. Explica, con la información aprobada del proyecto:
  - qué datos se recopilan y para qué;
  - minimización y calidad;
  - conservación;
  - seguridad;
  - destinatarios y transferencias;
  - datos sensibles y de salud;
  - derechos de acceso, rectificación, supresión y oposición, y cómo ejercerlos.
- **Lo que no se inventa:** lo que el proyecto aún no definió figura como pendiente (ver «Pendiente»).
- **Referencias:** los Convenios 108 y 108+ del Consejo de Europa son referencias del aviso, no una certificación. Sus enlaces oficiales se abren en una pestaña nueva con `rel="noopener noreferrer"`.
- **Consentimiento:** es explícito y no está premarcado. La etiqueta enlaza al aviso (pestaña nueva, sin perder lo capturado), muestra la versión y envía exactamente esa versión en `accepted_policies_version`.
- **Versión configurada:** la web solo ofrece aceptar la versión del aviso que muestra. Si `registrationPoliciesVersion` indica otra, el registro no se habilita.
- **Versión rechazada:** ante `422 policies_version_mismatch`, la casilla se desmarca y se ofrece «Recargar y leer la versión vigente».
- **La contraseña** solo vive durante el envío: no se guarda en el navegador ni queda en la pantalla del resultado.
- **Pruebas:** `e2e/privacy-notice.spec.ts` y `e2e/registration.spec.ts` (`@simulado`). `e2e/registration.integrated.spec.ts` (`@integrado`) cubre registro, `PROVISIONING` → `FREE` `ACTIVE` con capacidades, y `organizer`/`service_provider` en `NOT_APPLICABLE`.

## Sesión (HU003)

- `/iniciar-sesion` es la página inicial; desde ella se llega al registro (`/registro`).
- **Inicio por tipo de usuario (ADR-025, HU003 CA7–CA10):** tras ingresar, `athlete` va a `/deportista/inicio`, `organizer` a `/organizador/inicio` y `service_provider` a `/profesional/inicio`. Cada área tiene un menú lateral izquierdo (`shell/actor-shell`) y la guarda `requireActor`: la URL de otro actor lleva a `/acceso-no-autorizado`. Un `actor_type` ausente o desconocido no inicia sesión ni asume un rol.
- **Registro de navegación** (`shell/navigation/navigation.registry.ts`): fuente única de opciones por actor, con grupo, orden, icono, ruta documentada, permiso (`actor-permissions.v1`) o capacidad del plan (ADR-024) y HU. Solo incluye HU aprobadas para web. Las opciones cuya HU aún no existe se muestran deshabilitadas como «Próximamente» (decisión del responsable, 2026-10-11): se activan con `available: true` y su ruta cuando se implemente la HU.
- **Permisos y capacidades** (`core/session/session-access.store.ts`, `GET /v1/me/capabilities` con `Authorization: Bearer`): una opción con permiso o capacidad solo aparece si el BFF la confirma; mientras carga o si falla, no se asume. Durante `PROVISIONING` el deportista ve el aviso de activación sin opciones del plan y la web vuelve a consultar. `401` termina la sesión como vencida; `403 unsupported_actor_type` lleva a `/acceso-no-autorizado`.
- El access token vive **solo en memoria** (`core/session/session.store.ts`): nunca se escribe en `localStorage`, `sessionStorage`, cookies accesibles ni logs.
- El refresh token viaja en la cookie `HttpOnly` `__Secure-sportapp_refresh` que fija el BFF web (contrato 0.4.0+, decisión del 2026-10-10); la aplicación no lo recibe ni puede leerlo. Las operaciones de sesión van con `withCredentials`.
- **Mantener la sesión** (`core/session/http-session-refresher.ts`, `POST /v1/sessions/refresh`): el access token se renueva 60 s antes de vencer; si el BFF no responde se reintenta cada 15 s mientras siga vigente, y si rechaza la cookie la sesión termina con «Tu sesión expiró». Al recargar o abrir la aplicación, las guardas intentan una vez recuperar la sesión con la cookie antes de decidir. Las renovaciones de varias pestañas se serializan con la Web Locks API, porque la cookie rota en cada uso y reutilizar una rotada revoca la sesión.
- Los errores de credenciales usan siempre el mismo mensaje genérico; `429 too_many_attempts` muestra la espera indicada por `Retry-After`.

## Cerrar sesión (HU004)

Feature `src/app/features/identity/logout`. Usa `POST /v1/sessions/revoke` de `bff-web` 0.13.0 (`core/api/bff-web/sessions.api.ts`); la operación no cambia desde 0.7.0.

- «Cerrar sesión» es una acción del menú lateral para los tres actores web (`<app-logout-button>`; en el registro de navegación tiene `action: 'logout'`).
- **La solicitud:** va sin cuerpo y sin access token; la credencial es la cookie `HttpOnly`, que la aplicación no lee ni registra. El botón queda deshabilitado mientras dura, así que hay un solo envío.
- **Cuándo se da por cerrada:** solo cuando el BFF confirma que borró la cookie.
  - `204`: la sesión queda revocada. Se descartan de la memoria el access token, la identidad y la vista de permisos, y el acceso muestra «Cerraste sesión.».
  - `503`/`504`: el BFF también borró la cookie, pero no pudo confirmar la revocación remota. Se cierra en el navegador y se avisa que el servidor no lo confirmó.
- **Cuándo no:** sin conexión o con `403 origin_not_allowed` la cookie sigue en el navegador, así que la sesión **no** se da por cerrada. El menú lo explica, con la referencia si la hay, y se puede reintentar.
- **Después del cierre:** la entrada del historial se reemplaza, así que «Atrás» no vuelve al área protegida. Pedir una URL protegida intenta renovar y el BFF lo rechaza (`401`).
- Otras pestañas abiertas conservan su access token en memoria hasta que vence (≤ 15 min, riesgo aceptado en HU004); su siguiente renovación se rechaza.
- **Pruebas:** `e2e/logout.spec.ts` (`@simulado`) y `e2e/logout.integrated.spec.ts` (`@integrado`, requiere el origen de la aplicación en `CORS_ALLOWED_ORIGINS`; en local, `ng serve --port 4200`).

## Planes de entrenamiento (HU010)

Feature `src/app/features/training`, contrato `bff-web` 0.6.0 (`core/api/bff-web/training.api.ts`).

- **Deportista** (`/deportista/entrenamientos/planes`, capacidad `training.plan.manage`): autoriza por correo exacto a un profesional (`POST /v1/me/training-authorizations`) y revoca la autorización tras confirmarla (`DELETE …/{professional_id}`). Solo muestra las autorizaciones gestionadas en la visita: el contrato no ofrece una consulta de las existentes.
- **Profesional** (`/profesional/entrenamientos/planes`, permiso `training.plan.author`): editor con correo del deportista, título, 1–5 objetivos, periodo y 1–100 sesiones (fecha, deporte, minutos y RPE 1–10); el plan se revisa y se confirma antes de `POST /v1/training-plans`. La clave `Idempotency-Key` se conserva en los reintentos y se renueva si cambian los datos. Las reglas de coherencia (fechas, periodo, sesiones por día) las decide el backend y se listan desde `details`. `/profesional/entrenamientos/planes/:planId` consulta el plan (`GET /v1/training-plans/{plan_id}`); un `404` justo después de crearlo significa que aún se proyecta.

## Historial de entrenamiento (HU011)

Feature `src/app/features/training/history`, contrato `bff-web` 0.8.0 para el historial y 0.15.0 para la lista de deportistas (`core/api/bff-web/training-history.api.ts`).

- **Deportista** (`/deportista/historial/entrenamientos`, sin capacidad de plan): su historial con `GET /v1/training-history`.
- **Profesional** (permiso `training.history.view_assigned`):
  - `/profesional/historial/entrenamientos` lista, con `GET /v1/me/training-athletes` (CA5), los deportistas con autorización vigente: nombre, correo y fecha de autorización, en el orden del backend y con «Cargar más». No hay búsqueda ni ingreso de identificadores, y la revocación retira al deportista cuando se proyecta. Un `503` (nombre y correo incompletos) se muestra como error recuperable, nunca como lista vacía. El código está en `history/authorized-athletes/`.
  - Elegir un deportista abre `/profesional/historial/entrenamientos/:athleteId` (`GET /v1/athletes/{athlete_id}/training-history`). El resultado o la consulta de un plan (HU010) siguen como atajo. `403 athlete_authorization_required` se muestra sin datos.
- Filtros por fecha de fin (día UTC, inclusiva) y deporte (los que informa el backend en `filters.sports`). Orden y páginas los define el backend: «Cargar más» envía el `next_cursor` sin modificarlo (codificado con `encodeURIComponent`) y agrega la página tal como llega. Cada fila abre su detalle.
- Pruebas: `e2e/training-history.spec.ts` (`@simulado`) y `e2e/training-history.integrated.spec.ts` (`@integrado`). La integrada produce 25 sesiones reales con HU032 en `bff-mobile` (`PLAYWRIGHT_BFF_MOBILE_URL`) y cubre los filtros, las dos páginas, el acceso del profesional autorizado y el rechazo a un tercero y tras revocar. Su recorrido de CA5 (lista por nombre y correo y retiro tras revocar) requiere `bff-web` 0.15.0 desplegado.

## Crear evento (HU021)

Feature `src/app/features/events/create-event`, contrato `bff-web` 0.10.0 (`core/api/bff-web/events.api.ts`) y ADR-028.

- `/organizador/eventos/nuevo` (permiso `events.create`): exactamente los campos de ADR-028. La fecha y la hora se capturan en la hora local del lugar y la zona IANA (por defecto, la del navegador; sugerencias de `Intl.supportedValuesOf`); la web compone `starts_at` con el desfase de esa zona en ese instante (`event-time.ts`). El país es el código ISO de 2 letras y se muestra su nombre.
- En la web solo se validan las restricciones del contrato (longitudes tras recortar, patrón del país, rangos y enteros). Fecha futura, país existente y coherencia de la zona los decide el backend y se listan desde `details[{field, issue}]`.
- `Idempotency-Key` por intento lógico: se reintenta automáticamente hasta tres veces (1, 2 y 4 s) solo ante falta de red, `502`, `503` o `504`; nunca ante `4xx`. Al agotar los reintentos, volver a crear usa la misma clave.
- Se presenta el borrador devuelto por `201` en la hora local del evento, sin consultar la proyección.

## Publicar eventos (HU024)

Feature `src/app/features/events/publish-event`, contrato `bff-web` 0.16.0 (`core/api/bff-web/events.api.ts`) y ADR-033.

- `/organizador/eventos/publicacion` (permiso `events.publish`; la guarda `requirePermission` rechaza la ruta cuando la vista de capacidades confirma que falta el permiso). Pestañas «Borradores» y «Publicados» con `GET /v1/me/events?status`, en el orden del backend, con «Cargar más» por cursor. Las fechas se muestran en la zona del navegador, junto con la hora y la zona del evento.
- Elegir un evento abre su detalle a la derecha (`/:eventId`, `GET /v1/events/{event_id}`; un `404` se informa sin datos). «Publicar» pide confirmación y envía `POST /v1/events/{event_id}/publish` sin cuerpo. Se usa una `Idempotency-Key` por intento lógico, que se conserva en los reintentos automáticos (red, `502`, `503`, `504`; hasta tres) y manuales, y se renueva tras el éxito o ante `idempotency_key_reused`.
- Un `422` lista los requisitos faltantes y los marca junto a cada campo. El evento sigue como borrador. Si el inicio ya pasó, se advierte antes de enviar, pero la regla es del backend.
- Tras el `200` se muestran `published_at` y la versión. El evento sale de los borradores y aparece entre los publicados con la respuesta del comando, sin esperar la proyección.
- No captura tarifa, inscritos ni notificaciones, ni edita el evento.
- Pruebas: `e2e/publish-event.spec.ts` (`@simulado`) y `e2e/publish-event.integrated.spec.ts` (`@integrado`). La integrada crea el borrador por API con `POST /v1/events` de `bff-web` (la URL sale del `app-config.json` del ambiente), lo publica desde la pantalla y lo espera en publicados. También comprueba el `404` para un tercero, el `200` público y el `422 not_in_future`. Requiere `bff-web` 0.16.0 desplegado.

## Crear servicio (HU015)

Feature `src/app/features/services/create-service`, contrato `bff-web` 0.16.0 (`core/api/bff-web/services.api.ts`, `POST /v1/services`) y ADR-027.

- `/profesional/servicios/nuevo` (permiso `services.create`): exactamente los campos de ADR-027. Categoría, modalidad, moneda (solo `COP`) y unidad de cobro son listas cerradas. El importe se escribe como texto con coma o punto y viaja como cadena decimal (`"85000.50"`), sin pasar por un número de punto flotante; el formato `es-CO` solo se usa para mostrarlo. `0` es un servicio gratuito.
- Disponibilidad inicial opcional: hasta 100 horarios explícitos, cada uno con fecha y hora de inicio y fin locales, zona IANA (por defecto, la del navegador o la del horario anterior) y cupo de 1 a 100. La web compone cada instante con el desfase de su zona (`event-time.ts`). Sin horarios no se envía `availability`.
- En la web solo se validan las restricciones del contrato (longitudes tras recortar, patrón del importe, catálogos, cupo y máximo de horarios). Futuro, duración de 24 h, horizonte de 365 días, orden, superposición y desfase los decide el backend: se listan desde `details[{field, issue}]` y se marcan en el horario indicado por `availability[i]`.
- `Idempotency-Key` por intento lógico, con los mismos reintentos que HU021. `provider_id` nunca se envía. Se presenta el borrador devuelto por `201` (estado, versión, tarifa de referencia y horarios en su zona); no se publica, cobra ni contrata.
- Pruebas: `e2e/create-service.spec.ts` (`@simulado`) y `e2e/create-service.integrated.spec.ts` (`@integrado`). La integrada pierde la primera respuesta en la red y comprueba que el reintento devuelve el mismo servicio con `Idempotent-Replayed`, que el borrador no aparece en el catálogo de un deportista, que el BFF rechaza al deportista con `403` y que las reglas de los horarios se marcan en su campo. Requiere `bff-web` 0.9.0 o superior desplegado.

## Publicar servicios (HU019)

Feature `src/app/features/services/publish-service`, contrato `bff-web` 0.16.0 (`core/api/bff-web/services.api.ts`) y ADR-027.

- `/profesional/servicios/publicacion` (permiso `services.publish`; la guarda `requirePermission` de HU024 rechaza la ruta cuando la vista de capacidades confirma que falta). Pestañas «Borradores» y «Publicados» con `GET /v1/me/services?status`, en el orden del backend y con «Cargar más» por cursor.
- Elegir un servicio abre su detalle a la derecha (`/:serviceId`, `GET /v1/me/services/{service_id}`; uno ajeno o inexistente responde `404` y se informa sin datos). La tarifa en COP, la unidad de cobro y la disponibilidad futura se muestran como requisitos separados. Se aclara que publicar no confirma pagos ni incluye la tarifa en la afiliación.
- «Publicar» pide confirmación y envía `POST /v1/services/{service_id}/publish` sin cuerpo. Se usa una `Idempotency-Key` por intento lógico, que se conserva en los reintentos automáticos (red, `502`, `503`, `504`; hasta tres) y manuales, y se renueva tras el éxito o ante `idempotency_key_reused`.
- Un `422` lista los requisitos faltantes junto a cada fila y el servicio sigue como borrador. Sin horarios futuros se advierte antes de enviar, pero la regla es del backend.
- Servicios complementarios no tiene proyección: tras el `200`, la lista vuelve a consultar el backend y el servicio ya aparece entre los publicados.
- Pruebas: `e2e/publish-service.spec.ts` (`@simulado`) y `e2e/publish-service.integrated.spec.ts` (`@integrado`). La integrada crea los borradores por API con `POST /v1/services`, publica desde la pantalla perdiendo la primera respuesta en la red y comprueba la misma clave con `Idempotent-Replayed` y versión 2. También comprueba el `200` sin cambio de versión con otra clave, el `404` para otro profesional, la aparición en el catálogo de un deportista y el `422 availability required`. Requiere `bff-web` 0.11.0 o superior desplegado.

## Disponibilidad de servicios (HU020)

Feature `src/app/features/services/availability`, contrato `bff-web` 0.12.0 (`core/api/bff-web/services-availability.api.ts`) y ADR-038.

- **Deportista** (`/deportista/servicios`, opción base «Servicios», sin capacidad de plan): consulta los servicios publicados y sus horarios con `GET /v1/services/availability`. Consultar no reserva ni cobra nada; la tarifa en COP es informativa.
- **Medicina deportiva** (`/deportista/servicios/medico-deportivos`, capacidad `services.sports_medicine.access` del plan `PREMIUM`): la misma pantalla con la categoría `SPORTS_MEDICINE` preseleccionada. Sin la capacidad, el BFF omite esa categoría y la declara en `restricted_categories`; la web muestra el aviso como texto, sin enlace (comparar planes es HU016).
- Filtros: periodo por días locales (por defecto hoy y los 6 días siguientes; hasta 31 días), que se envía como `[from, to)` con el desfase del navegador; categorías y modalidades repetibles; «servicios sin espacios» envía `availability=all` y marca los que no tienen horarios. En la web solo se validan obligatorios, el orden de las fechas y el máximo del periodo; el resto lo decide el backend.
- Los horarios llegan en UTC con la zona del servicio: se muestran en la zona del navegador sin alterar el instante y, si difiere, se indica la zona del servicio. Orden y páginas los define el backend: «Cargar más» envía el `next_cursor` sin modificarlo.
- Ningún error se presenta como catálogo vacío: `401` termina la sesión como vencida; `403`, `422`, `503` y `504` muestran el error con su código de referencia.

## Datos demográficos y fisiológicos (HU005)

Feature `src/app/features/identity/profile`, contrato `bff-web` 0.13.0 (`core/api/bff-web/profile.api.ts`) y ADR-034.

- **Deportista** (`/deportista/perfil`, opción «Mi perfil» sin capacidad de plan): la sección «Datos demográficos y fisiológicos» lee el perfil con `GET /v1/me/profile` y registra o reemplaza cada conjunto con `PUT /v1/me/demographic-profile` y `PUT /v1/me/physiological-profile`. «Datos personales» (HU002) y «Hábitos deportivos» (HU006) aparecen como «Próximamente». Para el organizador y el profesional, «Mi perfil» sigue como «Próximamente» hasta HU002.
- Una sección vacía (`null`) es una invitación a registrar, nunca un error. Se muestra la respuesta del comando mientras la proyección no la alcance; si no llega tras los reintentos, se avisa y se ofrece «Actualizar datos».
- Catálogos cerrados en listas, unidades en la etiqueta de cada campo, decimales como texto (acepta coma o punto) y la fecha de la medición en la hora del navegador, enviada en UTC. La edad es informativa. En la web solo se validan las restricciones por campo del contrato; la edad permitida, la presión coherente y la ventana de la medición las decide el backend y se marcan desde `details[{field, issue}]`.
- **Consentimiento:** «Guardar datos fisiológicos» solo se habilita al marcar la casilla con la versión de `healthDataConsentVersion`, y la casilla se vuelve a pedir en cada guardado. Sin esa versión (`null`) el registro fisiológico no está disponible. El texto de la política aún no existe: no hay enlace.
- El IMC lo calcula el backend y se presenta como «IMC estimado», sin rangos ni clasificaciones: no es una evaluación médica. Los valores de salud no se escriben en consola ni en almacenamiento del navegador.
- `expected_version` es la versión mostrada; `409 version_conflict` no sobrescribe: recarga y muestra los valores vigentes. `Idempotency-Key` por intento lógico, con hasta tres reintentos automáticos (1, 2 y 4 s) ante falta de red, `502`, `503` o `504`; un reintento manual tras un fallo transitorio usa la misma clave.
- Pruebas: `e2e/profile.spec.ts` (`@simulado`, simulador `e2e/support/profile-simulator.ts`) y `e2e/profile.integrated.spec.ts` (`@integrado`), que requiere `bff-web` 0.13.0, `users-management` 0.6.0, `usuarios-read-projector` y `HEALTH_DATA_CONSENT_VERSION=local-dev` en `sportapp-runtime`. Hoy la composición local no cumple esos requisitos, así que el recorrido integrado está bloqueado.

## Contenedor y Kubernetes

Una sola imagen, `sportapp/web`, para Kubernetes local (kubeadm de Docker Desktop) y Cloud Run (ADR-022). Etapa de build con Node 24.14.0 y etapa final `nginxinc/nginx-unprivileged` 1.30.5; ambas fijadas por digest en el `Dockerfile`.

```bash
npm run container:build                 # docker build -t sportapp/web:local .
docker run --rm -p 18082:8080 -e APP_ENV=local -e BFF_WEB_BASE_URL=http://localhost:18080 \
  -e REGISTRATION_POLICIES_VERSION=sportapp-c108-c108plus.v1 -e HEALTH_DATA_CONSENT_VERSION=local-dev sportapp/web:local
bash deploy/docker/smoke-test.sh sportapp/web:local   # Git Bash, Linux o macOS
```

En Windows, la prueba de humo se ejecuta desde Git Bash: `npm run` usaría el `bash` de WSL, que no ve Docker Desktop.

| Elemento                        | Contrato                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Puerto                          | `8080`                                                                                                                           |
| Usuario                         | `101:101` (`nginx`), sin root; compatible con raíz de solo lectura si `/tmp` tiene escritura                                     |
| `APP_ENV`                       | Obligatoria: `local`, `development`, `staging` o `production`                                                                    |
| `BFF_WEB_BASE_URL`              | `http(s)://host[:puerto][/ruta]`; vacía o ausente publica `null`                                                                 |
| `REGISTRATION_POLICIES_VERSION` | De 1 a 32 caracteres entre letras, dígitos y `. _ : + -`; vacía o ausente publica `null`                                         |
| `HEALTH_DATA_CONSENT_VERSION`   | De 1 a 64 caracteres entre letras, dígitos y `. _ : + -`; vacía o ausente publica `null` (registro fisiológico no disponible)    |
| `/app-config.json`              | Generado al arrancar en `/tmp/sportapp`; `Cache-Control: no-store`                                                               |
| `/healthz`                      | `200` sin depender de la aplicación (sondas de Kubernetes)                                                                       |
| Rutas de la SPA                 | Toda ruta que no sea un archivo devuelve `index.html`; un archivo con hash inexistente devuelve `404`                            |
| Caché                           | `index.html` y `app-config.json` sin caché; archivos con hash `max-age=31536000, immutable`; el resto (i18n, favicon) `no-cache` |

Si `APP_ENV`, `BFF_WEB_BASE_URL`, `REGISTRATION_POLICIES_VERSION` o `HEALTH_DATA_CONSENT_VERSION` son inválidas, el contenedor termina con código `64` y un mensaje en la salida de error; nginx no llega a arrancar.

`deploy/k8s/base` (`kubectl kustomize deploy/k8s/base`) define el `Deployment` y el `Service` `web` (puerto `80` → `http`). Lee `APP_ENV`, `BFF_WEB_BASE_URL`, `REGISTRATION_POLICIES_VERSION` y `HEALTH_DATA_CONSENT_VERSION` del ConfigMap `sportapp-runtime`; las dos últimas son las mismas claves que usa users-management. `HEALTH_DATA_CONSENT_VERSION` es opcional (`optional: true`) mientras la plataforma la agrega al ConfigMap: sin ella la web publica `null` y el registro fisiológico queda no disponible. La imagen va sin tag, y el namespace, el ConfigMap, el tag y el acceso en `localhost:18082` los aporta `sport-app-platform`.

| Ambiente                      | `APP_ENV`    | `BFF_WEB_BASE_URL`                           | `REGISTRATION_POLICIES_VERSION`                                                                                               | `HEALTH_DATA_CONSENT_VERSION`               |
| ----------------------------- | ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Desarrollo (Kubernetes local) | `local`      | `http://localhost:18080`                     | `sportapp-c108-c108plus.v1` (variable de Terraform `registration_policies_version`; hoy `local-dev`, pendiente de plataforma) | `local-dev`                                 |
| Producción (Cloud Run)        | `production` | URL pública del servicio Cloud Run `bff-web` | La misma que users-management en producción                                                                                   | La misma que users-management en producción |

Para que el navegador pueda llamar al BFF, `bff-web` debe permitir CORS para el origen de la web (`localhost:18082`, `localhost:4200` y la URL de producción). Es una tarea del backend.

## Pruebas

- **Unitarias y componentes (Jasmine + TestBed):** estado, validadores, transformaciones y estados de interfaz (carga, éxito, vacío, validación, error, conflicto, permiso denegado). La cobertura se reporta en `coverage/`; el umbral web aún no está ratificado, por eso no se aplica uno.
- **Contrato simulado:** `src/app/core/api/contracts/` guarda la copia exacta del OpenAPI consumido (`bff-web` 0.2.0). `*.contract.spec.ts` verifica que los modelos de transporte y el simulador (`src/testing/bff-web/`) cumplan esa copia.
- **Playwright local/PR (`playwright.config.ts`):** levanta la build de producción y ejecuta los recorridos `@simulado`, con el BFF reemplazado por el simulador del contrato. **No es E2E integrado.**
- **Playwright integrado (`playwright.integrated.config.ts`):** se ejecuta contra un ambiente desplegado (`PLAYWRIGHT_BASE_URL`) e incluye los recorridos `@integrado`, que llaman al BFF real. Ejemplo local: `PLAYWRIGHT_BASE_URL=http://localhost:4200 npm run e2e:integrated` con `npm start` y la composición local de la plataforma activa. `PLAYWRIGHT_BFF_MOBILE_URL` (en local, `http://localhost:18081`) es la URL pública de `bff-mobile`. Solo la usa la preparación de `e2e/training-history.integrated.spec.ts` para producir las sesiones terminadas de HU032, como lo haría la app móvil; la aplicación web nunca la llama. Sin ella, ese recorrido falla con un mensaje explícito.

## Integración continua y entrega

GitHub no tiene identidad en GCP: ningún workflow se autentica en GCP, publica imágenes ni despliega. Detalle completo en [docs/ci-cd.md](docs/ci-cd.md).

| Pieza                                   | Responsabilidad                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions                          | Validación sin GCP: `ci-web.yml` en push y PR; `release-web.yml` al publicar un GitHub Release                                                                                                                |
| Cloud Build (`cloudbuild.release.yaml`) | Iniciado desde GCP por un trigger de `sport-app-platform` con un tag SemVer: prueba, construye la imagen una vez, la publica en Artifact Registry y genera `dist/frontend-release.json` con su URI por digest |
| `sport-app-platform` / Cloud Deploy     | Promueve ese digest al servicio Cloud Run, con aprobación obligatoria                                                                                                                                         |
| Terraform                               | Infraestructura en `sport-app-platform`, ejecutada manualmente por el propietario                                                                                                                             |

Workflow `ci-web` (`.github/workflows/ci-web.yml`):

| Evento                                                                                    | Jobs                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `push` a `feature/**`, `fix/**`, `chore/**`, `release/**`, `hotfix/**`, `develop`, `main` | `quality`, `unit-tests`, `build`              |
| `pull_request` hacia `develop` o `main`                                                   | lo anterior + `security`, `e2e` y `container` |

`quality` incluye `npm run release:test`. `build` publica el artefacto web empaquetado de forma reproducible con su SHA-256 y un `manifest.json` (repositorio, commit, versión, checks). `container` construye la imagen y ejecuta `deploy/docker/smoke-test.sh`, en local. Permisos mínimos (`contents: read`) y acciones fijadas a SHA completo. Ningún workflow fusiona ramas automáticamente.

Checks propuestos como obligatorios para el PR: `quality`, `unit-tests`, `build`, `security`, `e2e`, `container`.

Workflow `release-web` (`.github/workflows/release-web.yml`), con `release: types: [published]`:

1. Valida el tag SemVer `vX.Y.Z` o `vX.Y.Z-pre` y que su commit pertenezca a `main`.
2. Ejecuta todas las comprobaciones (formato, lint, tipos, scripts de release, unitarias, auditoría, build y Playwright).
3. Construye la imagen en el runner una sola vez, ejecuta la prueba de humo y calcula el checksum de su sitio.
4. Publica como artefacto del run el paquete de evidencia `release-evidence-<tag>`, con `release-validation.json` (`deploy/release/release-validation.schema.json`).

No se autentica en GCP, no publica la imagen y no despliega.

## Ramas y commits

GitFlow ligero: `feature/HUxxx-descripcion`, `fix/HUxxx-descripcion`, `chore/descripcion`, `release/vX.Y.Z`, `hotfix/vX.Y.Z-descripcion`. `develop` y `main` solo reciben cambios por pull request.

Commits: `<tipo>(<alcance>): <descripción>`, por ejemplo `feat(identity): registrar usuario` o `ci(web): validar contrato del BFF`.

## Pendiente

- Nombre de la cabecera de correlación en el contrato (el backend usa `X-Correlation-ID`).
- Aviso de tratamiento de datos (HU001): datos que el proyecto aún no definió y que el aviso declara pendientes. Son la identificación y el contacto del responsable, la fecha de vigencia, el plazo de conservación, el país de tratamiento y las transferencias, la autoridad de control y el canal para ejercer la supresión, la oposición y la rectificación del nombre y el correo.
- Plataforma: `REGISTRATION_POLICIES_VERSION=sportapp-c108-c108plus.v1` en `sportapp-runtime` y las suscripciones `sportapp.afiliacion.alta-gratuita.v1` y `proyector-usuarios-v1` en el emulador local (`T-HU001-PLAT`).
- Producción: con `SameSite=Strict`, la cookie de sesión solo viaja si la web y `bff-web` comparten sitio (decisión de la capa de borde en la plataforma).
- Evidencia integrada del deportista con plan `ACTIVE`: en la composición local el consumidor del alta gratuita de Afiliación no activa el plan `FREE` (backend/plataforma).
- HU005: `HEALTH_DATA_CONSENT_VERSION` en el ConfigMap `sportapp-runtime` (plataforma) y el recorrido integrado del perfil, que espera el despliegue de `users-management` 0.6.0 y `usuarios-read-projector`. El texto y la URL de la política de datos de salud.
- Recursos de `sport-app-platform` para la release (conexión de Cloud Build con la GitHub App, trigger de tags, cuenta exclusiva con permisos mínimos, bucket de evidencias, consumo de `frontend-release.json` y target de Cloud Deploy con aprobación); ver [docs/ci-cd.md](docs/ci-cd.md).
- Cabeceras de seguridad HTTP (CSP y relacionadas): sin decisión documentada.
- Umbral de cobertura web, herramientas SAST/secretos y `CODEOWNERS`.
- Idiomas y países del MVP y estándar de accesibilidad (ADR-012).
