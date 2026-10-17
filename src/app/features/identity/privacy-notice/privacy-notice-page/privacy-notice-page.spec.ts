import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PrivacyNoticePage } from './privacy-notice-page';

describe('PrivacyNoticePage (HU001)', () => {
  it('es una página pública con un único h1, el aviso y regreso al registro', async () => {
    TestBed.configureTestingModule({
      imports: [PrivacyNoticePage],
      providers: [provideRouter([]), provideTranslateTesting()],
    });
    const fixture = TestBed.createComponent(PrivacyNoticePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const titles = element.querySelectorAll('h1');
    expect(titles.length).toBe(1);
    expect(titles[0].textContent).toContain('Aviso de tratamiento de datos personales de SportApp');
    expect(element.querySelector('[data-testid="privacy-notice"]')).not.toBeNull();
    // Los títulos de sección siguen al h1 sin saltar niveles.
    expect(element.querySelectorAll('h2').length).toBe(12);
    expect(element.querySelector('h3')).toBeNull();
    const links = [...element.querySelectorAll<HTMLAnchorElement>('nav a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/registro',
      '/iniciar-sesion',
    ]);
  });
});
