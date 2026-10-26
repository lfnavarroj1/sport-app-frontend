import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { toApiError } from '../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { SessionAccess, SessionAccessStore } from '../../../../core/session/session-access.store';
import { ViewState } from '../../../../shared/ui/view-state';
import {
  FREE_SUBSCRIPTION,
  PLANS_RESPONSES,
  PREMIUM_QUARTERLY_SUBSCRIPTION,
  PROVISIONING_SUBSCRIPTION,
  SUBSCRIPTION_CHANGE_RESPONSES,
} from '../../../../../testing/bff-web/affiliation.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { MyPlanGateway } from '../my-plan.gateway';
import { ChangeOutcome, MyPlan, toCatalog, toSubscription } from '../my-plan.model';
import { MyPlanPage } from './my-plan-page';

// Datos sintéticos derivados de los fixtures del contrato bff-web 0.20.0.
const FREE_PLAN: MyPlan = {
  catalog: toCatalog(PLANS_RESPONSES.free.body),
  subscription: toSubscription(FREE_SUBSCRIPTION),
};
const PREMIUM_PLAN: MyPlan = {
  catalog: { ...FREE_PLAN.catalog, currentPlanCode: 'PREMIUM' },
  subscription: toSubscription(PREMIUM_QUARTERLY_SUBSCRIPTION),
};
const PROVISIONING_PLAN: MyPlan = {
  catalog: toCatalog(PLANS_RESPONSES.provisioning.body),
  subscription: toSubscription(PROVISIONING_SUBSCRIPTION),
};
const CHANGED: ChangeOutcome = {
  kind: 'changed',
  subscription: toSubscription(SUBSCRIPTION_CHANGE_RESPONSES.changed.body),
  replayed: false,
};
const BACK_TO_FREE: ChangeOutcome = {
  kind: 'changed',
  subscription: toSubscription(SUBSCRIPTION_CHANGE_RESPONSES.backToFree.body),
  replayed: false,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Espacios, incluido el de no separación que usa `Intl` entre el signo y el importe. */
const NBSP = /\s/g;

function failed(status: number, code: string): ChangeOutcome {
  return {
    kind: 'failed',
    error: toApiError(
      new HttpErrorResponse({
        status,
        error: { code, message: 'simulado', correlation_id: 'ref-sintetica-16', details: [] },
      }),
    ),
  };
}

function accessView(capabilities: string[]): ViewState<SessionAccess> {
  return {
    status: 'success',
    data: {
      actorType: 'athlete',
      subscriptionStatus: 'ACTIVE',
      permissions: new Set(),
      capabilities: new Set(capabilities),
    },
  };
}

describe('MyPlanPage (HU016)', () => {
  let fixture: ComponentFixture<MyPlanPage>;
  let element: HTMLElement;
  let load: jasmine.Spy;
  let change: jasmine.Spy;
  let view: ReturnType<typeof signal<ViewState<SessionAccess> | null>>;
  let reload: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(MyPlanPage);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const byTestId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) => byTestId(id)?.textContent?.replace(NBSP, ' ').trim() ?? '';
  const card = (code: string) => element.querySelector<HTMLElement>(`[data-plan="${code}"]`)!;

  function button(label: string, scope: HTMLElement = element): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
  }

  async function click(label: string, scope?: HTMLElement): Promise<void> {
    const target = button(label, scope);
    expect(target).withContext(label).toBeDefined();
    target!.click();
    await settle();
  }

  async function choosePeriodicity(label: RegExp): Promise<void> {
    const radio = [...element.querySelectorAll<HTMLElement>('mat-radio-button')].find((r) =>
      label.test(r.textContent ?? ''),
    );
    radio!.querySelector<HTMLInputElement>('input')!.click();
    await settle();
  }

  async function changeToPremiumQuarterly(): Promise<void> {
    await click('Elegir Premium', card('PREMIUM'));
    await choosePeriodicity(/Trimestral/);
    await click('Continuar');
    await click('Confirmar cambio');
  }

  beforeEach(async () => {
    load = jasmine.createSpy('load').and.resolveTo(FREE_PLAN);
    change = jasmine.createSpy('change').and.resolveTo(CHANGED);
    view = signal<ViewState<SessionAccess> | null>(accessView(['training.plan.manage']));
    reload = jasmine.createSpy('reload');
    await TestBed.configureTestingModule({
      imports: [MyPlanPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: MyPlanGateway, useValue: { load, change } },
        { provide: SessionAccessStore, useValue: { view: view.asReadonly(), reload } },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta el plan', async () => {
    load.and.returnValue(new Promise(() => undefined));
    await create();

    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('un fallo de la consulta es un error con referencia y reintento, no un plan gratuito', async () => {
    load.and.rejectWith(
      new HttpErrorResponse({
        status: 503,
        error: { code: 'upstream_unavailable', correlation_id: 'ref-sintetica-16' },
      }),
    );
    await create();

    expect(byTestId('state-error')?.textContent).toContain('ref-sintetica-16');
    expect(byTestId('my-plan-current')).toBeNull();
    load.and.resolveTo(FREE_PLAN);
    await click('Reintentar');
    expect(text('my-plan-current-name')).toBe('Gratuito');
  });

  describe('plan actual y comparación', () => {
    it('CA7: el deportista recién registrado ve FREE como plan actual sin elegirlo', async () => {
      await create();

      expect(text('my-plan-current-name')).toBe('Gratuito');
      expect(text('my-plan-current-periodicity')).toBe('Sin periodicidad');
      expect(text('my-plan-current-price')).toBe('Sin costo');
      expect(text('my-plan-current-end')).toBe('Sin vencimiento');
      expect(card('FREE').querySelector('[data-testid="my-plan-current-badge"]')).not.toBeNull();
      expect(button('Elegir Gratuito')).toBeUndefined();
    });

    it('HU007: enlaza al estado de cuenta de «Mi perfil»', async () => {
      await create();

      const link = byTestId('my-plan-statement-link') as HTMLAnchorElement;
      expect(link.textContent?.trim()).toBe('Ver mi estado de cuenta');
      expect(link.getAttribute('href')).toBe('/deportista/perfil#estado-de-cuenta');
    });

    it('compara los tres planes por capacidades propias y heredadas, y por ofertas en COP', async () => {
      await create();

      const plans = [...element.querySelectorAll<HTMLElement>('[data-plan]')];
      expect(plans.map((plan) => plan.dataset['plan'])).toEqual([
        'FREE',
        'INTERMEDIATE',
        'PREMIUM',
      ]);
      const premium = card('PREMIUM');
      expect(premium.querySelector('h4')?.textContent).toContain('Precios');
      expect(premium.textContent).toContain('Agrega a los planes anteriores');
      const own = premium.querySelector('[data-testid="my-plan-own-capabilities"]')!;
      expect(own.querySelectorAll('li').length).toBe(2);
      expect(own.textContent).toContain('Servicios médicos y deportivos');
      expect(own.textContent).toContain('Sesiones virtuales');
      expect(
        premium.querySelector('[data-testid="my-plan-inherited-capabilities"] summary')
          ?.textContent,
      ).toContain('Incluye además 14 funciones de los planes anteriores');
      const offers = premium.querySelector('[data-testid="my-plan-offers"]')!.textContent!;
      expect(offers.replace(NBSP, ' ')).toContain('Mensual: $ 4.800');
      expect(offers.replace(NBSP, ' ')).toContain('Trimestral: $ 14.400');
      expect(offers.replace(NBSP, ' ')).toContain('Anual: $ 57.600');
      expect(card('FREE').textContent).toContain('Incluye');
      expect(card('FREE').querySelector('[data-testid="my-plan-offers"]')?.textContent).toContain(
        'Sin costo',
      );
    });

    it('un plan no seleccionable no ofrece elegirlo', async () => {
      const plans = FREE_PLAN.catalog.plans.map((plan) =>
        plan.code === 'INTERMEDIATE' ? { ...plan, selectable: false } : plan,
      );
      load.and.resolveTo({ ...FREE_PLAN, catalog: { ...FREE_PLAN.catalog, plans } });
      await create();

      expect(button('Elegir Intermedio')).toBeUndefined();
      expect(card('INTERMEDIATE').textContent).toContain('no está disponible para seleccionar');
    });

    it('PROVISIONING: informa la activación, no permite elegir y vuelve a consultar', async () => {
      load.and.resolveTo(PROVISIONING_PLAN);
      await create();

      expect(text('my-plan-provisioning')).toContain('Estamos activando tu plan gratuito');
      expect(element.querySelectorAll('[data-plan] button').length).toBe(0);
      load.and.resolveTo(FREE_PLAN);
      await click('Volver a consultar');
      expect(load).toHaveBeenCalledTimes(2);
      expect(text('my-plan-current-name')).toBe('Gratuito');
    });

    it('el plan pago vigente muestra periodo y precio, y ofrece cambiar de periodicidad', async () => {
      load.and.resolveTo(PREMIUM_PLAN);
      await create();

      expect(text('my-plan-current-name')).toBe('Premium');
      expect(text('my-plan-current-periodicity')).toBe('Trimestral');
      expect(text('my-plan-current-price')).toBe('$ 14.400');
      expect(text('my-plan-current-end')).not.toBe('Sin vencimiento');
      await click('Elegir Premium', card('PREMIUM'));
      const current = [...element.querySelectorAll('mat-radio-button')].find((radio) =>
        radio.textContent?.includes('Trimestral'),
      );
      expect(current?.textContent).toContain('tu periodicidad actual');
      expect(current?.querySelector('input')?.disabled).toBeTrue();
    });
  });

  describe('elegir y confirmar', () => {
    it('la periodicidad solo se pide en planes pagos y es obligatoria', async () => {
      await create();
      await click('Elegir Premium', card('PREMIUM'));

      expect(element.querySelectorAll('mat-radio-button').length).toBe(3);
      await click('Continuar');
      expect(text('my-plan-periodicity-missing')).toBe('Elige una periodicidad para continuar.');
      expect(byTestId('my-plan-confirm')).toBeNull();
      expect(change).not.toHaveBeenCalled();
    });

    it('la confirmación resume la oferta, lo que se gana y el aviso de no cobro', async () => {
      await create();
      await click('Elegir Premium', card('PREMIUM'));
      await choosePeriodicity(/Trimestral/);
      await click('Continuar');

      expect(text('my-plan-confirm-plan')).toBe('Premium');
      expect(text('my-plan-confirm-periodicity')).toBe('Trimestral');
      expect(text('my-plan-confirm-price')).toBe('$ 14.400');
      expect(byTestId('my-plan-confirm')?.textContent).toContain('3 meses');
      expect(byTestId('my-plan-gained')?.querySelectorAll('li').length).toBe(5);
      expect(byTestId('my-plan-lost')).toBeNull();
      expect(text('my-plan-payment-notice')).toBe(
        'SportApp no procesa el pago; se registra un compromiso informativo.',
      );
      expect(document.activeElement?.id).toBe('my-plan-confirm-heading');
    });

    it('CA1 y CA8: confirma, muestra lo confirmado y reconstruye el menú sin cerrar sesión', async () => {
      await create();
      await changeToPremiumQuarterly();

      expect(change).toHaveBeenCalledOnceWith(
        { planCode: 'PREMIUM', periodicity: 'QUARTERLY', expectedVersion: 1 },
        jasmine.stringMatching(UUID),
        jasmine.any(Function),
      );
      expect(text('my-plan-changed')).toContain('Ahora tienes el plan Premium.');
      expect(text('my-plan-result-payment')).toContain('compromiso informativo pendiente');
      expect(text('my-plan-current-name')).toBe('Premium');
      expect(text('my-plan-current-periodicity')).toBe('Trimestral');
      expect(card('PREMIUM').querySelector('[data-testid="my-plan-current-badge"]')).not.toBeNull();
      expect(byTestId('my-plan-selection')).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(text('my-plan-menu-status')).toBe('Actualizando las opciones de tu menú…');

      view.set(accessView(['training.plan.manage', 'services.sports_medicine.access']));
      await settle();
      expect(text('my-plan-menu-status')).toBe('Tu menú ya muestra las opciones de tu plan.');
    });

    it('si las capacidades no se pudieron reconsultar, lo informa sin deshacer el cambio', async () => {
      await create();
      await changeToPremiumQuarterly();
      view.set({ status: 'error', error: toApiError(new HttpErrorResponse({ status: 503 })) });
      await settle();

      expect(text('my-plan-menu-status')).toContain('No pudimos actualizar las opciones');
      expect(text('my-plan-current-name')).toBe('Premium');
    });

    it('CA6: volver a FREE declara los compromisos sin efecto y lista lo que se pierde', async () => {
      load.and.resolveTo(PREMIUM_PLAN);
      change.and.resolveTo(BACK_TO_FREE);
      await create();
      await click('Elegir Gratuito', card('FREE'));

      expect(element.querySelectorAll('mat-radio-button').length).toBe(0);
      await click('Continuar');
      expect(byTestId('my-plan-lost')?.querySelectorAll('li').length).toBe(5);
      expect(text('my-plan-payment-notice')).toContain('quedan sin efecto');
      await click('Confirmar cambio');

      expect(change).toHaveBeenCalledOnceWith(
        { planCode: 'FREE', periodicity: 'NONE', expectedVersion: 2 },
        jasmine.stringMatching(UUID),
        jasmine.any(Function),
      );
      expect(text('my-plan-result-payment')).toContain('quedaron sin efecto');
      expect(text('my-plan-current-name')).toBe('Gratuito');
    });

    it('CA3: muestra que el resultado repetido es el original', async () => {
      change.and.resolveTo({ ...CHANGED, replayed: true } satisfies ChangeOutcome);
      await create();
      await changeToPremiumQuarterly();

      expect(byTestId('my-plan-replayed')).not.toBeNull();
    });

    it('evita el doble envío mientras confirma', async () => {
      let resolve!: (outcome: ChangeOutcome) => void;
      change.and.returnValue(new Promise<ChangeOutcome>((r) => (resolve = r)));
      await create();
      await changeToPremiumQuarterly();

      const confirm = button('Cambiando plan…');
      expect(confirm?.disabled).toBeTrue();
      confirm?.click();
      expect(change).toHaveBeenCalledTimes(1);
      resolve(CHANGED);
      await settle();
      expect(byTestId('my-plan-changed')).not.toBeNull();
    });

    it('informa los reintentos automáticos en curso', async () => {
      change.and.callFake((_choice: unknown, _key: string, onRetry: (attempt: number) => void) => {
        onRetry(2);
        return new Promise(() => undefined);
      });
      await create();
      await changeToPremiumQuarterly();

      expect(text('my-plan-retrying')).toContain('Reintentando (2 de 3)');
    });
  });

  describe('rechazos del cambio', () => {
    for (const [code, status, message, reloads] of [
      ['version_conflict', 409, 'Tu plan cambió mientras lo revisabas', true],
      ['subscription_unchanged', 409, 'Ya tienes ese plan con esa periodicidad', false],
      ['subscription_provisioning', 409, 'Tu plan gratuito aún se está activando', true],
      ['plan_not_selectable', 409, 'Ese plan ya no está disponible', true],
      ['plan_not_found', 404, 'Ese plan ya no existe', true],
    ] as const) {
      it(`${status} ${code}: mensaje propio${reloads ? ' y recarga del plan vigente' : ''}`, async () => {
        change.and.resolveTo(failed(status, code));
        await create();
        await changeToPremiumQuarterly();

        const alert = byTestId('my-plan-error')!;
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain(message);
        expect(alert.textContent).toContain('ref-sintetica-16');
        expect(text('my-plan-current-name')).toBe('Gratuito');
        expect(byTestId('my-plan-changed')).toBeNull();
        expect(reload).not.toHaveBeenCalled();
        if (reloads) {
          await click('Recargar mi plan');
          expect(load).toHaveBeenCalledTimes(2);
          expect(byTestId('my-plan-selection')).toBeNull();
        } else {
          expect(button('Recargar mi plan')).toBeUndefined();
        }
      });
    }

    it('CA2: un 422 de periodicidad incoherente no cambia el plan', async () => {
      change.and.resolveTo({
        kind: 'invalid',
        violations: [{ field: 'periodicity', issue: 'inconsistent_values' }],
      } satisfies ChangeOutcome);
      await create();
      await changeToPremiumQuarterly();

      expect(text('my-plan-error')).toContain('La periodicidad elegida no corresponde');
      expect(text('my-plan-current-name')).toBe('Gratuito');
    });

    it('un fallo transitorio agotado se reintenta a mano con la misma clave', async () => {
      change.and.resolveTo(failed(503, 'upstream_unavailable'));
      await create();
      await changeToPremiumQuarterly();

      expect(text('my-plan-error')).toContain('no se aplicará un cambio duplicado');
      change.and.resolveTo(CHANGED);
      await click('Confirmar cambio');
      const [first, second] = change.calls.allArgs().map(([, key]) => key as string);
      expect(second).toBe(first);
      expect(byTestId('my-plan-changed')).not.toBeNull();
    });

    it('otra elección es otro intento: usa otra clave', async () => {
      change.and.resolveTo(failed(503, 'upstream_unavailable'));
      await create();
      await changeToPremiumQuarterly();
      await click('Volver');
      await choosePeriodicity(/Anual/);
      await click('Continuar');
      await click('Confirmar cambio');

      const [first, second] = change.calls.allArgs().map(([, key]) => key as string);
      expect(second).not.toBe(first);
      expect(change.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ periodicity: 'ANNUAL' }),
      );
    });

    it('idempotency_key_reused renueva la clave del siguiente intento', async () => {
      change.and.resolveTo(failed(409, 'idempotency_key_reused'));
      await create();
      await changeToPremiumQuarterly();
      expect(text('my-plan-error')).toContain('no se aplicó ningún cambio duplicado');
      await click('Confirmar cambio');

      const [first, second] = change.calls.allArgs().map(([, key]) => key as string);
      expect(second).not.toBe(first);
    });

    it('un fallo sin referencia se muestra sin código de referencia', async () => {
      change.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies ChangeOutcome);
      await create();
      await changeToPremiumQuarterly();

      expect(text('my-plan-error')).toContain('No hay conexión');
      expect(text('my-plan-error')).not.toContain('Código de referencia');
    });
  });

  describe('datos que la web no conoce', () => {
    /** Catálogo con una capacidad nueva en INTERMEDIATE, heredada por PREMIUM. */
    function withUnknownCapability(subscription: MyPlan['subscription']): MyPlan {
      const body = PLANS_RESPONSES.free.body;
      const catalog = toCatalog({
        ...body,
        plans: body.plans.map((plan) =>
          plan.level >= 2
            ? { ...plan, capabilities: [...plan.capabilities, 'nueva.capacidad'] }
            : plan,
        ),
      });
      return { catalog: { ...catalog, currentPlanCode: subscription.planCode }, subscription };
    }

    it('una capacidad sin nombre en la web se muestra con su código, nunca se oculta', async () => {
      load.and.resolveTo(withUnknownCapability(FREE_PLAN.subscription));
      await create();

      expect(
        card('INTERMEDIATE').querySelector('[data-testid="my-plan-own-capabilities"]')?.textContent,
      ).toContain('nueva.capacidad');
      expect(
        card('PREMIUM').querySelector('[data-testid="my-plan-inherited-capabilities"]')
          ?.textContent,
      ).toContain('nueva.capacidad');
      await click('Elegir Intermedio', card('INTERMEDIATE'));
      await choosePeriodicity(/Mensual/);
      await click('Continuar');
      expect(text('my-plan-gained')).toContain('nueva.capacidad');
      expect(byTestId('my-plan-confirm')?.textContent).toContain('1 mes');
    });

    it('al bajar de nivel también lista la capacidad desconocida que se pierde', async () => {
      load.and.resolveTo(withUnknownCapability(PREMIUM_PLAN.subscription));
      await create();
      await click('Elegir Gratuito', card('FREE'));
      await click('Continuar');

      expect(text('my-plan-lost')).toContain('nueva.capacidad');
    });

    it('un plan vigente fuera del catálogo se muestra con su código', async () => {
      load.and.resolveTo({
        ...FREE_PLAN,
        subscription: { ...FREE_PLAN.subscription, planCode: 'LEGADO' },
      });
      await create();

      expect(text('my-plan-current-name')).toBe('LEGADO');
    });
  });
});
