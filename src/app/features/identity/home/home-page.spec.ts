import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../testing/translate-testing';
import { SessionStore } from '../../../core/session/session.store';
import { HomePage } from './home-page';

describe('HomePage (HU003)', () => {
  let session: SessionStore;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]), provideTranslateTesting()],
    }).compileComponents();
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  afterEach(() => session.end());

  it('saluda al usuario y muestra su tipo de cuenta', async () => {
    session.start({
      user: {
        id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        actorType: 'organizer',
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 60_000,
    });
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Hola, Persona Sintética');
    expect(element.querySelector('[data-testid="home-actor-type"]')?.textContent).toContain(
      'Organizador de eventos',
    );
    expect(element.querySelector('[data-testid="home-email"]')?.textContent).toContain(
      'persona@example.com',
    );
    expect(element.textContent).not.toContain('token-sintetico');
  });

  it('vuelve al inicio de sesión cuando la sesión termina', async () => {
    session.start({
      user: {
        id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        actorType: 'athlete',
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 60_000,
    });
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();

    session.end('expired');
    await fixture.whenStable();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/iniciar-sesion');
  });
});
