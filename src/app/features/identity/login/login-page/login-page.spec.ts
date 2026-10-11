import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { LoginPage } from './login-page';

describe('LoginPage (esqueleto HU003)', () => {
  let fixture: ComponentFixture<LoginPage>;
  let loader: HarnessLoader;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideTranslateTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    loader = TestbedHarnessEnvironment.loader(fixture);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  async function input(label: string): Promise<MatInputHarness> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    return (await field.getControl(MatInputHarness))!;
  }

  async function errorsOf(label: string): Promise<string[]> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    return field.getTextErrors();
  }

  async function submit(): Promise<void> {
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Ingresar' }))).click();
    await fixture.whenStable();
  }

  it('muestra el formulario de acceso con etiquetas y autocompletado adecuados', async () => {
    expect(element.querySelector('h1')?.textContent).toContain('Iniciar sesión');
    expect(await (await input('Correo electrónico')).getType()).toBe('email');
    expect(await (await input('Contraseña')).getType()).toBe('password');
    expect(element.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  });

  it('ofrece el acceso al registro de una cuenta nueva (HU001)', () => {
    const link = element.querySelector<HTMLAnchorElement>('.login__register a');

    expect(element.querySelector('.login__register')?.textContent).toContain(
      '¿Aún no tienes una cuenta?',
    );
    expect(link?.textContent).toContain('Crear cuenta');
    expect(link?.getAttribute('href')).toBe('/registro');
  });

  it('valida los campos obligatorios y el formato del correo', async () => {
    await submit();

    expect(await errorsOf('Correo electrónico')).toEqual(['Este campo es obligatorio.']);
    expect(await errorsOf('Contraseña')).toEqual(['Este campo es obligatorio.']);

    await (await input('Correo electrónico')).setValue('correo-invalido');
    expect(await errorsOf('Correo electrónico')).toEqual(['Ingresa un correo electrónico válido.']);
    expect(element.querySelector('[data-testid="login-not-available"]')).toBeNull();
  });

  it('no simula un ingreso: informa que aún no está disponible y descarta la contraseña', async () => {
    await (await input('Correo electrónico')).setValue('persona@example.com');
    await (await input('Contraseña')).setValue('clave-sintetica-123');

    await submit();

    const notice = element.querySelector('[data-testid="login-not-available"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('El inicio de sesión todavía no está disponible.');
    expect(await (await input('Contraseña')).getValue()).toBe('');
  });

  it('permite mostrar la contraseña con un control accesible', async () => {
    const toggle = await loader.getHarness(
      MatButtonHarness.with({ selector: '[aria-label="Mostrar contraseña"]' }),
    );

    await toggle.click();

    expect(await (await input('Contraseña')).getType()).toBe('text');
    expect(await (await toggle.host()).getAttribute('aria-pressed')).toBe('true');
  });
});
