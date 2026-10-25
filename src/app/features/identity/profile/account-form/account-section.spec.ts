import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ACCOUNT_READ,
  ACCOUNT_UPDATED,
  GET_ACCOUNT_RESPONSES,
  PUT_ACCOUNT_RESPONSES,
  SIMULATED_ACCOUNT_CORRELATION_ID,
  SIMULATED_ACCOUNT_USER_ID,
} from '../../../../../testing/bff-web/account.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { SessionStore } from '../../../../core/session/session.store';
import { AccountForm } from './account-form';
import { AccountGateway } from './account.gateway';
import { Account, AccountDraft, AccountSaveOutcome, toAccount } from './account.model';
import { ACCOUNT_PROJECTION_RETRY_DELAYS_MS, AccountSection } from './account-section';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.28.0.
const V1: Account = toAccount(ACCOUNT_READ);
const V2: Account = toAccount(ACCOUNT_UPDATED);
const V3: Account = {
  fullName: 'Persona Desde Otra Sesión',
  email: 'otra.sesion@example.com',
  version: 3,
};
const DRAFT: AccountDraft = { fullName: V2.fullName, email: V2.email };

function httpError(response: { status: number; body: unknown }): HttpErrorResponse {
  return new HttpErrorResponse({ status: response.status, error: response.body });
}

const SERVER_ERROR: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: SIMULATED_ACCOUNT_CORRELATION_ID,
};

/** Puerto controlado por la prueba: las respuestas se entregan en orden. */
class FakeAccountGateway extends AccountGateway {
  readonly loads: (Account | HttpErrorResponse)[] = [];
  readonly saves: AccountSaveOutcome[] = [];
  readonly calls: { draft: AccountDraft; expectedVersion: number; key: string }[] = [];
  loadCount = 0;
  retriesToReport = 0;

  loadAccount(): Promise<Account> {
    this.loadCount++;
    const next = this.loads.length > 1 ? this.loads.shift()! : this.loads[0];
    return next instanceof HttpErrorResponse ? Promise.reject(next) : Promise.resolve(next);
  }

  saveAccount(
    draft: AccountDraft,
    expectedVersion: number,
    key: string,
    onRetry?: (attempt: number) => void,
  ): Promise<AccountSaveOutcome> {
    this.calls.push({ draft, expectedVersion, key });
    for (let attempt = 1; attempt <= this.retriesToReport; attempt++) {
      onRetry?.(attempt);
    }
    return Promise.resolve(this.saves.shift()!);
  }
}

