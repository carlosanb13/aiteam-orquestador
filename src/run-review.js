/** Estado de revisión por archivo de una tarea, separado de run.review (configuración booleana). */
export function runReviewTarget(run) {
  run.reviewFiles ??= {};
  return { repoPath: run.repoPath, branch: run.integration.branch, worktree: run.integration.worktree, review: run.reviewFiles, run };
}

export function saveRunReview(target, touch) {
  target.run.reviewFiles = target.review;
  touch(target.run);
}
