import { SessionAccess } from '../../core/session/session-access.store';
import { ActorType } from '../../core/session/session.store';

/**
 * Registro único de navegación web por tipo de actor (ADR-025, HU003).
 * Fuentes: `navegacion/README.md` y `planes/05-menu-lateral-por-plan.md`.
 *
 * Solo incluye opciones de HU aprobadas para el canal web; las de canal móvil
 * (HU026–HU040) no aparecen, aunque el plan del deportista incluya su capacidad
 * (`navegacion/README.md`: cada canal muestra solo sus HU aprobadas).
 *
 * Opciones visibles = actor ∩ canal ∩ permisos/capacidades vigentes: una opción
 * con `permission` o `capability` solo aparece si `GET /v1/me/capabilities` la
 * confirma (ADR-024, ADR-025). Una opción cuya HU todavía no está implementada en
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
  /** Permiso estable del actor (`actor-permissions.v1`), si la opción lo exige. */
  readonly permission: string | null;
  /** Capacidad del plan del deportista (ADR-024), si la opción la exige. */
  readonly capability: string | null;
  /** HU que implementa la opción. */
  readonly hu: string;
  /** La HU ya está implementada en la web. */
  readonly available: boolean;
  /**
   * La opción es una acción y no una ruta (`logout`: cerrar sesión, HU004). El menú
   * la presenta como botón.
   */
  readonly action?: 'logout';
}

export interface ActorNavigation {
  readonly actor: ActorType;
  /** Ruta inicial del actor tras iniciar sesión. */
  readonly home: string;
  readonly items: readonly NavItem[];
  /** El actor tiene un plan cuyas capacidades amplían su menú (solo `athlete`). */
  readonly planCapabilities: boolean;
}

const home = (route: string): NavItem => ({
  id: 'home',
  group: 'main',
  order: 10,
  icon: 'home',
  route,
  permission: null,
  capability: null,
  hu: 'HU003',
  available: true,
});

/**
 * «Mi perfil». El deportista lo abre en `/deportista/perfil`, donde HU005 registra
 * sus datos demográficos y fisiológicos y HU006 sus hábitos deportivos (ADR-034). Los demás actores no tienen
 * ruta de perfil hasta HU002, así que su opción sigue como «Próximamente».
 */
const PROFILE: NavItem = {
  id: 'profile',
  group: 'account',
  order: 20,
  icon: 'person',
  route: null,
  permission: null,
  capability: null,
  hu: 'HU002',
  available: false,
};

const ATHLETE_PROFILE: NavItem = {
  ...PROFILE,
  route: '/deportista/perfil',
  hu: 'HU005',
  available: true,
};

