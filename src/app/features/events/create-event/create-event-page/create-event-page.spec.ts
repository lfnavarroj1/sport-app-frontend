import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { CreateEventForm } from '../create-event-form/create-event-form';
import { CreateEventGateway } from '../create-event.gateway';
import { CreateEventOutcome, CreatedEvent, EventDraft } from '../create-event.model';
import { CreateEventPage } from './create-event-page';

// Datos sintéticos de prueba (ejemplo de ADR-028).
const DRAFT: EventDraft = {
  name: 'Carrera 10K Bogotá',
  description: 'Carrera recreativa de diez kilómetros para corredores aficionados.',
  discipline: 'Running',
  location: {
    name: 'Parque Metropolitano Simón Bolívar',
    address: 'Avenida Calle 63 # 60-50',
    city: 'Bogotá',
    countryCode: 'CO',
  },
  startDate: '2026-11-15',
  startTime: '07:00',
  timeZone: 'America/Bogota',
  durationMinutes: 180,
  capacity: 5000,
};

const EVENT: CreatedEvent = {
  id: '683f4e38-6bb3-4c47-a6dc-9bb1588c67ef',
  name: DRAFT.name,
  description: DRAFT.description,
  discipline: DRAFT.discipline,
  location: DRAFT.location,
  startsAt: '2026-11-15T12:00:00Z',
  endsAt: '2026-11-15T15:00:00Z',
  timeZone: 'America/Bogota',
  durationMinutes: 180,
  capacity: 5000,
  status: 'DRAFT',
  version: 1,
  createdAt: '2026-10-12T21:00:00Z',
};

const UNAVAILABLE: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: 'ref-sintetica-21',
};

describe('CreateEventPage (HU021)', () => {
  let fixture: ComponentFixture<CreateEventPage>;
  let element: HTMLElement;
  let createEvent: jasmine.Spy;

  function form(): CreateEventForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof CreateEventForm)
      .componentInstance as CreateEventForm;
  }

  async function submit(draft: EventDraft = DRAFT): Promise<void> {
    form().submitted.emit(draft);
    await fixture.whenStable();
  }

  function keysUsed(): string[] {
    return createEvent.calls.allArgs().map(([, key]) => key as string);
  }

  beforeEach(async () => {
    createEvent = jasmine.createSpy('createEvent').and.resolveTo({
      kind: 'created',
      event: EVENT,
      replayed: false,
    } satisfies CreateEventOutcome);
    await TestBed.configureTestingModule({
      imports: [CreateEventPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: CreateEventGateway, useValue: { createEvent } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CreateEventPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('muestra el formulario de creación', () => {
    expect(element.querySelector('h1')?.textContent).toContain('Crear evento');
    expect(element.querySelector('app-create-event-form form')).not.toBeNull();
  });

  it('CA1 y CA5: presenta el borrador devuelto por 201, en la hora local del evento', async () => {
    await submit();

    expect(createEvent).toHaveBeenCalledOnceWith(DRAFT, jasmine.any(String), jasmine.any(Function));
    expect(keysUsed()[0]).toMatch(/^[0-9a-f-]{36}$/);
    const created = element.querySelector('[data-testid="event-created"]')!;
    expect(created.getAttribute('role')).toBe('status');
    expect(created.textContent).toContain('Borrador creado');
    expect(created.textContent).toContain('Borrador');
    expect(element.querySelector('[data-testid="event-starts-at"]')?.textContent).toContain('7:00');
    expect(element.querySelector('[data-testid="event-ends-at"]')?.textContent).toContain('10:00');
    expect(created.textContent).toContain('Colombia');
    expect(created.textContent).toContain('5.000');
    expect(created.textContent).toContain('no aparecen en el catálogo');
    expect(document.activeElement).toBe(created.querySelector('h2'));
    expect(element.querySelector('app-create-event-form')).toBeNull();
  });

  it('CA4: informa que el borrador ya existía cuando el BFF devuelve un reintento', async () => {
    createEvent.and.resolveTo({ kind: 'created', event: EVENT, replayed: true });
    await submit();

    expect(element.querySelector('[data-testid="event-replayed"]')?.textContent).toContain(
      'no se creó otro',
    );
  });

  it('CA7: avisa los reintentos automáticos mientras ocurren', async () => {
    let finish!: (outcome: CreateEventOutcome) => void;
    createEvent.and.callFake(
      (_draft: EventDraft, _key: string, onRetry: (attempt: number) => void) => {
        onRetry(2);
        return new Promise((resolve) => (finish = resolve));
      },
    );
    form().submitted.emit(DRAFT);
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="event-retrying"]')?.textContent).toContain(
      'Reintentando (2 de 3)',
    );
    finish({ kind: 'created', event: EVENT, replayed: false });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="event-retrying"]')).toBeNull();
    expect(element.querySelector('[data-testid="event-created"]')).not.toBeNull();
  });

  it('CA7: tras agotar los reintentos, volver a crear usa la misma clave', async () => {
    createEvent.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await submit();

    const error = element.querySelector('[data-testid="event-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('no se creará otro');
    expect(error.textContent).toContain('ref-sintetica-21');

    createEvent.and.resolveTo({ kind: 'created', event: EVENT, replayed: true });
    await submit();
    expect(keysUsed()[1]).toBe(keysUsed()[0]);
  });

  it('CA4: si el organizador cambia los datos, el siguiente envío es un intento nuevo', async () => {
    createEvent.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await submit();
    form().edited.emit();
    await submit();

    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('CA4: idempotency_key_reused se explica y el siguiente envío usa otra clave', async () => {
    createEvent.and.resolveTo({
      kind: 'failed',
      error: { kind: 'conflict', status: 409, code: 'idempotency_key_reused', correlationId: null },
    });
    await submit();

    const error = element.querySelector('[data-testid="event-error"]')!;
    expect(error.textContent).toContain('vuelve a crear el borrador');
    expect(error.textContent).not.toContain('no se creará otro');
    await submit();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('CA2: un actor sin permiso recibe el rechazo y no un borrador', async () => {
    createEvent.and.resolveTo({
      kind: 'failed',
      error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
    });
    await submit();

    expect(element.querySelector('[data-testid="event-error"]')?.textContent).toContain(
      'No tienes permiso para realizar esta acción.',
    );
    expect(element.querySelector('[data-testid="event-created"]')).toBeNull();
  });

  it('CA3: entrega al formulario las reglas incumplidas', async () => {
    const violations = [{ field: 'capacity', issue: 'out_of_range' }];
    createEvent.and.resolveTo({ kind: 'invalid', violations });
    await submit();

    expect(form().serverErrors()).toEqual(violations);
    expect(element.querySelector('[data-testid="event-created"]')).toBeNull();
  });

  it('evita el doble envío mientras crea', async () => {
    let finish!: (outcome: CreateEventOutcome) => void;
    createEvent.and.returnValue(new Promise((resolve) => (finish = resolve)));
    form().submitted.emit(DRAFT);
    form().submitted.emit(DRAFT);
    finish({ kind: 'created', event: EVENT, replayed: false });
    await fixture.whenStable();

    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('«Crear otro evento» vuelve al formulario vacío con una clave nueva', async () => {
    await submit();
    element.querySelector<HTMLButtonElement>('[data-testid="event-created"] button')!.click();
    await fixture.whenStable();

    expect(element.querySelector<HTMLInputElement>('[formcontrolname="name"]')?.value).toBe('');
    await submit();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });
});
