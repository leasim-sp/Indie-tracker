import { google } from 'googleapis';
import mammoth from 'mammoth';
import db from '../db.js';

function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

/**
 * Recursively collect every non-folder file inside a Drive folder.
 * Handles pagination and descends into subfolders in parallel.
 * @param {object} drive  - googleapis drive v3 client
 * @param {string} folderId
 * @returns {Promise<Array<{id, name, mimeType, modifiedTime}>>}
 */
async function collectFiles(drive, folderId) {
  const results = [];
  let pageToken;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, modifiedTime, mimeType)',
      pageSize: 1000,
      ...(pageToken && { pageToken }),
    });

    pageToken = res.data.nextPageToken;
    const items = res.data.files || [];

    const subfolders = [];
    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        subfolders.push(item);
      } else {
        results.push(item);
      }
    }

    // Descend into all subfolders of this level in parallel
    const nested = await Promise.all(subfolders.map(f => collectFiles(drive, f.id)));
    for (const batch of nested) results.push(...batch);

  } while (pageToken);

  return results;
}

/**
 * List all topic files inside the configured Drive folder (recursive).
 * Searches 'OPE' and every subfolder inside it, regardless of depth.
 * Returns array of { number, title, drive_file_id, modifiedTime, mimeType }
 */
export async function listTopics() {
  const auth = getOAuth2Client();
  const drive = google.drive({ version: 'v3', auth });
  const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'OPE';

  // Locate the root OPE folder
  const folderRes = await drive.files.list({
    q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 5,
  });

  const folder = folderRes.data.files?.[0];
  if (!folder) throw new Error(`Carpeta "${folderName}" no encontrada en Drive`);

  // Collect all files from OPE and every nested subfolder
  const allFiles = await collectFiles(drive, folder.id);

  const topics = [];
  for (const file of allFiles) {
    const match = file.name.match(/TEMA[_\s-]*(\d+)/i);
    if (match) {
      topics.push({
        number:        parseInt(match[1], 10),
        title:         file.name,
        drive_file_id: file.id,
        modifiedTime:  file.modifiedTime,
        mimeType:      file.mimeType,
      });
    }
  }

  // If the same topic number appears in multiple subfolders, keep the last
  // one found (relies on natural Drive listing order, first wins via Map)
  const byNumber = new Map();
  for (const t of topics) {
    if (!byNumber.has(t.number)) byNumber.set(t.number, t);
  }

  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * Read topic content from Drive, using DB cache if fresh (< 24h).
 * @param {number} topicNumber
 * @param {string} driveFileId
 * @param {string} mimeType
 * @returns {Promise<string>}
 */
export async function getTopicContent(topicNumber, driveFileId, mimeType) {
  // Check cache (24 h TTL)
  const cached = db.topics.findByNumber(topicNumber);
  if (cached?.content_cache && cached.cache_updated_at) {
    const age = Date.now() - new Date(cached.cache_updated_at).getTime();
    if (age < 24 * 60 * 60 * 1000) return cached.content_cache;
  }

  // Fetch from Drive
  const auth = getOAuth2Client();
  const drive = google.drive({ version: 'v3', auth });
  let content = '';

  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId: driveFileId, mimeType: 'text/plain' },
      { responseType: 'text' },
    );
    content = res.data;
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const res = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    const result = await mammoth.extractRawText({ buffer: Buffer.from(res.data) });
    content = result.value;
  } else {
    const res = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'text' },
    );
    content = res.data;
  }

  // Persist to cache
  db.topics.upsert({
    number:           topicNumber,
    drive_file_id:    driveFileId,
    content_cache:    content,
    cache_updated_at: new Date().toISOString(),
  });

  return content;
}
