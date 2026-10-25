import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import {
  ACCOUNT_STATEMENT_RESPONSES,
  SIMULATED_STATEMENT_CORRELATION_ID,
} from '../../../../../testing/bff-web/account-statement.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { AccountStatementResponseDto } from '../../../../core/api/bff-web/affiliation.api';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { AccountStatementGateway } from '../account-statement.gateway';
import {
  ACCOUNT_STATEMENT_FRAGMENT,
  AccountStatement,
  MovementsPage,
  toAccountStatement,
} from '../account-statement.model';
import { AccountStatementSection } from './account-statement-section';

const statement = (dto: AccountStatementResponseDto): AccountStatement => toAccountStatement(dto);
const ACTIVE_PREMIUM = statement(ACCOUNT_STATEMENT_RESPONSES.activePremium.body);
const FIRST_PAGE = statement(ACCOUNT_STATEMENT_RESPONSES.firstPage.body);
const LAST_PAGE: MovementsPage = statement(ACCOUNT_STATEMENT_RESPONSES.lastPage.body);

function httpError(response: { status: number; body: unknown }): HttpErrorResponse {
  return new HttpErrorResponse({ status: response.status, error: response.body });
}

describe('AccountStatementSection (HU007)', () => {
  let fixture: ComponentFixture<AccountStatementSection>;
  let element: HTMLElement;
  let gateway: jasmine.SpyObj<AccountStatementGateway>;

  function configure(fragment: string | null = null): void {
    gateway = jasmine.createSpyObj<AccountStatementGateway>('AccountStatementGateway', [
      'load',
      'loadMore',
    ]);
    TestBed.configureTestingModule({
      imports: [AccountStatementSection],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: AccountStatementGateway, useValue: gateway },
        ...(fragment === null
          ? []
          : [{ provide: ActivatedRoute, useValue: { snapshot: { fragment } } }]),
      ],
    });
  }

  async function create(
    result: AccountStatement | Promise<AccountStatement> = ACTIVE_PREMIUM,
  ): Promise<void> {
    gateway.load.and.returnValue(Promise.resolve(result));
    fixture = TestBed.createComponent(AccountStatementSection);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function text(id: string): string {
    return testId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );
  }

  async function click(label: string): Promise<void> {
    button(label)!.click();
    await settle();
  }

  function rows(): HTMLTableRowElement[] {
    return [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  }

  describe('carga y errores', () => {
    beforeEach(() => configure());

    it('muestra la carga mientras llega el estado de cuenta', async () => {
      await create(new Promise<AccountStatement>(() => undefined));

      expect(element.querySelector('h2')?.textContent?.trim()).toBe('Estado de cuenta');
      expect(testId('state-loading')).not.toBeNull();
      expect(testId('account-statement-content')).toBeNull();
    });

    it('un fallo se informa con su referencia, nunca como cuenta vacía, y se puede reintentar', async () => {
      gateway.load.and.returnValues(
        Promise.reject(httpError(ACCOUNT_STATEMENT_RESPONSES.upstreamUnavailable)),
        Promise.resolve(ACTIVE_PREMIUM),
      );
      fixture = TestBed.createComponent(AccountStatementSection);
      element = fixture.nativeElement as HTMLElement;
      await settle();

      const error = testId('state-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain(SIMULATED_STATEMENT_CORRELATION_ID);
      expect(testId('account-statement-no-movements')).toBeNull();

      await click('Reintentar');
      expect(gateway.load).toHaveBeenCalledTimes(2);
      expect(rows().length).toBe(3);
    });
  });

  describe('deportista con suscripción (CA1 y CA4)', () => {
    beforeEach(() => configure());

    it('CA1: muestra plan, versión, oferta, precio, periodo y próximo vencimiento con la zona visible', async () => {
      await create();

      const content = testId('account-statement-content')!;
      expect(content.getAttribute('data-statement-status')).toBe('ACTIVE');
      expect(text('account-statement-plan')).toBe('Premium');
      expect(text('account-statement-plan-version')).toBe('2');
      expect(text('account-statement-offer')).toBe('Trimestral');
      expect(text('account-statement-price')).toMatch(
        /^\$\s14\.400 \(precio de referencia, pago no confirmado\)$/,
      );
      expect(text('account-statement-period-start')).toContain('2026');
      expect(text('account-statement-next-due')).toContain('2027');
      expect(text('account-statement-time-zone')).toContain(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    });

    it('CA4: presenta la información financiera como no confirmada y sin saldo', async () => {
      await create();

      const notice = testId('account-statement-payments')!;
      expect(notice.getAttribute('role')).toBe('note');
      expect(notice.textContent).toContain('SportApp no registra pagos');
      expect(text('account-statement-balance')).toBe('No disponible: SportApp no registra pagos');
      expect(element.textContent).not.toMatch(/\bpagado\b|cobrado|saldo a favor/i);
    });

    it('CA1: lista el compromiso PENDING_EXTERNAL con importe, periodo y fecha informativa', async () => {
      await create();

      const items = testId('account-statement-commitments')!.querySelectorAll('li');
      expect(items.length).toBe(1);
      expect(items[0].getAttribute('data-commitment-status')).toBe('PENDING_EXTERNAL');
      expect(items[0].textContent).toContain('Premium');
      expect(items[0].textContent).toContain('Trimestral');
      expect(items[0].textContent).toContain(
        'Pendiente de pago externo: SportApp no lo cobra ni lo confirma',
      );
      expect(items[0].textContent).toMatch(/\$\s14\.400 \(precio de referencia, pago no confirmado\)/);
      expect(items[0].textContent).toContain('Fecha de pago (informativa)');
    });

    it('un compromiso WAIVED se presenta sin efecto al volver al plan gratuito', async () => {
      await create(statement(ACCOUNT_STATEMENT_RESPONSES.backToFree.body));

      const item = testId('account-statement-commitments')!.querySelector('li')!;
      expect(item.getAttribute('data-commitment-status')).toBe('WAIVED');
      expect(item.textContent).toContain('Sin efecto');
      expect(text('account-statement-plan')).toBe('Gratuito');
      expect(text('account-statement-price')).toBe('Sin costo');
      expect(text('account-statement-next-due')).toBe('Sin vencimiento');
    });

    it('CA1: muestra los movimientos en el orden del BFF, con su tipo, plan e importe', async () => {
      await create();

      expect(rows().map((row) => row.getAttribute('data-movement-type'))).toEqual([
        'COMMITMENT_CREATED',
        'PLAN_CHANGED',
        'FREE_ACTIVATED',
      ]);
      const cells = rows().map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()),
      );
      expect(cells[0][1]).toBe('Compromiso informativo registrado');
      expect(cells[0][2]).toBe('Premium · Trimestral');
      expect(cells[0][3]).toMatch(/^\$\s14\.400$/);
      expect(cells[1][1]).toBe('Cambio de plan');
      expect(cells[1][3]).toBe('No aplica');
      expect(cells[2][1]).toBe('Plan gratuito activado');
      expect(cells[2][2]).toBe('Gratuito');
      expect(cells[0][0]).toContain('2026');
    });

    it('un deportista FREE sin compromisos lo indica', async () => {
      await create(statement(ACCOUNT_STATEMENT_RESPONSES.activeFree.body));

      expect(text('account-statement-no-commitments')).toBe('No tienes compromisos de pago.');
      expect(rows().length).toBe(1);
    });

    it('NONE: sin suscripción activa muestra el aviso y el historial', async () => {
      await create(statement(ACCOUNT_STATEMENT_RESPONSES.none.body));

      expect(testId('account-statement-subscription')).toBeNull();
      expect(text('account-statement-none')).toContain('No tienes una suscripción activa');
      expect(testId('account-statement-payments')).not.toBeNull();
      expect(rows().length).toBe(5);
    });

    it('sin movimientos lo indica sin presentarlo como error', async () => {
      await create({ ...ACTIVE_PREMIUM, movements: [] });

      expect(text('account-statement-no-movements')).toBe('Aún no hay movimientos.');
      expect(testId('account-statement-movements')).toBeNull();
      expect(testId('state-error')).toBeNull();
    });
  });

  describe('estados sin cuenta (CA2)', () => {
    beforeEach(() => configure());

    it('NOT_APPLICABLE (organizador o profesional) es un estado explícito, no un error', async () => {
      await create(statement(ACCOUNT_STATEMENT_RESPONSES.notApplicable.body));

      const status = testId('account-statement-not-applicable')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(status.textContent).toContain('no tiene un plan de afiliación');
      expect(testId('state-error')).toBeNull();
      expect(testId('account-statement-movements')).toBeNull();
      expect(testId('account-statement-commitments')).toBeNull();
    });

    it('PROVISIONING se informa y permite volver a consultar', async () => {
      gateway.load.and.returnValues(
        Promise.resolve(statement(ACCOUNT_STATEMENT_RESPONSES.provisioning.body)),
        Promise.resolve(statement(ACCOUNT_STATEMENT_RESPONSES.activeFree.body)),
      );
      fixture = TestBed.createComponent(AccountStatementSection);
      element = fixture.nativeElement as HTMLElement;
      await settle();

      expect(text('account-statement-provisioning')).toContain('Estamos activando tu plan gratuito');
      expect(testId('state-error')).toBeNull();

      await click('Volver a consultar');
      expect(gateway.load).toHaveBeenCalledTimes(2);
      expect(text('account-statement-plan')).toBe('Gratuito');
    });
  });

  describe('paginación (CA5)', () => {
    beforeEach(() => configure());

    it('«Cargar más» envía el cursor sin modificar y agrega la página siguiente', async () => {
      gateway.loadMore.and.resolveTo(LAST_PAGE);
      await create(FIRST_PAGE);
      expect(rows().length).toBe(20);

      await click('Cargar más movimientos');

      expect(gateway.loadMore).toHaveBeenCalledOnceWith(FIRST_PAGE.nextCursor!);
      expect(rows().length).toBe(25);
      const ids = rows().map((row) => row.textContent);
      expect(new Set(ids).size).toBe(25);
      expect(testId('account-statement-load-more')).toBeNull();
    });

    it('no pide dos veces la misma página mientras carga', async () => {
      gateway.loadMore.and.returnValue(new Promise<MovementsPage>(() => undefined));
      await create(FIRST_PAGE);

      button('Cargar más movimientos')!.click();
      await settle();
      const loading = testId('account-statement-load-more') as HTMLButtonElement;
      expect(loading.disabled).toBeTrue();
      expect(loading.textContent?.trim()).toBe('Cargando movimientos…');
      loading.click();
      await settle();

      expect(gateway.loadMore).toHaveBeenCalledTimes(1);
    });

    it('un fallo al cargar más conserva lo mostrado y permite reintentar', async () => {
      gateway.loadMore.and.returnValues(
        Promise.reject(httpError(ACCOUNT_STATEMENT_RESPONSES.upstreamTimeout)),
        Promise.resolve(LAST_PAGE),
      );
      await create(FIRST_PAGE);

      await click('Cargar más movimientos');
      const error = testId('account-statement-more-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain(SIMULATED_STATEMENT_CORRELATION_ID);
      expect(rows().length).toBe(20);

      await click('Reintentar');
      expect(gateway.loadMore.calls.allArgs()).toEqual([
        [FIRST_PAGE.nextCursor!],
        [FIRST_PAGE.nextCursor!],
      ]);
      expect(rows().length).toBe(25);
      expect(testId('account-statement-more-error')).toBeNull();
    });

    it('un cursor rechazado (422) ofrece volver a cargar desde el inicio', async () => {
      gateway.loadMore.and.rejectWith(httpError(ACCOUNT_STATEMENT_RESPONSES.invalidCursor));
      await create(FIRST_PAGE);

      await click('Cargar más movimientos');
      expect(text('account-statement-more-error')).toContain(
        'No pudimos cargar más movimientos desde este punto',
      );
      expect(button('Reintentar')).toBeUndefined();

      await click('Volver a cargar el estado de cuenta');
      expect(gateway.load).toHaveBeenCalledTimes(2);
      expect(testId('account-statement-more-error')).toBeNull();
    });
  });

  describe('accesibilidad', () => {
    it('la sección y la tabla tienen nombre accesible y encabezados de columna', async () => {
      configure();
      await create();

      const section = testId('account-statement')!;
      expect(section.id).toBe(ACCOUNT_STATEMENT_FRAGMENT);
      expect(section.getAttribute('aria-labelledby')).toBe('account-statement-title');
      const table = testId('account-statement-movements')!;
      expect(element.querySelector(`#${table.getAttribute('aria-labelledby')}`)?.textContent).toContain(
        'Movimientos',
      );
      expect(
        [...table.querySelectorAll('th')].map((th) => [th.getAttribute('scope'), th.textContent?.trim()]),
      ).toEqual([
        ['col', 'Fecha'],
        ['col', 'Movimiento'],
        ['col', 'Plan'],
        ['col', 'Importe'],
      ]);
    });

    it('desde el enlace de «Mi plan» lleva el foco al título de la sección', async () => {
      configure(ACCOUNT_STATEMENT_FRAGMENT);
      await create();

      expect(document.activeElement).toBe(element.querySelector('h2'));
    });

    it('sin el fragmento no mueve el foco', async () => {
      configure();
      await create();

      expect(document.activeElement).not.toBe(element.querySelector('h2'));
    });
  });
});
