import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MY_ROUTES_RESPONSES,
  ROUTES_NEXT_CURSOR,
  SIMULATED_ROUTES_CORRELATION_ID,
  VALID_PUBLISH_ROUTE_REQUEST,
  organizerRoute,
} from '../../../../../testing/bff-web/routes.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { toApiError } from '../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { RouteForm } from '../route-form/route-form';
import { RoutesGateway } from '../routes.gateway';
import {
  OrganizerRoute,
  PublishOutcome,
  RetireOutcome,
  RouteDraft,
  RoutesPage as Page,
  toOrganizerRoute,
} from '../routes.model';
import { RoutesPage } from './routes-page';

// Datos sintéticos derivados de los fixtures del contrato bff-web 0.23.0.
const FIRST: Page = {
  routes: MY_ROUTES_RESPONSES.firstPage.body.items.map(toOrganizerRoute),
  nextCursor: ROUTES_NEXT_CURSOR,
};
const LAST: Page = {
  routes: MY_ROUTES_RESPONSES.lastPage.body.items.map(toOrganizerRoute),
  nextCursor: null,
};
const ROUTE: OrganizerRoute = toOrganizerRoute(organizerRoute(0));
const RETIRED: OrganizerRoute = toOrganizerRoute(organizerRoute(0, 'RETIRED'));
const NEW_ROUTE: OrganizerRoute = { ...ROUTE, id: 'nueva-ruta', name: 'Ruta nueva' };
const DRAFT: RouteDraft = {
  name: VALID_PUBLISH_ROUTE_REQUEST.name,
  description: null,
  sport: 'running',
  distanceKm: '12.5',
  difficulty: 'MODERATE',
  city: 'Bogotá',
  countryCode: 'CO',
  startPoint: VALID_PUBLISH_ROUTE_REQUEST.start_point,
  waypoints: [],
};
const SPACES = /\s+/g;

function failed(
  status: number,
  code: string,
): { kind: 'failed'; error: ReturnType<typeof toApiError> } {
  return {
    kind: 'failed',
    error: toApiError(
      new HttpErrorResponse({
        status,
        error: { code, message: 'x', correlation_id: SIMULATED_ROUTES_CORRELATION_ID, details: [] },
      }),
    ),
  };
}

