import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';

import {
  FREE_CAPABILITIES,
  ORGANIZER_WEB_PERMISSIONS,
  PREMIUM_CAPABILITIES,
  SERVICE_PROVIDER_WEB_PERMISSIONS,
} from '../../../testing/bff-web/capabilities.fixtures';
import {
  FakeSessionAccess,
  accessReady,
  provideFakeSessionAccess,
} from '../../../testing/session-access-testing';
import { provideTranslateTesting } from '../../../testing/translate-testing';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { SessionAccess } from '../../core/session/session-access.store';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { ViewState } from '../../shared/ui/view-state';
import { NAVIGATION, NavItem } from '../navigation/navigation.registry';
import { ActorShell } from './actor-shell';

/** Vista del BFF que corresponde a cada actor en el simulador. */
const READY: Record<ActorType, ViewState<SessionAccess>> = {
  athlete: accessReady('athlete', 'ACTIVE', [], FREE_CAPABILITIES),
  organizer: accessReady('organizer', 'NOT_APPLICABLE', ORGANIZER_WEB_PERMISSIONS),
  service_provider: accessReady(
    'service_provider',
    'NOT_APPLICABLE',
    SERVICE_PROVIDER_WEB_PERMISSIONS,
  ),
};

/**
 * Desde HU012 y HU013 ninguna opción web es «Próximamente». Para conservar la
 * prueba del renderizado, durante la prueba se marca como no disponible una
 * opción real del profesional (como si su HU no estuviera en la web) y se
 * restaura el registro al terminar. No cambia el código de producción.
 */
function markUpcoming(actor: ActorType, id: string): () => void {
  const navigation = NAVIGATION[actor] as { items: readonly NavItem[] };
  const original = navigation.items;
  navigation.items = original.map((item) =>
    item.id === id ? { ...item, available: false } : item,
  );
  return () => (navigation.items = original);
}

