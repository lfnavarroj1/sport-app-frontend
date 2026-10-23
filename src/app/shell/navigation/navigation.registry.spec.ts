import {
  FREE_CAPABILITIES,
  ORGANIZER_WEB_PERMISSIONS,
  PREMIUM_CAPABILITIES,
  SERVICE_PROVIDER_WEB_PERMISSIONS,
} from '../../../testing/bff-web/capabilities.fixtures';
import { SessionAccess } from '../../core/session/session-access.store';
import { ActorType } from '../../core/session/session.store';
import { NAVIGATION, homeFor, navigationSections, visibleItems } from './navigation.registry';

const ids = (actor: ActorType): string[] => NAVIGATION[actor].items.map((item) => item.id);

/** HU aprobadas solo para el canal móvil (catálogo: HU026–HU040). */
const MOBILE_ONLY = /^HU0(2[6-9]|3\d|40)$/;

function accessOf(
  actorType: ActorType,
  subscriptionStatus: SessionAccess['subscriptionStatus'],
  permissions: readonly string[],
  capabilities: readonly string[],
): SessionAccess {
  return {
    actorType,
    subscriptionStatus,
    permissions: new Set(permissions),
    capabilities: new Set(capabilities),
  };
}

const visibleIds = (actor: ActorType, access: SessionAccess | null): string[] =>
  visibleItems(actor, access).map((item) => item.id);

/** Opciones del deportista sin permiso ni capacidad; HU011 y HU020 no exigen capacidad de plan. */
const ATHLETE_BASE = [
  'home',
  'profile',
  'logout',
  'plan',
  'athlete-training-history',
  'athlete-services',
];

