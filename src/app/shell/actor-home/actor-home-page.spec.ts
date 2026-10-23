import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  FREE_CAPABILITIES,
  ORGANIZER_WEB_PERMISSIONS,
  SERVICE_PROVIDER_WEB_PERMISSIONS,
} from '../../../testing/bff-web/capabilities.fixtures';
import { accessReady, provideFakeSessionAccess } from '../../../testing/session-access-testing';
import { provideTranslateTesting } from '../../../testing/translate-testing';
import { SessionAccess } from '../../core/session/session-access.store';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { ViewState } from '../../shared/ui/view-state';
import { ActorHomePage } from './actor-home-page';

describe('ActorHomePage (ADR-025, HU003 CA7–CA9)', () => {
  let session: SessionStore;

  async function render(
    actorType: ActorType,
    state: ViewState<SessionAccess> | null,
  ): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [ActorHomePage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        provideFakeSessionAccess(state).provider,
      ],
    }).compileComponents();
    session = TestBed.inject(SessionStore);
    session.start({
      user: {
        id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        actorType,
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 60_000,
    });
    const fixture = TestBed.createComponent(ActorHomePage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => session.end());

  const features = (element: HTMLElement): (string | null)[] =>
    [...element.querySelectorAll('[data-feature]')].map((li) => li.getAttribute('data-feature'));

  const planText = (element: HTMLElement): string | undefined =>
    element.querySelector('[data-testid="home-plan"] [role="status"]')?.textContent?.trim();

  it('saluda al usuario con su tipo de cuenta y el propósito de su área', async () => {
    const element = await render(
      'organizer',
      accessReady('organizer', 'NOT_APPLICABLE', ORGANIZER_WEB_PERMISSIONS),
    );

    expect(element.querySelector('h1')?.textContent).toContain('Hola, Persona Sintética');
    expect(element.querySelector('[data-testid="home-actor-type"]')?.textContent).toContain(
      'Organizador de eventos',
    );
    expect(element.textContent).toContain('gestionarás tus eventos deportivos');
    expect(element.querySelector('[data-testid="home-email"]')?.textContent).toContain(
      'persona@example.com',
    );
    expect(element.textContent).not.toContain('token-sintetico');
    expect(element.querySelector('[data-testid="home-plan"]')).toBeNull();
  });

  it('lista las funciones confirmadas del rol marcadas como «Próximamente»', async () => {
    const element = await render(
      'service_provider',
      accessReady('service_provider', 'NOT_APPLICABLE', SERVICE_PROVIDER_WEB_PERMISSIONS),
    );

    expect(features(element)).toContain('service-create');
    expect(features(element)).toContain('service-publish');
    expect(features(element)).not.toContain('event-create');
    expect(element.querySelector('[data-feature="health-history"]')?.textContent).toContain(
      'Próximamente',
    );
  });

  it('sin la vista del BFF no lista funciones que exijan permiso', async () => {
    const element = await render('organizer', { status: 'loading' });

    expect(element.querySelector('[data-testid="home-features"]')).toBeNull();
  });

  it('CA7: el deportista con plan activo ve su estado y las funciones de su plan', async () => {
    const element = await render(
      'athlete',
      accessReady('athlete', 'ACTIVE', [], FREE_CAPABILITIES),
    );

    expect(planText(element)).toBe(
      'Tu plan está activo. Sus opciones disponibles en la web aparecen en tu menú.',
    );
    expect(features(element)).toEqual([
      'athlete-training-history',
      'athlete-services',
      'athlete-training-plans',
      'sport-calendar',
    ]);
  });

  it('PROVISIONING: informa la activación sin funciones asumidas', async () => {
    const element = await render('athlete', accessReady('athlete', 'PROVISIONING'));

    expect(planText(element)).toContain('Estamos activando tu plan');
    // Solo las funciones que no dependen del plan (HU011 y HU020).
    expect(features(element)).toEqual(['athlete-training-history', 'athlete-services']);
  });

  it('mientras consulta y ante un fallo no asume ningún plan', async () => {
    const loading = await render('athlete', { status: 'loading' });
    expect(planText(loading)).toBe('Consultando el estado de tu plan…');
    session.end();
    TestBed.resetTestingModule();

    const failed = await render('athlete', {
      status: 'error',
      error: { kind: 'server', status: 503, code: 'upstream_unavailable', correlationId: null },
    });
    expect(planText(failed)).toBe('No pudimos consultar tu plan. Reintenta desde el menú.');
    expect(features(failed)).toEqual(['athlete-training-history', 'athlete-services']);
  });
});
