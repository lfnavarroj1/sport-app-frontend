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

// Datos sintéticos de prueba; no representan el catálogo aprobado.
const OPTIONS: RegistrationOptions = {
  actorTypes: [{ code: 'athlete' }, { code: 'organizer' }],
  policies: [
    { id: 'terms', version: 'v1', url: 'https://example.test/terms', required: true },
    { id: 'privacy', version: 'v2', url: 'https://example.test/privacy', required: true },
  ],
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
    for (const checkbox of await loader.getAllHarnesses(MatCheckboxHarness)) {
      await checkbox.check();
    }
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
    expect(policyErrors.length).toBe(2);
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

  it('exige aceptar las políticas obligatorias', async () => {
    await fillValidForm();
    await (await loader.getAllHarnesses(MatCheckboxHarness))[1].uncheck();

    await submit();

    expect(host.drafts).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Debes aceptar esta política para registrarte.',
    );
  });

  it('CA1: envía los datos normalizados con las versiones de políticas aceptadas', async () => {
    await fillValidForm();

    await submit();

    expect(host.drafts).toEqual([
      {
        fullName: 'Persona Sintética',
        email: 'persona@example.test',
        password: 'clave-de-prueba',
        actorType: 'athlete',
        acceptedPolicies: [
          { id: 'terms', version: 'v1' },
          { id: 'privacy', version: 'v2' },
        ],
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
    host.serverErrors.set({ emailTaken: true, invalidFields: [] });
    await fixture.whenStable();

    expect(await errorsOf('Correo electrónico')).toEqual([
      'Ya existe una cuenta con este correo electrónico.',
    ]);
  });

  it('CA3: marca los campos rechazados por el backend', async () => {
    await fillValidForm();
    host.serverErrors.set({ emailTaken: false, invalidFields: ['fullName', 'password'] });
    await fixture.whenStable();

    expect(await errorsOf('Nombre completo')).toEqual(['El valor no es válido.']);
    expect(await errorsOf('Contraseña')).toEqual(['El valor no es válido.']);
    expect(await errorsOf('Correo electrónico')).toEqual([]);
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
