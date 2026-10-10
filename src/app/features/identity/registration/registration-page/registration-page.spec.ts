import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { RegistrationGateway } from '../registration.gateway';
import { RegistrationDraft, RegistrationOptions, RegistrationOutcome } from '../registration.model';
import { RegistrationForm } from '../registration-form/registration-form';
import { RegistrationPage } from './registration-page';

// Datos sintéticos de prueba; no representan el catálogo aprobado.
const OPTIONS: RegistrationOptions = {
  actorTypes: [{ code: 'athlete' }],
  policies: [{ id: 'terms', version: 'v1', url: 'https://example.test/terms', required: true }],
};

const DRAFT: RegistrationDraft = {
  fullName: 'Persona Sintética',
  email: 'persona@example.test',
  password: 'clave-de-prueba',
  actorType: 'athlete',
  acceptedPolicies: [{ id: 'terms', version: 'v1' }],
};

class FakeRegistrationGateway extends RegistrationGateway {
  loadOptions = jasmine.createSpy('loadOptions').and.resolveTo(OPTIONS);
  register = jasmine.createSpy('register').and.resolveTo({
    kind: 'registered',
    userId: 'user-1',
    email: 'persona@example.test',
  } satisfies RegistrationOutcome);
}

describe('RegistrationPage (HU001)', () => {
  let fixture: ComponentFixture<RegistrationPage>;
  let gateway: FakeRegistrationGateway;

  async function create(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RegistrationPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** Simula el envío del formulario ya validado. */
  async function submitDraft(draft: RegistrationDraft = DRAFT): Promise<void> {
    const form = fixture.debugElement.query(
      (el) => el.componentInstance instanceof RegistrationForm,
    ).componentInstance as RegistrationForm;
    form.submitted.emit(draft);
    await fixture.whenStable();
  }

  function editForm(): void {
    const form = fixture.debugElement.query(
      (el) => el.componentInstance instanceof RegistrationForm,
    ).componentInstance as RegistrationForm;
    form.edited.emit();
  }

  function keysUsed(): string[] {
    return gateway.register.calls.allArgs().map(([, key]) => key as string);
  }

  beforeEach(async () => {
    gateway = new FakeRegistrationGateway();
    await TestBed.configureTestingModule({
      imports: [RegistrationPage],
      providers: [provideTranslateTesting(), { provide: RegistrationGateway, useValue: gateway }],
    }).compileComponents();
  });

  it('muestra la carga mientras obtiene las opciones', async () => {
    gateway.loadOptions.and.returnValue(new Promise(() => undefined));

    const element = await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
    expect(element.querySelector('form')).toBeNull();
  });

  it('muestra el formulario cuando las opciones están disponibles', async () => {
    const element = await create();

    expect(element.querySelector('h1')?.textContent).toContain('Crear cuenta');
    expect(element.querySelector('app-registration-form form')).not.toBeNull();
  });

  it('informa un error recuperable al cargar opciones y permite reintentar', async () => {
    gateway.loadOptions.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    const element = await create();

    expect(element.querySelector('[data-testid="state-error"]')).not.toBeNull();

    gateway.loadOptions.and.resolveTo(OPTIONS);
    element.querySelector<HTMLButtonElement>('[data-testid="state-error"] button')?.click();
    await fixture.whenStable();

    expect(gateway.loadOptions).toHaveBeenCalledTimes(2);
    expect(element.querySelector('app-registration-form form')).not.toBeNull();
  });

  it('muestra un estado vacío si no hay tipos de actor habilitados', async () => {
    gateway.loadOptions.and.resolveTo({ actorTypes: [], policies: [] });

    const element = await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'El registro no está disponible en este momento.',
    );
  });

  it('CA1: confirma el registro y descarta el formulario con la contraseña', async () => {
    const element = await create();

    await submitDraft();

    expect(gateway.register).toHaveBeenCalledOnceWith(DRAFT, jasmine.any(String));
    const success = element.querySelector('[data-testid="registration-success"]');
    expect(success?.getAttribute('role')).toBe('status');
    expect(success?.textContent).toContain('Tu cuenta fue creada');
    expect(success?.textContent).toContain('persona@example.test');
    expect(element.querySelector('input[type="password"]')).toBeNull();
    expect(document.activeElement).toBe(success?.querySelector('h2') ?? null);
  });

  it('CA2: entrega al formulario el error de correo ya registrado', async () => {
    gateway.register.and.resolveTo({ kind: 'email_taken' });
    const element = await create();

    await submitDraft();

    expect(element.querySelector('[data-testid="registration-success"]')).toBeNull();
    expect(element.textContent).toContain('Ya existe una cuenta con este correo electrónico.');
  });

  it('muestra un fallo técnico de forma segura y trazable, sin interpretarlo como éxito', async () => {
    gateway.register.and.resolveTo({
      kind: 'failed',
      error: { kind: 'server', status: 503, code: null, correlationId: 'c0ffee00-1111' },
    });
    const element = await create();

    await submitDraft();

    const alert = element.querySelector('[data-testid="registration-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('El servicio no está disponible en este momento.');
    expect(alert?.textContent).toContain('c0ffee00-1111');
    expect(element.querySelector('[data-testid="registration-success"]')).toBeNull();
    expect(element.querySelector('app-registration-form form')).not.toBeNull();
  });

  it('convierte una excepción del adaptador en un fallo, no en éxito', async () => {
    gateway.register.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    const element = await create();

    await submitDraft();

    expect(element.querySelector('[data-testid="registration-error"]')?.textContent).toContain(
      'No hay conexión.',
    );
  });

  it('CA5: reutiliza la clave de idempotencia al reintentar el mismo intento', async () => {
    gateway.register.and.resolveTo({
      kind: 'failed',
      error: { kind: 'offline', status: null, code: null, correlationId: null },
    });
    await create();

    await submitDraft();
    await submitDraft();

    const [first, second] = keysUsed();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it('CA5: usa una clave nueva cuando el usuario cambia los datos', async () => {
    gateway.register.and.resolveTo({ kind: 'email_taken' });
    await create();

    await submitDraft();
    editForm();
    await submitDraft({ ...DRAFT, email: 'otra@example.test' });

    const [first, second] = keysUsed();
    expect(second).not.toBe(first);
  });

  it('ignora un segundo envío mientras el primero está en curso', async () => {
    gateway.register.and.returnValue(new Promise(() => undefined));
    await create();

    await submitDraft();
    await submitDraft();

    expect(gateway.register).toHaveBeenCalledTimes(1);
  });
});
