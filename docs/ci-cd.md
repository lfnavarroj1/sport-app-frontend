# CI/CD del frontend web

Modelo vigente desde el 2026-10-18: **GitHub no tiene identidad en GCP**. Este repositorio produce una imagen inmutable identificada por digest; la plataforma decide cuándo y dónde se despliega.

| Pieza                                            | Dónde vive                                                   | Qué hace                                                                                                                                                                                                                  | Qué no hace                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions (`ci-web.yml`, `release-web.yml`) | este repositorio                                             | Valida: formato, lint, tipos, unitarias, build, seguridad, Playwright, scripts de release, construcción y prueba de humo **local** del contenedor, evidencia                                                              | No se autentica en GCP (sin `google-github-actions/auth`, sin `id-token: write`, sin variables ni secretos GCP), no publica imágenes, no despliega                               |
| Cloud Build (`cloudbuild.release.yaml`)          | este repositorio (archivo) + trigger en `sport-app-platform` | Iniciado desde GCP por un tag SemVer: valida, prueba, construye la imagen **una vez**, la prueba, la publica en Artifact Registry por tag de versión y de commit, obtiene su digest y genera `dist/frontend-release.json` | No despliega, no crea releases ni rollouts de Cloud Deploy, no ejecuta Terraform ni `gcloud run`, no toca IAM, redes, secretos, dominios, APIs ni servicios, no publica `latest` |
| Cloud Deploy                                     | `sport-app-platform`                                         | Promueve el digest de `frontend-release.json` al servicio Cloud Run, con aprobación obligatoria                                                                                                                           | —                                                                                                                                                                                |
| Terraform                                        | `sport-app-platform`                                         | Infraestructura, ejecutada manualmente por el propietario                                                                                                                                                                 | Nunca se ejecuta desde GitHub ni desde Cloud Build                                                                                                                               |

Un push o un pull request nunca despliega. La web no queda «desplegada» por ningún pipeline de este repositorio.

## GitHub Actions

### `ci-web.yml`

Igual que antes en sus comprobaciones, más `npm run release:test` en `quality`.

| Evento                                        | Jobs                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `push` a ramas de trabajo, `develop` o `main` | `quality`, `unit-tests`, `build`                                                    |
| `pull_request` hacia `develop` o `main`       | lo anterior + `security`, `e2e` y `container` (construcción y prueba de humo local) |

### `release-web.yml`: validación de la release, sin GCP

Se dispara con `release: types: [published]` (publicar un GitHub Release). Permisos `contents: read` en todo el workflow.

1. `validate`: el tag es SemVer `vX.Y.Z` o `vX.Y.Z-pre` (`deploy/release/validate-release.sh`), apunta al commit del evento y ese commit pertenece a `main`.
2. `checks`: `npm ci`, formato, lint, tipos, `release:test`, unitarias con cobertura, auditoría de dependencias de producción y build de producción.
3. `e2e`: Playwright completo contra la aplicación local (no es E2E integrado).
4. `container`: construye la imagen **local** una vez, ejecuta `deploy/docker/smoke-test.sh` y calcula el checksum del sitio de esa imagen (`deploy/release/web-artifact.sh`).
5. `evidence`: genera `release-validation.json` (`deploy/release/release-validation.schema.json`) y publica el paquete `release-evidence-<tag>` (manifiesto, `web.tgz`, su `.sha256`, el log de la prueba de humo y el ID local de la imagen) como artefacto del run, durante 90 días.

La imagen de este workflow no se publica: `localImage.published` es siempre `false`. La imagen publicable la construye Cloud Build.

## Cloud Build: `cloudbuild.release.yaml`

Lo ejecuta un trigger creado y administrado en `sport-app-platform`. Cada paso invoca una etapa de `deploy/release/cloudbuild-release.sh` con las sustituciones como variables de entorno.

