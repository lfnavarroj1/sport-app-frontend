import { ServiceAssociationResponseDto } from '../app/core/api/bff-web/service-associations.api';
import { ServiceAssociationsGateway } from '../app/features/services/associations/service-associations.gateway';
import {
  AssociateOutcome,
  ServiceAssociation,
  toServiceAssociation,
} from '../app/features/services/associations/service-associations.model';
import { serviceAssociation } from './bff-web/service-associations.fixtures';

/** Asociación sintética `index` ya transformada (derivada del simulador del contrato). */
export function testAssociation(
  index: number,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
): ServiceAssociation {
  return toServiceAssociation(serviceAssociation(index, status) as ServiceAssociationResponseDto);
}

/** Puerto controlado por las pruebas de componentes de HU017. */
export class FakeServiceAssociationsGateway extends ServiceAssociationsGateway {
  loadPage = jasmine
    .createSpy('loadPage')
    .and.resolveTo({ associations: [testAssociation(1)], nextCursor: null });
  associate = jasmine.createSpy('associate').and.resolveTo({
    kind: 'associated',
    association: testAssociation(0),
    replayed: false,
  } satisfies AssociateOutcome);
  dissociate = jasmine.createSpy('dissociate').and.resolveTo({ kind: 'dissociated' });
}
