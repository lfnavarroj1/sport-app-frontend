import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  INTEGRATED_CALENDAR_RESPONSES,
  OWN_PUBLISHED_ITEM,
} from '../../../../../testing/bff-web/integrated-calendar.fixtures';
import { SimulatedResponse } from '../../../../../testing/bff-web/register-user.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { IntegratedCalendarResponseDto } from '../../../../core/api/bff-web/integrated-calendar.api';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { ActorType, SessionStore } from '../../../../core/session/session.store';
import { CalendarPeriod, localDayKey, monthPeriod } from '../../event-calendar/event-calendar.model';
import { IntegratedCalendarGateway } from '../integrated-calendar.gateway';
import { IntegratedCalendar, toIntegratedCalendar } from '../integrated-calendar.model';
import { IntegratedCalendarPage } from './integrated-calendar-page';

/** Puerto simulado: responde con el simulador del contrato o rechaza como el BFF. */
class FakeIntegratedCalendarGateway extends IntegratedCalendarGateway {
  next: SimulatedResponse = INTEGRATED_CALENDAR_RESPONSES.organizer;
  readonly load = jasmine
    .createSpy<(period: CalendarPeriod) => Promise<IntegratedCalendar>>('load')
    .and.callFake(async () => {
      const response = this.next;
      if (response.status !== 200) {
        throw new HttpErrorResponse({ status: response.status, error: response.body });
      }
      return toIntegratedCalendar(response.body as IntegratedCalendarResponseDto);
    });
}

