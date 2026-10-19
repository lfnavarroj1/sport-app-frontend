import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';

import { provideTranslateTesting } from '../../../../testing/translate-testing';
import { FieldError } from './field-error';

@Component({
  imports: [FieldError],
  template: `<app-field-error [control]="control" />`,
})
class HostComponent {
  readonly control = new FormControl('', [
    Validators.required,
    Validators.minLength(3),
    (c) => (c.value === 'xyz' ? { custom: true } : null),
  ]);
}

describe('FieldError', () => {
  let fixture: ComponentFixture<HostComponent>;
  let control: HostComponent['control'];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    control = fixture.componentInstance.control;
  });

  async function text(): Promise<string> {
    fixture.detectChanges();
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';
  }

  it('no muestra errores antes de que el usuario interactúe', async () => {
    expect(await text()).toBe('');
  });

  it('muestra el mensaje de campo obligatorio', async () => {
    control.markAsTouched();

    expect(await text()).toBe('Este campo es obligatorio.');
  });

  it('interpola los parámetros del validador', async () => {
    control.setValue('ab');
    control.markAsDirty();

    expect(await text()).toBe('Debe tener al menos 3 caracteres.');
  });

  it('usa un mensaje genérico para validadores sin texto propio', async () => {
    control.setValue('xyz');
    control.markAsDirty();

    expect(await text()).toBe('El valor no es válido.');
  });

  it('desaparece cuando el valor es válido', async () => {
    control.setValue('valor válido');
    control.markAsDirty();

    expect(await text()).toBe('');
  });
});
