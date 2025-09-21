// index.js
'use strict';

/**
 * KOSH backend (Express)
 * - Routes available under both /entries and /api/entries (legacy + new)
 * - Protected endpoints require Firebase ID token (Bearer) OR SCRAPE_API_TOKEN service token
 * - Dev-friendly fallbacks when Firestore (admin) isn't initialized
 *
 * Paste this file as-is into backend/index.js
 */

const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');

const SCRAPE_API_TOKEN = process.env.SCRAPE_API_TOKEN || null;
const DEFAULT_RETENTION_DAYS = Number(process.env.DEFAULT_RETENTION_DAYS || 30);

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));

// -------------------- CORS / WHITELIST --------------------
const WHITELIST = new Set([
  'https://kosh-frontend.pages.dev',
  'https://nimble-falcon-38ada.web.app',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:8080',
  'https://data-transfer-extension.pages.dev',
  'http://127.0.0.1:5500'
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    // server-to-server or curl -> allow
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }
  if (WHITELIST.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', req.header('access-control-request-headers') || 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }
  console.warn('[CORS] blocked origin:', origin, req.method, req.url);
  return res.status(403).send('CORS not allowed');
});

// -------------------- Logging --------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} origin:${req.headers.origin || '-'} ip:${req.ip}`);
  next();
});

// -------------------- Firebase Admin init --------------------
let db = null;
try {
  // initializeApp() will use service account if available on Cloud Run
  admin.initializeApp();
  db = admin.firestore();
  console.log('✅ Firebase Admin initialized (Firestore available)');
} catch (err) {
  console.warn('⚠️ Firebase Admin init failed or not available:', err && err.message ? err.message : err);
  db = null;
}

// -------------------- Helpers --------------------
function safe(handler) {
  // Wrap handlers to catch async errors
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Unhandled handler error:', err && err.stack ? err.stack : err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
    });
  };
}

/**
 * Middleware: resolveAuth
 * Accepts either:
 *  - Authorization: Bearer <SCRAPE_API_TOKEN>  (legacy service token)
 *  - Authorization: Bearer <Firebase ID token>
 *
 * For SCRAPE_API_TOKEN the request will be allowed and req.__auth set to a service identity.
 * For Firebase token we verify with admin.auth().verifyIdToken and set req.__auth to decoded token.
 *
 * If no token present, we do NOT automatically fail here — leave endpoints to decide if auth required.
 */
async function resolveAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const match = hdr.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1] : null;

    if (!token) {
      req.__auth = null;
      return next();
    }

    // legacy service token
    if (SCRAPE_API_TOKEN && token === SCRAPE_API_TOKEN) {
      req.__auth = { uid: 'service-scrape-token', email: 'service@kosh.local', service: true };
      return next();
    }

    // If admin auth is unavailable, fail early
    if (!admin || !admin.auth) {
      console.warn('Firebase admin.auth unavailable while verifying token.');
      return res.status(500).json({ success: false, message: 'Auth service unavailable' });
    }

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.__auth = decoded;
      return next();
    } catch (err) {
      console.warn('verifyIdToken failed:', err && err.message ? err.message : err);
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  } catch (err) {
    console.error('resolveAuth middleware error', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Auth error' });
  }
}

/**
 * requireAuth middleware
 * Ensures req.__auth is present (call resolveAuth first)
 */
function requireAuth(req, res, next) {
  if (!req.__auth) return res.status(401).json({ success: false, message: 'Unauthorized' });
  return next();
}

/**
 * Helper: getOwnerUidFromReq
 * Returns a stable owner identifier for DB records:
 *  - For Firebase user tokens: uses decoded.uid
 *  - For legacy service token: 'service-scrape-token'
 */
function getOwnerUidFromReq(req) {
  if (!req || !req.__auth) return null;
  // prefer uid, fallback to email
  return req.__auth.uid || req.__auth.email || null;
}

// -------------------- Legacy alias support (keeps compatibility) --------------------
// We provide a small set of aliases but avoid complex app._router.handle rewrites that can loop.
app.get('/entries', (req, res) => res.redirect(307, '/api/entries'));
app.post('/saveEntry', (req, res) => res.redirect(307, '/api/saveEntry'));
app.post('/cleanup', (req, res) => res.redirect(307, '/api/cleanup'));
app.post('/scrapes', (req, res) => res.redirect(307, '/api/scrapes'));

// -------------------- Health --------------------
app.get('/_health', (req, res) => res.json({ ok: true }));
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// -------------------- Register (dev-friendly) --------------------
app.post('/register', resolveAuth, safe(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing email/password' });

  // Dev fallback: if no Firestore, return success without persisting
  if (!db) {
    console.log('📁 Dev fallback register for:', email);
    return res.json({ success: true, user: { email, name: name || email.split('@')[0] }, token: null });
  }

  const docRef = db.collection('users').doc(email.toLowerCase());
  const doc = await docRef.get();
  if (doc.exists) return res.status(409).json({ success: false, message: 'User exists' });

  const hash = await bcrypt.hash(password, 10);
  await docRef.set({
    email,
    name: name || email.split('@')[0],
    passwordHash: hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Optionally mint a custom token (best-effort)
  let token = null;
  try {
    const uid = email.replace(/[@.+]/g, '_').slice(0, 120);
    token = await admin.auth().createCustomToken(uid, { email, name: name || '' });
  } catch (e) {
    console.warn('createCustomToken failed (non-fatal):', e && e.message ? e.message : e);
  }

  return res.json({ success: true, user: { email, name: name || '' }, token });
}));

// -------------------- Login (dev-friendly) --------------------
app.post('/login', resolveAuth, safe(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing email/password' });

  if (!db) {
    console.log('📁 Dev fallback login for:', email);
    return res.json({ success: true, user: { email, name: email.split('@')[0] }, token: null });
  }

  const docRef = db.collection('users').doc(email.toLowerCase());
  const doc = await docRef.get();
  if (!doc.exists) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  const user = doc.data();
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  // Optionally mint custom token (non-fatal)
  let token = null;
  try {
    const uid = email.replace(/[@.+]/g, '_').slice(0, 120);
    token = await admin.auth().createCustomToken(uid, { email: user.email, name: user.name || '' });
  } catch (tErr) {
    console.warn('createCustomToken failed (non-fatal):', tErr && tErr.message ? tErr.message : tErr);
  }

  return res.json({ success: true, user: { email: user.email, name: user.name || '' }, token });
}));

