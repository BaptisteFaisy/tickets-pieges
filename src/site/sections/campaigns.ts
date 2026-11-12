import type { Section, SectionContext } from './types';
import { buttonHtml, byId, heading, note, panel, pre } from '../dom';

function render(_ctx: SectionContext): string {
  const body = [
    heading('Campagnes et hérédité'),
    note('Charge le jeu d’essai pour inspecter les campagnes, leurs empreintes et leur héritage.'),
    buttonHtml('campaigns-load', 'Charger le jeu d’essai'),
    '<div id="campaigns-result"></div>',
  ].join('\n');
  return panel(body, 'campaigns-panel');
}

function mount(root: HTMLElement, _ctx: SectionContext): void {
  const btn = byId<HTMLButtonElement>(root, 'campaigns-load');
  const out = byId<HTMLElement>(root, 'campaigns-result');
  if (!btn || !out) return;
  btn.addEventListener('click', () => {
    out.innerHTML = pre('Jeu d’essai indisponible pour le moment.');
  });
}

export const campaignsSection: Section = {
  id: 'campaigns',
  titles: { fr: 'Campagnes et hérédité', en: 'Campaigns & inheritance' },
  render,
  mount,
};
