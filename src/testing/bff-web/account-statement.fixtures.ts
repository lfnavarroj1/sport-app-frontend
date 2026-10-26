/**
 * Simulador de HU007 derivado del contrato bff-web 0.28.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`; la operación es idéntica a la
 * de 0.27.0) y de ADR-036: `GET /v1/me/account-statement`. SportApp no registra
 * pagos: `payments_status` es siempre `NOT_INTEGRATED` y `balance`, `null`. Lo usan
 * las pruebas unitarias y Playwright; `affiliation.contract.spec.ts` valida cada
 * respuesta contra el esquema de la operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { FREE_SUBSCRIPTION, PREMIUM_QUARTERLY_SUBSCRIPTION } from './affiliation.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const ACCOUNT_STATEMENT_PATH = '/v1/me/account-statement';
/** Tamaño de página que pide la web (el contrato admite 1 a 100). */
export const SIMULATED_STATEMENT_PAGE_SIZE = 20;
const CORRELATION_ID = '7c9e1b3d-5f7a-4c9e-8b3d-5f7a9c1e3b5d';

type Periodicity = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
type MovementType =
  | 'FREE_ACTIVATED'
  | 'PLAN_CHANGED'
  | 'RETURNED_TO_FREE'
  | 'COMMITMENT_CREATED'
  | 'COMMITMENT_WAIVED';

const FREE_SUBSCRIPTION_ID = FREE_SUBSCRIPTION.subscription_id;
const PREMIUM_SUBSCRIPTION_ID = PREMIUM_QUARTERLY_SUBSCRIPTION.subscription_id;
export const SIMULATED_COMMITMENT_ID = '9e1b3d5f-7a9c-4e1b-8d5f-7a9c1e3b5d7f';

function movement(
  index: number,
  movementType: MovementType,
  occurredAt: string,
  subscriptionId: string,
  planCode: string,
  periodicity: Periodicity,
  amount: string | null = null,
) {
  const withAmount = movementType === 'COMMITMENT_CREATED' || movementType === 'COMMITMENT_WAIVED';
  return {
    movement_id: `1d3f5a7c-9e1b-4d3f-8a7c-${String(index).padStart(12, '0')}`,
    movement_type: movementType,
    occurred_at: occurredAt,
    subscription_id: subscriptionId,
    plan_code: planCode,
    periodicity,
    commitment_id: withAmount ? SIMULATED_COMMITMENT_ID : null,
    amount: withAmount ? amount : null,
    currency: withAmount ? ('COP' as const) : null,
  };
}

/** Compromiso informativo del cambio a `PREMIUM` trimestral (pago anticipado: vence al inicio). */
export const PENDING_COMMITMENT = {
  commitment_id: SIMULATED_COMMITMENT_ID,
  plan_code: 'PREMIUM',
  periodicity: 'QUARTERLY' as const,
  amount: '14400.00',
  currency: 'COP' as const,
  period_start: '2026-10-24T15:00:00Z',
  period_end: '2027-01-24T15:00:00Z',
  due_at: '2026-10-24T15:00:00Z',
  status: 'PENDING_EXTERNAL' as const,
};

export const WAIVED_COMMITMENT = { ...PENDING_COMMITMENT, status: 'WAIVED' as const };

/** Alta `FREE` del registro (HU001). */
export const FREE_ACTIVATED_MOVEMENT = movement(
  1,
  'FREE_ACTIVATED',
  '2026-10-20T14:00:00Z',
  FREE_SUBSCRIPTION_ID,
  'FREE',
  'NONE',
);

/** Movimientos tras pasar de `FREE` a `PREMIUM` trimestral, en el orden del contrato. */
export const AFTER_UPGRADE_MOVEMENTS = [
  movement(
    3,
    'COMMITMENT_CREATED',
    '2026-10-24T15:00:00Z',
    PREMIUM_SUBSCRIPTION_ID,
    'PREMIUM',
    'QUARTERLY',
    '14400.00',
  ),
  movement(
    2,
    'PLAN_CHANGED',
    '2026-10-24T15:00:00Z',
    PREMIUM_SUBSCRIPTION_ID,
    'PREMIUM',
    'QUARTERLY',
  ),
  FREE_ACTIVATED_MOVEMENT,
];

/** Movimientos tras volver a `FREE` antes del fin del periodo pago. */
export const AFTER_DOWNGRADE_MOVEMENTS = [
  movement(
    5,
    'COMMITMENT_WAIVED',
    '2026-10-26T09:30:00Z',
    PREMIUM_SUBSCRIPTION_ID,
    'PREMIUM',
    'QUARTERLY',
    '14400.00',
  ),
  movement(
    4,
    'RETURNED_TO_FREE',
    '2026-10-26T09:30:00Z',
    '3b5d7f9a-1c3e-4a5b-8d7f-000000000003',
    'FREE',
    'NONE',
  ),
  ...AFTER_UPGRADE_MOVEMENTS,
];

