import type { Section, SectionContext } from './types';
import { badge, buttonHtml, field, heading, note, panel, pre, selectHtml } from '../dom';
import { byId, valueOf } from '../dom';

const TEXTS: Record<string, [string, string]> = {
  intro: [
    'Un ticket témoin (canari) est un faux ticket inoffensif posé pour détecter une exfiltration : si quelqu’un agit dessus, une alerte se déclenche.',
    'A canary ticket is a harmless fake ticket planted to detect exfiltration: if anyone acts on it, an alert fires.',
  ],
  role: ['Rôle de l’acteur', 'Actor role'],
  roleAgent: ['Agent support', 'Support agent'],
  roleSecurity: ['Sécurité', 'Security'],
  launch: ['Lancer un exercice', 'Run an exercise'],
  result: ['Résultat de l’exercice', 'Exercise result'],
  denied: [
    'Refusé : la création d’un ticket témoin exige le rôle sécurité.',
    'Denied: creating a canary ticket requires the security role.',
  ],
  ok: ['Exercice lancé (squelette — à enrichir).', 'Exercise started (skeleton — to be enriched).'],
  placeholder: ['(aucun exercice lancé)', '(no exercise run yet)'],
};

function tr(ctx: SectionContext, key: string): string {
  const pair = TEXTS[key];
  if (!pair) return key;
  return ctx.lang === 'fr' ? pair[0] : pair[1];
}

const BADGE_OK = { fr: 'OK', en: 'OK' };
const BADGE_DENIED = { fr: 'Refusé', en: 'Denied' };

function resultHtml(kind: 'ok' | 'denied', text: string, lang: 'fr' | 'en' = 'fr'): string {
  const label = (kind === 'ok' ? BADGE_OK : BADGE_DENIED)[lang];
  const tone = kind === 'ok' ? 'success' : 'danger';
  return `${badge(label, tone)} ${text}`;
}

function render(ctx: SectionContext): string {
  const controls = [
    field(
      tr(ctx, 'role'),
      selectHtml('canary-role', [
        ['agent', tr(ctx, 'roleAgent')],
        ['security', tr(ctx, 'roleSecurity')],
      ]),
    ),
    buttonHtml('canary-launch', tr(ctx, 'launch')),
  ].join('');
  return panel(
    [
      note(tr(ctx, 'intro')),
      heading(tr(ctx, 'result')),
      controls,
      `<div id="canary-out">${pre(tr(ctx, 'placeholder'))}</div>`,
    ].join(''),
  );
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  const button = byId<HTMLButtonElement>(root, 'canary-launch');
  const out = byId<HTMLDivElement>(root, 'canary-out');
  if (!button || !out) return;
  button.addEventListener('click', () => {
    const role = valueOf(root, 'canary-role');
    if (role !== 'security') {
      out.innerHTML = resultHtml('denied', tr(ctx, 'denied'), ctx.lang);
      ctx.notify(tr(ctx, 'denied'));
      return;
    }
    out.innerHTML = resultHtml('ok', tr(ctx, 'ok'), ctx.lang);
  });
}

export const canarySection: Section = {
  id: 'canary',
  titles: { fr: 'Exercice d’alerte', en: 'Alert exercise' },
  render,
  mount,
};
