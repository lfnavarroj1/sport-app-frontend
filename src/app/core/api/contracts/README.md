# Contratos consumidos

Copias exactas, sin formatear, de los contratos que publica el backend. No se editan a mano: se reemplazan cuando la web adopta una nueva versión, junto con los modelos de transporte y las pruebas.

| Archivo                | Versión | Origen                                                                                        | SHA-256                                                            |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `bff-web.openapi.json` | 0.8.0   | `sport-app-backend`, `contracts/openapi/bff-web.openapi.json` en `develop` `5e6387e` (PR #12) | `927a86e1651983bad45f614f4fa0881f2b0770f4b37c982da05dd5ad25dfa6fa` |

Historial: 0.2.0 (`d13587d`, HU001); 0.3.0 (`92c03d9`, PR #3) agrega `POST /v1/sessions` y `POST /v1/sessions/refresh` (HU003); 0.4.0 (`2046411`, PR #6) saca el refresh token del cuerpo y lo fija en la cookie `HttpOnly` `__Secure-sportapp_refresh`, `/refresh` va sin cuerpo y ambas operaciones exigen un `Origin` permitido (`403 origin_not_allowed`); 0.5.0 (`bafa8a5`, PR #8) agrega `GET /v1/me/capabilities`; 0.6.0 (`5593d56`, PR #9) agrega las operaciones de planes y autorizaciones de entrenamiento (HU010); 0.7.0 (`ca4cb2c`, PR #11) agrega `POST /v1/sessions/revoke` (HU004); 0.8.0 (`24ef7db`, PR #12) agrega `GET /v1/training-history` y `GET /v1/athletes/{athlete_id}/training-history` (HU011). De 0.6.0 a 0.8.0 no cambia ninguna operación ni esquema que ya consumía la web. `POST /v1/users` no cambia desde 0.2.0.

La web consume de 0.8.0 `POST /v1/users` (HU001), `POST /v1/sessions`, `POST /v1/sessions/refresh` y `GET /v1/me/capabilities` (HU003), y las operaciones de HU010: `POST /v1/me/training-authorizations`, `DELETE /v1/me/training-authorizations/{professional_id}`, `POST /v1/training-plans` y `GET /v1/training-plans/{plan_id}` (`bff-web/training.api.ts`), y las de HU011: `GET /v1/training-history` y `GET /v1/athletes/{athlete_id}/training-history` (`bff-web/training-history.api.ts`). `POST /v1/sessions/revoke` (HU004) aún no tiene cliente.

`bff-web/*.contract.spec.ts` verifica que los modelos de transporte y los datos del simulador correspondan a esta copia.
