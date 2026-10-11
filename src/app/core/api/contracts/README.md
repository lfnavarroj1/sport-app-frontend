# Contratos consumidos

Copias exactas, sin formatear, de los contratos que publica el backend. No se editan a mano: se reemplazan cuando la web adopta una nueva versión, junto con los modelos de transporte y las pruebas.

| Archivo                | Versión | Origen                                                                                       | SHA-256                                                            |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `bff-web.openapi.json` | 0.3.0   | `sport-app-backend`, `contracts/openapi/bff-web.openapi.json` en `develop` `92c03d9` (PR #3) | `ebbc66f19e43f5e03069f9cd9b41aa3d532456721999b9a2658f944f7e478922` |

Historial: 0.2.0 (`d13587d`, HU001). La versión 0.3.0 agrega `POST /v1/sessions` y `POST /v1/sessions/refresh` (HU003) sin cambiar `POST /v1/users`.

`bff-web/*.contract.spec.ts` verifica que los modelos de transporte y los datos del simulador correspondan a esta copia.
