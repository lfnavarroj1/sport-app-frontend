import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import {
  RegistrationDraft,
  RegistrationOptions,
  RegistrationServerErrors,
} from '../registration.model';
import { RegistrationForm } from './registration-form';

// Datos sintéticos de prueba.
const OPTIONS: RegistrationOptions = {
  actorTypes: [{ code: 'athlete' }, { code: 'organizer' }],
  policiesVersion: 'v-sintetica',
};

const NO_SERVER_ERRORS: RegistrationServerErrors = {
  emailTaken: false,
  policiesOutdated: false,
  invalidFields: [],
};

@Component({
  imports: [RegistrationForm],
  template: `
    <app-registration-form
      [options]="options"
      [submitting]="submitting()"
      [serverErrors]="serverErrors()"
      (submitted)="drafts.push($event)"
      (edited)="edits = edits + 1"
    />
  `,
})
class HostComponent {
  readonly options = OPTIONS;
  readonly submitting = signal(false);
  readonly serverErrors = signal<RegistrationServerErrors | null>(null);
  readonly drafts: RegistrationDraft[] = [];
  edits = 0;
}

describe('RegistrationForm (HU001)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.loader(fixture);
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

  async function fillValidForm(): Promise<void> {
    await (await input('Nombre completo')).setValue('  Persona Sintética  ');
    await (await input('Correo electrónico')).setValue(' persona@example.test ');
    await (await input('Contraseña')).setValue('clave-de-prueba');
    const select = await loader.getHarness(MatSelectHarness);
    await select.open();
    await select.clickOptions({ text: 'Deportista' });
    await (await loader.getHarness(MatCheckboxHarness)).check();
  }

  async function submit(): Promise<void> {
    const button = await loader.getHarness(MatButtonHarness.with({ text: /Registrar/ }));
    await button.click();
    await fixture.whenStable();
  }

  it('muestra los campos de la HU con etiquetas accesibles', async () => {
    const labels = await Promise.all(
      (await loader.getAllHarnesses(MatFormFieldHarness)).map((f) => f.getLabel()),
    );
    expect(labels).toEqual([
      'Nombre completo',
      'Correo electrónico',
      'Contraseña',
      'Tipo de usuario',
    ]);
    expect(await (await input('Contraseña')).getType()).toBe('password');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input[autocomplete="new-password"]')).not.toBeNull();
    expect(element.querySelector('fieldset legend')?.textContent).toContain('Políticas');
  });

  it('ofrece solo los tipos de actor del catálogo recibido', async () => {
    const select = await loader.getHarness(MatSelectHarness);
    await select.open();
    const options = await Promise.all((await select.getOptions()).map((o) => o.getText()));
    expect(options).toEqual(['Deportista', 'Organizador de eventos']);
  });

  it('CA3: identifica los campos obligatorios y no envía un formulario incompleto', async () => {
    await submit();

    expect(host.drafts).toEqual([]);
    expect(await errorsOf('Nombre completo')).toEqual(['Este campo es obligatorio.']);
    expect(await errorsOf('Correo electrónico')).toEqual(['Este campo es obligatorio.']);
    expect(await errorsOf('Contraseña')).toEqual(['Este campo es obligatorio.']);
    expect(await errorsOf('Tipo de usuario')).toEqual(['Este campo es obligatorio.']);
    const policyErrors = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.registration-form__policy-error',
    );
    expect(policyErrors.length).toBe(1);
  });

  it('CA3: rechaza un correo con formato inválido y un nombre en blanco', async () => {
    await fillValidForm();
    await (await input('Correo electrónico')).setValue('correo-invalido');
    await (await input('Nombre completo')).setValue('   ');

    await submit();

    expect(host.drafts).toEqual([]);
    expect(await errorsOf('Correo electrónico')).toEqual(['Ingresa un correo electrónico válido.']);
    expect(await errorsOf('Nombre completo')).toEqual(['Este campo es obligatorio.']);
  });

  it('exige aceptar las políticas y muestra su versión vigente', async () => {
    await fillValidForm();
    const checkbox = await loader.getHarness(MatCheckboxHarness);
    expect(await checkbox.getLabelText()).toBe(
      'Acepto las políticas de uso y privacidad de SportApp (versión v-sintetica).',
    );
    await checkbox.uncheck();

    await submit();

    expect(host.drafts).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Debes aceptar las políticas para registrarte.',
    );
  });

  it('aplica los límites de longitud del contrato a la contraseña y el nombre', async () => {
    await fillValidForm();
    await (await input('Contraseña')).setValue('x'.repeat(11));
    await (await input('Nombre completo')).setValue('n'.repeat(121));

    await submit();

    expect(host.drafts).toEqual([]);
    expect(await errorsOf('Contraseña')).toEqual(['Debe tener al menos 12 caracteres.']);
    expect(await errorsOf('Nombre completo')).toEqual(['Debe tener como máximo 120 caracteres.']);

    await (await input('Contraseña')).setValue('x'.repeat(129));
    expect(await errorsOf('Contraseña')).toEqual(['Debe tener como máximo 128 caracteres.']);
  });

  it('indica los límites de la contraseña antes de enviar', async () => {
    const field = await loader.getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Contraseña' }),
    );

    expect(await field.getTextHints()).toEqual(['Entre 12 y 128 caracteres.']);
  });

  it('CA1: envía los datos normalizados con la versión de políticas aceptada', async () => {
    await fillValidForm();

    await submit();

    expect(host.drafts).toEqual([
      {
        fullName: 'Persona Sintética',
        email: 'persona@example.test',
        password: 'clave-de-prueba',
        actorType: 'athlete',
        acceptedPoliciesVersion: 'v-sintetica',
      },
    ]);
  });

  it('evita el doble envío mientras hay una solicitud en curso', async () => {
    await fillValidForm();
    host.submitting.set(true);
    await fixture.whenStable();

    const button = await loader.getHarness(MatButtonHarness.with({ text: 'Registrando…' }));
    expect(await button.isDisabled()).toBeTrue();
    (fixture.nativeElement as HTMLElement).querySelector('form')?.requestSubmit();
    expect(host.drafts).toEqual([]);
  });

  it('CA2: marca el correo cuando el backend informa que ya está registrado', async () => {
    await fillValidForm();
    host.serverErrors.set({ ...NO_SERVER_ERRORS, emailTaken: true });
    await fixture.whenStable();

    expect(await errorsOf('Correo electrónico')).toEqual([
      'Ya existe una cuenta con este correo electrónico.',
    ]);
  });

  it('CA3: marca los campos rechazados por el backend', async () => {
    await fillValidForm();
    host.serverErrors.set({ ...NO_SERVER_ERRORS, invalidFields: ['fullName', 'password'] });
    await fixture.whenStable();

    expect(await errorsOf('Nombre completo')).toEqual(['El valor no es válido.']);
    expect(await errorsOf('Contraseña')).toEqual(['El valor no es válido.']);
    expect(await errorsOf('Correo electrónico')).toEqual([]);
  });

  it('informa que la versión de políticas aceptada ya no está vigente', async () => {
    await fillValidForm();
    host.serverErrors.set({ ...NO_SERVER_ERRORS, policiesOutdated: true });
    await fixture.whenStable();

    const error = (fixture.nativeElement as HTMLElement).querySelector(
      '.registration-form__policy-error',
    );
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('La versión de las políticas ya no está vigente.');
  });

  it('informa cuando el usuario modifica los datos', async () => {
    const before = host.edits;
    await (await input('Nombre completo')).setValue('Otro nombre');

    expect(host.edits).toBeGreaterThan(before);
  });

  it('permite mostrar la contraseña con un control accesible', async () => {
    const toggle = await loader.getHarness(
      MatButtonHarness.with({ selector: '[aria-label="Mostrar contraseña"]' }),
    );
    expect(await (await toggle.host()).getAttribute('aria-pressed')).toBe('false');

    await toggle.click();

    expect(await (await input('Contraseña')).getType()).toBe('text');
    expect(await (await toggle.host()).getAttribute('aria-pressed')).toBe('true');
  });
});
