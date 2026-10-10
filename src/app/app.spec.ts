import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../testing/translate-testing';
import { App } from './app';

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
