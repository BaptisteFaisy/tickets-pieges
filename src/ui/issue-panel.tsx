/**
 * Bandeau et panneau du ticket (§17.1) — écran du lot UI.
 * Référence : docs/CAHIER-DES-CHARGES.md §17.1, §21 (peu de bruit, pas de
 * fausse assurance). Aucune logique métier ici : l'écran appelle le pont
 * (`api.ts`) et affiche.
 */
import React, { useEffect, useState } from 'react';
import { modeLabel, suspicionLabel, t, trustLabel } from '../core/i18n';
import { getIssuePanel, type ApiResult, type PanelView } from './api';
import { useScreenContext, type AsyncState } from './context';
import { confidenceLabel, percent, shortDate } from './format';
import { Badge, Banner, Box, Spinner, Stack, Table, Cell, Head, Row, Text } from './kit';
import { mountScreen } from './mount';

function PanelBanner({ view }: { view: PanelView }): JSX.Element | null {
  if (!view.banner) return null;
  return (
    <Banner appearance="warning" title={t(view.language, 'ui.panel.title')}>
      <Text>{view.banner}</Text>
    </Banner>
  );
}

function PanelBadges({ view }: { view: PanelView }): JSX.Element {
  const lang = view.language;
  return (
    <Stack space="space.100">
      <Box>
        <Stack space="space.100">
          <Badge appearance="neutral" text={trustLabel(lang, view.trustLevel)} />
          <Badge
            appearance={view.suspicionLevel === 'clean' ? 'added' : 'important'}
            text={suspicionLabel(lang, view.suspicionLevel)}
          />
          <Badge appearance="primary" text={modeLabel(lang, view.modeApplied)} />
        </Stack>
      </Box>
      <Text>{t(lang, 'ui.panel.analyzedShare', { share: percent(view.analyzedShare) })}</Text>
      {view.unanalyzed.length > 0 ? (
        <Stack space="space.050">
          <Text>{t(lang, 'ui.panel.unanalyzed')}</Text>
          {view.unanalyzed.map((reason) => (
            <Text key={reason}>{t(lang, `framing.not-analyzed.${reason}`)}</Text>
          ))}
        </Stack>
      ) : null}
      {view.updatedAt ? <Text>{t(lang, 'ui.panel.updatedAt', { date: shortDate(view.updatedAt) })}</Text> : null}
    </Stack>
  );
}

function SegmentsTable({ view }: { view: PanelView }): JSX.Element {
  const lang = view.language;
  if (view.segments.length === 0) return <Text>{t(lang, 'ui.panel.empty')}</Text>;
  return (
    <Table>
      <Head>
        <Cell>{t(lang, 'ui.panel.segments')}</Cell>
        <Cell>{lang === 'fr' ? 'Confiance' : 'Trust'}</Cell>
        <Cell>{lang === 'fr' ? 'Canal' : 'Channel'}</Cell>
      </Head>
      {view.segments.map((segment) => (
        <Row key={segment.segmentId}>
          <Cell>{segment.field}</Cell>
          <Cell>{trustLabel(lang, segment.trustLevel)}</Cell>
          <Cell>{segment.channel}</Cell>
        </Row>
      ))}
    </Table>
  );
}

function FindingsList({ view }: { view: PanelView }): JSX.Element {
  const lang = view.language;
  if (view.findings.length === 0) return <Text>{t(lang, 'ui.panel.noFindings')}</Text>;
  return (
    <Stack space="space.150">
      {view.findings.map((finding) => (
        <Stack key={finding.id} space="space.050">
          <Box>
            <Stack space="space.100">
              <Badge appearance="removed" text={finding.layer} />
              <Badge appearance="neutral" text={finding.ruleId} />
              <Badge appearance="default" text={confidenceLabel(finding.confidence)} />
              {finding.status !== 'open' ? <Badge appearance="added" text={finding.status} /> : null}
            </Stack>
          </Box>
          <Text>{finding.askSummary}</Text>
          <Text>« {finding.excerpt} »</Text>
        </Stack>
      ))}
    </Stack>
  );
}

function DraftsList({ view }: { view: PanelView }): JSX.Element {
  const lang = view.language;
  if (view.drafts.length === 0) return <Text>{t(lang, 'ui.panel.noDrafts')}</Text>;
  return (
    <Stack space="space.100">
      {view.drafts.map((draft) => (
        <Stack key={draft.id} space="space.050">
          <Text>{shortDate(draft.createdAt)}</Text>
          <Text>{draft.text}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

function PanelBody({ issueId, issueKey }: { issueId: string; issueKey: string }): JSX.Element {
  const [state, setState] = useState<AsyncState<PanelView>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result: ApiResult<PanelView> = await getIssuePanel(issueId, issueKey);
      if (cancelled) return;
      setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [issueId, issueKey]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <Banner appearance="error">{state.message}</Banner>;
  const view = state.data;
  const lang = view.language;
  return (
    <Stack space="space.200">
      <PanelBanner view={view} />
      <PanelBadges view={view} />
      <Stack space="space.100">
        <Text>{t(lang, 'ui.panel.segments')}</Text>
        <SegmentsTable view={view} />
      </Stack>
      <Stack space="space.100">
        <Text>{t(lang, 'ui.panel.findings')}</Text>
        <FindingsList view={view} />
      </Stack>
      <Stack space="space.100">
        <Text>{t(lang, 'ui.panel.drafts')}</Text>
        <DraftsList view={view} />
      </Stack>
      <Text>{t(lang, 'ui.reduceRisk')}</Text>
    </Stack>
  );
}

export default function IssuePanelScreen(): JSX.Element {
  const context = useScreenContext();
  if (context.status === 'loading') return <Spinner />;
  if (context.status === 'error') return <Banner appearance="error">{context.message}</Banner>;
  const { issueId, issueKey, language } = context.data;
  if (!issueId) return <Text>{t(language, 'ui.panel.empty')}</Text>;
  return <PanelBody issueId={issueId} issueKey={issueKey ?? ''} />;
}

mountScreen(<IssuePanelScreen />);
