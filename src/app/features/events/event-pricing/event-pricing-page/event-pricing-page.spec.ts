import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  DRAFT_WITHOUT_FEE,
  PUBLISHED_FREE,
  PUBLISHED_WITH_REGISTRATIONS,
} from '../../../../../testing/bff-web/event-pricing.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { EventPricingGateway } from '../event-pricing.gateway';
import { toPricedEvent } from '../event-pricing.model';
import { EventPricingStore } from '../event-pricing.store';
import { EventPricingPage } from './event-pricing-page';

const EVENTS = [DRAFT_WITHOUT_FEE, PUBLISHED_WITH_REGISTRATIONS, PUBLISHED_FREE].map(toPricedEvent);

describe('EventPricingPage (HU025)', () => {
  let fixture: ComponentFixture<EventPricingPage>;
  let element: HTMLElement;
  let loadOwnEvents: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(EventPricingPage);
    await fixture.whenStable();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  function items(): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>('[data-testid="pricing-event-item"]')];
  }

  beforeEach(async () => {
    loadOwnEvents = jasmine.createSpy('loadOwnEvents').and.resolveTo(EVENTS);
    await TestBed.configureTestingModule({
      imports: [EventPricingPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        EventPricingStore,
        { provide: EventPricingGateway, useValue: { loadOwnEvents } },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta los eventos', async () => {
    loadOwnEvents.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('lista los eventos propios con su tarifa en COP, gratuito o sin tarifa, y sus inscritos', async () => {
    await create();

    expect(loadOwnEvents).toHaveBeenCalledTimes(1);
    const rows = items();
    expect(rows.length).toBe(3);
    const fee = (row: HTMLElement) =>
      row.querySelector('[data-testid="pricing-event-fee"]')?.textContent?.trim();
    expect(fee(rows[0])).toBe('Sin tarifa');
    expect(fee(rows[1])).toContain('85.000');
    expect(fee(rows[1])).toContain('$');
    expect(fee(rows[2])).toBe('Gratuito');
    expect(
      rows[1].querySelector('[data-testid="pricing-event-registrations"]')?.textContent,
    ).toContain('3');
    expect(rows[0].textContent).toContain('Borrador');
    expect(rows[1].textContent).toContain('Publicado');
    expect(rows[1].textContent).toContain('(America/Bogota)');
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe(`/${EVENTS[1].id}`);
    expect(element.querySelector('[data-testid="fee-detail-placeholder"]')).not.toBeNull();
    expect(element.textContent).toContain('no genera cobros');
  });

  it('sin eventos muestra el vacío', async () => {
    loadOwnEvents.and.resolveTo([]);
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'Aún no tienes eventos',
    );
  });

  it('un fallo muestra el error con reintento, nunca una lista vacía', async () => {
    loadOwnEvents.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await create();

    expect(element.querySelector('[data-testid="state-error"]')).not.toBeNull();
    expect(items().length).toBe(0);

    loadOwnEvents.and.resolveTo(EVENTS);
    const retry = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Reintentar'),
    )!;
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(items().length).toBe(3);
  });
});