/**
 * Historial sintético de `count` movimientos alternando cambios de plan, del más
 * reciente al más antiguo (`occurred_at DESC, movement_id DESC`), para paginar.
 */
export function longHistory(count: number) {
  return Array.from({ length: count }, (_, position) => {
    const index = count - position;
    const occurredAt = new Date(Date.UTC(2026, 0, 1, 12) + index * 3_600_000)
      .toISOString()
      .replace('.000', '');
    return index === 1
      ? movement(index, 'FREE_ACTIVATED', occurredAt, FREE_SUBSCRIPTION_ID, 'FREE', 'NONE')
      : index % 2 === 0
        ? movement(index, 'PLAN_CHANGED', occurredAt, PREMIUM_SUBSCRIPTION_ID, 'PREMIUM', 'MONTHLY')
        : movement(index, 'RETURNED_TO_FREE', occurredAt, FREE_SUBSCRIPTION_ID, 'FREE', 'NONE');
  });
}

type Subscription = typeof FREE_SUBSCRIPTION | typeof PREMIUM_QUARTERLY_SUBSCRIPTION;
type Movement = ReturnType<typeof movement>;
type Commitment = typeof PENDING_COMMITMENT | typeof WAIVED_COMMITMENT;

/** Respuesta `200` del contrato. */
export function statementResponse(
  statementStatus: 'ACTIVE' | 'PROVISIONING' | 'NOT_APPLICABLE' | 'NONE',
  subscription: Subscription | null,
  commitments: readonly Commitment[],
  movements: readonly Movement[],
  nextCursor: string | null = null,
) {
  return {
    statement_status: statementStatus,
    subscription,
    commitments,
    movements,
    next_cursor: nextCursor,
    payments_status: 'NOT_INTEGRATED' as const,
    balance: null,
  };
}

/** Cursor opaco sintético de la página que empieza en `offset`. */
export function simulatedCursor(offset: number): string {
  return `c2ltdWxhZG8t${offset}`;
}

/** Desplazamiento de un cursor sintético, o `null` si no lo emitió el simulador. */
export function offsetOfCursor(cursor: string): number | null {
  const match = /^c2ltdWxhZG8t(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : null;
}

/** Página de `movements` desde `offset`, con su `next_cursor`. */
export function statementPage(
  statementStatus: 'ACTIVE' | 'NONE',
  subscription: Subscription | null,
  commitments: readonly Commitment[],
  movements: readonly Movement[],
  offset: number,
  limit = SIMULATED_STATEMENT_PAGE_SIZE,
) {
  const end = offset + limit;
  return statementResponse(
    statementStatus,
    subscription,
    commitments,
    movements.slice(offset, end),
    end < movements.length ? simulatedCursor(end) : null,
  );
}

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const ACCOUNT_STATEMENT_RESPONSES = {
  /** CA1: deportista tras subir a `PREMIUM` trimestral, con el compromiso pendiente. */
  activePremium: {
    status: 200,
    body: statementResponse(
      'ACTIVE',
      PREMIUM_QUARTERLY_SUBSCRIPTION,
      [PENDING_COMMITMENT],
      AFTER_UPGRADE_MOVEMENTS,
    ),
  },
  /** Deportista recién registrado: `FREE` sin compromisos. */
  activeFree: {
    status: 200,
    body: statementResponse('ACTIVE', FREE_SUBSCRIPTION, [], [FREE_ACTIVATED_MOVEMENT]),
  },
  /** Volvió a `FREE` antes del fin del periodo: el compromiso queda `WAIVED`. */
  backToFree: {
    status: 200,
    body: statementResponse(
      'ACTIVE',
      FREE_SUBSCRIPTION,
      [WAIVED_COMMITMENT],
      AFTER_DOWNGRADE_MOVEMENTS,
    ),
  },
  /** CA5: primera página de un historial de 25 movimientos. */
  firstPage: {
    status: 200,
    body: statementPage('ACTIVE', FREE_SUBSCRIPTION, [], longHistory(25), 0),
  },
  /** CA5: segunda y última página del mismo historial. */
  lastPage: {
    status: 200,
    body: statementPage('ACTIVE', FREE_SUBSCRIPTION, [], longHistory(25), 20),
  },
  /** CA2: el alta gratuita aún no termina. */
  provisioning: { status: 200, body: statementResponse('PROVISIONING', null, [], []) },
  /** CA2: organizador o profesional. */
  notApplicable: { status: 200, body: statementResponse('NOT_APPLICABLE', null, [], []) },
  /** Sin suscripción activa pero con historial. */
  none: {
    status: 200,
    body: statementResponse('NONE', null, [WAIVED_COMMITMENT], AFTER_DOWNGRADE_MOVEMENTS),
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'Tipo de actor desconocido.'),
  invalidCursor: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'query.cursor', issue: 'invalid_cursor' },
  ]),
  limitOutOfRange: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'query.limit', issue: 'out_of_range' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_STATEMENT_CORRELATION_ID = CORRELATION_ID;
