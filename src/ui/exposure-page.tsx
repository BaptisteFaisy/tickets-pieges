/**
 * Page « Exposition » (§17.5) — écran du lot UI.
 * Exercices et résultats, constats par mois et par couche, campagnes, part des
 * demandes réellement analysées. Aucune logique métier : l'écran appelle le
 * pont (`api.ts`) et affiche.
 */
import React, { useEffect, useState } from 'react';
import { t } from '../core/i18n';
import type { Language } from '../core/types';
import { getExposure, type ExposureView } from './api';
import type { AsyncState } from './context';
import { percent, shortDate } from './format';
import { Banner, Spinner, Stack, Table, Cell, Head, Row, Text } from './kit';

function ReportStats({ view, language }: { view: ExposureView; language: Language }): JSX.Element {
  const report = view.report;
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.exposure.requests')} : {report.requestsExamined}</Text>
      <Text>{t(language, 'ui.exposure.analyzedShare')} : {percent(report.analyzedShare)}</Text>
      <Text>
        {t(language, 'ui.exposure.canariesDetail', {
          launched: report.canariesLaunched,
          obeyed: report.canariesObeyed,
          rate: percent(report.obedienceRate),
        })}
      </Text>
      <Text>{t(language, 'ui.exposure.outbound')} : {report.outboundHeld}</Text>
      <Text>{t(language, 'ui.exposure.campaigns')} : {report.campaigns}</Text>
    </Stack>
  );
}

function LayersTable({ view, language }: { view: ExposureView; language: Language }): JSX.Element {
  const entries = Object.entries(view.report.findingsByLayer);
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.exposure.byLayer')}</Text>
      <Table>
        <Head>
          <Cell>{language === 'fr' ? 'Couche' : 'Layer'}</Cell>
          <Cell>{language === 'fr' ? 'Constats' : 'Findings'}</Cell>
        </Head>
        {entries.map(([layer, count]) => (
          <Row key={layer}>
            <Cell>{layer}</Cell>
            <Cell>{count}</Cell>
          </Row>
        ))}
      </Table>
    </Stack>
  );
}

function MonthsTable({ view, language }: { view: ExposureView; language: Language }): JSX.Element {
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.exposure.byMonth')}</Text>
      {view.findingsByMonth.length === 0 ? <Text>{t(language, 'ui.exposure.empty')}</Text> : null}
      <Table>
        <Head>
          <Cell>{language === 'fr' ? 'Mois' : 'Month'}</Cell>
          <Cell>{language === 'fr' ? 'Constats' : 'Findings'}</Cell>
        </Head>
        {view.findingsByMonth.map((entry) => (
          <Row key={entry.month}>
            <Cell>{entry.month}</Cell>
            <Cell>{entry.count}</Cell>
          </Row>
        ))}
      </Table>
    </Stack>
  );
}

function CampaignsTable({ view, language }: { view: ExposureView; language: Language }): JSX.Element {
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.exposure.campaigns')}</Text>
      <Table>
        <Head>
          <Cell>{language === 'fr' ? 'Empreinte' : 'Fingerprint'}</Cell>
          <Cell>{language === 'fr' ? 'Compte' : 'Count'}</Cell>
          <Cell>{language === 'fr' ? 'Dernier' : 'Last seen'}</Cell>
        </Head>
        {view.campaigns.map((campaign) => (
          <Row key={campaign.payloadHash}>
            <Cell>{campaign.payloadHash.slice(0, 10)}</Cell>
            <Cell>{campaign.count}</Cell>
            <Cell>{shortDate(campaign.lastSeen)}</Cell>
          </Row>
        ))}
      </Table>
    </Stack>
  );
}

function VerdictsAndKinds({ view, language }: { view: ExposureView; language: Language }): JSX.Element {
  const verdicts = Object.entries(view.report.verdicts);
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.exposure.verdicts')}</Text>
      {verdicts.map(([decision, count]) => (
        <Text key={decision}>{t(language, `verdict.${decision}`)} : {count}</Text>
      ))}
      <Text>{t(language, 'ui.exposure.topKinds')}</Text>
      {view.report.topKinds.map((entry) => (
        <Text key={entry.kind}>{entry.kind} : {entry.count}</Text>
      ))}
    </Stack>
  );
}

export function ExposurePage({ projectKey, language }: { projectKey: string; language: Language }): JSX.Element {
  const [state, setState] = useState<AsyncState<ExposureView>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getExposure(projectKey, 30);
      if (cancelled) return;
      setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <Banner appearance="error">{state.message}</Banner>;
  const view = state.data;
  return (
    <Stack space="space.200">
      <Text>{t(language, 'ui.exposure.title')} — {view.report.projectKey}</Text>
      <ReportStats view={view} language={language} />
      <LayersTable view={view} language={language} />
      <MonthsTable view={view} language={language} />
      <VerdictsAndKinds view={view} language={language} />
      <CampaignsTable view={view} language={language} />
      <Text>{t(language, 'ui.reduceRisk')}</Text>
    </Stack>
  );
}
