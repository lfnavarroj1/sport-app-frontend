import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  FakeServiceAssociationsGateway,
  testAssociation,
} from '../../../../../testing/fake-service-associations.gateway';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ServiceAssociationsGateway } from '../service-associations.gateway';
import { ServiceAssociationsStore } from '../service-associations.store';
import { AssociationAction } from './association-action';

describe('AssociationAction (HU017)', () => {
  let fixture: ComponentFixture<AssociationAction>;
  let element: HTMLElement;
  let gateway: FakeServiceAssociationsGateway;

  async function create(serviceIndex: number): Promise<void> {
    const service = testAssociation(serviceIndex);
    fixture = TestBed.createComponent(AssociationAction);
    fixture.componentRef.setInput('serviceId', service.serviceId);
    fixture.componentRef.setInput('name', service.name);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function byTestId(testId: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  async function click(testId: string): Promise<void> {
    byTestId(testId)!.click();
    await settle();
  }

  beforeEach(async () => {
    gateway = new FakeServiceAssociationsGateway();
    await TestBed.configureTestingModule({
      imports: [AssociationAction],
      providers: [
        provideTranslateTesting(),
        provideRouter([]),
        ServiceAssociationsStore,
        { provide: ServiceAssociationsGateway, useValue: gateway },
      ],
    }).compileComponents();
  });

  it('mientras consulta las asociaciones, «Asociar» espera deshabilitado', async () => {
    gateway.loadPage.and.returnValue(new Promise(() => undefined));
    await create(0);

    expect(byTestId('association-associate')?.hasAttribute('disabled')).toBeTrue();
  });

  it('CA1 y CA4: asociar pide confirmar, recuerda que no comparte datos de salud y muestra lo confirmado', async () => {
    await create(0);
    const associate = byTestId('association-associate')!;
    expect(associate.textContent?.trim()).toBe('Asociar');
    expect(associate.getAttribute('aria-label')).toBe(`Asociar ${testAssociation(0).name}`);

    await click('association-associate');
    const confirm = byTestId('association-confirm')!;
    expect(confirm.getAttribute('role')).toBe('group');
    expect(confirm.textContent).toContain(`¿Asociar «${testAssociation(0).name}» a tu perfil?`);
    expect(confirm.textContent).toContain('no comparte tus datos de salud');
    expect(confirm.textContent).toContain('no contrata, no reserva ni paga');
    expect(gateway.associate).not.toHaveBeenCalled();

    await click('association-confirm-button');

    expect(gateway.associate).toHaveBeenCalledTimes(1);
    expect(byTestId('association-badge')?.textContent).toContain('Asociado a tu perfil');
    expect(byTestId('association-dissociate')?.textContent?.trim()).toBe('Quitar');
    expect(byTestId('association-message')?.textContent).toContain('Servicio asociado');
  });

  it('cancelar no asocia', async () => {
    await create(0);
    await click('association-associate');
    element
      .querySelectorAll<HTMLButtonElement>('[data-testid="association-confirm"] button')[1]
      .click();
    await settle();

    expect(gateway.associate).not.toHaveBeenCalled();
    expect(byTestId('association-confirm')).toBeNull();
  });

  it('CA3: un servicio ya asociado ofrece «Quitar» y, tras confirmar, lo quita', async () => {
    await create(1);
    expect(byTestId('association-badge')).not.toBeNull();

    await click('association-dissociate');
    expect(byTestId('association-confirm')?.textContent).toContain('Seguirá en tu historial');
    gateway.loadPage.and.resolveTo({ associations: [], nextCursor: null });
    await click('association-confirm-button');

    expect(gateway.dissociate).toHaveBeenCalledOnceWith(testAssociation(1).id);
    expect(byTestId('association-associate')).not.toBeNull();
    expect(byTestId('association-message')?.textContent).toContain('Quitaste el servicio');
  });

  it('CA3: si el backend informa una asociación existente, lo dice sin duplicarla', async () => {
    gateway.associate.and.resolveTo({ kind: 'exists', associationId: testAssociation(0).id });
    await create(0);
    gateway.loadPage.and.resolveTo({ associations: [testAssociation(0)], nextCursor: null });
    await click('association-associate');
    await click('association-confirm-button');

    expect(byTestId('association-message')?.textContent).toContain('ya estaba asociado');
    expect(byTestId('association-badge')).not.toBeNull();
  });

  it('CA2: 404 service_not_found se explica sin presentarse como éxito', async () => {
    gateway.associate.and.resolveTo({
      kind: 'failed',
      error: { kind: 'not_found', status: 404, code: 'service_not_found', correlationId: 'ref-17' },
    });
    await create(0);
    await click('association-associate');
    await click('association-confirm-button');

    const message = byTestId('association-message')!;
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toContain('ya no está disponible para asociar');
    expect(message.textContent).toContain('ref-17');
    expect(byTestId('association-badge')).toBeNull();
  });

  it('CA2: 403 capability_required lleva a «Comparar planes» y oculta las acciones', async () => {
    gateway.associate.and.resolveTo({
      kind: 'failed',
      error: { kind: 'forbidden', status: 403, code: 'capability_required', correlationId: null },
    });
    await create(0);
    await click('association-associate');
    await click('association-confirm-button');

    expect(byTestId('association-action')).toBeNull();
  });

  it('un fallo transitorio ofrece reintentar con la misma clave', async () => {
    gateway.associate.and.resolveTo({
      kind: 'failed',
      error: { kind: 'server', status: 503, code: 'upstream_unavailable', correlationId: null },
    });
    await create(0);
    await click('association-associate');
    await click('association-confirm-button');
    const retry = byTestId('association-message')!.querySelector('button')!;
    expect(retry.textContent?.trim()).toBe('Reintentar');

    retry.click();
    await settle();

    const keys = gateway.associate.calls.allArgs().map((args) => args[1]);
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
