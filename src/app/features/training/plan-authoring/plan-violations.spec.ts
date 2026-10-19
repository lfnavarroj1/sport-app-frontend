import contractJson from '../../../core/api/contracts/bff-web.openapi.json';
import { PLAN_RULE_ISSUES } from './plan-authoring.model';
import { ruleText, violationMessage, violationTarget } from './plan-violations';

describe('Reglas incumplidas del plan (HU010 CA3)', () => {
  describe('violationTarget', () => {
    it('ubica los campos del plan', () => {
      expect(violationTarget('athlete_email')).toEqual({ control: 'athleteEmail' });
      expect(violationTarget('title')).toEqual({ control: 'title' });
      expect(violationTarget('start_date')).toEqual({ control: 'startDate' });
      expect(violationTarget('end_date')).toEqual({ control: 'endDate' });
    });

    it('ubica un objetivo y un campo de una sesión por su posición', () => {
      expect(violationTarget('objectives.2')).toEqual({ control: 'objective', index: 2 });
      expect(violationTarget('sessions.1.scheduled_date')).toEqual({
        control: 'session',
        index: 1,
        field: 'scheduledDate',
      });
      expect(violationTarget('sessions.0.intensity_rpe')).toEqual({
        control: 'session',
        index: 0,
        field: 'intensityRpe',
      });
    });

    it('no ubica rutas de listas completas, desconocidas o vacías', () => {
      for (const path of ['objectives', 'sessions', 'sessions.1', 'sessions.x.sport', 'otro', '']) {
        expect(violationTarget(path)).withContext(path).toEqual({ control: null });
      }
      expect(violationTarget('sessions.0.sport.extra')).toEqual({ control: null });
    });
  });

  describe('violationMessage', () => {
    it('presenta cada motivo conocido con su propio texto', () => {
      for (const issue of PLAN_RULE_ISSUES) {
        expect(ruleText(issue).key).toBe(`training.plan.rules.${issue}`);
      }
    });

    it('los motivos conocidos son los motivos estables que declara el contrato', () => {
      const description =
        contractJson.paths['/v1/training-plans'].post.responses['422'].description;
      // «Motivos estables de `issue` en `training_plan_invalid`: `a`, `b`…»
      const declared = [
        ...description
          .split('Motivos estables')[1]
          .split(':')[1]
          .matchAll(/`([a-z_]+)`/g),
      ];

      expect(declared.map((match) => match[1]).sort()).toEqual([...PLAN_RULE_ISSUES].sort());
    });

    it('un motivo desconocido se informa con un texto genérico, sin ocultarlo', () => {
      expect(ruleText('less_than_equal').key).toBe('training.plan.rules.unknown');
    });

    it('numera desde 1 los objetivos y las sesiones', () => {
      expect(violationMessage({ path: 'objectives.0', issue: 'invalid_length' })).toEqual({
        field: { key: 'training.plan.rules.fieldObjective', params: { n: 1 } },
        rule: { key: 'training.plan.rules.invalid_length', params: {} },
      });
      expect(
        violationMessage({ path: 'sessions.3.scheduled_date', issue: 'outside_plan_period' }).field,
      ).toEqual({ key: 'training.plan.rules.fieldSession.scheduledDate', params: { n: 4 } });
    });

    it('nombra la lista completa o el plan cuando no hay un campo concreto', () => {
      expect(violationMessage({ path: 'sessions', issue: 'invalid_count' }).field.key).toBe(
        'training.plan.fields.sessions',
      );
      expect(violationMessage({ path: 'end_date', issue: 'period_too_long' }).field.key).toBe(
        'training.plan.fields.endDate',
      );
      expect(violationMessage({ path: '', issue: 'invalid_count' }).field.key).toBe(
        'training.plan.rules.fieldPlan',
      );
    });
  });
});
