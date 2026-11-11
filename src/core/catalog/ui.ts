/** Catalogue « écrans » (§17) — propriétaire : lot UI. */
export const uiCatalog = {
  fr: {
    'ui.panel.title': 'Tickets piégés',
    'ui.panel.empty': 'Rien à signaler sur cette demande.',
  },
  en: {
    'ui.panel.title': 'Trapped tickets',
    'ui.panel.empty': 'Nothing to report on this request.',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
