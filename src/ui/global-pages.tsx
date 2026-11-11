/**
 * Page globale — aiguillage des trois routes (§17.5, §17.6, §17.7).
 *
 * Forge n'accepte qu'une entrée `jira:globalPage` par app (mesuré par
 * `forge lint` le 11 novembre 2026) : le manifeste déclare trois `pages`
 * (`exposition`, `originaux`, `banc`) et cet écran aiguille sur la route lue
 * dans le contexte. Aucune logique métier ici.
 */
import React from 'react';
import { t } from '../core/i18n';
import { useScreenContext } from './context';
import { ExposurePage } from './exposure-page';
import { Banner, Spinner, Stack, Text } from './kit';
import { mountScreen } from './mount';
import { OriginalsPage } from './originals-page';
import { PlaygroundPage } from './playground-page';

export default function GlobalPagesScreen(): JSX.Element {
  const context = useScreenContext();
  if (context.status === 'loading') return <Spinner />;
  if (context.status === 'error') return <Banner appearance="error">{context.message}</Banner>;
  const { route, projectKey, language } = context.data;

  if (route === 'originaux') return <OriginalsPage language={language} />;
  if (route === 'banc') return <PlaygroundPage language={language} />;
  if (route === 'exposition' || route === null) {
    if (!projectKey) {
      return (
        <Stack space="space.100">
          <Text>{t(language, 'ui.exposure.title')}</Text>
          <Text>{t(language, 'ui.error.missing', { name: 'projectKey' })}</Text>
        </Stack>
      );
    }
    return <ExposurePage projectKey={projectKey} language={language} />;
  }
  return <Text>{t(language, 'ui.error.notFound', { name: route })}</Text>;
}

mountScreen(<GlobalPagesScreen />);
