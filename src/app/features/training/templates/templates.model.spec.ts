import {
  VALID_PUBLISH_TEMPLATE_REQUEST,
  professionalTemplate,
} from '../../../../testing/bff-web/training-templates.fixtures';
import es from '../../../../../public/i18n/es.json';
import {
  TEMPLATE_DAYS,
  TEMPLATE_GOALS,
  TEMPLATE_LEVELS,
  TEMPLATE_STATUSES,
} from '../../../core/api/bff-web/training-templates.api';
import {
  TemplateDraft,
  templateFieldText,
  templateIssueKey,
  templateTarget,
  toPublishTemplateRequest,
  toTrainingTemplate,
  weeklyMinutes,
} from './templates.model';

const SESSIONS = VALID_PUBLISH_TEMPLATE_REQUEST.weekly_sessions.map((session) => ({
  dayOfWeek: session.day_of_week,
  description: session.description,
  durationMinutes: session.duration_minutes,
}));

const DRAFT: TemplateDraft = {
  title: VALID_PUBLISH_TEMPLATE_REQUEST.title,
  objectives: VALID_PUBLISH_TEMPLATE_REQUEST.objectives,
  sport: 'running',
  goal: 'PERFORMANCE',
  level: 'BEGINNER',
  durationWeeks: 8,
  weeklySessions: SESSIONS,
};

function translate(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null
      ? (node as Record<string, unknown>)[part]
      : undefined;
  }, es);
}

describe('Modelo de plantillas de plan (HU028)', () => {
  it('el cuerpo de publicar tiene exactamente los campos del contrato, sin professional_id', () => {
    expect(toPublishTemplateRequest(DRAFT)).toEqual(VALID_PUBLISH_TEMPLATE_REQUEST);
  });

  it('CA4: transforma la plantilla confirmada con su estado, versión y sesiones en orden', () => {
    expect(toTrainingTemplate(professionalTemplate(0))).toEqual({
      id: professionalTemplate(0).template_id,
      title: 'Base aeróbica para 10K',
      objectives: VALID_PUBLISH_TEMPLATE_REQUEST.objectives,
      sport: 'running',
      goal: 'PERFORMANCE',
      level: 'BEGINNER',
      durationWeeks: 8,
      weeklySessions: SESSIONS,
      status: 'PUBLISHED',
      version: 1,
      publishedAt: professionalTemplate(0).published_at,
      retiredAt: null,
    });
    expect(toTrainingTemplate(professionalTemplate(0, 'RETIRED'))).toEqual(
      jasmine.objectContaining({
        status: 'RETIRED',
        version: 2,
        retiredAt: professionalTemplate(0, 'RETIRED').retired_at,
      }),
    );
  });

  it('suma los minutos de la semana tipo', () => {
    expect(weeklyMinutes(SESSIONS)).toBe(155);
    expect(weeklyMinutes([])).toBe(0);
  });

  it('CA4: ubica cada regla del servicio en su control o en su sesión', () => {
    expect(templateTarget('title')).toEqual({ kind: 'field', control: 'title' });
    expect(templateTarget('duration_weeks')).toEqual({ kind: 'field', control: 'durationWeeks' });
    expect(templateTarget('goal')).toEqual({ kind: 'field', control: 'goal' });
    expect(templateTarget('weekly_sessions.1.duration_minutes')).toEqual({
      kind: 'session',
      index: 1,
      control: 'durationMinutes',
    });
    expect(templateTarget('weekly_sessions.0.day_of_week')).toEqual({
      kind: 'session',
      index: 0,
      control: 'dayOfWeek',
    });
    expect(templateTarget('weekly_sessions[2].description')).toEqual({
      kind: 'session',
      index: 2,
      control: 'description',
    });
    expect(templateTarget('weekly_sessions.3')).toEqual({
      kind: 'session',
      index: 3,
      control: null,
    });
    expect(templateTarget('weekly_sessions')).toEqual({ kind: 'sessions' });
    expect(templateTarget('weekly_sessions.0.otro')).toEqual({ kind: 'none' });
    expect(templateTarget('professional_id')).toEqual({ kind: 'none' });
    expect(templateTarget('')).toEqual({ kind: 'none' });
  });

  it('agrupa los motivos del servicio y de la validación de forma; los desconocidos son genéricos', () => {
    expect(templateIssueKey('invalid_length')).toBe('training.templates.issues.invalid_length');
    expect(templateIssueKey('string_too_short')).toBe('training.templates.issues.invalid_length');
    expect(templateIssueKey('less_than_equal')).toBe('training.templates.issues.out_of_range');
    expect(templateIssueKey('too_long')).toBe('training.templates.issues.out_of_range');
    expect(templateIssueKey('missing')).toBe('training.templates.issues.required');
    expect(templateIssueKey('enum')).toBe('training.templates.issues.unknown_value');
    expect(templateIssueKey('extra_forbidden')).toBe('training.templates.issues.field_not_allowed');
    expect(templateIssueKey('motivo_nuevo')).toBe('training.templates.issues.unknown');
    expect(templateIssueKey('constructor')).toBe('training.templates.issues.unknown');
  });

  it('cada campo, motivo y catálogo que puede producir tiene texto en es.json', () => {
    const fields = [
      'title',
      'objectives',
      'sport',
      'goal',
      'level',
      'duration_weeks',
      'weekly_sessions',
      'weekly_sessions.3',
      'weekly_sessions.3.day_of_week',
      'weekly_sessions.3.description',
      'weekly_sessions.3.duration_minutes',
      'professional_id',
    ];
    for (const field of fields) {
      expect(typeof translate(templateFieldText(field).key))
        .withContext(field)
        .toBe('string');
    }
    const issues = [
      'required',
      'missing',
      'invalid_length',
      'string_too_long',
      'out_of_range',
      'greater_than_equal',
      'int_type',
      'enum',
      'extra_forbidden',
      'x',
    ];
    for (const issue of issues) {
      expect(typeof translate(templateIssueKey(issue)))
        .withContext(issue)
        .toBe('string');
    }
    expect(templateFieldText('weekly_sessions.3.description').params).toEqual({ n: 4 });
    for (const goal of TEMPLATE_GOALS) {
      expect(typeof translate(`training.templates.goals.${goal}`))
        .withContext(goal)
        .toBe('string');
    }
    for (const level of TEMPLATE_LEVELS) {
      expect(typeof translate(`training.templates.levels.${level}`))
        .withContext(level)
        .toBe('string');
    }
    for (const day of TEMPLATE_DAYS) {
      expect(typeof translate(`training.templates.days.${day}`))
        .withContext(day)
        .toBe('string');
    }
    for (const status of TEMPLATE_STATUSES) {
      expect(typeof translate(`training.templates.status.${status}`))
        .withContext(status)
        .toBe('string');
    }
  });
});