describe('ActorShell (ADR-025, HU003)', () => {
  let session: SessionStore;
  let access: FakeSessionAccess;

  async function render(
    actor: ActorType,
    state: ViewState<SessionAccess> | null = READY[actor],
  ): Promise<HTMLElement> {
    const fakeAccess = provideFakeSessionAccess(state);
    access = fakeAccess.fake;
    await TestBed.configureTestingModule({
      imports: [ActorShell],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: 'http://bff.test',
            registrationPoliciesVersion: null,
            healthDataConsentVersion: null,
          } satisfies AppConfig,
        },
        fakeAccess.provider,
        { provide: ActivatedRoute, useValue: { snapshot: { data: { actor } } } },
      ],
    }).compileComponents();
    session = TestBed.inject(SessionStore);
    session.start({
      user: {
        id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        actorType: actor,
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 60_000,
    });
    const fixture = TestBed.createComponent(ActorShell);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** Restaura el registro si la prueba marcó una opción como «Próximamente». */
  let restoreNavigation: (() => void) | null = null;

  afterEach(() => {
    restoreNavigation?.();
    restoreNavigation = null;
  });

  afterEach(() => session?.end());

  const item = (element: HTMLElement, id: string): HTMLElement | null =>
    element.querySelector(`[data-menu-item="${id}"]`);

  it('pide la vista de permisos y capacidades de la sesión al abrirse', async () => {
    await render('organizer');

    expect(access.ensureLoaded).toHaveBeenCalled();
  });

  it('muestra el tipo de cuenta y el menú lateral del organizador', async () => {
    const element = await render('organizer');

    expect(element.querySelector('[data-testid="shell-role"]')?.textContent).toContain(
      'Organizador de eventos',
    );
    expect(element.querySelector('mat-sidenav')).not.toBeNull();
    expect(item(element, 'event-create')?.textContent).toContain('Crear evento');
    expect(item(element, 'service-create')).toBeNull();
    expect(item(element, 'plan')).toBeNull();
    // HU002: «Mi perfil» del organizador navega a sus datos personales.
    expect(item(element, 'profile')?.getAttribute('href')).toBe('/organizador/perfil');
    expect(item(element, 'profile')?.textContent).not.toContain('Próximamente');
  });

  it('«Inicio» es un enlace al inicio propio', async () => {
    const element = await render('service_provider');
    const home = item(element, 'home');

    expect(home?.tagName).toBe('A');
    expect(home?.getAttribute('href')).toBe('/profesional/inicio');
  });

  it('las opciones «Próximamente» no son enlaces ni acciones', async () => {
    restoreNavigation = markUpcoming('service_provider', 'health-history');
    const element = await render('service_provider');
    const upcoming = item(element, 'health-history');

    expect(upcoming?.tagName).toBe('DIV');
    expect(upcoming?.querySelector('a, button')).toBeNull();
    expect(upcoming?.getAttribute('href')).toBeNull();
    expect(upcoming?.textContent).toContain('Historial de molestias o lesiones');
    expect(upcoming?.textContent).toContain('Próximamente');
  });

  it('cada grupo del menú es una navegación etiquetada por su título', async () => {
    const element = await render('organizer');
    const events = element.querySelector('[aria-labelledby="menu-group-events"]');

    expect(events?.getAttribute('role')).toBe('navigation');
    expect(element.querySelector('#menu-group-events')?.textContent).toContain('Eventos');
    expect(element.querySelectorAll('nav').length).toBe(0);
  });

  it('mientras carga la vista no muestra opciones que exijan permiso', async () => {
    const element = await render('organizer', { status: 'loading' });

    expect(item(element, 'home')).not.toBeNull();
    expect(item(element, 'event-create')).toBeNull();
    expect(
      element.querySelector('[data-testid="shell-access"] [data-testid="state-loading"]'),
    ).not.toBeNull();
  });

  it('si el BFF falla muestra un error trazable con reintento, sin opciones asumidas', async () => {
    const element = await render('athlete', {
      status: 'error',
      error: {
        kind: 'server',
        status: 503,
        code: 'upstream_unavailable',
        correlationId: 'ref-sintetica',
      },
    });
    const error = element.querySelector('[data-testid="shell-access"] [role="alert"]');

    expect(error?.textContent).toContain('ref-sintetica');
    expect(item(element, 'sport-calendar')).toBeNull();
    error?.querySelector('button')?.click();
    expect(access.reload).toHaveBeenCalled();
  });

  describe('CA7: deportista según su plan (ADR-024)', () => {
    it('FREE: opciones base y las del plan con HU web, ya navegables', async () => {
      const element = await render('athlete');

      expect(item(element, 'plan')?.textContent).toContain('Mi plan');
      // HU016: «Mi plan» ya navega a la comparación y el cambio de plan.
      expect(item(element, 'plan')?.getAttribute('href')).toBe('/deportista/plan');
      expect(item(element, 'plan')?.textContent).not.toContain('Próximamente');
      expect(item(element, 'athlete-training-plans')?.textContent).toContain(
        'Planes de entrenamiento',
      );
      // HU010 ya está implementada en la web: es un enlace, no «Próximamente».
      expect(item(element, 'athlete-training-plans')?.getAttribute('href')).toBe(
        '/deportista/entrenamientos/planes',
      );
      expect(item(element, 'athlete-training-plans')?.textContent).not.toContain('Próximamente');
      // HU018: «Calendario deportivo» ya navega al calendario integrado.
      expect(item(element, 'sport-calendar')?.getAttribute('href')).toBe('/deportista/calendario');
      expect(item(element, 'sport-calendar')?.textContent).not.toContain('Próximamente');
      // HU020: «Servicios» es una opción base y ya navega.
      expect(item(element, 'athlete-services')?.getAttribute('href')).toBe('/deportista/servicios');
      expect(item(element, 'athlete-services')?.textContent).not.toContain('Próximamente');
      // HU005: «Mi perfil» del deportista ya navega a su perfil.
      expect(item(element, 'profile')?.getAttribute('href')).toBe('/deportista/perfil');
      expect(item(element, 'profile')?.textContent).toContain('Mi perfil');
      expect(item(element, 'profile')?.textContent).not.toContain('Próximamente');
      expect(item(element, 'sports-medicine')).toBeNull();
      expect(element.querySelector('[data-testid="shell-plan-provisioning"]')).toBeNull();
    });

    it('PREMIUM: agrega «Servicios médicos y deportivos»', async () => {
      const element = await render(
        'athlete',
        accessReady('athlete', 'ACTIVE', [], PREMIUM_CAPABILITIES),
      );

      expect(item(element, 'sports-medicine')?.textContent).toContain(
        'Servicios médicos y deportivos',
      );
      // Abre la pantalla de HU020 filtrada por medicina deportiva.
      expect(item(element, 'sports-medicine')?.getAttribute('href')).toBe(
        '/deportista/servicios/medico-deportivos',
      );
    });

    it('PROVISIONING: informa la activación y no muestra opciones del plan', async () => {
      const element = await render('athlete', accessReady('athlete', 'PROVISIONING'));

      expect(
        element.querySelector('[data-testid="shell-plan-provisioning"]')?.textContent,
      ).toContain('Estamos activando tu plan');
      expect(item(element, 'athlete-training-plans')).toBeNull();
      expect(item(element, 'plan')).not.toBeNull();
    });
  });

  it('vuelve al inicio de sesión cuando la sesión termina', async () => {
    await render('organizer');
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

    session.end('expired');
    TestBed.tick();

    expect(navigate).toHaveBeenCalledWith('/iniciar-sesion', { replaceUrl: true });
  });

  it('CA10: si el BFF no admite el actor, va al acceso no autorizado', async () => {
    await render('athlete');
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

    session.end('unauthorized_actor');
    TestBed.tick();

    expect(navigate).toHaveBeenCalledWith('/acceso-no-autorizado', { replaceUrl: true });
  });

  describe('HU004: cerrar sesión', () => {
    for (const actor of ['athlete', 'organizer', 'service_provider'] as const) {
      it(`${actor}: «Cerrar sesión» es un botón del menú, no «Próximamente»`, async () => {
        const element = await render(actor);
        const logout = item(element, 'logout');

        expect(logout?.tagName).toBe('BUTTON');
        expect(logout?.textContent).toContain('Cerrar sesión');
        expect(logout?.textContent).not.toContain('Próximamente');
      });
    }

    it('CA1: al confirmar el cierre vuelve al acceso sin dejar el área en el historial', async () => {
      const element = await render('athlete');
      const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      const http = TestBed.inject(HttpTestingController);

      item(element, 'logout')!.click();
      const request = http.expectOne('http://bff.test/v1/sessions/revoke');
      expect(request.request.withCredentials).toBeTrue();
      request.flush(null, { status: 204, statusText: 'No Content' });
      await new Promise((resolve) => setTimeout(resolve));
      TestBed.tick();

      expect(session.user()).toBeNull();
      expect(session.accessToken()).toBeNull();
      expect(session.lastEndReason()).toBe('logged_out');
      expect(navigate).toHaveBeenCalledWith('/iniciar-sesion', { replaceUrl: true });
      http.verify();
    });
  });
});
