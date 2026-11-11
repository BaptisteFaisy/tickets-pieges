/**
 * File « Suspects » (§17.2) et revue d'un constat (§17.3) — écran du lot UI.
 * Demandes à examiner triées par niveau, regroupées par campagne ; verdict en
 * un clic ; restauration d'une neutralisation. Aucune logique métier ici :
 * l'écran appelle le pont (`api.ts`) et affiche.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { suspicionLabel, t } from '../core/i18n';
import type { Language, VerdictDecision } from '../core/types';
import {
  getFinding,
  listSuspects,
  restoreFinding,
  setVerdict,
  type FindingReview,
  type SuspectItem,
} from './api';
import { useScreenContext, type AsyncState } from './context';
import { confidenceLabel, shortDate } from './format';
import { Badge, Banner, Box, Button, Spinner, Stack, Table, Cell, Head, Row, Text } from './kit';
import { mountScreen } from './mount';

function VerdictButtons({
  findingId,
  language,
  onDone,
}: {
  findingId: string;
  language: Language;
  onDone: () => void;
}): JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const decisions: VerdictDecision[] = ['trapped', 'false-positive', 'legitimate-risky'];

  const decide = async (decision: VerdictDecision): Promise<void> => {
    const result = await setVerdict(findingId, decision, '');
    setMessage(result.ok ? t(language, 'ui.verdict.saved') : result.error);
    if (result.ok) onDone();
  };

  return (
    <Stack space="space.100">
      <Text>{t(language, 'ui.verdict.title')}</Text>
      <Box>
        <Stack space="space.100">
          {decisions.map((decision) => (
            <Button key={decision} text={t(language, `verdict.${decision}`)} onClick={() => void decide(decision)} />
          ))}
        </Stack>
      </Box>
      {message ? <Text>{message}</Text> : null}
    </Stack>
  );
}

function RuleInfo({ review, language }: { review: FindingReview; language: Language }): JSX.Element {
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.review.rule', { ruleId: review.ruleId })}</Text>
      {review.rulePrecision !== null ? (
        <Text>
          {t(language, 'ui.review.precision', { value: confidenceLabel(review.rulePrecision) })}
          {review.ruleDemoted ? ` — ${t(language, 'ui.review.demoted')}` : ''}
        </Text>
      ) : null}
    </Stack>
  );
}

function VerdictHistory({ review, language }: { review: FindingReview; language: Language }): JSX.Element {
  if (review.verdicts.length === 0) return <span />;
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.review.history')}</Text>
      {review.verdicts.map((verdict, index) => (
        <Text key={`${verdict.at}-${index}`}>
          {shortDate(verdict.at)} — {t(language, `verdict.${verdict.decision}`)}
        </Text>
      ))}
    </Stack>
  );
}

function ReviewPane({
  findingId,
  language,
  onChanged,
}: {
  findingId: string;
  language: Language;
  onChanged: () => void;
}): JSX.Element {
  const [state, setState] = useState<AsyncState<FindingReview>>({ status: 'loading' });
  const [restored, setRestored] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getFinding(findingId);
    setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.error });
  }, [findingId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <Banner appearance="error">{state.message}</Banner>;
  const review = state.data;

  const restore = async (): Promise<void> => {
    const result = await restoreFinding(findingId);
    setRestored(result.ok ? t(language, 'ui.review.restored') : result.error);
    if (result.ok) {
      await load();
      onChanged();
    }
  };

  return (
    <Stack space="space.100">
      <RuleInfo review={review} language={language} />
      <Text>{review.askSummary}</Text>
      <Text>« {review.excerpt} »</Text>
      {review.context ? (
        <Stack space="space.050">
          <Text>{t(language, 'ui.review.context')}</Text>
          <Text>{review.context}</Text>
        </Stack>
      ) : null}
      <VerdictHistory review={review} language={language} />
      <VerdictButtons findingId={findingId} language={language} onDone={() => void load()} />
      {review.status === 'neutralized' && review.originalId ? (
        <Button text={t(language, 'ui.review.restore')} appearance="subtle" onClick={() => void restore()} />
      ) : null}
      {restored ? <Text>{restored}</Text> : null}
    </Stack>
  );
}

function SuspectsTable({
  items,
  language,
  onSelect,
}: {
  items: SuspectItem[];
  language: Language;
  onSelect: (findingId: string) => void;
}): JSX.Element {
  return (
    <Table>
      <Head>
        <Cell>{t(language, 'ui.queue.col.issue')}</Cell>
        <Cell>{t(language, 'ui.queue.col.level')}</Cell>
        <Cell>{t(language, 'ui.queue.col.ask')}</Cell>
        <Cell>{t(language, 'ui.queue.col.layer')}</Cell>
        <Cell>{t(language, 'ui.queue.col.campaign')}</Cell>
        <Cell>{t(language, 'ui.queue.col.verdict')}</Cell>
      </Head>
      {items.map((item) => (
        <Row key={item.findingId}>
          <Cell>
            <Button appearance="link" text={item.issueKey} onClick={() => onSelect(item.findingId)} />
          </Cell>
          <Cell>{suspicionLabel(language, item.suspicion)}</Cell>
          <Cell>{item.askSummary}</Cell>
          <Cell>{item.layer}</Cell>
          <Cell>{item.campaignHash ? `${item.campaignHash.slice(0, 8)} ×${item.campaignCount}` : '—'}</Cell>
          <Cell>{item.verdict ? t(language, `verdict.${item.verdict}`) : '—'}</Cell>
        </Row>
      ))}
    </Table>
  );
}

export default function SuspectQueueScreen(): JSX.Element {
  const context = useScreenContext();
  const [state, setState] = useState<AsyncState<SuspectItem[]>>({ status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const language = context.status === 'ready' ? context.data.language : 'fr';

  const load = useCallback(async () => {
    const result = await listSuspects();
    setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.error });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <Banner appearance="error">{state.message}</Banner>;
  return (
    <Stack space="space.200">
      <Text>{t(language, 'ui.queue.title')}</Text>
      {state.data.length === 0 ? <Text>{t(language, 'ui.queue.empty')}</Text> : null}
      {state.data.length > 0 ? (
        <SuspectsTable items={state.data} language={language} onSelect={setSelected} />
      ) : null}
      <Stack space="space.100">
        <Text>{t(language, 'ui.queue.detail')}</Text>
        {selected ? (
          <ReviewPane findingId={selected} language={language} onChanged={() => void load()} />
        ) : (
          <Text>{t(language, 'ui.queue.select')}</Text>
        )}
      </Stack>
      <Badge appearance="neutral" text={t(language, 'ui.reduceRisk')} />
    </Stack>
  );
}

mountScreen(<SuspectQueueScreen />);