describe('IntegratedCalendarPage (HU018)', () => {
  let fixture: ComponentFixture<IntegratedCalendarPage>;
  let gateway: FakeIntegratedCalendarGateway;
  let element: HTMLElement;

  /** Crea la pantalla para `actor` con «hoy» en marzo de 2027 (zona del navegador). */
  async function create(actor: ActorType, response: SimulatedResponse): Promise<void> {
    gateway.next = response;
    await TestBed.configureTestingModule({
      imports: [IntegratedCalendarPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: IntegratedCalendarGateway, useValue: gateway },
      ],
    }).compileComponents();
    TestBed.inject(SessionStore).start({
      user: {
        id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
        fullName: 'Usuario Sintético',
        email: 'usuario@example.com',
        actorType: actor,
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 600_000,
    });
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2027, 2, 15, 12));
    fixture = TestBed.createComponent(IntegratedCalendarPage);
    jasmine.clock().uninstall();
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  afterEach(() => TestBed.inject(SessionStore).end());

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function text(id: string): string {
    return (testId(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function cell(day: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`td[data-day="${day}"]`);
  }

  function input(name: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;
  }

  function type(target: HTMLInputElement, value: string): void {
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  async function toList(from?: string, to?: string): Promise<void> {
    testId('integrated-mode-list')!.querySelector('button')!.click();
    await settle();
    if (from && to) {
      type(input('from'), from);
      type(input('to'), to);
      element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
    }
  }

  function sourceFilter(source: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(
      `[data-source-filter="${source}"] input[type="checkbox"]`,
    )!;
  }

  function listedTitles(): string[] {
    return [...element.querySelectorAll('[data-testid="integrated-list"] .calendar-item__title')].map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  beforeEach(() => {
    gateway = new FakeIntegratedCalendarGateway();
  });

  describe('organizador: sus eventos', () => {
    beforeEach(() => create('organizer', INTEGRATED_CALENDAR_RESPONSES.organizer));

    it('consulta el mes en la zona del navegador y muestra sus eventos por día (CA1)', () => {
      expect(element.querySelector('h1')?.textContent).toContain('Calendario integrado');
      expect(element.querySelector('header')?.textContent).toContain(
        'tus eventos en borrador y publicados',
      );
      expect(gateway.load).toHaveBeenCalledOnceWith(monthPeriod(2027, 2));
      expect(text('integrated-browser-zone')).toContain(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );

      const draft = cell('2027-03-07')!;
      expect(draft.textContent).toContain('Media maratón de Bogotá');
      expect(draft.textContent).toContain('Mis eventos');
      expect(draft.textContent).toContain('Borrador');
      expect(text('integrated-count')).toContain('Actividades mostradas: 2.');
    });

    it('ubica el evento de Madrid en su día de la zona del navegador y muestra su zona (CA3)', async () => {
      const day = localDayKey(new Date(OWN_PUBLISHED_ITEM.starts_at));
      expect(cell(day)?.textContent).toContain('Carrera de medianoche de Madrid');

      await toList();
      const madrid = element.querySelector<HTMLElement>(
        `[data-item="${OWN_PUBLISHED_ITEM.item_id}"]`,
      )!;
      expect(madrid.querySelector('[data-testid="calendar-item-zone"]')?.textContent).toContain(
        'Europe/Madrid',
      );
      expect(madrid.textContent).toContain('Publicado');
      expect(madrid.textContent).toContain('Parque del Retiro, Madrid');
    });

    it('la vista de mes es una tabla de lunes a domingo con encabezados de columna', () => {
      const table = testId('integrated-month')!;
      expect(table.querySelector('caption')?.textContent?.trim()).toMatch(/marzo/i);
      expect(table.querySelectorAll('th[scope="col"]').length).toBe(7);
      expect(cell('2027-03-01')?.closest('tr')?.firstElementChild).toBe(cell('2027-03-01'));
    });

    it('cambia de mes y consulta ese periodo', async () => {
      element.querySelector<HTMLButtonElement>('[aria-label="Mes siguiente"]')!.click();
      await settle();

      expect(gateway.load).toHaveBeenCalledWith(monthPeriod(2027, 3));
      expect(text('integrated-month-label')).toMatch(/abril/i);
    });
  });

  describe('deportista: eventos, sesiones, servicios asociados e inscripciones', () => {
    beforeEach(() => create('athlete', INTEGRATED_CALENDAR_RESPONSES.athlete));

    it('lista las cuatro fuentes con su texto, la sesión sin hora y el filtro por fuente', async () => {
      expect(element.querySelector('h1')?.textContent).toContain('Calendario deportivo');
      await toList('2027-03-01', '2027-03-31');

      expect(gateway.load).toHaveBeenCalledWith({
        from: monthPeriod(2027, 2).from,
        to: monthPeriod(2027, 2).to,
      });
      expect(listedTitles()).toEqual([
        'Rodaje suave',
        'Gran Fondo Bogotá',
        'Gran Fondo Bogotá',
        'Valoración deportiva',
      ]);
      const sources = [
        ...element.querySelectorAll('[data-testid="integrated-list"] [data-testid="calendar-item-source"]'),
      ].map((node) => node.textContent?.trim());
      expect(sources).toEqual([
        'Sesiones de mis planes',
        'Eventos publicados',
        'Mis inscripciones',
        'Mis servicios asociados',
      ]);
      const session = element.querySelector<HTMLElement>('[data-source="TRAINING_PLAN_SESSION"]')!;
      expect(session.textContent).toContain('Sin hora fija');
      expect(session.textContent).toContain('Carrera');
      expect(session.textContent).toContain('45 min · esfuerzo percibido (RPE) 4');
      expect(session.querySelector('[data-testid="calendar-item-zone"]')).toBeNull();
      const service = element.querySelector<HTMLElement>(
        '[data-source="ASSOCIATED_SERVICE_AVAILABILITY"]',
      )!;
      expect(service.textContent).toContain('Disponible');
      expect(service.textContent).toContain('cupo: 1');

      expect(text('integrated-sources')).toContain('Eventos publicados (1)');
      sourceFilter('EVENT_PUBLISHED').click();
      await settle();
      expect(listedTitles()).toEqual(['Rodaje suave', 'Gran Fondo Bogotá', 'Valoración deportiva']);
      // El filtro solo oculta lo recibido: no vuelve a consultar (mes, lista y «Consultar»).
      expect(gateway.load).toHaveBeenCalledTimes(3);
    });

    it('sin fuentes elegidas lo dice en lugar de mostrar un calendario vacío', async () => {
      for (const source of [
        'EVENT_PUBLISHED',
        'TRAINING_PLAN_SESSION',
        'ASSOCIATED_SERVICE_AVAILABILITY',
        'EVENT_REGISTRATION',
      ]) {
        sourceFilter(source).click();
        await settle();
      }

      expect(text('integrated-no-source')).toBe('Elige al menos una fuente para ver sus actividades.');
      expect(testId('integrated-empty')).toBeNull();
    });
  });

  describe('fuentes incompletas y truncadas', () => {
    it('declara las fuentes que no respondieron y permite volver a consultar (CA5)', async () => {
      await create('athlete', INTEGRATED_CALENDAR_RESPONSES.athletePartial);

      const notice = testId('integrated-incomplete')!;
      expect(notice.getAttribute('role')).toBe('alert');
      expect(notice.textContent).toContain('Información incompleta');
      expect(notice.textContent).toContain('Sesiones de mis planes: no está disponible.');
      expect(notice.textContent).toContain('Mis servicios asociados: no respondió a tiempo.');
      expect(cell('2027-03-07')?.textContent).toContain('Gran Fondo Bogotá');

      gateway.next = INTEGRATED_CALENDAR_RESPONSES.athlete;
      notice.querySelector('button')!.click();
      await settle();
      expect(gateway.load).toHaveBeenCalledTimes(2);
      expect(testId('integrated-incomplete')).toBeNull();
    });

    it('sin elementos y con la fuente caída no afirma que no haya actividades (CA5)', async () => {
      await create('organizer', INTEGRATED_CALENDAR_RESPONSES.organizerEmptyUnavailable);

      expect(testId('integrated-incomplete')).not.toBeNull();
      expect(text('integrated-empty')).toContain('no podemos confirmar que no tengas actividades');
      expect(text('integrated-empty')).not.toBe('No tienes actividades en este periodo.');
    });

    it('con todas las fuentes OK y sin elementos informa el vacío', async () => {
      await create('organizer', INTEGRATED_CALENDAR_RESPONSES.organizerEmpty);

      expect(text('integrated-empty')).toBe('No tienes actividades en este periodo.');
      expect(testId('integrated-incomplete')).toBeNull();
    });

    it('una fuente truncada sugiere acotar el periodo (CA6)', async () => {
      await create('service_provider', INTEGRATED_CALENDAR_RESPONSES.serviceProviderTruncated);

      expect(element.querySelector('h1')?.textContent).toContain('Calendario integrado');
      const notice = testId('integrated-truncated')!;
      expect(notice.getAttribute('role')).toBe('status');
      expect(notice.querySelector('[data-truncated="EVENT_PUBLISHED"]')?.textContent).toContain(
        'Eventos publicados',
      );
      expect(notice.textContent).toContain('Acota el periodo');
      expect(cell('2027-03-12')?.textContent).toContain('Asesoría nutricional');
      expect(cell('2027-03-12')?.textContent).toContain('Disponibilidad de mis servicios');
    });
  });

  describe('errores', () => {
    it('con todas las fuentes caídas muestra un error trazable con reintento (CA5)', async () => {
      await create('organizer', INTEGRATED_CALENDAR_RESPONSES.upstreamUnavailable);

      expect(text('state-error')).toContain('3b8d2f6a-9c1e-4d7b-a5f3-2e8c6a4d1b9f');
      expect(testId('integrated-month')).toBeNull();
      gateway.next = INTEGRATED_CALENDAR_RESPONSES.organizer;
      testId('state-error')!.querySelector('button')!.click();
      await settle();
      expect(testId('integrated-month')).not.toBeNull();
    });

    it('sin permiso informa el rechazo sin datos ni reintento', async () => {
      await create('athlete', INTEGRATED_CALENDAR_RESPONSES.capabilityRequired);

      expect(text('state-error')).toContain('No tienes permiso');
      expect(testId('state-error')!.querySelector('button')).toBeNull();
      expect(testId('integrated-sources')).toBeNull();
    });

    it('un 422 del periodo se informa junto al campo «Hasta» (CA6)', async () => {
      await create('organizer', INTEGRATED_CALENDAR_RESPONSES.organizer);
      gateway.next = INTEGRATED_CALENDAR_RESPONSES.periodTooLong;
      await toList('2027-03-01', '2027-03-31');

      expect(text('integrated-violations')).toContain(
        'Hasta: el periodo supera los 92 días permitidos.',
      );
      expect(element.querySelector('mat-error')?.textContent).toContain('92 días');
    });
  });

  describe('validación del periodo en la lista', () => {
    beforeEach(() => create('organizer', INTEGRATED_CALENDAR_RESPONSES.organizer));

    it('no consulta un periodo de más de 92 días', async () => {
      await toList('2027-01-01', '2027-04-30');

      expect(gateway.load).toHaveBeenCalledTimes(2);
      expect(element.querySelector('mat-error')?.textContent).toContain(
        'el periodo supera los 92 días permitidos.',
      );
    });

    it('no consulta un periodo invertido', async () => {
      await toList('2027-03-10', '2027-03-01');

      expect(gateway.load).toHaveBeenCalledTimes(2);
      expect(element.querySelector('mat-error')?.textContent).toContain(
        'la fecha final es anterior a la inicial.',
      );
    });
  });
});
