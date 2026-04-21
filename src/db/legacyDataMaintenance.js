import db from './index.js';
import {
  normalizeNoteRecord,
  normalizeCommentRecord,
  normalizeAuthorRecord,
  normalizeMediaAssetRecord,
} from './recordNormalization.js';

function getChangedRecords(records = [], normalizeRecord) {
  const changed = [];
  for (const record of records) {
    const normalized = normalizeRecord(record);
    if (JSON.stringify(normalized) !== JSON.stringify(record)) {
      changed.push(normalized);
    }
  }
  return changed;
}

export async function backfillLegacyAiReadyFields() {
  const [notes, comments, authors, mediaAssets] = await Promise.all([
    db.notes.toArray(),
    db.comments.toArray(),
    db.authors.toArray(),
    db.mediaAssets.toArray(),
  ]);

  const changedNotes = getChangedRecords(notes, normalizeNoteRecord);
  const changedComments = getChangedRecords(comments, normalizeCommentRecord);
  const changedAuthors = getChangedRecords(authors, normalizeAuthorRecord);
  const changedMediaAssets = getChangedRecords(mediaAssets, normalizeMediaAssetRecord);

  if (changedNotes.length > 0) await db.notes.bulkPut(changedNotes);
  if (changedComments.length > 0) await db.comments.bulkPut(changedComments);
  if (changedAuthors.length > 0) await db.authors.bulkPut(changedAuthors);
  if (changedMediaAssets.length > 0) await db.mediaAssets.bulkPut(changedMediaAssets);

  return {
    notes: changedNotes.length,
    comments: changedComments.length,
    authors: changedAuthors.length,
    mediaAssets: changedMediaAssets.length,
    total: changedNotes.length + changedComments.length + changedAuthors.length + changedMediaAssets.length,
  };
}
