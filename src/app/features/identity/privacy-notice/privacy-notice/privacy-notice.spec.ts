import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PRIVACY_NOTICE_REFERENCES, PRIVACY_NOTICE_VERSION } from '../privacy-notice.model';
import { PrivacyNotice } from './privacy-notice';

describe('PrivacyNotice (HU001)', () => {
  let fixture: ComponentFixture<PrivacyNotice>;
  let element: HTMLElement;

  async function render(headingLevel: 2 | 3 = 2): Promise<void> {
    TestBed.configureTestingModule({
      imports: [PrivacyNotice],
      providers: [provideTranslateTesting()],
    });
    fixture = TestBed.createComponent(PrivacyNotice);
    fixture.componentRef.setInput('headingLevel', headingLevel);
    fixture.detectChanges();
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  const text = () => element.textContent ?? '';
  const headings = (level: 'h2' | 'h3') =>
    [...element.querySelectorAll(level)].map((heading) => heading.textContent?.trim());

  it('muestra la versión aprobada y declara pendiente la fecha de vigencia', async () => {
    await render();

    expect(element.querySelector('[data-testid="privacy-notice-version"]')?.textContent).toBe(
      'sportapp-c108-c108plus.v1',
    );
    expect(PRIVACY_NOTICE_VERSION).toBe('sportapp-c108-c108plus.v1');
    const meta = element.querySelector('[data-testid="privacy-notice-meta"]')!;
    expect(meta.textContent).toContain('Fecha de vigencia');
    expect(meta.textContent).toContain('Pendiente de definir por el responsable del proyecto.');
  });

  it('explica en secciones todos los temas exigidos', async () => {
    await render();

    expect(headings('h2')).toEqual([
      'Quién trata tus datos',
      'Qué datos recopilamos',
      'Para qué usamos tus datos',
      'Minimización y calidad de los datos',
      'Cuánto tiempo conservamos tus datos',
      'Cómo protegemos tus datos',
      'Quién puede ver tus datos',
      'Datos sensibles y de salud',
      'Tus derechos',
      'Cómo ejercer tus derechos',
      'Referencias',
      'Versión de este aviso',
    ]);
    // Ninguna clave sin traducir llega a la pantalla.
    expect(text()).not.toMatch(/privacyNotice\./);
    // Derechos de acceso, rectificación, supresión y oposición.
    expect(text()).toContain('Acceder a ellos');
    expect(text()).toContain('Rectificarlos');
    expect(text()).toContain('Solicitar su supresión');
    expect(text()).toContain('Oponerte a su tratamiento');
    // Datos sensibles y de salud con consentimiento propio.
    expect(text()).toContain('consentimiento explícito y específico');
  });

  it('no inventa datos que el proyecto aún no definió: los declara pendientes', async () => {
    await render();

    expect(text()).toContain('razón social y domicilio');
    expect(text()).toContain('aún no están definidos');
    expect(text()).toContain('El plazo de conservación de tus datos');
    expect(text()).toContain('El país donde se tratan los datos');
    expect(text()).toContain('la autoridad ante la que puedes presentar una reclamación');
    expect(text()).not.toMatch(/@/);
  });

  it('presenta los Convenios 108 y 108+ como referencias, no como certificación', async () => {
    await render();

    expect(text()).toContain('no es una certificación de cumplimiento');
  });

  it('enlaza las fuentes oficiales del Consejo de Europa de forma segura', async () => {
    await render();

    for (const reference of PRIVACY_NOTICE_REFERENCES) {
      const link = element.querySelector<HTMLAnchorElement>(
        `[data-testid="privacy-notice-link-${reference.id}"]`,
      )!;
      expect(link.href).toBe(reference.url);
      expect(link.href.startsWith('https://www.coe.int/')).toBeTrue();
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(link.textContent).toContain('(se abre en una pestaña nueva)');
    }
    expect(PRIVACY_NOTICE_REFERENCES.map((reference) => reference.url)).toEqual([
      'https://www.coe.int/en/web/data-protection/convention108-and-protocol',
      'https://www.coe.int/en/web/data-protection/convention108/modernised',
    ]);
  });

  it('cada sección queda etiquetada por su título y puede usar h3 dentro del formulario', async () => {
    await render(3);

    expect(headings('h2')).toEqual([]);
    const sections = [...element.querySelectorAll('section')];
    expect(sections.length).toBe(12);
    for (const section of sections) {
      const labelledBy = section.getAttribute('aria-labelledby')!;
      expect(section.querySelector(`#${labelledBy}`)?.tagName).toBe('H3');
    }
  });

  it('no menciona precios ni la composición de los planes', async () => {
    await render();

    expect(text()).not.toMatch(/COP|INTERMEDIATE|PREMIUM|\$/);
  });
});
