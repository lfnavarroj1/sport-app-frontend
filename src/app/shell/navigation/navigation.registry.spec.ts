import { ActorType } from '../../core/session/session.store';
import { NAVIGATION, homeFor, navigationSections } from './navigation.registry';

const ids = (actor: ActorType): string[] => NAVIGATION[actor].items.map((item) => item.id);

/** HU aprobadas solo para el canal móvil (catálogo: HU026–HU040). */
const MOBILE_ONLY = /^HU0(2[6-9]|3\d|40)$/;

describe('Registro de navegación por actor (ADR-025, HU003)', () => {
  it('CA7–CA9: cada actor tiene su propio inicio', () => {
    expect(homeFor('athlete')).toBe('/deportista/inicio');
    expect(homeFor('organizer')).toBe('/organizador/inicio');
    expect(homeFor('service_provider')).toBe('/profesional/inicio');
  });

  it('solo «Inicio» es navegable; el resto es «Próximamente» hasta que exista su HU', () => {
    for (const actor of Object.keys(NAVIGATION) as ActorType[]) {
      const available = NAVIGATION[actor].items.filter((item) => item.available);
      expect(available.map((item) => item.id)).toEqual(['home']);
      expect(available[0].route).toBe(homeFor(actor));
    }
  });

  it('no incluye opciones de HU aprobadas solo para móvil', () => {
    for (const actor of Object.keys(NAVIGATION) as ActorType[]) {
      for (const item of NAVIGATION[actor].items) {
        expect(item.hu).withContext(`${actor}/${item.id}`).not.toMatch(MOBILE_ONLY);
      }
    }
  });

  it('CA7: el deportista ve sus opciones base y «Mi plan», y su menú depende del plan', () => {
    expect(ids('athlete')).toEqual(['home', 'profile', 'logout', 'plan']);
    expect(NAVIGATION.athlete.planCapabilities).toBeTrue();
  });

  it('CA8: el organizador ve el ciclo de eventos, incluido Crear evento, sin opciones de servicios ni de plan', () => {
    const organizer = ids('organizer');

    expect(organizer).toContain('event-create');
    expect(organizer).toEqual(
      jasmine.arrayContaining([
        'event-attendees',
        'event-calendar',
        'event-publish',
        'event-pricing',
        'integrated-calendar',
      ]),
    );
    expect(organizer).not.toContain('service-create');
    expect(organizer).not.toContain('plan');
    expect(NAVIGATION.organizer.planCapabilities).toBeFalse();
  });

  it('CA9: el profesional ve Crear y Publicar servicios, sin Crear evento ni opciones de plan', () => {
    const provider = ids('service_provider');

    expect(provider).toEqual(jasmine.arrayContaining(['service-create', 'service-publish']));
    expect(provider).not.toContain('event-create');
    expect(provider).not.toContain('plan');
    expect(NAVIGATION.service_provider.planCapabilities).toBeFalse();
  });

  it('conserva la trazabilidad de opción, ruta documentada, permiso y HU', () => {
    const create = NAVIGATION.organizer.items.find((item) => item.id === 'event-create');

    expect(create).toEqual(
      jasmine.objectContaining({
        route: '/organizador/eventos/nuevo',
        permission: 'events.create',
        hu: 'HU021',
      }),
    );
  });

  it('agrupa y ordena el menú: Inicio primero y la cuenta al final', () => {
    const sections = navigationSections('organizer');

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
});
