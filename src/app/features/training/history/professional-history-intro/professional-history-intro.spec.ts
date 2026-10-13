import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ProfessionalHistoryIntro } from './professional-history-intro';

describe('ProfessionalHistoryIntro (HU011)', () => {
  it('explica que el historial se abre desde el plan y lleva a los planes', async () => {
    await TestBed.configureTestingModule({
      imports: [ProfessionalHistoryIntro],
      providers: [provideRouter([]), provideTranslateTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProfessionalHistoryIntro);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(
      element.querySelector('[data-testid="history-professional-intro"]')?.textContent,
    ).toContain('Ver historial de entrenamiento');
    expect(element.querySelector('a')?.getAttribute('href')).toBe(
      '/profesional/entrenamientos/planes',
    );
  });
});
