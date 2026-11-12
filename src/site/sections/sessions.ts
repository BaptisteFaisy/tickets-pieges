import type { Section, SectionContext } from './types';
import { badge, buttonHtml, byId, esc, heading, note, panel } from '../dom';

type Lang = 'fr' | 'en';

interface SessionsState {
  tainted: boolean;
  source: string;
  taintedAt: string | null;
}

const TEXTS: Record<Lang, {
  intro: string;
  title: string;
  tainted: string;
  clean: string;
  source: string;
  since: string;
  contaminate: string;
  reset: string;
  notifiedTainted: string;
  notifiedClean: string;
  none: string;
}> = {
  fr: {
    intro: "Lecture d'un contenu classé T0/T1 : la session est marquée contaminée et les gestes sensibles passent en validation humaine.",
    title: 'État de la session',
    tainted: 'contaminée',
    clean: 'saine',
    source: 'Source',
    since: 'Contaminée à',
    contaminate: 'Contaminer la session',
    reset: 'Réinitialiser',
    notifiedTainted: 'Session marquée contaminée.',
    notifiedClean: 'Session réinitialisée.',
    none: '—',
  },
  en: {
    intro: 'Reading T0/T1 content marks the session as tainted; sensitive actions then require human approval.',
    title: 'Session state',
    tainted: 'tainted',
    clean: 'clean',
    source: 'Source',
    since: 'Tainted at',
    contaminate: 'Taint the session',
    reset: 'Reset',
    notifiedTainted: 'Session marked as tainted.',
    notifiedClean: 'Session reset.',
    none: '—',
  },
};

let state: SessionsState = { tainted: false, source: '', taintedAt: null };

function statusHtml(ctx: SectionContext): string {
  const tx = TEXTS[ctx.lang];
  const status = state.tainted ? badge(tx.tainted, 'danger') : badge(tx.clean, 'ok');
  const meta = state.tainted
    ? note(`${tx.source} : ${esc(state.source)} — ${tx.since} : ${esc(state.taintedAt ?? tx.none)}`)
    : '';
  return `<p>${status}</p>${meta}`;
}

function render(ctx: SectionContext): string {
  const tx = TEXTS[ctx.lang];
  const controls =
    buttonHtml('sessions-contaminate', tx.contaminate, 'primary') +
    buttonHtml('sessions-reset', tx.reset, 'ghost');
  return (
    heading(tx.title) +
    note(tx.intro) +
    panel(`<div id="sessions-status">${statusHtml(ctx)}</div>${controls}`)
  );
}

function refresh(root: HTMLElement, ctx: SectionContext): void {
  const box = byId(root, 'sessions-status');
  if (box) box.innerHTML = statusHtml(ctx);
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  const tx = TEXTS[ctx.lang];
  const taintBtn = byId<HTMLButtonElement>(root, 'sessions-contaminate');
  const resetBtn = byId<HTMLButtonElement>(root, 'sessions-reset');
  if (taintBtn) {
    taintBtn.addEventListener('click', () => {
      state = { tainted: true, source: 'T1 / demo', taintedAt: ctx.now };
      refresh(root, ctx);
      ctx.notify(tx.notifiedTainted);
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state = { tainted: false, source: '', taintedAt: null };
      refresh(root, ctx);
      ctx.notify(tx.notifiedClean);
    });
  }
}

export const sessionsSection: Section = {
  id: 'sessions',
  titles: { fr: 'Session contaminée', en: 'Tainted session' },
  render,
  mount,
};
