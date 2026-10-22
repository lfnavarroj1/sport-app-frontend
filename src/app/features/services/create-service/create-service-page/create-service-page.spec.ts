import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { CreateServiceForm } from '../create-service-form/create-service-form';
import { CreateServiceGateway } from '../create-service.gateway';
import { CreateServiceOutcome, CreatedService, ServiceDraft } from '../create-service.model';
import { CreateServicePage } from './create-service-page';

// Datos sintéticos de prueba (ejemplo de ADR-027).
const DRAFT: ServiceDraft = {
  name: 'Valoración deportiva inicial',
  description: 'Valoración presencial para orientar el plan deportivo.',
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  amount: '120000.00',
  billingUnit: 'SESSION',
  intervals: [
    {
      startDate: '2026-11-20',
      startTime: '09:00',
      endDate: '2026-11-20',
      endTime: '10:00',
      timeZone: 'America/Bogota',
      capacity: 1,
    },
  ],
};

const SERVICE: CreatedService = {
  id: '8e2885fb-ef5d-42ad-a02e-6ef5f97f377d',
  name: DRAFT.name,
  description: DRAFT.description,
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  price: { amount: '120000.00', currency: 'COP', billingUnit: 'SESSION' },
  intervals: [
    {
      startsAt: '2026-11-20T14:00:00Z',
      endsAt: '2026-11-20T15:00:00Z',
      timeZone: 'America/Bogota',
      capacity: 1,
    },
  ],
  status: 'DRAFT',
  version: 1,
  createdAt: '2026-10-21T15:00:00Z',
};

const UNAVAILABLE: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: 'ref-sintetica-15',
};