describe('Registro de navegación por actor (ADR-025, HU003)', () => {
  it('CA7–CA9: cada actor tiene su propio inicio', () => {
    expect(homeFor('athlete')).toBe('/deportista/inicio');
    expect(homeFor('organizer')).toBe('/organizador/inicio');
    expect(homeFor('service_provider')).toBe('/profesional/inicio');
  });

  it('solo «Inicio» y las HU implementadas son navegables; el resto es «Próximamente»', () => {
    const navigable = (actor: ActorType) =>
      NAVIGATION[actor].items
        .filter((item) => item.available && item.action === undefined)
        .map((item) => [item.id, item.route, item.hu]);

    expect(navigable('athlete')).toEqual([
      ['home', homeFor('athlete'), 'HU003'],
      ['profile', '/deportista/perfil', 'HU005'],
      ['athlete-training-history', '/deportista/historial/entrenamientos', 'HU011'],
      ['athlete-services', '/deportista/servicios', 'HU020'],
      ['athlete-training-plans', '/deportista/entrenamientos/planes', 'HU010'],
      ['sports-medicine', '/deportista/servicios/medico-deportivos', 'HU017'],
    ]);
    expect(navigable('organizer')).toEqual([
      ['home', homeFor('organizer'), 'HU003'],
      ['event-create', '/organizador/eventos/nuevo', 'HU021'],
      ['event-publish', '/organizador/eventos/publicacion', 'HU024'],
    ]);
    expect(navigable('service_provider')).toEqual([
      ['home', homeFor('service_provider'), 'HU003'],
      ['service-create', '/profesional/servicios/nuevo', 'HU015'],
      ['service-publish', '/profesional/servicios/publicacion', 'HU019'],
      ['training-plans', '/profesional/entrenamientos/planes', 'HU010'],
      ['training-history', '/profesional/historial/entrenamientos', 'HU011'],
    ]);
  });

  it('HU004: «Cerrar sesión» es una acción disponible para los tres actores web, sin ruta ni permiso', () => {
    for (const actor of ['athlete', 'organizer', 'service_provider'] as const) {
      const logout = NAVIGATION[actor].items.find((item) => item.id === 'logout')!;

      expect(logout).toEqual(
        jasmine.objectContaining({
          action: 'logout',
          available: true,
          route: null,
          permission: null,
          capability: null,
          hu: 'HU004',
        }),
      );
      expect(visibleIds(actor, null)).toContain('logout');
    }
  });

  it('HU010 sigue condicionada: capacidad del deportista y permiso del profesional', () => {
    const find = (actor: ActorType, id: string) =>
      NAVIGATION[actor].items.find((item) => item.id === id)!;

    expect(find('athlete', 'athlete-training-plans').capability).toBe('training.plan.manage');
    expect(find('service_provider', 'training-plans').permission).toBe('training.plan.author');
    expect(visibleIds('service_provider', null)).not.toContain('training-plans');
    expect(visibleIds('athlete', null)).not.toContain('athlete-training-plans');
  });

  it('HU020: «Servicios» es opción base; medicina deportiva sigue exigiendo su capacidad', () => {
    const find = (id: string) => NAVIGATION.athlete.items.find((item) => item.id === id)!;

    expect(find('athlete-services')).toEqual(
      jasmine.objectContaining({ group: 'services', permission: null, capability: null }),
    );
    expect(find('sports-medicine').capability).toBe('services.sports_medicine.access');
    expect(visibleIds('athlete', null)).toContain('athlete-services');
    expect(visibleIds('athlete', null)).not.toContain('sports-medicine');
  });

  it('HU005: «Mi perfil» navega solo para el deportista; los demás esperan HU002 (ADR-034)', () => {
    const profile = (actor: ActorType) =>
      NAVIGATION[actor].items.find((item) => item.id === 'profile')!;

    expect(profile('athlete')).toEqual(
      jasmine.objectContaining({
        group: 'account',
        route: '/deportista/perfil',
        permission: null,
        capability: null,
        hu: 'HU005',
        available: true,
      }),
    );
    for (const actor of ['organizer', 'service_provider'] as const) {
      expect(profile(actor))
        .withContext(actor)
        .toEqual(jasmine.objectContaining({ route: null, hu: 'HU002', available: false }));
    }
    expect(visibleIds('athlete', null)).toContain('profile');
  });

  it('no incluye opciones de HU aprobadas solo para móvil', () => {
    for (const actor of Object.keys(NAVIGATION) as ActorType[]) {
      for (const item of NAVIGATION[actor].items) {
        expect(item.hu).withContext(`${actor}/${item.id}`).not.toMatch(MOBILE_ONLY);
      }
    }
  });

  it('solo el deportista tiene opciones por capacidad de plan; los demás, por permiso', () => {
    expect(NAVIGATION.athlete.planCapabilities).toBeTrue();
    expect(NAVIGATION.organizer.planCapabilities).toBeFalse();
    expect(NAVIGATION.service_provider.planCapabilities).toBeFalse();
    for (const actor of ['organizer', 'service_provider'] as const) {
      expect(NAVIGATION[actor].items.every((item) => item.capability === null)).toBeTrue();
    }
    expect(NAVIGATION.athlete.items.every((item) => item.permission === null)).toBeTrue();
  });

  it('cada permiso del registro existe en actor-permissions.v1 para el canal web', () => {
    const declared = (actor: ActorType) =>
      NAVIGATION[actor].items.flatMap((item) => (item.permission ? [item.permission] : []));

    expect(declared('organizer').sort()).toEqual([...ORGANIZER_WEB_PERMISSIONS].sort());
    expect(declared('service_provider').sort()).toEqual(
      [...SERVICE_PROVIDER_WEB_PERMISSIONS].sort(),
    );
  });

  describe('opciones visibles = actor ∩ canal ∩ permisos/capacidades vigentes', () => {
    it('sin la vista del BFF solo quedan las opciones base: nunca se asumen permisos', () => {
      expect(visibleIds('organizer', null)).toEqual(['home', 'profile', 'logout']);
      expect(visibleIds('service_provider', null)).toEqual(['home', 'profile', 'logout']);
      expect(visibleIds('athlete', null)).toEqual(ATHLETE_BASE);
    });

    it('CA8: el organizador ve el ciclo de eventos confirmado, sin opciones de servicios ni de plan', () => {
      const organizer = visibleIds(
        'organizer',
        accessOf('organizer', 'NOT_APPLICABLE', ORGANIZER_WEB_PERMISSIONS, []),
      );

      expect(organizer).toEqual(
        jasmine.arrayContaining([
          'event-create',
          'event-attendees',
          'event-calendar',
          'event-publish',
          'event-pricing',
          'integrated-calendar',
        ]),
      );
      expect(organizer).not.toContain('service-create');
      expect(organizer).not.toContain('plan');
    });

    it('CA9: el profesional ve Crear y Publicar servicios, sin Crear evento ni opciones de plan', () => {
      const provider = visibleIds(
        'service_provider',
        accessOf('service_provider', 'NOT_APPLICABLE', SERVICE_PROVIDER_WEB_PERMISSIONS, []),
      );

      expect(provider).toEqual(jasmine.arrayContaining(['service-create', 'service-publish']));
      expect(provider).not.toContain('event-create');
      expect(provider).not.toContain('plan');
    });

    it('un permiso ausente en la vista oculta su opción', () => {
      const organizer = visibleIds(
        'organizer',
        accessOf('organizer', 'NOT_APPLICABLE', ['events.create'], []),
      );

      expect(organizer).toContain('event-create');
      expect(organizer).not.toContain('event-publish');
    });

    it('CA7: deportista FREE → opciones base y las opciones FREE con HU web; ninguna pagada', () => {
      expect(visibleIds('athlete', accessOf('athlete', 'ACTIVE', [], FREE_CAPABILITIES))).toEqual([
        ...ATHLETE_BASE,
        'athlete-training-plans',
        'sport-calendar',
      ]);
    });

    it('deportista PREMIUM → además «Servicios médicos y deportivos» (HU017)', () => {
      expect(
        visibleIds('athlete', accessOf('athlete', 'ACTIVE', [], PREMIUM_CAPABILITIES)),
      ).toEqual([...ATHLETE_BASE, 'athlete-training-plans', 'sport-calendar', 'sports-medicine']);
    });

    it('PROVISIONING → solo las opciones base, aunque llegaran capacidades', () => {
      expect(
        visibleIds('athlete', accessOf('athlete', 'PROVISIONING', [], FREE_CAPABILITIES)),
      ).toEqual(ATHLETE_BASE);
    });

    it('las capacidades de HU solo móviles no generan opciones web', () => {
      const capabilities = NAVIGATION.athlete.items.flatMap((item) =>
        item.capability ? [item.capability] : [],
      );

      expect(capabilities.sort()).toEqual(
        ['calendar.sport.view', 'services.sports_medicine.access', 'training.plan.manage'].sort(),
      );
    });

    it('un permiso de organizador no amplía el menú del deportista', () => {
      expect(
        visibleIds(
          'athlete',
          accessOf('athlete', 'ACTIVE', ORGANIZER_WEB_PERMISSIONS, FREE_CAPABILITIES),
        ),
      ).not.toContain('event-create');
    });
  });

  it('conserva la trazabilidad de opción, ruta documentada, permiso o capacidad y HU', () => {
    expect(NAVIGATION.organizer.items.find((item) => item.id === 'event-create')).toEqual(
      jasmine.objectContaining({
        route: '/organizador/eventos/nuevo',
        permission: 'events.create',
        hu: 'HU021',
      }),
    );
    expect(NAVIGATION.organizer.items.find((item) => item.id === 'event-publish')).toEqual(
      jasmine.objectContaining({
        route: '/organizador/eventos/publicacion',
        permission: 'events.publish',
        hu: 'HU024',
        available: true,
      }),
    );
    expect(NAVIGATION.service_provider.items.find((item) => item.id === 'service-create')).toEqual(
      jasmine.objectContaining({
        route: '/profesional/servicios/nuevo',
        permission: 'services.create',
        hu: 'HU015',
        available: true,
      }),
    );
    expect(NAVIGATION.service_provider.items.find((item) => item.id === 'service-publish')).toEqual(
      jasmine.objectContaining({
        route: '/profesional/servicios/publicacion',
        permission: 'services.publish',
        hu: 'HU019',
        available: true,
      }),
    );
    expect(NAVIGATION.athlete.items.find((item) => item.id === 'sport-calendar')).toEqual(
      jasmine.objectContaining({
        route: '/deportista/calendario',
        capability: 'calendar.sport.view',
        hu: 'HU023',
      }),
    );
  });

  it('agrupa y ordena el menú: Inicio primero y la cuenta al final', () => {
    const sections = navigationSections(
      'organizer',
      accessOf('organizer', 'NOT_APPLICABLE', ORGANIZER_WEB_PERMISSIONS, []),
    );

    expect(sections[0]).toEqual({
      group: 'main',
      items: [jasmine.objectContaining({ id: 'home' })],
    });
    expect(sections.at(-1)?.group).toBe('account');
    expect(sections.at(-1)?.items.map((item) => item.id)).toEqual(['profile', 'logout']);
    expect(sections.find((section) => section.group === 'events')?.items[0].id).toBe(
      'event-create',
    );
  });

  it('el deportista conserva «Mi plan» en su cuenta y no tiene grupos vacíos', () => {
    const sections = navigationSections('athlete', null);

    expect(sections.map((section) => section.group)).toEqual([
      'main',
      'services',
      'training',
      'account',
    ]);
    expect(ids('athlete')).toContain('plan');
  });
});
