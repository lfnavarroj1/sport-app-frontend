import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../testing/translate-testing';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { ActorHomePage } from './actor-home-page';

describe('ActorHomePage (ADR-025, HU003 CA7–CA9)', () => {
  let session: SessionStore;

  async function render(actorType: ActorType): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [ActorHomePage],
      providers: [provideRouter([]), provideTranslateTesting()],
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

  it('saluda al usuario con su tipo de cuenta y el propósito de su área', async () => {
    const element = await render('organizer');

    expect(element.querySelector('h1')?.textContent).toContain('Hola, Persona Sintética');
    expect(element.querySelector('[data-testid="home-actor-type"]')?.textContent).toContain(
      'Organizador de eventos',
    );
    expect(element.textContent).toContain('gestionarás tus eventos deportivos');
    expect(element.querySelector('[data-testid="home-email"]')?.textContent).toContain(
      'persona@example.com',
    );
    expect(element.textContent).not.toContain('token-sintetico');
  });

  it('lista las funciones del rol marcadas como «Próximamente»', async () => {
    const element = await render('service_provider');
    const features = [...element.querySelectorAll('[data-feature]')].map((li) =>
      li.getAttribute('data-feature'),
    );

    expect(features).toContain('service-create');
    expect(features).toContain('service-publish');
    expect(features).not.toContain('event-create');
    expect(element.querySelector('[data-feature="service-create"]')?.textContent).toContain(
      'Próximamente',
    );
  });

  it('el deportista ve el estado pendiente de su plan sin funciones asumidas', async () => {
    const element = await render('athlete');

    expect(element.querySelector('[data-testid="home-plan"]')?.textContent).toContain(
      'Tu plan y sus opciones aparecerán aquí cuando estén confirmados.',
    );
    expect(element.querySelector('[data-testid="home-features"]')).toBeNull();
  });
});
