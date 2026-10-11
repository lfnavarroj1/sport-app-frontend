import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../testing/translate-testing';
import { App } from './app';
import { SessionStore } from './core/session/session.store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideTranslateTesting()],
    }).compileComponents();
  });

  it('muestra el nombre de la aplicación y el contenedor principal', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('mat-toolbar')?.textContent).toContain('SportApp');
    expect(element.querySelector('main#main-content')).not.toBeNull();
  });

  it('ofrece en la navegación el acceso al inicio de sesión', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav');

    expect(nav?.getAttribute('aria-label')).toBe('Navegación principal');
    const link = nav?.querySelector('a');
    expect(link?.textContent).toContain('Iniciar sesión');
    expect(link?.getAttribute('href')).toBe('/iniciar-sesion');
  });

  it('con sesión iniciada muestra el inicio y el nombre del usuario', async () => {
    const session = TestBed.inject(SessionStore);
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
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav');

    expect(nav?.querySelector('a')?.getAttribute('href')).toBe('/deportista/inicio');
    expect(nav?.querySelector('[data-testid="session-user"]')?.textContent).toContain(
      'Persona Sintética',
    );
    expect(nav?.textContent).not.toContain('Iniciar sesión');
    session.end();
  });

  it('ofrece un enlace accesible para saltar al contenido', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.skip-link');

    expect(link?.textContent).toContain('Saltar al contenido principal');
  });

  it('mueve el foco al contenido principal sin navegar', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    const event = new MouseEvent('click', { cancelable: true });

    element.querySelector('a.skip-link')?.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(element.querySelector('main'));
    element.remove();
  });
});
