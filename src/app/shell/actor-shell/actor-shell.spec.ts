import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../testing/translate-testing';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { ActorShell } from './actor-shell';

describe('ActorShell (ADR-025, HU003)', () => {
  let session: SessionStore;

  async function render(actor: ActorType): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [ActorShell],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
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

  afterEach(() => session?.end());

  const item = (element: HTMLElement, id: string): HTMLElement | null =>
    element.querySelector(`[data-menu-item="${id}"]`);

  it('muestra el tipo de cuenta y el menú lateral del organizador', async () => {
    const element = await render('organizer');

    expect(element.querySelector('[data-testid="shell-role"]')?.textContent).toContain(
      'Organizador de eventos',
    );
    expect(element.querySelector('mat-sidenav')).not.toBeNull();
    expect(item(element, 'event-create')?.textContent).toContain('Crear evento');
    expect(item(element, 'service-create')).toBeNull();
    expect(element.querySelector('[data-testid="shell-plan-pending"]')).toBeNull();
  });

  it('«Inicio» es un enlace al inicio propio', async () => {
    const element = await render('service_provider');
    const home = item(element, 'home');

    expect(home?.tagName).toBe('A');
    expect(home?.getAttribute('href')).toBe('/profesional/inicio');
  });

  it('las opciones «Próximamente» no son enlaces ni acciones', async () => {
    const element = await render('service_provider');
    const create = item(element, 'service-create');

    expect(create?.tagName).toBe('DIV');
    expect(create?.querySelector('a, button')).toBeNull();
    expect(create?.getAttribute('href')).toBeNull();
    expect(create?.textContent).toContain('Crear servicio');
    expect(create?.textContent).toContain('Próximamente');
  });

  it('cada grupo del menú es una navegación etiquetada por su título', async () => {
    const element = await render('organizer');
    const events = element.querySelector('[aria-labelledby="menu-group-events"]');

    expect(events?.getAttribute('role')).toBe('navigation');
    expect(element.querySelector('#menu-group-events')?.textContent).toContain('Eventos');
    expect(element.querySelectorAll('nav').length).toBe(0);
  });

  it('CA7: el deportista ve el aviso de las opciones de su plan sin asumir permisos', async () => {
    const element = await render('athlete');

    expect(element.querySelector('[data-testid="shell-plan-pending"]')?.textContent).toContain(
      'Las opciones de tu plan aparecerán cuando tu plan esté confirmado.',
    );
    expect(item(element, 'plan')?.textContent).toContain('Mi plan');
  });

  it('vuelve al inicio de sesión cuando la sesión termina', async () => {
    await render('organizer');
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

    session.end('expired');
    TestBed.tick();

    expect(navigate).toHaveBeenCalledWith('/iniciar-sesion');
  });
});
