import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ACCOUNT_READ } from '../../../../../testing/bff-web/account.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { AccountForm } from './account-form';
import { Account, AccountDraft, AccountViolation, toAccount } from './account.model';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.28.0.
const INITIAL: Account = toAccount(ACCOUNT_READ);

describe('AccountForm (HU002)', () => {
  let fixture: ComponentFixture<AccountForm>;
  let element: HTMLElement;
  let submitted: AccountDraft[];
  let edited: number;
  let cancelled: number;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(AccountForm);
    fixture.componentRef.setInput('initial', INITIAL);
    submitted = [];
    edited = 0;
    cancelled = 0;
    fixture.componentInstance.submitted.subscribe((draft) => submitted.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountForm],
      providers: [provideTranslateTesting()],
    }).compileComponents();
  });

  function control(name: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`[formcontrolname="${name}"]`)!;
  }

  function type(name: string, value: string): void {
    const target = control(name);
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function errors(): string[] {
    return [...element.querySelectorAll('mat-error')].map((item) => item.textContent?.trim() ?? '');
  }

  async function serverErrors(violations: readonly AccountViolation[]): Promise<void> {
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }

  it('parte de los valores vigentes sin contarlo como edición, con etiquetas accesibles', async () => {
    await create();

    expect(control('fullName').value).toBe('Persona Sintética');
    expect(control('email').value).toBe('persona@example.com');
    expect(control('email').type).toBe('email');
    expect(control('fullName').getAttribute('autocomplete')).toBe('name');
    expect(control('email').getAttribute('autocomplete')).toBe('email');
    expect(edited).toBe(0);
    const labels = [...element.querySelectorAll('mat-label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual(['Nombre completo', 'Correo electrónico']);
  });

  it('envía el nombre y el correo recortados; la normalización la hace el backend', async () => {
    await create();
    type('fullName', '  Persona   Renombrada ');
    type('email', ' Persona.Nueva@Example.com ');
    await submit();

    expect(submitted).toEqual([
      { fullName: 'Persona   Renombrada', email: 'Persona.Nueva@Example.com' },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('no envía un nombre vacío, un correo mal formado ni valores sobre el límite', async () => {
    await create();
    type('fullName', '   ');
    type('email', 'no-es-un-correo');
    await fixture.whenStable();
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toEqual([
      'Este campo es obligatorio.',
      'Ingresa un correo electrónico válido.',
    ]);
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(control('fullName'));

    type('fullName', 'a'.repeat(121));
    type('email', `a@${`${'b'.repeat(60)}.`.repeat(5)}com`);
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toEqual([
      'Debe tener como máximo 120 caracteres.',
      // El validador de correo ya rechaza más de 254 caracteres; además el campo no los admite.
      'Ingresa un correo electrónico válido.',
    ]);
  });

  it('marca las reglas del backend en su campo y resume las demás', async () => {
    await create();
    await serverErrors([
      { field: 'full_name', issue: 'invalid_length' },
      { field: 'email', issue: 'unknown_value' },
      { field: 'actor_type', issue: 'field_not_allowed' },
    ]);

    expect(errors()).toEqual(['La longitud no es válida.', 'El valor no es válido.']);
    const summary = element.querySelector<HTMLElement>('[data-testid="account-errors"]')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.textContent).toContain('Nombre completo: La longitud no es válida.');
    expect(summary.textContent).toContain('Solicitud: Este dato no se puede enviar.');
    expect(document.activeElement).toBe(summary);

    // Al editar se retiran las marcas del backend.
    type('fullName', 'Persona Renombrada');
    await fixture.whenStable();
    expect(errors()).toEqual([]);
  });

  it('CA3: un correo de otra cuenta se marca en el campo sin revelar nada más', async () => {
    await create();
    fixture.componentRef.setInput('emailTaken', true);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(errors()).toEqual(['No puedes usar este correo. Ingresa otro.']);
    expect(document.activeElement).toBe(control('email'));

    type('email', 'otro@example.com');
    await fixture.whenStable();
    expect(errors()).toEqual([]);
  });

  it('evita el doble envío mientras se guarda y permite cancelar', async () => {
    await create();
    fixture.componentRef.setInput('submitting', true);
    await fixture.whenStable();

    await submit();
    expect(submitted).toEqual([]);
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.disabled)).toEqual([true, true]);

    fixture.componentRef.setInput('submitting', false);
    await fixture.whenStable();
    buttons[1].click();
    expect(cancelled).toBe(1);
  });
});
