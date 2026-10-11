import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { Session, SessionStore } from '../../../../core/session/session.store';
import { LoginGateway } from '../login.gateway';
import { LoginOutcome } from '../login.model';
import { LoginPage } from './login-page';

// Datos sintéticos de prueba.
const SESSION: Session = {
  user: {
    id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
    fullName: 'Persona Sintética',
    email: 'persona@example.com',
    actorType: 'service_provider',
  },
  accessToken: 'token-sintetico',
  expiresAt: Date.now() + 900_000,
};

class FakeLoginGateway extends LoginGateway {
  login = jasmine
    .createSpy('login')
    .and.resolveTo({ kind: 'authenticated', session: SESSION } satisfies LoginOutcome);
}

describe('LoginPage (HU003)', () => {
  let fixture: ComponentFixture<LoginPage>;
  let loader: HarnessLoader;
  let element: HTMLElement;
  let gateway: FakeLoginGateway;
  let session: SessionStore;
  let router: Router;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(LoginPage);
    loader = TestbedHarnessEnvironment.loader(fixture);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  beforeEach(async () => {
    gateway = new FakeLoginGateway();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: LoginGateway, useValue: gateway },
      ],
    }).compileComponents();
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  afterEach(() => session.end());

  async function input(label: string): Promise<MatInputHarness> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    return (await field.getControl(MatInputHarness))!;
  }

  async function errorsOf(label: string): Promise<string[]> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    return field.getTextErrors();
  }

  async function fillAndSubmit(): Promise<void> {
    await (await input('Correo electrónico')).setValue(' persona@example.com ');
    await (await input('Contraseña')).setValue('clave-sintetica-123');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Ingresar' }))).click();
    await fixture.whenStable();
  }

  function alertText(): string | undefined {
    return element.querySelector('[data-testid="login-error"]')?.textContent?.trim();
  }

  it('muestra el formulario de acceso con etiquetas y autocompletado adecuados', async () => {
    await create();

    expect(element.querySelector('h1')?.textContent).toContain('Iniciar sesión');
    expect(await (await input('Correo electrónico')).getType()).toBe('email');
    expect(await (await input('Contraseña')).getType()).toBe('password');
    expect(element.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  });

  it('ofrece el acceso al registro de una cuenta nueva (HU001)', async () => {
    await create();
    const link = element.querySelector<HTMLAnchorElement>('.login__register a');

    expect(link?.textContent).toContain('Crear cuenta');
    expect(link?.getAttribute('href')).toBe('/registro');
  });

  it('valida los campos obligatorios y el formato del correo sin llamar al BFF', async () => {
    await create();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Ingresar' }))).click();
    await fixture.whenStable();

    expect(await errorsOf('Correo electrónico')).toEqual(['Este campo es obligatorio.']);
    expect(await errorsOf('Contraseña')).toEqual(['Este campo es obligatorio.']);
    await (await input('Correo electrónico')).setValue('correo-invalido');
    expect(await errorsOf('Correo electrónico')).toEqual(['Ingresa un correo electrónico válido.']);
    expect(gateway.login).not.toHaveBeenCalled();
  });

  it('CA1: inicia la sesión y redirige al destino de su tipo de cuenta', async () => {
    await create();

    await fillAndSubmit();

    expect(gateway.login).toHaveBeenCalledOnceWith({
      email: 'persona@example.com',
      password: 'clave-sintetica-123',
    });
    expect(session.user()).toEqual(SESSION.user);
    // ADR-025: el profesional entra a su propio inicio.
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/profesional/inicio');
  });

  it('CA10: un actor ausente o desconocido no inicia sesión y va al acceso no autorizado', async () => {
    gateway.login.and.resolveTo({ kind: 'unauthorized_actor' });
    await create();

    await fillAndSubmit();

    expect(session.isAuthenticated()).toBeFalse();
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/acceso-no-autorizado');
  });

  it('CA2/CA3: muestra un mensaje genérico, no inicia sesión y descarta la contraseña', async () => {
    gateway.login.and.resolveTo({ kind: 'invalid_credentials' });
    await create();

    await fillAndSubmit();

    expect(element.querySelector('[data-testid="login-error"]')?.getAttribute('role')).toBe(
      'alert',
    );
    expect(alertText()).toBe('Correo o contraseña incorrectos.');
    expect(session.isAuthenticated()).toBeFalse();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(await (await input('Contraseña')).getValue()).toBe('');
    expect(await (await input('Correo electrónico')).getValue()).toBe('persona@example.com');
  });

  it('CA4: informa el tiempo de espera indicado por el control de abuso', async () => {
    gateway.login.and.resolveTo({ kind: 'too_many_attempts', retryAfterSeconds: 540 });
    await create();

    await fillAndSubmit();

    expect(alertText()).toBe('Hiciste demasiados intentos. Intenta de nuevo en 9 min.');
    expect(session.isAuthenticated()).toBeFalse();
  });

  it('CA4: sin tiempo de espera conocido pide esperar unos minutos', async () => {
    gateway.login.and.resolveTo({ kind: 'too_many_attempts', retryAfterSeconds: null });
    await create();

    await fillAndSubmit();

    expect(alertText()).toContain('Espera unos minutos');
  });

  it('muestra un fallo técnico de forma segura y trazable, y permite reintentar', async () => {
    gateway.login.and.resolveTo({
      kind: 'failed',
      error: { kind: 'server', status: 503, code: 'upstream_unavailable', correlationId: 'ref-1' },
    });
    await create();

    await fillAndSubmit();

    expect(alertText()).toContain('El servicio no está disponible en este momento.');
    expect(alertText()).toContain('ref-1');
    expect(await (await input('Contraseña')).getValue()).toBe('clave-sintetica-123');

    gateway.login.and.resolveTo({ kind: 'authenticated', session: SESSION });
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Ingresar' }))).click();
    await fixture.whenStable();
    expect(session.isAuthenticated()).toBeTrue();
  });

  it('convierte una excepción del adaptador en un fallo, no en sesión', async () => {
    gateway.login.and.rejectWith(new Error('inesperado'));
    await create();

    await fillAndSubmit();

    expect(alertText()).toContain('Ocurrió un error inesperado.');
    expect(session.isAuthenticated()).toBeFalse();
  });

  it('evita el doble envío mientras la solicitud está en curso', async () => {
    gateway.login.and.returnValue(new Promise(() => undefined));
    await create();

    await fillAndSubmit();
    const button = await loader.getHarness(MatButtonHarness.with({ text: 'Ingresando…' }));
    expect(await button.isDisabled()).toBeTrue();
    element.querySelector('form')?.requestSubmit();

    expect(gateway.login).toHaveBeenCalledTimes(1);
  });

  it('informa una sola vez que la sesión anterior expiró', async () => {
    session.start({ ...SESSION, expiresAt: Date.now() + 60_000 });
    session.end('expired');
    await create();

    expect(element.querySelector('[data-testid="login-session-expired"]')?.textContent).toContain(
      'Tu sesión expiró.',
    );
    expect(session.lastEndReason()).toBeNull();
  });

  it('permite mostrar la contraseña con un control accesible', async () => {
    await create();
    const toggle = await loader.getHarness(
      MatButtonHarness.with({ selector: '[aria-label="Mostrar contraseña"]' }),
    );

    await toggle.click();

    expect(await (await input('Contraseña')).getType()).toBe('text');
    expect(await (await toggle.host()).getAttribute('aria-pressed')).toBe('true');
  });
});