| Paso         | Imagen (fijada por digest)      | Etapa                                                                                                                                                                                                                        |
| ------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`   | `node:24.14.0-bookworm-slim`    | SemVer, commit de 40 caracteres, registro `<región>-docker.pkg.dev/<proyecto>`, repositorio, bucket; `_RELEASE_TAG`/`_COMMIT_SHA` iguales a `$TAG_NAME`/`$COMMIT_SHA` y `$REPO_FULL_NAME` = `lfnavarroj1/sport-app-frontend` |
| `install`    | Node                            | `npm ci`                                                                                                                                                                                                                     |
| `checks`     | Node                            | `format:check`, `lint`, `typecheck`                                                                                                                                                                                          |
| `unit-tests` | Node                            | Chromium de Playwright (versión fijada en `package-lock.json`) y `npm run test:ci`                                                                                                                                           |
| `audit`      | Node                            | `npm run audit:prod`                                                                                                                                                                                                         |
| `build`      | Node                            | `npm run build`                                                                                                                                                                                                              |
| `image`      | `gcr.io/cloud-builders/docker`  | **Única** construcción: `<registro>/<repositorio>/web:<tag>` y la misma imagen etiquetada `:<commit>`                                                                                                                        |
| `smoke`      | Docker                          | `deploy/docker/smoke-test.sh` contra esa imagen, en la red `cloudbuild` (`SMOKE_TEST_NETWORK`)                                                                                                                               |
| `artifact`   | Docker                          | `web.tgz` reproducible del sitio de esa imagen y su SHA-256                                                                                                                                                                  |
| `publish`    | Docker                          | Comprueba que la imagen es la construida (mismo ID), publica los dos tags y obtiene la URI `…/web@sha256:<digest>`                                                                                                           |
| `manifest`   | Node                            | `dist/frontend-release.json`, validado contra `deploy/release/frontend-release.schema.json`                                                                                                                                  |
| `store`      | `google-cloud-cli:588.0.0-slim` | Si hay `_RELEASE_BUCKET`, sube el manifiesto a `gs://<bucket>/frontend/<tag>/frontend-release.json` con `--if-generation-match=0` (nunca sobrescribe)                                                                        |

Opciones: `logging: CLOUD_LOGGING_ONLY` (sin bucket de logs predeterminado), sin `serviceAccount` (la cuenta la fija el trigger; el repositorio no puede elegir otra), sin campo `images` (no se vuelve a publicar), `E2_HIGHCPU_8` y una hora como máximo. Si una etapa falla, Cloud Build se detiene y no publica nada de las siguientes.

### Sustituciones

| Sustitución       | Obligatoria                          | Valor                                                                                                    |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `_RELEASE_TAG`    | sí (por defecto `$TAG_NAME`)         | `vX.Y.Z` o `vX.Y.Z-pre`                                                                                  |
| `_COMMIT_SHA`     | sí (por defecto `$COMMIT_SHA`)       | SHA-1 completo del commit etiquetado                                                                     |
| `_REGISTRY`       | sí                                   | `<región>-docker.pkg.dev/<proyecto>`                                                                     |
| `_REPOSITORY`     | sí (por defecto `sportapp-frontend`) | repositorio de Artifact Registry del frontend                                                            |
| `_RELEASE_BUCKET` | no                                   | bucket de evidencias aprovisionado desde `sport-app-platform`; vacío, el manifiesto queda solo en el log |

Imagen resultante: `<_REGISTRY>/<_REPOSITORY>/web:<tag>` y `:<commit>`, que apuntan al mismo digest. Nunca `latest`.

### `frontend-release.json`

Esquema: `deploy/release/frontend-release.schema.json` (`schemaVersion` `1.0`). Sin secretos ni referencias mutables: la imagen se identifica solo por digest.

```json
{
  "schemaVersion": "1.0",
  "kind": "frontend-release",
  "repository": "lfnavarroj1/sport-app-frontend",
  "component": "web",
  "version": "1.4.0",
  "tag": "v1.4.0",
  "commit": "<sha-1 de 40 caracteres>",
  "expectedBffContract": {
    "name": "bff-web",
    "version": "0.16.0",
    "sha256": "<sha-256 de la copia del contrato>"
  },
  "artifact": { "name": "web.tgz", "sha256": "<sha-256>", "source": "/usr/share/nginx/html" },
  "checks": [{ "name": "format", "command": "npm run format:check", "status": "passed" }],
  "smokeTest": {
    "status": "passed",
    "script": "deploy/docker/smoke-test.sh",
    "scriptSha256": "<sha-256>",
    "checksPassed": 21
  },
  "image": {
    "uri": "<región>-docker.pkg.dev/<proyecto>/sportapp-frontend/web@sha256:<digest>",
    "digest": "sha256:<digest>"
  },
  "cloudBuild": {
    "buildId": "<id de la build>",
    "projectId": "<proyecto>",
    "location": "<región>"
  },
  "createdAt": "2026-10-18T15:03:24Z"
}
```

