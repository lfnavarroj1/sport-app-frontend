import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  SERVICES_AVAILABILITY_PATH,
  SERVICES_AVAILABILITY_RESPONSES,
  catalogService,
} from '../../../../testing/bff-web/services-availability.fixtures';
import { CatalogServiceDto } from '../../../core/api/bff-web/services-availability.api';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { AvailabilityFilters, queryPeriod } from './availability.model';
import { HttpAvailabilityGateway } from './http-availability.gateway';

// Datos sintéticos de prueba.
const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const URL = `${BFF}${SERVICES_AVAILABILITY_PATH}`;

const FILTERS: AvailabilityFilters = {
  fromDate: '2026-11-03',
  toDate: '2026-11-09',
  categories: [],
  modalities: [],
  includeUnavailable: false,
};

describe('HttpAvailabilityGateway (HU020, contrato bff-web 0.12.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpAvailabilityGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpAvailabilityGateway,
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    gateway = TestBed.inject(HttpAvailabilityGateway);
    session.start({
      user: {
        id: '4b6d8f0a-2c4e-4a6b-8d0f-2a4c6e8b0d2f',
        fullName: 'Deportista Sintética',
        email: 'deportista@example.com',
        actorType: 'athlete',
      },
      accessToken: TOKEN,
      expiresAt: Date.now() + 600_000,
    });
  });

  afterEach(() => {
    http.verify();
    session.end();
  });

  it('consulta con token, periodo con desfase, modo disponible y el tamaño de página del contrato', async () => {
    const page = gateway.loadPage(FILTERS, null);
    const request = http.expectOne((r) => r.url === URL);
    const period = queryPeriod(FILTERS);

    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.get('from')).toBe(period.from);
    expect(request.request.params.get('to')).toBe(period.to);
    expect(request.request.params.get('availability')).toBe('available');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.has('category')).toBeFalse();
    expect(request.request.params.has('modality')).toBeFalse();
    expect(request.request.params.has('cursor')).toBeFalse();
    request.flush(SERVICES_AVAILABILITY_RESPONSES.firstPage.body);

    const result = await page;
    expect(result.services.map((service) => service.id)).toEqual(
      SERVICES_AVAILABILITY_RESPONSES.firstPage.body.items.map((item) => item.service_id),
    );
    expect(result.nextCursor).toBe('cursor-sintetico-servicios-2');
    expect(result.restrictedCategories).toEqual(['SPORTS_MEDICINE']);
  });

  it('CA1: categorías y modalidades se envían como parámetros repetibles', async () => {
    const page = gateway.loadPage(
      { ...FILTERS, categories: ['COACHING', 'NUTRITION'], modalities: ['VIRTUAL', 'HYBRID'] },
      null,
    );
    const request = http.expectOne((r) => r.url === URL);

    expect(request.request.params.getAll('category')).toEqual(['COACHING', 'NUTRITION']);
    expect(request.request.params.getAll('modality')).toEqual(['VIRTUAL', 'HYBRID']);
    request.flush(SERVICES_AVAILABILITY_RESPONSES.empty.body);

    expect(await page).toEqual({
      services: [],
      nextCursor: null,
      restrictedCategories: ['SPORTS_MEDICINE'],
    });
  });

  it('CA2: incluir servicios sin espacios pide availability=all y conserva available=false', async () => {
    const page = gateway.loadPage({ ...FILTERS, includeUnavailable: true }, null);
    const request = http.expectOne((r) => r.url === URL);

    expect(request.request.params.get('availability')).toBe('all');
    request.flush(SERVICES_AVAILABILITY_RESPONSES.withUnavailable.body);

    const result = await page;
    expect(result.services.map((service) => service.available)).toEqual([true, false]);
    expect(result.services[1].intervals).toEqual([]);
  });

  it('CA3: transforma el servicio sin alterar instantes, zona ni tarifa', async () => {
    const page = gateway.loadPage(FILTERS, null);
    http.expectOne((r) => r.url === URL).flush(SERVICES_AVAILABILITY_RESPONSES.premium.body);

    // Los datos sintéticos no conservan los tipos literales del contrato.
    const first = catalogService(0, 'SPORTS_MEDICINE') as unknown as CatalogServiceDto;
    const result = await page;
    expect(result.services[0]).toEqual({
      id: first.service_id,
      providerId: first.provider_id,
      name: first.name,
      description: first.description,
      category: 'SPORTS_MEDICINE',
      modality: first.modality,
      price: { amount: first.price.amount, currency: 'COP', billingUnit: first.price.billing_unit },
      intervals: first.availability.map((interval) => ({
        startsAt: interval.starts_at,
        endsAt: interval.ends_at,
        timeZone: interval.time_zone,
        capacity: interval.capacity,
      })),
      available: true,
    });
    expect(result.restrictedCategories).toEqual([]);
  });

  it('CA4: pide la página siguiente con el cursor sin modificar', async () => {
    const page = gateway.loadPage(FILTERS, 'cursor-sintetico-servicios-2');
    const request = http.expectOne((r) => r.url === URL);

    expect(request.request.params.get('cursor')).toBe('cursor-sintetico-servicios-2');
    request.flush(SERVICES_AVAILABILITY_RESPONSES.lastPage.body);

    expect((await page).nextCursor).toBeNull();
  });

  for (const [name, status] of [
    ['permissionRequired', 403],
    ['upstreamUnavailable', 503],
  ] as const) {
    it(`un ${status} llega como error, nunca como catálogo vacío`, async () => {
      const page = gateway.loadPage(FILTERS, null);
      http
        .expectOne((r) => r.url === URL)
        .flush(SERVICES_AVAILABILITY_RESPONSES[name].body, { status, statusText: 'Error' });

      await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.user()).not.toBeNull();
    });
  }

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const page = gateway.loadPage(FILTERS, null);
    http
      .expectOne((r) => r.url === URL)
      .flush(SERVICES_AVAILABILITY_RESPONSES.invalidAccessToken.body, {
        status: 401,
        statusText: 'Unauthorized',
      });

    await expectAsync(page).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadPage(FILTERS, null)).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone((r) => r.url === URL);
  });
});
