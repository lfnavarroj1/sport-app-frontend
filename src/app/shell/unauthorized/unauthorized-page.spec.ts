import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../testing/translate-testing';
import { SessionStore } from '../../core/session/session.store';
import { UnauthorizedPage } from './unauthorized-page';

describe('UnauthorizedPage (HU003 CA10)', () => {
  let session: SessionStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnauthorizedPage],
      providers: [provideRouter([]), provideTranslateTesting()],
    }).compileComponents();
    session = TestBed.inject(SessionStore);
  });

  afterEach(() => session.end());

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(UnauthorizedPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('sin sesión informa el bloqueo y lleva al inicio de sesión', async () => {
    const element = await render();

    expect(element.querySelector('h1')?.textContent).toContain('Acceso no autorizado');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/iniciar-sesion');
  });

  it('con sesión ofrece volver al inicio propio, sin menú de negocio', async () => {
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
    const element = await render();

    expect(element.querySelector('a')?.getAttribute('href')).toBe('/deportista/inicio');
    expect(element.querySelector('a')?.textContent).toContain('Ir a mi inicio');
    expect(element.querySelector('mat-sidenav, [data-menu-item]')).toBeNull();
  });
});