describe('AccountSection (HU002)', () => {
  let fixture: ComponentFixture<AccountSection>;
  let element: HTMLElement;
  let gateway: FakeAccountGateway;
  let session: SessionStore;

  beforeEach(async () => {
    gateway = new FakeAccountGateway();
    await TestBed.configureTestingModule({
      imports: [AccountSection],
      providers: [
        provideTranslateTesting(),
        { provide: AccountGateway, useValue: gateway },
        { provide: ACCOUNT_PROJECTION_RETRY_DELAYS_MS, useValue: [0, 0] },
      ],
    }).compileComponents();
    session = TestBed.inject(SessionStore);
    session.start({
      user: {
        id: SIMULATED_ACCOUNT_USER_ID,
        fullName: V1.fullName,
        email: V1.email,
        actorType: 'service_provider',
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 600_000,
    });
  });

  afterEach(() => session.end());

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  /** Como `settle`, hasta que se cumpla la condición (cadenas de recargas programadas). */
  async function settleUntil(condition: () => boolean, maxRounds = 30): Promise<void> {
    for (let round = 0; round < maxRounds && !condition(); round++) {
      await settle();
    }
  }

  async function create(...loads: (Account | HttpErrorResponse)[]): Promise<void> {
    gateway.loads.push(...loads);
    fixture = TestBed.createComponent(AccountSection);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  const testId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const button = (text: string) =>
    [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === text,
    );

  async function submitDraft(draft: AccountDraft = DRAFT): Promise<void> {
    const form = fixture.debugElement.query((node) => node.componentInstance instanceof AccountForm)
      .componentInstance as AccountForm;
    form.submitted.emit(draft);
    await settle();
  }

  async function edit(): Promise<void> {
    button('Editar datos personales')!.click();
    await settle();
  }

  it('muestra la carga mientras consulta la cuenta', () => {
    gateway.loads.push(V1);
    fixture = TestBed.createComponent(AccountSection);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;

    expect(testId('state-loading')).not.toBeNull();
  });

  it('CA1: muestra el nombre y el correo vigentes con su título y la acción de editar', async () => {
    await create(V1);

    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Datos personales');
    expect(testId('account-full-name')?.textContent?.trim()).toBe('Persona Sintética');
    expect(testId('account-email')?.textContent?.trim()).toBe('persona@example.com');
    expect(button('Editar datos personales')?.disabled).toBeFalse();
  });

  it('un error de la consulta no se presenta como cuenta vacía y permite reintentar', async () => {
    await create(httpError(GET_ACCOUNT_RESPONSES.upstreamUnavailable), V1);

    const error = testId('state-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain(SIMULATED_ACCOUNT_CORRELATION_ID);
    expect(testId('account-summary')).toBeNull();

    button('Reintentar')!.click();
    await settle();
    expect(testId('account-full-name')?.textContent?.trim()).toBe('Persona Sintética');
  });

  it('404 user_not_found: la cuenta aún se prepara y se puede reintentar', async () => {
    await create(httpError(GET_ACCOUNT_RESPONSES.userNotFound), V1);

    expect(testId('account-not-projected')?.textContent).toContain('aún se están preparando');
    expect(testId('state-error')).toBeNull();

    button('Reintentar')!.click();
    await settle();
    expect(testId('account-not-projected')).toBeNull();
    expect(testId('account-email')?.textContent?.trim()).toBe('persona@example.com');
  });

  it('CA1 y CA6: guarda con la versión vigente, muestra lo confirmado y actualiza la sesión', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({ kind: 'saved', account: V2, replayed: false });

    await submitDraft();

    expect(gateway.calls.length).toBe(1);
    expect(gateway.calls[0].expectedVersion).toBe(1);
    expect(gateway.calls[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(testId('account-full-name')?.textContent?.trim()).toBe('Persona Renombrada');
    expect(testId('account-email')?.textContent?.trim()).toBe('persona.nueva@example.com');
    const saved = testId('account-saved')!;
    expect(saved.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(saved);
    expect(testId('account-replayed')).toBeNull();
    // La sesión sigue abierta, con el nombre y el correo confirmados.
    expect(session.isAuthenticated()).toBeTrue();
    expect(session.accessToken()).toBe('token-sintetico');
    expect(session.user()).toEqual(
      jasmine.objectContaining({ fullName: V2.fullName, email: V2.email }),
    );
  });

  it('CA5: avisa cuando la confirmación corresponde a un envío anterior', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({ kind: 'saved', account: V2, replayed: true });

    await submitDraft();

    expect(testId('account-replayed')).not.toBeNull();
  });

  it('conserva lo confirmado aunque la proyección siga en la versión anterior', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({ kind: 'saved', account: V2, replayed: false });
    await submitDraft();

    // Una edición siguiente parte de la versión confirmada.
    await edit();
    gateway.saves.push({ kind: 'saved', account: { ...V2, version: 3 }, replayed: false });
    await submitDraft();
    expect(gateway.calls[1].expectedVersion).toBe(2);
  });

  it('CA3: un correo de otra cuenta deja el formulario abierto y conserva el valor anterior', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({ kind: 'email_taken' });

    await submitDraft();

    expect(testId('account-form')).not.toBeNull();
    expect(element.textContent).toContain('No puedes usar este correo. Ingresa otro.');
    expect(session.user()?.email).toBe('persona@example.com');

    // Otro intento usa una clave nueva.
    gateway.saves.push({ kind: 'saved', account: V2, replayed: false });
    await submitDraft();
    expect(gateway.calls[1].key).not.toBe(gateway.calls[0].key);
  });

  it('CA4: version_conflict no sobrescribe, recarga y muestra los valores vigentes', async () => {
    await create(V1, V1, V3);
    await edit();
    gateway.saves.push({ kind: 'conflict', currentVersion: 3 });

    await submitDraft();
    await settleUntil(() => testId('account-full-name')?.textContent?.trim() === V3.fullName);

    const conflict = testId('account-conflict')!;
    expect(conflict.getAttribute('role')).toBe('alert');
    expect(testId('account-form')).toBeNull();
    expect(testId('account-full-name')?.textContent?.trim()).toBe(V3.fullName);
    expect(button('Editar datos personales')?.disabled).toBeFalse();
    expect(session.user()?.fullName).toBe('Persona Sintética');
    expect(testId('account-projection-pending')).toBeNull();
  });

  it('CA4: si la proyección no alcanza la versión vigente, impide editar y ofrece actualizar', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({ kind: 'conflict', currentVersion: 3 });

    await submitDraft();
    await settleUntil(() => testId('account-projection-pending') !== null);

    expect(testId('account-projection-pending')).not.toBeNull();
    expect(button('Editar datos personales')?.disabled).toBeTrue();

    gateway.loads.splice(0, gateway.loads.length, V3);
    testId('account-refresh')!.click();
    await settle();
    expect(testId('account-projection-pending')).toBeNull();
    expect(testId('account-email')?.textContent?.trim()).toBe(V3.email);
  });

  it('422: las reglas llegan al formulario y la clave se conserva para el reintento', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({
      kind: 'invalid',
      violations: [{ field: 'full_name', issue: 'invalid_length' }],
    });

    await submitDraft();
    expect(testId('account-errors')?.textContent).toContain('Nombre completo');

    gateway.saves.push({ kind: 'saved', account: V2, replayed: false });
    await submitDraft();
    expect(gateway.calls[1].key).toBe(gateway.calls[0].key);
  });

  it('error recuperable: informa los reintentos, la referencia y conserva la clave', async () => {
    await create(V1);
    await edit();
    gateway.retriesToReport = 3;
    gateway.saves.push({ kind: 'failed', error: SERVER_ERROR });

    await submitDraft();

    const error = testId('account-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('no se repetirá el cambio');
    expect(error.textContent).toContain(SIMULATED_ACCOUNT_CORRELATION_ID);
    expect(document.activeElement).toBe(error);
    expect(testId('account-form')).not.toBeNull();

    gateway.retriesToReport = 0;
    gateway.saves.push({ kind: 'saved', account: V2, replayed: false });
    await submitDraft();
    expect(gateway.calls[1].key).toBe(gateway.calls[0].key);
  });

  it('idempotency_key_reused descarta la clave: el siguiente envío es un intento nuevo', async () => {
    await create(V1);
    await edit();
    gateway.saves.push({
      kind: 'failed',
      error: {
        kind: 'conflict',
        status: 409,
        code: PUT_ACCOUNT_RESPONSES.idempotencyKeyReused.body.code,
        correlationId: null,
      },
    });

    await submitDraft();
    expect(testId('account-error')?.textContent).toContain('No pudimos confirmar el envío');

    gateway.saves.push({ kind: 'saved', account: V2, replayed: false });
    await submitDraft();
    expect(gateway.calls[1].key).not.toBe(gateway.calls[0].key);
  });

  it('cancelar vuelve a la vista sin enviar nada', async () => {
    await create(V1);
    await edit();

    button('Cancelar')!.click();
    await settle();

    expect(testId('account-form')).toBeNull();
    expect(gateway.calls).toEqual([]);
    expect(testId('account-full-name')?.textContent?.trim()).toBe('Persona Sintética');
  });
});
