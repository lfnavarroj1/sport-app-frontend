import {
  VALID_PUBLISH_ROUTE_REQUEST,
  organizerRoute,
} from '../../../../testing/bff-web/routes.fixtures';
import es from '../../../../../public/i18n/es.json';
import {
  RouteDraft,
  distanceIssue,
  normalizeDistance,
  routeFieldText,
  routeIssueKey,
  routeTarget,
  toOrganizerRoute,
  toPublishRouteRequest,
} from './routes.model';

const DRAFT: RouteDraft = {
  name: VALID_PUBLISH_ROUTE_REQUEST.name,
  description: VALID_PUBLISH_ROUTE_REQUEST.description,
  sport: 'running',
  distanceKm: '12.5',
  difficulty: 'MODERATE',
  city: 'Bogotá',
  countryCode: 'CO',
  startPoint: VALID_PUBLISH_ROUTE_REQUEST.start_point,
  waypoints: VALID_PUBLISH_ROUTE_REQUEST.waypoints,
};

function translate(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null
      ? (node as Record<string, unknown>)[part]
      : undefined;
  }, es);
}

describe('Modelo de rutas (HU026)', () => {
  it('el cuerpo de publicar tiene exactamente los campos del contrato, sin organizer_id', () => {
    expect(toPublishRouteRequest(DRAFT)).toEqual(VALID_PUBLISH_ROUTE_REQUEST);
    expect(toPublishRouteRequest({ ...DRAFT, description: null, waypoints: [] })).toEqual({
      ...VALID_PUBLISH_ROUTE_REQUEST,
      description: null,
      waypoints: [],
    });
  });

  it('CA1: transforma la ruta confirmada con su estado, versión y puntos', () => {
    expect(toOrganizerRoute(organizerRoute(0))).toEqual({
      id: organizerRoute(0).route_id,
      name: 'Vuelta al Parque Simón Bolívar',
      description: VALID_PUBLISH_ROUTE_REQUEST.description,
      sport: 'running',
      distanceKm: '12.5',
      difficulty: 'MODERATE',
      city: 'Bogotá',
      countryCode: 'CO',
      startPoint: { lat: 4.6584, lng: -74.0937 },
      waypoints: [
        { lat: 4.6601, lng: -74.0902 },
        { lat: 4.6572, lng: -74.0961 },
      ],
      status: 'PUBLISHED',
      version: 1,
      publishedAt: organizerRoute(0).published_at,
      retiredAt: null,
    });
    expect(toOrganizerRoute(organizerRoute(0, 'RETIRED'))).toEqual(
      jasmine.objectContaining({ status: 'RETIRED', version: 2 }),
    );
  });

  it('la distancia acepta coma, un decimal como máximo y el rango del contrato', () => {
    expect(normalizeDistance(' 12,5 ')).toBe('12.5');
    expect(distanceIssue('12.5')).toBeNull();
    expect(distanceIssue('0.1')).toBeNull();
    expect(distanceIssue('500')).toBeNull();
    expect(distanceIssue('500.0')).toBeNull();
    expect(distanceIssue('0.0')).toBe('range');
    expect(distanceIssue('500.1')).toBe('range');
    expect(distanceIssue('12.55')).toBe('format');
    expect(distanceIssue('doce')).toBe('format');
    expect(distanceIssue('-3')).toBe('format');
  });

  it('CA2: ubica cada regla del servicio en su control o en su punto intermedio', () => {
    expect(routeTarget('distance_km')).toEqual({ kind: 'field', control: 'distanceKm' });
    expect(routeTarget('country_code')).toEqual({ kind: 'field', control: 'countryCode' });
    expect(routeTarget('start_point.lat')).toEqual({ kind: 'field', control: 'startLat' });
    expect(routeTarget('start_point.lng')).toEqual({ kind: 'field', control: 'startLng' });
    expect(routeTarget('start_point')).toEqual({ kind: 'field', control: 'startLat' });
    expect(routeTarget('waypoints[1].lng')).toEqual({
      kind: 'waypoint',
      index: 1,
      coordinate: 'lng',
    });
    expect(routeTarget('waypoints[0]')).toEqual({ kind: 'waypoint', index: 0, coordinate: null });
    expect(routeTarget('waypoints')).toEqual({ kind: 'waypoints' });
    expect(routeTarget('organizer_id')).toEqual({ kind: 'none' });
  });

  it('los motivos desconocidos usan un texto genérico', () => {
    expect(routeIssueKey('out_of_range')).toBe('training.routes.issues.out_of_range');
    expect(routeIssueKey('motivo_nuevo')).toBe('training.routes.issues.unknown');
  });

  it('cada campo y motivo que puede producir tiene texto en es.json', () => {
    const fields = [
      'name',
      'description',
      'sport',
      'distance_km',
      'difficulty',
      'city',
      'country_code',
      'start_point.lat',
      'start_point.lng',
      'waypoints',
      'waypoints[3]',
      'waypoints[3].lat',
      'waypoints[3].lng',
      'organizer_id',
    ];
    for (const field of fields) {
      expect(typeof translate(routeFieldText(field).key))
        .withContext(field)
        .toBe('string');
    }
    for (const issue of ['required', 'invalid_length', 'out_of_range', 'unknown_value', 'x']) {
      expect(typeof translate(routeIssueKey(issue)))
        .withContext(issue)
        .toBe('string');
    }
    expect(routeFieldText('waypoints[3].lat').params).toEqual({ n: 4 });
  });
});
