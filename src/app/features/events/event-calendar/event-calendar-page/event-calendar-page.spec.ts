import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import {
  FakeEventCalendarGateway,
  TEST_MARCH_EVENTS,
  TEST_OWN_DRAFT,
} from '../../../../../testing/fake-event-calendar.gateway';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { EventCalendarGateway } from '../event-calendar.gateway';
import { CalendarQuery, monthPeriod, toUtcIso } from '../event-calendar.model';
import { EventCalendarPage } from './event-calendar-page';

function validationError(details: { field: string; issue: string }[]): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 422,
    error: { code: 'validation_error', message: 'x', correlation_id: 'ref-422', details },
  });
}

describe('EventCalendarPage (HU023)', () => {
  let fixture: ComponentFixture<EventCalendarPage>;
  let gateway: FakeEventCalendarGateway;
  let element: HTMLElement;
  const now = new Date();

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [EventCalendarPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: EventCalendarGateway, useValue: gateway },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EventCalendarPage);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    );
  }

  function lastQuery(): CalendarQuery {
    return gateway.loadEvents.calls.mostRecent().args[0] as CalendarQuery;
  }

  function input(name: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;
  }

  function type(target: HTMLInputElement, value: string): void {
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  async function submit(): Promise<void> {
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  async function toList(): Promise<void> {
    testId('calendar-mode-list')!.querySelector('button')!.click();
    await settle();
  }

  async function chooseOwn(label: string): Promise<void> {
    fixture.debugElement.query(By.css('mat-select')).nativeElement.click();
    await settle();
    const panels = document.querySelectorAll('.mat-mdc-select-panel');
    const option = [
      ...panels.item(panels.length - 1).querySelectorAll<HTMLElement>('mat-option'),
    ].find((o) => o.textContent?.includes(label));
    option!.click();
    await settle();
  }

  beforeEach(() => {
    gateway = new FakeEventCalendarGateway();
  });

  describe('vista de mes', () => {
    beforeEach(create);

    it('consulta el mes actual en la zona del navegador, sin filtros (CA1)', () => {
      expect(element.querySelector('h1')?.textContent).toContain('Calendario de eventos');
      expect(lastQuery()).toEqual({
        period: monthPeriod(now.getFullYear(), now.getMonth()),
        discipline: null,
        city: null,
      });
      expect(gateway.loadEvents.calls.mostRecent().args[1]).toBeNull();
      expect(testId('calendar-browser-zone')?.textContent).toContain(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      expect(testId('calendar-month')).not.toBeNull();
    });

    it('cambia de mes y vuelve a consultar ese periodo', async () => {
      button('')!; // los botones de mes solo tienen icono: se buscan por su etiqueta
      element.querySelector<HTMLButtonElement>('[aria-label="Mes siguiente"]')!.click();
      await settle();

      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      expect(lastQuery().period).toEqual(monthPeriod(next.getFullYear(), next.getMonth()));
    });

    it('envía los filtros recortados y vacíos como ausentes', async () => {
      type(input('discipline'), '  Running ');
      type(input('city'), '   ');
      await submit();

      expect(gateway.loadEvents).toHaveBeenCalledTimes(1);
      type(input('city'), ' Bogotá ');
      await submit();
      expect(lastQuery()).toEqual(
        jasmine.objectContaining({ discipline: 'Running', city: 'Bogotá' }),
      );
    });

    it('un periodo vacío se muestra como tal, no como error', async () => {
      gateway.loadEvents.and.resolveTo({ events: [], nextCursor: null });
      await submit();

      expect(testId('state-empty')?.textContent).toContain('No hay eventos publicados');
    });

    it('un fallo del servicio se informa con reintento y nunca como vacío', async () => {
      gateway.loadEvents.and.rejectWith(new HttpErrorResponse({ status: 503 }));
      await submit();

      expect(testId('state-error')).not.toBeNull();
      expect(testId('state-empty')).toBeNull();

      gateway.loadEvents.and.resolveTo({ events: TEST_MARCH_EVENTS, nextCursor: null });
      button('Reintentar')!.click();
      await settle();
      expect(testId('state-error')).toBeNull();
    });
  });

  describe('vista de lista', () => {
    beforeEach(create);

    it('arranca con el mes visible como periodo y lista los eventos en el orden del backend', async () => {
      await toList();

      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      expect(lastQuery().period.from).toBe(toUtcIso(first));
      const names = [
        ...element.querySelectorAll('[data-testid="calendar-list"] li .calendar-event__name'),
      ].map((e) => e.textContent);
      expect(names).toEqual(TEST_MARCH_EVENTS.map((event) => event.name));
    });

    it('valida en el cliente el periodo invertido o mayor de 92 días y no consulta (CA3)', async () => {
      await toList();
      const calls = gateway.loadEvents.calls.count();

      type(input('from'), '2027-03-10');
      type(input('to'), '2027-03-01');
      await submit();
      expect(element.textContent).toContain('la fecha final es anterior a la inicial.');

      type(input('to'), '2027-06-11');
      await submit();
      expect(element.textContent).toContain('el periodo supera los 92 días permitidos.');
      expect(gateway.loadEvents.calls.count()).toBe(calls);

      type(input('to'), '2027-06-09');
      await submit();
      expect(gateway.loadEvents.calls.count()).toBe(calls + 1);
    });

    it('un 422 del backend se lista y se marca en su campo (CA3)', async () => {
      await toList();
      gateway.loadEvents.and.rejectWith(
        validationError([
          { field: 'query.to', issue: 'out_of_range' },
          { field: 'query.city', issue: 'invalid_length' },
        ]),
      );
      type(input('city'), 'B');
      await submit();

      const summary = testId('calendar-violations')!;
      expect(summary.getAttribute('role')).toBe('alert');
      expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
        'Hasta: el periodo supera los 92 días permitidos.',
        'Ciudad: debe tener entre 2 y 80 caracteres.',
      ]);
      const errors = [...element.querySelectorAll('mat-error')].map((e) => e.textContent?.trim());
      expect(errors).toContain('debe tener entre 2 y 80 caracteres.');
    });

    it('carga la página siguiente con la misma consulta y el cursor sin modificar (CA4)', async () => {
      gateway.loadEvents.and.returnValues(
        Promise.resolve({ events: TEST_MARCH_EVENTS.slice(0, 2), nextCursor: 'cursor+opaco/=' }),
        Promise.resolve({ events: TEST_MARCH_EVENTS.slice(2), nextCursor: null }),
      );
      await toList();
      expect(testId('calendar-count')?.textContent).toContain('Hay más disponibles');

      button('Cargar más')!.click();
      await settle();

      const [query, cursor] = gateway.loadEvents.calls.mostRecent().args;
      expect(cursor).toBe('cursor+opaco/=');
      expect(query).toEqual(gateway.loadEvents.calls.argsFor(1)[0]);
      expect(element.querySelectorAll('[data-testid="calendar-list"] li').length).toBe(5);
      expect(button('Cargar más')).toBeUndefined();
    });

    it('si falla la página siguiente conserva los eventos y ofrece reintentar', async () => {
      let calls = 0;
      gateway.loadEvents.and.callFake(() =>
        calls++ === 0
          ? Promise.resolve({ events: TEST_MARCH_EVENTS.slice(0, 2), nextCursor: 'c1' })
          : Promise.reject(new HttpErrorResponse({ status: 0 })),
      );
      await toList();
      button('Cargar más')!.click();
      await settle();

      expect(element.querySelectorAll('[data-testid="calendar-list"] li').length).toBe(2);
      expect(testId('calendar-more-error')?.textContent).toContain('No hay conexión');
      expect(button('Reintentar')).toBeDefined();
    });

    it('el error de la página siguiente muestra su referencia', async () => {
      let calls = 0;
      gateway.loadEvents.and.callFake(() =>
        calls++ === 0
          ? Promise.resolve({ events: TEST_MARCH_EVENTS.slice(0, 2), nextCursor: 'c1' })
          : Promise.reject(
              new HttpErrorResponse({
                status: 503,
                error: { code: 'upstream_unavailable', message: 'x', correlation_id: 'ref-503' },
              }),
            ),
      );
      await toList();
      button('Cargar más')!.click();
      await settle();

      expect(testId('calendar-more-error')?.textContent).toContain('ref-503');
    });

    it('sin fechas no consulta y señala los campos obligatorios', async () => {
      await toList();
      const calls = gateway.loadEvents.calls.count();
      type(input('from'), '');
      await submit();

      expect(gateway.loadEvents.calls.count()).toBe(calls);
      expect(element.textContent).toContain('Este campo es obligatorio.');
    });

    it('un 422 de la disciplina se marca en su campo; otro código no se lista como regla', async () => {
      await toList();
      gateway.loadEvents.and.rejectWith(
        validationError([{ field: 'query.discipline', issue: 'invalid_length' }]),
      );
      type(input('discipline'), 'R');
      await submit();
      expect(
        [...element.querySelectorAll('mat-error')].map((e) => e.textContent?.trim()),
      ).toContain('debe tener entre 2 y 80 caracteres.');

      gateway.loadEvents.and.rejectWith(
        new HttpErrorResponse({
          status: 422,
          error: { code: 'otro_codigo', message: 'x', correlation_id: null, details: [] },
        }),
      );
      type(input('discipline'), 'Running');
      await submit();
      expect(testId('calendar-violations')).toBeNull();
      expect(testId('state-error')).not.toBeNull();
    });

    it('al volver a la vista de mes muestra el mes del día «Desde»', async () => {
      await toList();
      type(input('from'), '2027-03-10');
      type(input('to'), '2027-03-20');
      await submit();

      testId('calendar-mode-month')!.querySelector('button')!.click();
      await settle();
      expect(lastQuery().period).toEqual(monthPeriod(2027, 2));
      expect(testId('calendar-month-label')?.textContent?.trim()).toBe('marzo 2027');

      const calls = gateway.loadEvents.calls.count();
      testId('calendar-mode-month')!.querySelector('button')!.click();
      await settle();
      expect(gateway.loadEvents.calls.count()).toBe(calls);
    });
  });

  describe('coincidencias con un evento propio', () => {
    beforeEach(create);

    it('lista los eventos propios con su estado', async () => {
      fixture.debugElement.query(By.css('mat-select')).nativeElement.click();
      await settle();

      expect(document.body.textContent).toContain('Carrera 10K Bogotá');
      expect(document.body.textContent).toContain('(Borrador)');
    });

    it('al elegir el evento propio muestra y resalta las coincidencias con su motivo (CA2)', async () => {
      await toList();
      await chooseOwn('Carrera 10K Bogotá');

      expect(gateway.loadConflicts).toHaveBeenCalledWith(TEST_OWN_DRAFT.id);
      const list = testId('calendar-conflicts-list')!;
      expect(
        [...list.querySelectorAll('li')].map((li) => li.textContent?.replace(/\s+/g, ' ')),
      ).toEqual([
        jasmine.stringContaining('Coincide: misma disciplina, misma ciudad'),
        jasmine.stringContaining('Coincide: misma ciudad'),
      ]);
      expect(testId('calendar-conflicts')?.textContent).toContain(
        'no bloquea la publicación ni reserva fechas',
      );
      const highlighted = [
        ...element.querySelectorAll(
          '[data-testid="calendar-list"] .calendar-event--conflict .calendar-event__name',
        ),
      ].map((e) => e.textContent);
      expect(highlighted).toEqual(['Media maratón de Bogotá', 'Triatlón de Bogotá']);
    });

    it('si las coincidencias fallan se informa con reintento y nada queda resaltado', async () => {
      gateway.loadConflicts.and.rejectWith(new HttpErrorResponse({ status: 503 }));
      await toList();
      await chooseOwn('Carrera 10K Bogotá');

      expect(
        testId('calendar-conflicts')?.querySelector('[data-testid="state-error"]'),
      ).not.toBeNull();
      expect(element.querySelectorAll('.calendar-event--conflict').length).toBe(0);

      gateway.loadConflicts.and.resolveTo({ conflicts: [], evaluatedAt: '2026-10-23T15:00:00Z' });
      testId('calendar-conflicts')!.querySelector<HTMLButtonElement>('button')!.click();
      await settle();
      expect(gateway.loadConflicts).toHaveBeenCalledTimes(2);
      expect(testId('calendar-conflicts-none')).not.toBeNull();
    });

    it('sin coincidencias lo dice explícitamente', async () => {
      gateway.loadConflicts.and.resolveTo({ conflicts: [], evaluatedAt: '2026-10-23T15:00:00Z' });
      await chooseOwn('Carrera 10K Bogotá');

      expect(testId('calendar-conflicts-none')?.textContent).toContain(
        'Ningún evento publicado coincide',
      );
    });

    it('un evento ajeno o ya inexistente responde 404 y se informa sin datos (CA2)', async () => {
      gateway.loadConflicts.and.rejectWith(
        new HttpErrorResponse({
          status: 404,
          error: { code: 'event_not_found', message: 'x', correlation_id: null },
        }),
      );
      await chooseOwn('Carrera 10K Bogotá');

      expect(testId('calendar-conflicts-not-found')?.textContent).toContain(
        'ya no está disponible',
      );
      expect(testId('calendar-conflicts-list')).toBeNull();
    });

    it('lleva el calendario al mes del evento propio', async () => {
      await chooseOwn('Carrera 10K Bogotá');
      button('Ver el mes de mi evento')!.click();
      await settle();

      const start = new Date(TEST_OWN_DRAFT.startsAt);
      expect(lastQuery().period).toEqual(monthPeriod(start.getFullYear(), start.getMonth()));
      expect(testId('calendar-month')).not.toBeNull();
    });

    it('al quitar la selección se retiran las coincidencias', async () => {
      await chooseOwn('Carrera 10K Bogotá');
      await chooseOwn('Ninguno');

      expect(testId('calendar-conflicts')).toBeNull();
    });
  });

  it('si no se pueden cargar los eventos propios lo informa y permite reintentar', async () => {
    gateway.loadOwnEvents.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await create();

    expect(testId('calendar-own-error')?.textContent).toContain('No pudimos cargar tus eventos.');
    gateway.loadOwnEvents.and.resolveTo([TEST_OWN_DRAFT]);
    testId('calendar-own-error')!.querySelector('button')!.click();
    await settle();
    expect(testId('calendar-own-error')).toBeNull();
    expect(gateway.loadEvents).toHaveBeenCalledTimes(1);
  });

  it('sin eventos propios explica que aún no hay con qué comparar', async () => {
    gateway.loadOwnEvents.and.resolveTo([]);
    await create();

    expect(testId('calendar-own-empty')?.textContent).toContain('Aún no tienes eventos');
  });
});
