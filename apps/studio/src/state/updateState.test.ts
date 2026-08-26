import { describe, expect, it } from 'vitest';

import { describeUpdate, IDLE, shouldOffer, versionKey, type UpdateState } from './updateState.js';

const state = (patch: Partial<UpdateState>): UpdateState => ({ ...IDLE, ...patch });

describe('shouldOffer', () => {
  it('says nothing until the update is actually downloaded', () => {
    for (const status of ['idle', 'checking', 'available', 'downloading', 'current'] as const) {
      expect(shouldOffer(state({ status, version: '2.0.0' }), null)).toBe(false);
    }
    expect(shouldOffer(state({ status: 'ready', version: '2.0.0' }), null)).toBe(true);
  });

  it('stays quiet about a version already waved away', () => {
    const ready = state({ status: 'ready', version: '2.0.0' });
    expect(shouldOffer(ready, '2.0.0')).toBe(false);
  });

  it('asks again when a newer one arrives', () => {
    // The point of remembering a version rather than a flag: saying "later" to
    // one release must not silence every release after it.
    expect(shouldOffer(state({ status: 'ready', version: '2.1.0' }), '2.0.0')).toBe(true);
  });

  it('can still be dismissed by a source that names no version', () => {
    // A service worker reports that something newer exists without saying
    // what, so "later" has to have something to remember it by.
    const anonymous = state({ status: 'ready', version: null });
    expect(shouldOffer(anonymous, null)).toBe(true);
    expect(shouldOffer(anonymous, versionKey(anonymous))).toBe(false);
  });

  it('never offers a failed check as though it were an update', () => {
    expect(shouldOffer(state({ status: 'failed', message: 'offline' }), null)).toBe(false);
  });
});

describe('describeUpdate', () => {
  it('rounds progress to something readable', () => {
    expect(describeUpdate(state({ status: 'downloading', progress: 0.4237 }))).toBe(
      'Downloading — 42%.',
    );
  });

  it('names the version when it knows it, and copes when it does not', () => {
    expect(describeUpdate(state({ status: 'ready', version: '3.2.0' }))).toContain('Wisp 3.2.0');
    expect(describeUpdate(state({ status: 'ready', version: null }))).toContain('a new version');
  });

  it('passes the reason through when a check fails', () => {
    expect(describeUpdate(state({ status: 'failed', message: 'net::ERR_DISCONNECTED' }))).toContain(
      'net::ERR_DISCONNECTED',
    );
    // And still says something useful when there is no reason to pass on.
    expect(describeUpdate(state({ status: 'failed' }))).toBe(
      'Could not check for a newer version.',
    );
  });

  it('says so plainly when there is nothing to do', () => {
    expect(describeUpdate(state({ status: 'current' }))).toBe('This is the newest version.');
  });
});
