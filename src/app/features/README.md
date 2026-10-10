# Features por dominio

Una sola aplicación Angular organizada por dominio funcional. Cada carpeta se implementa solo mediante una HU autorizada y se registra en `app.routes.ts` con carga diferida.

| Carpeta       | Dominio backend          | HU web                     |
| ------------- | ------------------------ | -------------------------- |
| `identity`    | `users_management`       | HU001–HU006, HU008, HU009  |
| `affiliation` | `affiliation_management` | HU007, HU016               |
| `training`    | `training_management`    | HU010–HU014                |
| `services`    | `complementary_services` | HU015, HU017, HU019, HU020 |
| `events`      | `events_management`      | HU018, HU021–HU025         |

Reglas:

- Una feature no importa código de otra feature; lo común va a `core` (técnico) o `shared` (visual, sin reglas de negocio).
- Toda llamada remota va al BFF web a través de `core/api`; nunca a un microservicio.
- Los modelos de transporte del BFF se transforman antes de usarse como estado de pantalla.
