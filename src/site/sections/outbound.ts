import type { Section, SectionContext } from './types';
import { buttonHtml, byId, field, heading, note, panel, pre, textareaHtml, valueOf } from '../dom';

function render(): string {
  const form = [
    field('Contenu du message sortant', textareaHtml('ob-input', 6, 'Colle ici un e-mail, un chat ou un extrait à contrôler…')),
    buttonHtml('ob-run', 'Contrôler la sortie'),
  ].join('');
  return [
    heading('Sas de sortie'),
    note('Tout contenu qui quitte l’entreprise passe par ce sas : DLP, caviardage et notification avant envoi.'),
    panel(form, 'ob-form'),
    panel(pre('(aucun contrôle lancé)'), 'ob-result'),
  ].join('');
}

function mount(root: HTMLElement, _ctx: SectionContext): void {
  const btn = byId<HTMLButtonElement>(root, 'ob-run');
  btn?.addEventListener('click', () => {
    const out = byId<HTMLElement>(root, 'ob-result');
    const value = valueOf(root, 'ob-input');
    if (out) out.innerHTML = pre(value ? `Reçu ${value.length} caractères — analyse à venir.` : 'Saisie vide.');
  });
}

export const outboundSection: Section = {
  id: 'outbound',
  titles: { fr: 'Sas de sortie', en: 'Outbound gate' },
  render,
  mount,
};
