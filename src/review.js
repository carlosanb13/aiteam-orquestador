// Revisión por archivo y aplicación al proyecto de lo que hicieron las IAs en una rama
// (la de una conversación o la integrada de una tarea de equipo).
//
// Un "objetivo" es { repoPath, branch, worktree, review }: review guarda los archivos aceptados
// junto con la versión exacta (blob) que se aceptó, para que un cambio posterior vuelva a pedir revisión.
import fs from 'node:fs';
import path from 'node:path';
import * as G from './git.js';

const STATUS = { A: 'añadido', M: 'modificado', D: 'eliminado', R: 'renombrado', C: 'copiado', T: 'tipo cambiado' };

async function projectHead(t) {
  return (await G.git(t.repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
}

/** Base de comparación: el punto común entre el proyecto actual y la rama de las IAs. */
async function mergeBase(t) {
  return (await G.git(t.repoPath, ['merge-base', 'HEAD', t.branch])).stdout.trim();
}

async function blobOf(t, file) {
  const r = await G.git(t.repoPath, ['rev-parse', `${t.branch}:${file}`], { allowFail: true });
  return r.ok ? r.stdout.trim() : 'deleted';
}

/** Archivos que la rama cambia respecto al proyecto, con su estado de revisión. */
export async function listChanges(t) {
  const base = await mergeBase(t);
  const res = await G.git(t.repoPath, ['diff', '--name-status', '--find-renames', base, t.branch]);
  const numstat = await G.git(t.repoPath, ['diff', '--numstat', '--find-renames', base, t.branch]);
  const counts = {};
  for (const line of numstat.stdout.split('\n')) {
    const [add, del, ...rest] = line.split('\t');
    if (rest.length) counts[rest.at(-1).replace(/^.*=> /, '').replace(/[{}]/g, '')] = { add: Number(add) || 0, del: Number(del) || 0 };
  }
  const files = [];
  for (const line of res.stdout.split('\n').filter(Boolean)) {
    const [code, ...paths] = line.split('\t');
    const file = paths.at(-1);
    const blob = await blobOf(t, file);
    const accepted = t.review?.[file] === blob;
    files.push({
      file,
      from: paths.length > 1 ? paths[0] : null,
      status: code[0],
      statusLabel: STATUS[code[0]] ?? code,
      ...(counts[file] ?? { add: 0, del: 0 }),
      accepted,
    });
  }

  // Comprobación de sintaxis para archivos JavaScript modificados en la copia de trabajo
  const syntaxErrors = [];
  if (t.worktree && fs.existsSync(t.worktree)) {
    const { spawnSync } = await import('node:child_process');
    for (const f of files) {
      if (f.status === 'D') continue;
      if (/\.(m?js|cjs)$/i.test(f.file)) {
        const full = path.join(t.worktree, f.file);
        if (fs.existsSync(full)) {
          const chk = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8', timeout: 5000 });
          if (chk.status !== 0) {
            const errLine = (chk.stderr || chk.stdout || 'Error de sintaxis').trim().split('\n')[0];
            syntaxErrors.push({ file: f.file, error: errLine });
          }
        }
      }
    }
  }

  const dirty = (await G.git(t.repoPath, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim().length > 0;
  const branchName = (await G.git(t.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  const applied = (await G.git(t.repoPath, ['merge-base', '--is-ancestor', t.branch, 'HEAD'], { allowFail: true })).ok;
  return { files, applied, projectBranch: branchName, projectDirty: dirty, syntaxErrors };
}

export async function fileDiff(t, file) {
  const base = await mergeBase(t);
  const res = await G.git(t.repoPath, ['diff', '--find-renames', base, t.branch, '--', file], { allowFail: true });
  let diff = res.stdout;
  if (diff.length > 300_000) diff = `${diff.slice(0, 300_000)}\n... (diff truncado)`;
  return { file, diff };
}

export async function accept(t, file) {
  t.review ??= {};
  t.review[file] = await blobOf(t, file);
}

export function unaccept(t, file) {
  if (t.review) delete t.review[file];
}

/** Deshace en la rama los cambios de un archivo (lo deja como está en el proyecto). */
export async function reject(t, file) {
  if (!fs.existsSync(t.worktree)) throw new Error('La copia de trabajo ya no existe.');
  const base = await mergeBase(t);
  const inBase = (await G.git(t.repoPath, ['cat-file', '-e', `${base}:${file}`], { allowFail: true })).ok;
  if (inBase) {
    await G.git(t.worktree, ['checkout', base, '--', file]);
  } else {
    const full = path.join(t.worktree, file);
    if (fs.existsSync(full)) fs.rmSync(full, { force: true });
  }
  if (t.review) delete t.review[file];
  return G.commitAll(t.worktree, `[usuario] rechaza los cambios en ${file}`);
}

/**
 * Guarda los cambios pendientes del repositorio del usuario en un commit de respaldo.
 */
export async function commitProject(t, message = 'AITeam: guardado automático del proyecto antes de aplicar cambios') {
  if (!fs.existsSync(t.repoPath)) throw new Error('La carpeta del proyecto no existe.');
  const changed = await G.commitAll(t.repoPath, message);
  return { ok: true, changed };
}

/**
 * Fusiona la rama en la rama actual del proyecto del usuario.
 * No toca nada si el proyecto tiene cambios sin guardar; si hay conflictos, deshace la fusión.
 */
export async function apply(t, message, options = {}) {
  if (!fs.existsSync(t.repoPath)) throw new Error('La carpeta del proyecto no existe.');
  let state = await listChanges(t);
  if (state.projectDirty) {
    if (options.commitFirst) {
      await G.commitAll(t.repoPath, options.commitMessage || 'AITeam: guardado automático antes de aplicar cambios');
      state = await listChanges(t);
    } else {
      return { ok: false, reason: 'dirty', error: 'Tu proyecto tiene cambios sin guardar (sin commit). Haz commit o descártalos antes de aplicar.' };
    }
  }
  if (!state.files.length) return { ok: false, reason: 'empty', error: 'No hay cambios pendientes de aplicar.' };
  if (state.syntaxErrors?.length && !options.force) {
    return {
      ok: false,
      reason: 'syntax',
      syntaxErrors: state.syntaxErrors,
      error: `No se puede aplicar: hay errores de sintaxis en: ${state.syntaxErrors.map((s) => `${s.file} (${s.error})`).join(' · ')}. Pide a la IA que lo corrija antes de aplicar.`,
    };
  }
  const before = await projectHead(t);
  const res = await G.merge(t.repoPath, t.branch, message);
  if (!res.ok) {
    await G.abortMerge(t.repoPath);
    return { ok: false, reason: 'conflict', conflicts: res.conflicts, error: `Hay conflictos con cambios recientes de tu proyecto en: ${res.conflicts.join(', ')}.` };
  }
  t.review = {};
  return { ok: true, files: state.files.length, branch: state.projectBranch, before, after: await projectHead(t) };
}

/** Trae a la rama de las IAs los cambios nuevos del proyecto. Devuelve los conflictos, si los hay. */
export async function syncFromProject(t) {
  const head = await projectHead(t);
  const res = await G.merge(t.worktree, head, 'AITeam: trae los últimos cambios del proyecto');
  return res.ok ? { ok: true, conflicts: [] } : { ok: false, conflicts: res.conflicts };
}
