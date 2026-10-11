import test from 'node:test';
import assert from 'node:assert/strict';
import { journey, redirectToEditor } from '../web/journey.mjs';

test('progressive sections follow workflow, selection and retained review; reset returns to first step', () => {
  assert.deepEqual(journey({workflowId: ''}), {step: 1, executionsVisible: false, reviewVisible: false});
  assert.deepEqual(journey({workflowId: 'wf'}), {step: 2, executionsVisible: true, reviewVisible: false});
  assert.equal(journey({workflowId: 'wf', selected: 1}).step, 3);
  assert.equal(journey({workflowId: 'wf', reviewing: true}).reviewVisible, true);
  assert.deepEqual(journey({workflowId: '', selected: 2, reviewing: true}), {step: 1, executionsVisible: false, reviewVisible: false});
});

test('only absent or expired session redirects to the same origin editor', () => {
  const navigations = [], location = {assign: path => navigations.push(path)};
  for (const code of ['access_denied', 'network_error', 'outcome_unknown', 'session_changed', 'storage_unavailable']) {
    assert.equal(redirectToEditor({code}, location), false);
  }
  for (const code of ['session_expired', 'open_editor_first']) assert.equal(redirectToEditor({code}, location), true);
  assert.deepEqual(navigations, ['/', '/']);
});
