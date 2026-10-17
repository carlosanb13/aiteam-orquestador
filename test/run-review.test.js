import test from 'node:test';
import assert from 'node:assert/strict';
import { unaccept } from '../src/review.js';
import { runReviewTarget, saveRunReview } from '../src/run-review.js';

test('la aceptación de archivos de una tarea no sobrescribe su configuración de revisión', () => {
  for (const enabled of [true, false]) {
    const run = {
      repoPath: 'repo',
      integration: { branch: 'integrated', worktree: 'worktree' },
      review: enabled,
    };
    const target = runReviewTarget(run);
    target.review['file.txt'] = 'abc123';
    let touched = false;
    saveRunReview(target, (savedRun) => {
      assert.equal(savedRun, run);
      touched = true;
    });
    assert.equal(touched, true);
    assert.equal(run.review, enabled);
    assert.deepEqual(run.reviewFiles, { 'file.txt': 'abc123' });
    assert.equal(runReviewTarget(run).review['file.txt'], 'abc123');

    unaccept(target, 'file.txt');
    saveRunReview(target, () => {});
    assert.deepEqual(run.reviewFiles, {});
    assert.equal(run.review, enabled);

    target.review = {}; // Review.apply limpia las aceptaciones después de aplicar.
    saveRunReview(target, () => {});
    assert.deepEqual(run.reviewFiles, {});
    assert.equal(run.review, enabled);
  }
});
