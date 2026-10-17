import * as Review from './review.js';
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const ROLLBACK_FILE = path.join(APP_ROOT, 'data', 'last-rollback.json');

/** Entrega el trabajo terminado sin exigir una segunda aprobación de archivos. */
export async function deliverChanges(target, message) {
  try {
    const state = await Review.listChanges(target);
    if (state.applied) return { status: 'applied', files: 0, branch: state.projectBranch, changes: [] };
    if (!state.files.length) return { status: 'no_changes', files: 0 };
    if (state.syntaxErrors.length) return { status: 'pending', files: state.files.length, changes: state.files, reason: 'Hay errores de sintaxis.', syntaxErrors: state.syntaxErrors };
    if (state.projectDirty) return { status: 'pending', files: state.files.length, changes: state.files, reason: 'El proyecto tiene cambios sin guardar.' };
    const result = await Review.apply(target, message);
    if (!result.ok) return { status: 'pending', files: state.files.length, changes: state.files, reason: result.error || 'No se pudieron integrar los cambios.' };
    const selfUpdate = path.resolve(target.repoPath).toLowerCase() === APP_ROOT.toLowerCase();
    if (selfUpdate && result.before) {
      try {
        fs.mkdirSync(path.dirname(ROLLBACK_FILE), { recursive: true });
        fs.writeFileSync(ROLLBACK_FILE, JSON.stringify({ before: result.before, timestamp: new Date().toISOString(), label: message }, null, 2));
      } catch { /* La entrega ya está aplicada; no se debe informar como pendiente. */ }
    }
    return { status: 'applied', files: result.files, changes: state.files, branch: result.branch, before: result.before, after: result.after, selfUpdate };
  } catch (error) {
    return { status: 'pending', reason: error.message || 'No se pudieron integrar los cambios.' };
  }
}