`checks` lista, en orden: `format`, `lint`, `typecheck`, `unit-tests`, `dependency-audit`, `production-build` y `container-build`; el manifiesto solo se genera si todas pasaron. `expectedBffContract` sale de `src/app/core/api/contracts/bff-web.openapi.json`. `artifact.sha256` describe exactamente el sitio que contiene la imagen, empaquetado con permisos, fechas y dueños normalizados, de modo que el mismo valor se obtiene en cualquier anfitrión.

## Lo que debe crear `sport-app-platform`

Nada de esto se crea ni se ejecuta desde este repositorio.

1. **Conexión de Cloud Build a GitHub**: conexión de 2.ª generación con la GitHub App de Cloud Build, iniciada desde GCP y vinculada a `lfnavarroj1/sport-app-frontend` con acceso de lectura. Si la autorización de la App exige intervención manual en GitHub, el propietario la hace una vez desde la consola. GitHub no recibe ninguna credencial de GCP.
2. **Trigger** regional `release-frontend`: evento push de tag con el patrón `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`, archivo `cloudbuild.release.yaml`, la cuenta de servicio exclusiva del punto 3 y las sustituciones `_REGISTRY`, `_REPOSITORY` y `_RELEASE_BUCKET`. Recomendado: aprobación de build desactivada solo si los tags están protegidos por un ruleset de GitHub que limite quién puede crearlos.
3. **Cuenta de servicio exclusiva** de construcción del frontend (por ejemplo `cloud-build-frontend`), usada solo por ese trigger.
4. **Permisos mínimos** de esa cuenta:
   - `roles/artifactregistry.writer` **solo** en el repositorio `sportapp-frontend` (no en el proyecto);
   - `roles/logging.logWriter` en el proyecto (logs de la build);
   - `roles/storage.objectCreator` **solo** en el bucket de evidencias, idealmente condicionado al prefijo `frontend/` (sin `objectViewer` ni borrado: no puede reemplazar evidencia);
   - lectura del repositorio a través de la conexión de Cloud Build (no requiere rol adicional sobre GitHub).

   Debe **no** tener: Owner ni Editor, Cloud Run Admin (ni ningún rol de `run.*` de escritura), permisos de IAM (`*.setIamPolicy`, `iam.serviceAccountUser`, `iam.serviceAccountTokenCreator`), permisos para crear infraestructura (Compute, redes, GKE, Cloud SQL, Secret Manager, Service Usage), acceso a `tf-apply-production` ni a su estado de Terraform, y ningún rol de Cloud Deploy (`clouddeploy.releaser`, `clouddeploy.approver`, `clouddeploy.operator`).

5. **Almacenamiento de evidencias**: bucket privado (acceso uniforme, prevención de acceso público), con versionado y política de retención, cifrado (CMEK opcional) y un prefijo por componente (`frontend/`, `backend/`) para que un componente no pueda sobrescribir la evidencia del otro. Lectura solo para la identidad de promoción.
6. **Proceso que consume `frontend-release.json`**: lee el manifiesto del bucket, verifica `schemaVersion`, `repository`, `tag`, `commit`, `expectedBffContract` (compatible con el `bff-web` del mismo release) y `image.uri` por digest, y crea la release de Cloud Deploy con ese digest. Nunca usa un tag.
7. **Target de Cloud Deploy** para el servicio Cloud Run de la web con **aprobación obligatoria** (`requireApproval: true`). La promoción la ejecuta una identidad distinta de la de Cloud Build.

## Validación local sin GCP

- `npm run release:test`: validación de entradas, manifiestos contra sus esquemas y reglas de seguridad sobre el texto de los workflows y de `cloudbuild.release.yaml` (sin acceso a GCP en GitHub; sin despliegue, `latest`, `serviceAccount` ni imágenes sin digest en Cloud Build).
- Las etapas de `deploy/release/cloudbuild-release.sh` se pueden ejecutar con las mismas imágenes de los pasos en una red de Docker llamada `cloudbuild` y con un registro local (`registry:2`) en lugar de Artifact Registry. Así se verificó el 2026-10-18; ver la bitácora de `02-valores-proyecto.md`.
