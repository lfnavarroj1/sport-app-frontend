import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../testing/translate-testing';
import { AuthShell } from './auth-shell';

@Component({
  imports: [AuthShell],
  template: `<app-auth-shell><p data-testid="contenido">Formulario</p></app-auth-shell>`,
})
class HostComponent {}

describe('AuthShell', () => {
  it('muestra el mensaje de la plataforma y proyecta el contenido en el panel', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.auth-shell__headline')?.textContent).toContain(
      'Entrena, compite y conecta',
    );
    expect(element.querySelector('.auth-shell__tagline')?.textContent).toContain(
      'en un solo lugar',
    );
    expect(element.querySelector('.auth-shell__panel [data-testid="contenido"]')?.textContent).toBe(
      'Formulario',
    );
    // El mensaje de marca no compite con el título de la página.
    expect(element.querySelector('h1, h2')).toBeNull();
  });
});