// -------------------- Entries (protected) --------------------
// GET /api/entries?profileId=...
app.get('/api/entries', resolveAuth, requireAuth, safe(async (req, res) => {
  try {
    if (!db) return res.json({ success: true, entries: [] });

    const ownerUid = getOwnerUidFromReq(req);
    if (!ownerUid) return res.status(401).json({ success: false, message: 'No user' });

    const profileId = (req.query && req.query.profileId) ? String(req.query.profileId) : null;

    let q = db.collection('approvedEntries').where('ownerUid', '==', ownerUid);
    if (profileId) q = q.where('profileId', '==', profileId);

    const snap = await q.get();
    const entries = [];
    snap.forEach(d => entries.push(d.data()));

    return res.json({ success: true, entries });
  } catch (err) {
    console.error('/entries error', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}));

// -------------------- Save Entry (protected) --------------------
// Accepts { entry, userId(optional), profileId(optional) }
app.post('/api/saveEntry', resolveAuth, requireAuth, safe(async (req, res) => {
  try {
    const { entry, userId, profileId } = req.body || {};
    if (!entry) return res.status(400).json({ success: false, message: 'Missing entry' });

    // Dev fallback: if no Firestore, pretend to save
    if (!db) {
      console.warn('Firestore not available; saveEntry skipped (dev).');
      return res.json({ success: true, message: 'dev-saved' });
    }

    const ownerUid = getOwnerUidFromReq(req);
    const payload = {
      ...entry,
      userId: userId || ownerUid || null,
      ownerUid,
      profileId: profileId || null,
      timestamp: Date.now()
    };

    await db.collection('approvedEntries').add(payload);
    return res.json({ success: true });
  } catch (err) {
    console.error('saveEntry error', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'save failed' });
  }
}));

// -------------------- Cleanup (protected) --------------------
// POST /api/cleanup
app.post('/api/cleanup', resolveAuth, requireAuth, safe(async (req, res) => {
  try {
    if (!db) return res.json({ success: true, deletedCount: 0 });

    const retentionDays = Number(req.body.retentionDays || DEFAULT_RETENTION_DAYS);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const uid = getOwnerUidFromReq(req);
    if (!uid) return res.status(400).json({ success: false, message: 'No user in token' });

    const snap = await db.collection('approvedEntries').where('ownerUid', '==', uid).get();
    const batch = db.batch();
    let deleted = 0;

    snap.forEach(doc => {
      const data = doc.data();
      let ts = data.timestamp || data.processTime || data.time || null;
      let tsMs = null;
      if (typeof ts === 'number') tsMs = ts;
      else if (typeof ts === 'string' && /^\d+$/.test(ts)) {
        tsMs = ts.length === 10 ? parseInt(ts, 10) * 1000 : parseInt(ts, 10);
      } else if (typeof ts === 'string') {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) tsMs = d.getTime();
      }
      if (tsMs !== null && tsMs < cutoff) {
        batch.delete(doc.ref);
        deleted++;
      }
    });

    if (deleted > 0) await batch.commit();
    return res.json({ success: true, deletedCount: deleted });
  } catch (err) {
    console.error('/cleanup error', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'cleanup failed' });
  }
}));

// -------------------- Scrapes (accepts per-user or service token) --------------------
// POST /api/scrapes
// Body: { profileId?: string, fetchedAt: string|number, result: any }
app.post('/api/scrapes', resolveAuth, safe(async (req, res) => {
  try {
    // If SCRAPE_API_TOKEN is set and used, resolveAuth would have set req.__auth to service identity.
    // If token was a Firebase ID token, req.__auth will be decoded token.
    if (!req.__auth) {
      // No auth at all -> unauthorized
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const payload = req.body || {};
    if (!payload.fetchedAt || typeof payload.result === 'undefined') {
      return res.status(400).json({ ok: false, error: 'Invalid payload: missing fetchedAt/result' });
    }

    // Protect against huge payloads
    const size = JSON.stringify(payload).length;
    if (size > 300000) return res.status(413).json({ ok: false, error: 'Payload too large' });

    if (!db) {
      console.log('[api/scrapes] firestore not available — logged only');
      return res.json({ ok: true, id: null });
    }

    const ownerUid = getOwnerUidFromReq(req) || null;
    const profileId = payload.profileId ? String(payload.profileId) : null;

    const ref = db.collection('scrapes').doc();
    await ref.set({
      payload,
      ownerUid,
      profileId,
      receivedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // update meta/latestScrape (optional)
    try {
      await db.collection('meta').doc('latestScrape').set({
        lastId: ref.id,
        fetchedAt: payload.fetchedAt,
        rowCount: payload.result && payload.result.rowCount || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('latestScrape update failed (non-fatal):', e && e.message ? e.message : e);
    }

    return res.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('/api/scrapes error', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'save_failed' });
  }
}));

// -------------------- Fallback / 404 --------------------
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// -------------------- Error middleware --------------------
app.use((err, req, res, next) => {
  console.error('Error middleware caught:', err && err.stack ? err.stack : err);
  if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
});

// -------------------- Start server --------------------
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
