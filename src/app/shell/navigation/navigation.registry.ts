import { ActorType } from '../../core/session/session.store';

/**
 * Registro único de navegación web por tipo de actor (ADR-025, HU003).
 * Fuentes: `navegacion/README.md` y `planes/05-menu-lateral-por-plan.md`.
 *
 * Solo incluye opciones de HU aprobadas para el canal web; las de canal móvil
 * (HU026–HU040) no aparecen. Una opción cuya HU todavía no está implementada en
 * la web se muestra como «Próximamente», deshabilitada y sin navegación
 * (decisión del responsable, 2026-10-11): nunca como función disponible.
 *
 * El menú es una ayuda de navegación, no una frontera de seguridad: las guardas
 * de ruta y el backend vuelven a validar rol, propiedad y capacidad.
 */

export type NavGroup =
  'main' | 'events' | 'services' | 'training' | 'health' | 'nutrition' | 'calendar' | 'account';

export interface NavItem {
  /** Identificador estable de la opción. */
  readonly id: string;
  readonly group: NavGroup;
  readonly order: number;
  readonly icon: string;
  /**
   * Destino lógico documentado; solo es navegable si `available`. `null` cuando
   * la documentación aún no define la ruta (no se inventa).
   */
  readonly route: string | null;
  /** Permiso estable o capacidad requerida, cuando la documentación lo define. */
  readonly permission: string | null;
  /** HU que implementa la opción. */
  readonly hu: string;
  /** La HU ya está implementada en la web. */
  readonly available: boolean;
}

export interface ActorNavigation {
  readonly actor: ActorType;
  /** Ruta inicial del actor tras iniciar sesión. */
  readonly home: string;
  readonly items: readonly NavItem[];
  /**
   * El actor recibe además opciones según las capacidades de su plan (ADR-024).
   * Mientras el BFF no exponga las capacidades, no se asumen permisos.
   */
  readonly planCapabilities: boolean;
}

const home = (route: string): NavItem => ({
  id: 'home',
  group: 'main',
  order: 10,
  icon: 'home',
  route,
  permission: null,
  hu: 'HU003',
  available: true,
});

const account = (): NavItem[] => [
  {
    id: 'profile',
    group: 'account',
    order: 20,
    icon: 'person',
    route: null,
    permission: null,
    hu: 'HU002',
    available: false,
  },
  {
    id: 'logout',
    group: 'account',
    order: 900,
    icon: 'logout',
    route: null,
    permission: null,
    hu: 'HU004',
    available: false,
  },
];

const upcoming = (
  id: string,
  group: NavGroup,
  order: number,
  icon: string,
  route: string | null,
  permission: string | null,
  hu: string,
): NavItem => ({ id, group, order, icon, route, permission, hu, available: false });

export const NAVIGATION: Readonly<Record<ActorType, ActorNavigation>> = {
  athlete: {
    actor: 'athlete',
    home: '/deportista/inicio',
    planCapabilities: true,
    items: [
      home('/deportista/inicio'),
      ...account(),
      // «Mi plan» solo existe para el deportista (navegacion/README.md).
      upcoming('plan', 'account', 30, 'workspace_premium', null, null, 'HU016'),
    ],
  },
  organizer: {
    actor: 'organizer',
    home: '/organizador/inicio',
    planCapabilities: false,
    items: [
      home('/organizador/inicio'),
      upcoming(
        'event-create',
        'events',
        100,
        'add_circle',
        '/organizador/eventos/nuevo',
        'events.create',
        'HU021',
      ),
      upcoming(
        'event-attendees',
        'events',
        110,
        'groups',
        '/organizador/eventos/inscritos',
        'events.attendees.view',
        'HU022',
      ),
      upcoming(
        'event-calendar',
        'events',
        120,
        'event',
        '/organizador/eventos/calendario',
        'events.calendar.view',
        'HU023',
      ),
      upcoming(
        'event-publish',
        'events',
        130,
        'publish',
        '/organizador/eventos/publicacion',
        'events.publish',
        'HU024',
      ),
      upcoming(
        'event-pricing',
        'events',
        140,
        'sell',
        '/organizador/eventos/tarifas',
        'events.pricing.manage',
        'HU025',
      ),
      upcoming(
        'integrated-calendar',
        'calendar',
        160,
        'calendar_month',
        '/organizador/calendario',
        'calendar.integrated.view',
        'HU018',
      ),
      ...account(),
    ],
  },
  service_provider: {
    actor: 'service_provider',
    home: '/profesional/inicio',
    planCapabilities: false,
    items: [
      home('/profesional/inicio'),
      upcoming(
        'service-create',
        'services',
        100,
        'add_circle',
        '/profesional/servicios/nuevo',
        'services.create',
        'HU015',
      ),
      upcoming(
        'service-publish',
        'services',
        110,
        'publish',
        '/profesional/servicios/publicacion',
        'services.publish',
        'HU019',
      ),
      upcoming(
        'training-plans',
        'training',
        120,
        'fitness_center',
        '/profesional/entrenamientos/planes',
        'training.plan.author',
        'HU010',
      ),
      upcoming(
        'training-history',
        'training',
        130,
        'history',
        '/profesional/historial/entrenamientos',
        'training.history.view_assigned',
        'HU011',
      ),
      upcoming(
        'health-history',
        'health',
        140,
        'healing',
        '/profesional/historial/salud',
        'health.history.view_assigned',
        'HU012',
      ),
      upcoming(
        'nutrition-history',
        'nutrition',
        150,
        'restaurant',
        '/profesional/historial/alimentacion',
        'nutrition.history.view_assigned',
        'HU013',
      ),
      upcoming(
        'nutrition-plans',
        'nutrition',
        160,
        'menu_book',
        '/profesional/alimentacion/planes',
        'nutrition.plan.author',
        'HU014',
      ),
      upcoming(
        'integrated-calendar',
        'calendar',
        170,
        'calendar_month',
        '/profesional/calendario',
        'calendar.integrated.view',
        'HU018',
      ),
      ...account(),
    ],
  },
};

/** Orden de presentación de los grupos del menú lateral. */
export const GROUP_ORDER: readonly NavGroup[] = [
  'main',
  'events',
  'services',
  'training',
  'health',
  'nutrition',
  'calendar',
  'account',
];

export interface NavSection {
  readonly group: NavGroup;
  readonly items: readonly NavItem[];
}

/** Agrupa y ordena las opciones del actor para el menú lateral. */
export function navigationSections(actor: ActorType): NavSection[] {
  const items = [...NAVIGATION[actor].items].sort((a, b) => a.order - b.order);
  return GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0);
}

/** Destino tras iniciar sesión según el tipo de actor (ADR-025). */
export function homeFor(actor: ActorType): string {
  return NAVIGATION[actor].home;
}

export const UNAUTHORIZED_PATH = '/acceso-no-autorizado';