const account = (profile: NavItem = PROFILE): NavItem[] => [
  profile,
  // HU004: acción de cierre para los tres actores web; no tiene ruta.
  {
    id: 'logout',
    group: 'account',
    order: 900,
    icon: 'logout',
    route: null,
    permission: null,
    capability: null,
    hu: 'HU004',
    available: true,
    action: 'logout',
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
): NavItem => ({
  id,
  group,
  order,
  icon,
  route,
  permission,
  capability: null,
  hu,
  available: false,
});

/**
 * Opción que aporta una capacidad del plan del deportista
 * (`planes/05-menu-lateral-por-plan.md`); la ruta lógica se ubica en el área
 * `/deportista`. `available` indica si su HU ya está implementada en la web.
 */
const planOption = (
  id: string,
  group: NavGroup,
  order: number,
  icon: string,
  route: string,
  capability: string,
  hu: string,
  available = false,
): NavItem => ({
  id,
  group,
  order,
  icon,
  route,
  permission: null,
  capability,
  hu,
  available,
});

/** Opción del actor exigida por un permiso estable, con su HU ya implementada en la web. */
const permissionOption = (
  id: string,
  group: NavGroup,
  order: number,
  icon: string,
  route: string,
  permission: string,
  hu: string,
): NavItem => ({ ...upcoming(id, group, order, icon, route, permission, hu), available: true });

export const NAVIGATION: Readonly<Record<ActorType, ActorNavigation>> = {
  athlete: {
    actor: 'athlete',
    home: '/deportista/inicio',
    planCapabilities: true,
    items: [
      home('/deportista/inicio'),
      ...account(ATHLETE_PROFILE),
      // «Mi plan» solo existe para el deportista (navegacion/README.md).
      upcoming('plan', 'account', 30, 'workspace_premium', null, null, 'HU016'),
      // HU011: historial propio, sin capacidad de plan (ADR-024 no define una);
      // decisión del responsable del 2026-10-12.
      {
        id: 'athlete-training-history',
        group: 'training',
        order: 110,
        icon: 'history',
        route: '/deportista/historial/entrenamientos',
        permission: null,
        capability: null,
        hu: 'HU011',
        available: true,
      },
      // HU020: catálogo de servicios y su disponibilidad; opción base del deportista,
      // sin capacidad de plan (ADR-038). Medicina deportiva la filtra el BFF.
      {
        id: 'athlete-services',
        group: 'services',
        order: 40,
        icon: 'storefront',
        route: '/deportista/servicios',
        permission: null,
        capability: null,
        hu: 'HU020',
        available: true,
      },
      // «Mi alimentación»: opción base del deportista, sin capacidad de plan (ADR-037).
      // HU014 aporta la sección «Planes de alimentación»; los consumos serán HU013.
      {
        id: 'athlete-nutrition',
        group: 'nutrition',
        order: 60,
        icon: 'restaurant_menu',
        route: '/deportista/alimentacion',
        permission: null,
        capability: null,
        hu: 'HU014',
        available: true,
      },
      // Capacidades del plan con HU aprobada para la web (ADR-024).
      planOption(
        'athlete-training-plans',
        'training',
        100,
        'fitness_center',
        '/deportista/entrenamientos/planes',
        'training.plan.manage',
        'HU010',
        true,
      ),
      planOption(
        'sport-calendar',
        'calendar',
        200,
        'calendar_month',
        '/deportista/calendario',
        'calendar.sport.view',
        'HU023',
      ),
      // Abre la pantalla de HU020 filtrada por medicina deportiva (ADR-038); la
      // búsqueda y asociación de servicios médicos sigue siendo HU017.
      planOption(
        'sports-medicine',
        'services',
        240,
        'medical_services',
        '/deportista/servicios/medico-deportivos',
        'services.sports_medicine.access',
        'HU017',
        true,
      ),
    ],
  },
  organizer: {
    actor: 'organizer',
    home: '/organizador/inicio',
    planCapabilities: false,
    items: [
      home('/organizador/inicio'),
      permissionOption(
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
      // HU023: calendario de eventos publicados con coincidencias (ADR-040).
      permissionOption(
        'event-calendar',
        'events',
        120,
        'event',
        '/organizador/eventos/calendario',
        'events.calendar.view',
        'HU023',
      ),
      permissionOption(
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
      // HU015: el profesional crea un servicio en borrador (ADR-027).
      permissionOption(
        'service-create',
        'services',
        100,
        'add_circle',
        '/profesional/servicios/nuevo',
        'services.create',
        'HU015',
      ),
      // HU019: el profesional revisa sus servicios y publica un borrador (ADR-027).
      permissionOption(
        'service-publish',
        'services',
        110,
        'publish',
        '/profesional/servicios/publicacion',
        'services.publish',
        'HU019',
      ),
      permissionOption(
        'training-plans',
        'training',
        120,
        'fitness_center',
        '/profesional/entrenamientos/planes',
        'training.plan.author',
        'HU010',
      ),
      permissionOption(
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
      // HU014: el profesional crea y asigna planes de alimentación (ADR-037).
      permissionOption(
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

/**
 * Opciones que la sesión puede ver. Sin la vista del BFF (`null`: cargando o
 * con error) solo quedan las que no exigen permiso ni capacidad: nunca se
 * asumen. Las capacidades solo cuentan con la suscripción `ACTIVE`.
 */
export function visibleItems(actor: ActorType, access: SessionAccess | null): NavItem[] {
  return NAVIGATION[actor].items.filter((item) => {
    if (item.permission !== null) {
      return access?.permissions.has(item.permission) ?? false;
    }
    if (item.capability !== null) {
      return access?.subscriptionStatus === 'ACTIVE' && access.capabilities.has(item.capability);
    }
    return true;
  });
}

/** Agrupa y ordena las opciones visibles del actor para el menú lateral. */
export function navigationSections(actor: ActorType, access: SessionAccess | null): NavSection[] {
  const items = visibleItems(actor, access).sort((a, b) => a.order - b.order);
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
