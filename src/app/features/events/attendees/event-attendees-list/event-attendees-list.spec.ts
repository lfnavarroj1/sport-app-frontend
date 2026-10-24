import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import {
  ATTENDEES_EVENT,
  ATTENDEES_NEXT_CURSOR,
  EVENT_ATTENDEES_RESPONSES,
  SIMULATED_ATTENDEES_CORRELATION_ID,
} from '../../../../../testing/bff-web/event-attendees.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { toOrganizerEvent } from '../../publish-event/publish-event.model';
import { AttendeesGateway } from '../attendees.gateway';
import { AttendeesPage, toAttendeesPage } from '../attendees.model';
import { OwnEventsStore } from '../own-events.store';
import { EventAttendeesList } from './event-attendees-list';

// Datos sintéticos derivados de los fixtures del contrato bff-web 0.22.0.
const FIRST: AttendeesPage = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.firstPage.body);
const LAST: AttendeesPage = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.lastPage.body);
const EMPTY: AttendeesPage = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.empty.body);
const NO_NAMES: AttendeesPage = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.namesUnavailable.body);
const EVENT = toOrganizerEvent(ATTENDEES_EVENT);
const SPACES = /\s+/g;

function httpError(response: { status: number; body: unknown }): HttpErrorResponse {
  return new HttpErrorResponse({ status: response.status, error: response.body });
}