describe('RoutesPage (HU026)', () => {
  let fixture: ComponentFixture<RoutesPage>;
  let element: HTMLElement;
  let loadRoutes: jasmine.Spy;
  let publish: jasmine.Spy;
  let retire: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(RoutesPage);
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
  const items = () => [...element.querySelectorAll<HTMLElement>('li[data-route]')];
  const item = (id: string) => element.querySelector<HTMLElement>(`li[data-route="${id}"]`)!;

  function button(label: string, scope: ParentNode = element): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
  }

  async function click(label: string, scope?: ParentNode): Promise<void> {
    const target = button(label, scope);
    expect(target).withContext(label).toBeDefined();
    target!.click();
    await settle();
  }

  function form(): RouteForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof RouteForm)
      .componentInstance as RouteForm;
  }

  async function submit(draft: RouteDraft = DRAFT): Promise<void> {
    form().submitted.emit(draft);
    await settle();
  }

  function keys(): string[] {
    return publish.calls.allArgs().map(([, key]) => key as string);
  }

  beforeEach(async () => {
    loadRoutes = jasmine.createSpy('loadRoutes').and.resolveTo(FIRST);
    publish = jasmine.createSpy('publish').and.resolveTo({
      kind: 'published',
      route: NEW_ROUTE,
      replayed: false,
    } satisfies PublishOutcome);
    retire = jasmine
      .createSpy('retire')
      .and.resolveTo({ kind: 'retired', route: RETIRED } satisfies RetireOutcome);
    await TestBed.configureTestingModule({
      imports: [RoutesPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: RoutesGateway, useValue: { loadRoutes, publish, retire } },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta las rutas', async () => {
    loadRoutes.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('h1')?.textContent).toContain('Rutas');
    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('lista las rutas propias con sus datos y pagina con el cursor', async () => {
    await create();

    expect(items().length).toBe(20);
    const first = item(ROUTE.id);
    expect(first.querySelector('h3')?.textContent).toContain('Vuelta al Parque Simón Bolívar');
    expect(first.textContent).toContain('Publicada');
    expect(first.textContent).toContain('Carrera');
    expect(first.querySelector('[data-testid="route-distance"]')?.textContent?.trim()).toBe(
      '12,5 km',
    );
    expect(first.textContent).toContain('Moderada');
    expect(first.textContent).toContain('Bogotá, CO');
    expect(first.querySelector('[data-testid="route-start"]')?.textContent?.trim()).toBe(
      '4,6584, -74,0937',
    );
    expect(first.querySelectorAll('[data-testid="route-waypoints"] li').length).toBe(2);
    expect(item(FIRST.routes[1].id).textContent).toContain('Sin puntos intermedios');

    loadRoutes.and.resolveTo(LAST);
    await click('Cargar más');
    expect(loadRoutes.calls.mostRecent().args).toEqual([ROUTES_NEXT_CURSOR]);
    expect(items().length).toBe(22);
    expect(items()[21].textContent).toContain('Retirada');
    expect(items()[21].querySelector('[data-testid="route-retired-at"]')).not.toBeNull();
    expect(button('Retirar', items()[21])).toBeUndefined();
    expect(byTestId('routes-load-more')).toBeNull();
  });

  it('sin rutas lo explica y un error se muestra con referencia y reintento', async () => {
    loadRoutes.and.resolveTo({ routes: [], nextCursor: null });
    await create();
    expect(byTestId('state-empty')?.textContent).toContain('Aún no has publicado rutas.');

    loadRoutes.and.rejectWith(
      new HttpErrorResponse({ status: 503, error: MY_ROUTES_RESPONSES.upstreamUnavailable.body }),
    );
    await create();
    expect(byTestId('state-error')?.textContent).toContain(SIMULATED_ROUTES_CORRELATION_ID);
  });

  it('mientras carga más deshabilita el botón y un fallo con referencia la muestra', async () => {
    await create();
    let fail!: (error: unknown) => void;
    loadRoutes.and.returnValue(new Promise((_resolve, reject) => (fail = reject)));
    button('Cargar más')!.click();
    await settle();

    expect(button('Cargando…')?.disabled).toBeTrue();
    fail(
      new HttpErrorResponse({ status: 503, error: MY_ROUTES_RESPONSES.upstreamUnavailable.body }),
    );
    await settle();
    expect(text('routes-more-error')).toContain(SIMULATED_ROUTES_CORRELATION_ID);
  });

  it('un fallo al cargar más conserva lo mostrado', async () => {
    await create();
    loadRoutes.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    await click('Cargar más');

    expect(text('routes-more-error')).toContain('No pudimos cargar más rutas');
    expect(items().length).toBe(20);
  });

  describe('publicar', () => {
    it('CA1: publica con una clave por intento, muestra lo confirmado y lo agrega primero', async () => {
      await create();
      await click('Publicar una ruta');
      await submit();

      expect(publish).toHaveBeenCalledOnceWith(
        DRAFT,
        jasmine.stringMatching(/^[0-9a-f-]{36}$/),
        jasmine.any(Function),
      );
      const message = byTestId('route-published')!;
      expect(message.getAttribute('role')).toBe('status');
      expect(message.textContent).toContain('Publicamos la ruta «Ruta nueva».');
      expect(document.activeElement).toBe(message);
      expect(items()[0].dataset['route']).toBe('nueva-ruta');
      expect(byTestId('route-form')).toBeNull();
    });

    it('CA1: informa que la confirmación corresponde a un envío anterior', async () => {
      publish.and.resolveTo({ kind: 'published', route: ROUTE, replayed: true });
      await create();
      await click('Publicar una ruta');
      await submit();

      expect(byTestId('route-published-replayed')).not.toBeNull();
      // La ruta ya estaba en la lista: no se duplica.
      expect(items().filter((li) => li.dataset['route'] === ROUTE.id).length).toBe(1);
    });

    it('CA2: entrega al formulario las reglas del backend y nada se publica', async () => {
      const violations = [{ field: 'distance_km', issue: 'out_of_range' }];
      publish.and.resolveTo({ kind: 'invalid', violations });
      await create();
      await click('Publicar una ruta');
      await submit();

      expect(form().serverErrors()).toEqual(violations);
      expect(byTestId('route-published')).toBeNull();
      expect(items().length).toBe(20);
      // Sin editar, volver a enviar es el mismo intento lógico.
      await submit();
      expect(keys()[1]).toBe(keys()[0]);
    });

    it('tras un fallo recuperable, reintentar usa la misma clave; editar la renueva', async () => {
      publish.and.resolveTo(failed(503, 'upstream_unavailable'));
      await create();
      await click('Publicar una ruta');
      await submit();

      const error = byTestId('route-publish-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('no se publicará una ruta duplicada');
      expect(error.textContent).toContain(SIMULATED_ROUTES_CORRELATION_ID);
      await submit();
      expect(keys()[1]).toBe(keys()[0]);
      form().edited.emit();
      await submit();
      expect(keys()[2]).not.toBe(keys()[1]);
    });

    it('idempotency_key_reused se explica y renueva la clave; el permiso denegado se informa', async () => {
      publish.and.resolveTo(failed(409, 'idempotency_key_reused'));
      await create();
      await click('Publicar una ruta');
      await submit();
      expect(text('route-publish-error')).toContain('No pudimos confirmar la publicación');
      await submit();
      expect(keys()[1]).not.toBe(keys()[0]);

      publish.and.resolveTo(failed(403, 'permission_required'));
      await submit();
      expect(text('route-publish-error')).toContain('No tienes permiso');
    });

    it('avisa los reintentos automáticos y no envía dos veces', async () => {
      let finish!: (outcome: PublishOutcome) => void;
      publish.and.callFake((_draft: RouteDraft, _key: string, onRetry: (n: number) => void) => {
        onRetry(2);
        return new Promise<PublishOutcome>((resolve) => (finish = resolve));
      });
      await create();
      await click('Publicar una ruta');
      form().submitted.emit(DRAFT);
      form().submitted.emit(DRAFT);
      await settle();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(text('route-retrying')).toContain('Reintentando publicar la ruta (2 de 3)');
      finish({ kind: 'published', route: NEW_ROUTE, replayed: false });
      await settle();
      expect(byTestId('route-published')).not.toBeNull();
    });

    it('un fallo sin conexión se informa sin código de referencia', async () => {
      publish.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies PublishOutcome);
      await create();
      await click('Publicar una ruta');
      await submit();

      expect(text('route-publish-error')).toContain('No hay conexión');
      expect(text('route-publish-error')).not.toContain('Código de referencia');
    });

    it('si la página se cierra mientras publica, ignora el resultado', async () => {
      let finish!: (outcome: PublishOutcome) => void;
      publish.and.returnValue(new Promise<PublishOutcome>((resolve) => (finish = resolve)));
      await create();
      await click('Publicar una ruta');
      form().submitted.emit(DRAFT);
      await settle();
      fixture.destroy();
      finish({ kind: 'published', route: NEW_ROUTE, replayed: false });
      await new Promise((resolve) => setTimeout(resolve));

      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('cancelar cierra el formulario sin publicar', async () => {
      await create();
      await click('Publicar una ruta');
      form().cancelled.emit();
      await settle();

      expect(byTestId('route-form')).toBeNull();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('retirar', () => {
    it('CA4: pide confirmación y retira con la versión mostrada; la ruta se conserva', async () => {
      await create();
      await click('Retirar', item(ROUTE.id));

      const confirm = byTestId(`route-retire-confirm-${ROUTE.id}`)!;
      expect(confirm.getAttribute('role')).toBe('group');
      expect(confirm.textContent).toContain('¿Retirar «Vuelta al Parque Simón Bolívar»?');
      expect(retire).not.toHaveBeenCalled();
      await click('Sí, retirar', confirm);

      expect(retire).toHaveBeenCalledOnceWith(ROUTE.id, 1);
      expect(item(ROUTE.id).textContent).toContain('Retirada');
      expect(text(`route-retire-message-${ROUTE.id}`)).toContain('Retiramos la ruta');
      expect(button('Retirar', item(ROUTE.id))).toBeUndefined();
      expect(items().length).toBe(20);
    });

    it('no envía dos retiros a la vez y, si la página se cierra, ignora el resultado', async () => {
      let finish!: (outcome: RetireOutcome) => void;
      retire.and.returnValue(new Promise<RetireOutcome>((resolve) => (finish = resolve)));
      await create();
      await click('Retirar', item(ROUTE.id));
      button('Sí, retirar')!.click();
      await settle();

      expect(button('Retirando…')?.disabled).toBeTrue();
      button('Retirando…')!.click();
      expect(retire).toHaveBeenCalledTimes(1);
      fixture.destroy();
      finish({ kind: 'retired', route: RETIRED });
      await new Promise((resolve) => setTimeout(resolve));
    });

    it('cancelar la confirmación no retira', async () => {
      await create();
      await click('Retirar', item(ROUTE.id));
      await click('Cancelar', byTestId(`route-retire-confirm-${ROUTE.id}`)!);

      expect(retire).not.toHaveBeenCalled();
      expect(byTestId(`route-retire-confirm-${ROUTE.id}`)).toBeNull();
    });

    it('un 409 version_conflict no retira y ofrece actualizar la lista', async () => {
      retire.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      await create();
      await click('Retirar', item(ROUTE.id));
      await click('Sí, retirar');

      const message = byTestId(`route-retire-message-${ROUTE.id}`)!;
      expect(message.getAttribute('role')).toBe('alert');
      expect(message.textContent).toContain('no se retiró');
      expect(item(ROUTE.id).textContent).toContain('Publicada');
      await click('Actualizar lista', message);
      expect(loadRoutes).toHaveBeenCalledTimes(2);
    });

    it('CA4: una ruta ajena se informa sin éxito', async () => {
      retire.and.resolveTo(failed(404, 'route_not_found'));
      await create();
      await click('Retirar', item(ROUTE.id));
      await click('Sí, retirar');

      expect(text(`route-retire-message-${ROUTE.id}`)).toContain('La ruta no existe o no es tuya.');
      expect(text(`route-retire-message-${ROUTE.id}`)).toContain(SIMULATED_ROUTES_CORRELATION_ID);
    });

    it('un fallo genérico al retirar se informa con su tipo', async () => {
      retire.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies RetireOutcome);
      await create();
      await click('Retirar', item(ROUTE.id));
      await click('Sí, retirar');

      expect(text(`route-retire-message-${ROUTE.id}`)).toContain('No hay conexión');
    });
  });

  it('no muestra mapas, trazados ni datos de valoración de seguridad', async () => {
    await create();

    expect(element.querySelector('iframe, canvas, img')).toBeNull();
    expect(element.textContent).toContain('no valora su seguridad');
  });
});