describe('CreateServicePage (HU015)', () => {
  let fixture: ComponentFixture<CreateServicePage>;
  let element: HTMLElement;
  let createService: jasmine.Spy;

  function form(): CreateServiceForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof CreateServiceForm)
      .componentInstance as CreateServiceForm;
  }

  async function submit(draft: ServiceDraft = DRAFT): Promise<void> {
    form().submitted.emit(draft);
    await fixture.whenStable();
  }

  function keysUsed(): string[] {
    return createService.calls.allArgs().map(([, key]) => key as string);
  }

  beforeEach(async () => {
    createService = jasmine.createSpy('createService').and.resolveTo({
      kind: 'created',
      service: SERVICE,
      replayed: false,
    } satisfies CreateServiceOutcome);
    await TestBed.configureTestingModule({
      imports: [CreateServicePage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: CreateServiceGateway, useValue: { createService } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CreateServicePage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('muestra el formulario de creación', () => {
    expect(element.querySelector('h1')?.textContent).toContain('Crear servicio');
    expect(element.querySelector('app-create-service-form form')).not.toBeNull();
  });

  it('CA1, CA5 y CA7: presenta el borrador devuelto por 201 con la tarifa de referencia', async () => {
    await submit();

    expect(createService).toHaveBeenCalledOnceWith(
      DRAFT,
      jasmine.any(String),
      jasmine.any(Function),
    );
    expect(keysUsed()[0]).toMatch(/^[0-9a-f-]{36}$/);
    const created = element.querySelector('[data-testid="service-created"]')!;
    expect(created.getAttribute('role')).toBe('status');
    expect(created.textContent).toContain('Borrador guardado');
    expect(element.querySelector('[data-testid="service-status"]')?.textContent).toContain(
      'Borrador',
    );
    expect(
      element.querySelector('[data-testid="service-price"]')?.textContent?.replace(/\s/g, ' '),
    ).toContain('$ 120.000 por sesión');
    expect(created.textContent).toContain('Medicina deportiva');
    expect(created.textContent).toContain('Presencial');
    expect(created.textContent).toContain('no genera cobros');
    expect(created.textContent).toContain('no aparecen en el catálogo de servicios');
    expect(document.activeElement).toBe(created.querySelector('h2'));
    expect(element.querySelector('app-create-service-form')).toBeNull();
  });

  it('CA6: muestra cada intervalo en la zona declarada, con la zona y el cupo', async () => {
    await submit();

    const intervals = element.querySelector('[data-testid="service-intervals"]')!;
    expect(intervals.textContent).toContain('20 de noviembre de 2026');
    expect(intervals.textContent).toContain('9:00');
    expect(intervals.textContent).toContain('10:00');
    expect(intervals.textContent).toContain('America/Bogota');
    expect(intervals.textContent).toContain('Cupo: 1');
  });

  it('CA6: un borrador sin disponibilidad lo indica', async () => {
    createService.and.resolveTo({
      kind: 'created',
      service: { ...SERVICE, intervals: [] },
      replayed: false,
    });
    await submit({ ...DRAFT, intervals: [] });

    expect(element.querySelector('[data-testid="service-no-intervals"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="service-intervals"]')).toBeNull();
  });

  it('CA4: informa que el borrador ya existía cuando el BFF devuelve un reintento', async () => {
    createService.and.resolveTo({ kind: 'created', service: SERVICE, replayed: true });
    await submit();

    expect(element.querySelector('[data-testid="service-replayed"]')?.textContent).toContain(
      'no se creó otro',
    );
  });

  it('avisa los reintentos automáticos mientras ocurren', async () => {
    let finish!: (outcome: CreateServiceOutcome) => void;
    createService.and.callFake(
      (_draft: ServiceDraft, _key: string, onRetry: (attempt: number) => void) => {
        onRetry(2);
        return new Promise((resolve) => (finish = resolve));
      },
    );
    form().submitted.emit(DRAFT);
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="service-retrying"]')?.textContent).toContain(
      'Reintentando (2 de 3)',
    );
    finish({ kind: 'created', service: SERVICE, replayed: false });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="service-retrying"]')).toBeNull();
    expect(element.querySelector('[data-testid="service-created"]')).not.toBeNull();
  });

  it('CA4: tras agotar los reintentos, volver a guardar usa la misma clave', async () => {
    createService.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await submit();

    const error = element.querySelector('[data-testid="service-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('no se creará otro');
    expect(error.textContent).toContain('ref-sintetica-15');

    createService.and.resolveTo({ kind: 'created', service: SERVICE, replayed: true });
    await submit();
    expect(keysUsed()[1]).toBe(keysUsed()[0]);
  });

  it('sin conexión se informa de forma recuperable', async () => {
    createService.and.resolveTo({
      kind: 'failed',
      error: { kind: 'offline', status: null, code: null, correlationId: null },
    });
    await submit();

    const error = element.querySelector('[data-testid="service-error"]')!;
    expect(error.textContent).toContain('No hay conexión');
    expect(error.textContent).toContain('no se creará otro');
  });

  it('CA4: si el profesional cambia los datos, el siguiente envío es un intento nuevo', async () => {
    createService.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await submit();
    form().edited.emit();
    await submit();

    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('CA4: idempotency_key_reused se explica y el siguiente envío usa otra clave', async () => {
    createService.and.resolveTo({
      kind: 'failed',
      error: { kind: 'conflict', status: 409, code: 'idempotency_key_reused', correlationId: null },
    });
    await submit();

    const error = element.querySelector('[data-testid="service-error"]')!;
    expect(error.textContent).toContain('vuelve a guardar el borrador');
    expect(error.textContent).not.toContain('no se creará otro');
    await submit();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('CA2: un usuario sin permiso recibe el rechazo y no un borrador', async () => {
    createService.and.resolveTo({
      kind: 'failed',
      error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
    });
    await submit();

    expect(element.querySelector('[data-testid="service-error"]')?.textContent).toContain(
      'No tienes permiso para realizar esta acción.',
    );
    expect(element.querySelector('[data-testid="service-created"]')).toBeNull();
  });

  it('CA3: entrega al formulario las reglas incumplidas', async () => {
    const violations = [{ field: 'price.amount', issue: 'out_of_range' }];
    createService.and.resolveTo({ kind: 'invalid', violations });
    await submit();

    expect(form().serverErrors()).toEqual(violations);
    expect(element.querySelector('[data-testid="service-created"]')).toBeNull();
  });

  it('evita el doble envío mientras guarda', async () => {
    let finish!: (outcome: CreateServiceOutcome) => void;
    createService.and.returnValue(new Promise((resolve) => (finish = resolve)));
    form().submitted.emit(DRAFT);
    form().submitted.emit(DRAFT);
    finish({ kind: 'created', service: SERVICE, replayed: false });
    await fixture.whenStable();

    expect(createService).toHaveBeenCalledTimes(1);
  });

  it('«Crear otro servicio» vuelve al formulario vacío con una clave nueva', async () => {
    await submit();
    element.querySelector<HTMLButtonElement>('[data-testid="service-created"] button')!.click();
    await fixture.whenStable();

    expect(element.querySelector<HTMLInputElement>('[formcontrolname="name"]')?.value).toBe('');
    await submit();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });
});