describe('EventAttendeesList (HU022)', () => {
  let fixture: ComponentFixture<EventAttendeesList>;
  let element: HTMLElement;
  let loadAttendees: jasmine.Spy;
  let params: BehaviorSubject<ParamMap>;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(EventAttendeesList);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  }

  const byTestId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) => byTestId(id)?.textContent?.replace(SPACES, ' ').trim() ?? '';
  const rows = () => [...element.querySelectorAll<HTMLElement>('tbody tr')];

  function button(label: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
  }

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ eventId: EVENT.id }));
    loadAttendees = jasmine.createSpy('loadAttendees').and.resolveTo(FIRST);
    await TestBed.configureTestingModule({
      imports: [EventAttendeesList],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        OwnEventsStore,
        {
          provide: AttendeesGateway,
          useValue: { loadAttendees, loadOwnEvents: () => Promise.resolve([EVENT]) },
        },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      ],
    }).compileComponents();
    await TestBed.inject(OwnEventsStore).load();
  });

  it('muestra la carga mientras consulta los inscritos', async () => {
    loadAttendees.and.returnValue(new Promise(() => undefined));
    await create();

    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('CA1: lista nombre, estado, fecha y tarifa con conteos, en el orden del backend', async () => {
    await create();

    expect(loadAttendees).toHaveBeenCalledOnceWith(EVENT.id, 'REGISTERED', null);
    expect(element.querySelector('h2')?.textContent).toContain(`Inscritos de «${EVENT.name}»`);
    expect(element.querySelector('caption')?.textContent).toContain(EVENT.name);
    expect(text('attendees-count-REGISTERED')).toBe('23');
    expect(text('attendees-total')).toBe('23');
    expect(rows().length).toBe(20);
    const first = rows()[0];
    expect(first.querySelector('th[scope="row"]')?.textContent?.trim()).toBe(
      'Deportista sintético 1',
    );
    expect(first.textContent).toContain('Inscrito');
    expect(first.textContent).toContain('2026');
    expect(first.textContent?.replace(SPACES, ' ')).toContain('$ 45.000');
    expect(rows()[2].textContent).toContain('Sin tarifa');
    expect(text('attendees-shown')).toBe('Mostrando 20 de 23 inscripciones.');
    expect(element.textContent).toContain('no indica que la inscripción esté pagada');
    // Sin datos de contacto ni exportación.
    expect(element.textContent).not.toMatch(/@|correo|exportar|descargar/i);
  });

  it('CA4: «Cargar más» usa el cursor sin modificar y agrega sin repetir', async () => {
    await create();
    loadAttendees.and.resolveTo(LAST);
    button('Cargar más')!.click();
    await settle();

    expect(loadAttendees.calls.mostRecent().args).toEqual([
      EVENT.id,
      'REGISTERED',
      ATTENDEES_NEXT_CURSOR,
    ]);
    expect(rows().length).toBe(23);
    expect(new Set(rows().map((row) => row.dataset['registration'])).size).toBe(23);
    expect(text('attendees-shown')).toBe('Mostrando 23 de 23 inscripciones.');
    expect(byTestId('attendees-load-more')).toBeNull();
  });

  it('un fallo al cargar más conserva lo mostrado y permite reintentar', async () => {
    await create();
    loadAttendees.and.rejectWith(httpError(EVENT_ATTENDEES_RESPONSES.upstreamUnavailable));
    button('Cargar más')!.click();
    await settle();

    expect(text('attendees-more-error')).toContain('No pudimos cargar más inscritos');
    expect(text('attendees-more-error')).toContain(SIMULATED_ATTENDEES_CORRELATION_ID);
    expect(rows().length).toBe(20);
    expect(button('Cargar más')?.disabled).toBeFalse();
  });

  it('CA4: cambiar el filtro vuelve a la primera página con el nuevo estado', async () => {
    await create();
    element
      .querySelector<HTMLButtonElement>('[data-testid="attendees-filter-ALL"] button')!
      .click();
    await settle();

    expect(loadAttendees.calls.mostRecent().args).toEqual([EVENT.id, 'ALL', null]);
    expect(byTestId('attendees-filter-ALL')?.classList).toContain('mat-button-toggle-checked');
  });

  it('CA3: sin inscritos muestra el total cero y un mensaje, sin tabla', async () => {
    loadAttendees.and.resolveTo(EMPTY);
    await create();

    expect(text('attendees-empty')).toBe('Este evento aún no tiene inscritos.');
    expect(text('attendees-total')).toBe('0');
    expect(byTestId('attendees-table')).toBeNull();
    expect(byTestId('attendees-load-more')).toBeNull();
  });

  it('CA6: sin nombres de Usuarios muestra «Nombre no disponible» y avisa', async () => {
    loadAttendees.and.resolveTo(NO_NAMES);
    await create();

    expect(element.querySelectorAll('[data-testid="attendee-name-unavailable"]').length).toBe(3);
    expect(rows()[0].textContent).toContain('Nombre no disponible');
    const notice = byTestId('attendees-names-unavailable')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('El estado, la fecha y la tarifa sí están completos');

    loadAttendees.and.resolveTo(FIRST);
    button('Volver a consultar')!.click();
    await settle();
    expect(byTestId('attendees-names-unavailable')).toBeNull();
  });

  it('CA2: un evento ajeno o inexistente se informa sin datos', async () => {
    loadAttendees.and.rejectWith(httpError(EVENT_ATTENDEES_RESPONSES.eventNotFound));
    await create();

    expect(text('attendees-not-found')).toContain('El evento no existe o no es tuyo');
    expect(byTestId('attendees-table')).toBeNull();
    expect(byTestId('attendees-counts')).toBeNull();
  });

  it('un error recuperable se muestra con referencia y reintento, no como lista vacía', async () => {
    loadAttendees.and.rejectWith(httpError(EVENT_ATTENDEES_RESPONSES.upstreamUnavailable));
    await create();

    expect(byTestId('state-error')?.textContent).toContain(SIMULATED_ATTENDEES_CORRELATION_ID);
    expect(byTestId('attendees-empty')).toBeNull();
    loadAttendees.and.resolveTo(FIRST);
    button('Reintentar')!.click();
    await settle();
    expect(rows().length).toBe(20);
  });

  it('al cambiar de evento consulta el nuevo con el filtro por defecto', async () => {
    await create();
    element
      .querySelector<HTMLButtonElement>('[data-testid="attendees-filter-ALL"] button')!
      .click();
    await settle();
    params.next(convertToParamMap({ eventId: 'otro-evento' }));
    await settle();

    expect(loadAttendees.calls.mostRecent().args).toEqual(['otro-evento', 'REGISTERED', null]);
    // Evento fuera de la lista propia cargada: título y leyenda genéricos.
    expect(element.querySelector('h2')?.textContent).toContain('Inscritos del evento');
    expect(element.querySelector('caption')?.textContent).toContain('Inscritos del evento');
  });

  it('una página sin filas con total mayor que cero no dice que el evento esté vacío', async () => {
    loadAttendees.and.resolveTo({ ...FIRST, attendees: [], nextCursor: null });
    await create();

    expect(text('attendees-empty')).toBe('No hay más inscripciones para mostrar.');
    expect(text('attendees-total')).toBe('23');
  });

  it('un fallo sin conexión al cargar más se informa sin código de referencia', async () => {
    await create();
    loadAttendees.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    button('Cargar más')!.click();
    await settle();

    expect(text('attendees-more-error')).toContain('No pudimos cargar más inscritos');
    expect(text('attendees-more-error')).not.toContain('Código de referencia');
  });

  it('un estado que la web no conoce se muestra con su código', async () => {
    loadAttendees.and.resolveTo({
      ...FIRST,
      attendees: [{ ...FIRST.attendees[0], status: 'WAITLISTED' }],
      byStatus: [{ status: 'WAITLISTED', count: 1 }],
    } satisfies AttendeesPage);
    await create();

    expect(rows()[0].textContent).toContain('WAITLISTED');
    expect(text('attendees-counts')).toContain('WAITLISTED');
  });
});
