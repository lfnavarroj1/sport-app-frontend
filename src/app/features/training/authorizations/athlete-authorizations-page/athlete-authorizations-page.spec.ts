import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { AuthorizationsGateway } from '../authorizations.gateway';
import { GrantOutcome, RevokeOutcome, TrainingAuthorization } from '../authorizations.model';
import { AthleteAuthorizationsPage } from './athlete-authorizations-page';

// Datos sintéticos de prueba.
const EMAIL = 'profesional@example.com';
const PROFESSIONAL_ID = '7f2e4d6c-8b0a-4e1c-9d3f-5a7b9c1d3e5f';
const AUTHORIZATION: TrainingAuthorization = {
  professionalEmail: EMAIL,
  professionalId: PROFESSIONAL_ID,
  status: 'ACTIVE',
  grantedAt: '2026-10-12T15:30:00Z',
  alreadyActive: false,
};
const UNAVAILABLE: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: 'ref-sintetica-3',
};

class FakeAuthorizationsGateway extends AuthorizationsGateway {
  grant = jasmine
    .createSpy('grant')
    .and.resolveTo({ kind: 'granted', authorization: AUTHORIZATION } satisfies GrantOutcome);
  revoke = jasmine.createSpy('revoke').and.resolveTo({ kind: 'revoked' } satisfies RevokeOutcome);
}

describe('AthleteAuthorizationsPage (HU010)', () => {
  let fixture: ComponentFixture<AthleteAuthorizationsPage>;
  let gateway: FakeAuthorizationsGateway;
  let element: HTMLElement;

  function emailInput(): HTMLInputElement {
    return element.querySelector<HTMLInputElement>('input[type="email"]')!;
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text,
    );
  }

  async function grant(email = EMAIL): Promise<void> {
    emailInput().value = email;
    emailInput().dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function entry(): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-professional="${EMAIL}"]`);
  }

  beforeEach(async () => {
    gateway = new FakeAuthorizationsGateway();
    await TestBed.configureTestingModule({
      imports: [AthleteAuthorizationsPage],
      providers: [provideTranslateTesting(), { provide: AuthorizationsGateway, useValue: gateway }],
    }).compileComponents();
    fixture = TestBed.createComponent(AthleteAuthorizationsPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('explica la opción y empieza sin autorizaciones gestionadas', () => {
    expect(element.querySelector('h1')?.textContent).toContain('Planes de entrenamiento');
    expect(element.querySelector('[data-testid="authorizations-empty"]')).not.toBeNull();
  });

  it('valida el correo antes de llamar al BFF', async () => {
    await grant('no-es-correo');

    expect(gateway.grant).not.toHaveBeenCalled();
    expect(element.querySelector('mat-error')?.textContent).toContain(
      'Ingresa un correo electrónico válido.',
    );
  });

  it('autoriza al profesional y lo anuncia', async () => {
    await grant(`  ${EMAIL} `);

    expect(gateway.grant).toHaveBeenCalledOnceWith(EMAIL);
    const notice = element.querySelector('[data-testid="authorization-notice"]')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain(`Autorizaste a ${EMAIL}`);
    expect(entry()?.textContent).toContain('Autorizado');
    expect(emailInput().value).toBe('');
    // El formulario vuelve a su estado inicial: el campo vacío no se marca como error.
    expect(element.querySelector('mat-error')).toBeNull();
  });

  it('informa cuando el profesional ya tenía la autorización y no lo repite en la lista', async () => {
    await grant();
    gateway.grant.and.resolveTo({
      kind: 'granted',
      authorization: { ...AUTHORIZATION, alreadyActive: true },
    });
    await grant();

    expect(element.querySelector('[data-testid="authorization-notice"]')?.textContent).toContain(
      'ya tenía tu autorización',
    );
    expect(element.querySelectorAll('[data-professional]').length).toBe(1);
  });

  it('un correo que no es de un profesional se indica en el campo', async () => {
    gateway.grant.and.resolveTo({ kind: 'professional_not_found' });
    await grant();

    expect(element.querySelector('mat-error')?.textContent).toContain(
      'no corresponde a un profesional',
    );
    expect(entry()).toBeNull();
  });

  it('sin la capacidad del plan lo explica sin asumir otra causa', async () => {
    gateway.grant.and.resolveTo({
      kind: 'failed',
      error: { kind: 'forbidden', status: 403, code: 'capability_required', correlationId: null },
    });
    await grant();

    expect(element.querySelector('[data-testid="authorization-error"]')?.textContent).toContain(
      'Tu plan actual no incluye esta opción.',
    );
  });

  it('un fallo del servicio es trazable y no agrega la autorización', async () => {
    gateway.grant.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await grant();

    const error = element.querySelector('[data-testid="authorization-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('ref-sintetica-3');
    expect(entry()).toBeNull();
  });

  it('evita el doble envío mientras autoriza', async () => {
    let resolve!: (outcome: GrantOutcome) => void;
    gateway.grant.and.returnValue(new Promise((r) => (resolve = r)));
    emailInput().value = EMAIL;
    emailInput().dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(button('Autorizando…')?.disabled).toBeTrue();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    resolve({ kind: 'granted', authorization: AUTHORIZATION });
    await fixture.whenStable();

    expect(gateway.grant).toHaveBeenCalledTimes(1);
  });

  it('revoca solo tras confirmar y con la confirmación del BFF', async () => {
    await grant();
    button('Revocar')!.click();
    await fixture.whenStable();

    expect(gateway.revoke).not.toHaveBeenCalled();
    expect(entry()?.textContent).toContain(`¿Revocar la autorización de ${EMAIL}?`);

    button('Revocar autorización')!.click();
    await fixture.whenStable();

    expect(gateway.revoke).toHaveBeenCalledOnceWith(PROFESSIONAL_ID);
    expect(entry()?.textContent).toContain('Autorización revocada');
    expect(button('Revocar')).toBeUndefined();
  });

  it('cancelar la revocación no llama al BFF', async () => {
    await grant();
    button('Revocar')!.click();
    await fixture.whenStable();
    button('Cancelar')!.click();
    await fixture.whenStable();

    expect(gateway.revoke).not.toHaveBeenCalled();
    expect(button('Revocar')).toBeDefined();
  });

  it('si la revocación falla, la autorización sigue activa y se puede reintentar', async () => {
    gateway.revoke.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await grant();
    button('Revocar')!.click();
    await fixture.whenStable();
    button('Revocar autorización')!.click();
    await fixture.whenStable();

    expect(entry()?.textContent).toContain('El servicio no está disponible');
    expect(entry()?.textContent).not.toContain('Autorización revocada');

    gateway.revoke.and.resolveTo({ kind: 'revoked' });
    button('Revocar autorización')!.click();
    await fixture.whenStable();

    expect(entry()?.textContent).toContain('Autorización revocada');
  });
});
