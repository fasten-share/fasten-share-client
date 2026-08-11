"use client";

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ConsumerApiKeyDto } from '@/lib/client/auth';
import type { UserDto } from '@/lib/client/auth-types';
import type { Status } from '@/lib/control-client';
import { useI18n } from '@/lib/i18n/context';
import type { MessageKey } from '@/lib/i18n/dictionary';
import {
  CONSUMER_STEPS, PRODUCER_STEPS, derivedSteps, dismissOnboarding, getState,
  markSteps, setCollapsed, subscribeToOnboarding, EMPTY_STATE,
  type OnboardingStep,
} from '@/lib/onboarding';
import styles from './OnboardingChecklist.module.css';

export type OnboardingTarget =
  | { kind: 'recharge' }
  | { kind: 'apiKeys' }
  | { kind: 'tab'; tab: 'consumer' | 'producer' };

/** Where the "Go" button sends the user for each unfinished step. */
const TARGETS: Record<OnboardingStep, OnboardingTarget> = {
  consumerRecharge: { kind: 'recharge' },
  consumerApiKey: { kind: 'apiKeys' },
  consumerSearch: { kind: 'tab', tab: 'consumer' },
  consumerConfigure: { kind: 'tab', tab: 'consumer' },
  producerBackend: { kind: 'tab', tab: 'producer' },
  producerHealthy: { kind: 'tab', tab: 'producer' },
  producerShare: { kind: 'tab', tab: 'producer' },
  producerEarn: { kind: 'tab', tab: 'producer' },
};

export function OnboardingChecklist({ user, apiKeys, status, onNavigate }: {
  user: UserDto | null;
  apiKeys: ConsumerApiKeyDto[];
  status: Status | null;
  onNavigate: (target: OnboardingTarget) => void;
}) {
  const { t } = useI18n();
  const userId = user?.id ?? '';

  const state = useSyncExternalStore(
    subscribeToOnboarding,
    () => getState(userId),
    () => EMPTY_STATE,
  );
  const collapsed = state.collapsed;

  // Observable progress is latched as it appears, so a step stays ticked after
  // its signal goes away (traffic resets, sharing stopped).
  const observed = useMemo(() => derivedSteps({
    consumerCredits: user?.consumerAvailable ?? '0',
    apiKeyCount: apiKeys.length,
    backendCount: status?.config.backends.length ?? 0,
    anyHealthy: status?.producer.backends.some((backend) => backend.lastHealth?.ok) ?? false,
    anyAdvertised: status?.producer.backends.some((backend) => backend.advertised) ?? false,
    servedRequests: status?.producer.traffic.totals.success ?? 0,
  }), [user?.consumerAvailable, apiKeys.length, status]);

  useEffect(() => {
    if (userId) markSteps(userId, observed);
  }, [userId, observed]);

  const done = useMemo(() => {
    const set = new Set(state.done);
    observed.forEach((step) => set.add(step));
    return set;
  }, [state.done, observed]);

  const total = CONSUMER_STEPS.length + PRODUCER_STEPS.length;
  const completed = done.size;

  // Nothing to nag a finished or opted-out user about.
  if (!user || state.dismissed || completed >= total) return null;

  const renderTrack = (title: string, steps: readonly OnboardingStep[]) => (
    <div className={styles.track}>
      <h4 className={styles.trackTitle}>{title}</h4>
      <ol className={styles.steps}>
        {steps.map((step) => {
          const complete = done.has(step);
          return (
            <li key={step} className={complete ? styles.stepDone : styles.step}>
              <span className={styles.mark} aria-hidden="true">{complete ? '\u2713' : ''}</span>
              <span className={styles.stepText}>
                <span className={styles.stepTitle}>{t(`onboarding.${step}` as MessageKey)}</span>
                <span className={styles.stepHint}>
                  {t(`onboarding.${step}Hint` as MessageKey)}
                </span>
              </span>
              {complete ? null : (
                <button
                  type="button"
                  className={styles.goButton}
                  onClick={() => onNavigate(TARGETS[step])}
                >
                  {t('onboarding.go')}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <section className={`card ${styles.panel}`} aria-label={t('onboarding.title')}>
      <header className={styles.header}>
        <h3 className={styles.title}>{t('onboarding.title')}</h3>
        <span className={styles.progress}>
          {t('onboarding.progress', { done: completed, total })}
        </span>
        <div className={styles.bar}>
          <div
            className={styles.barFill}
            style={{ width: `${(completed / total) * 100}%` }}
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={total}
          />
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          aria-controls="onboarding-steps"
          onClick={() => setCollapsed(userId, !collapsed)}
        >
          {collapsed ? t('onboarding.expand') : t('onboarding.collapse')}
        </button>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => dismissOnboarding(userId)}
        >
          {t('onboarding.dismiss')}
        </button>
      </header>
      {!collapsed && (
        <div className={styles.tracks} id="onboarding-steps">
          {renderTrack(t('onboarding.consumerTrack'), CONSUMER_STEPS)}
          {renderTrack(t('onboarding.producerTrack'), PRODUCER_STEPS)}
        </div>
      )}
    </section>
  );
}
