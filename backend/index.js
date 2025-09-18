// index.js
'use strict';

/**
 * Robust Express backend for kosh:
 * - CORS whitelist + preflight handling
 * - Firebase Admin (optional / fallback)
 * - Routes: /register, /login (dev fallback), /entries (GET), /saveEntry (POST), /cleanup (POST)
 *
 * Usage:
 *  - Install deps: npm i express body-parser firebase-admin bcryptjs
 *  - Set GOOGLE_APPLICATION_CREDENTIALS env or run on Cloud Run in same project (admin.initializeApp())
 *  - Deploy to Cloud Run
 */

const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const SCRAPE_API_TOKEN = process.env.SCRAPE_API_TOKEN || null;
const app = express();
app.use(bodyParser.json({ limit: '2mb' }));


// --- ensure both /entries and /api/entries (etc.) work for legacy & new clients ---
// convenience aliases so both /entries and /api/entries (and cleanup/saveEntry) work
app.get('/entries', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/entries' }), res, next));


app.post('/cleanup', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/cleanup' }), res, next));


app.post('/saveEntry', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/saveEntry' }), res, next));


// optional: keep scrapes mapping too if you expect /scrapes <-> /api/scrapes
app.post('/scrapes', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/scrapes' }), res, next));

// -------------------- CORS --------------------
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
    // server-to-server or curl: permit
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }
  if (WHITELIST.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // allow cookies if needed
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

// -------------------- Firebase Admin init (safe) --------------------
let db = null;
try {
  admin.initializeApp(); // uses default credentials on Cloud Run if available
  db = admin.firestore();
  console.log('✅ Firebase Admin initialized (default credentials)');
} catch (err) {
  console.warn('⚠️ Firebase Admin initialize failed or not available:', err && err.message ? err.message : err);
  db = null;
}

// Helper: verify Firebase ID token middleware
async function verifyIdTokenFromHeader(req, res, next) {
  const hdr = req.headers.authorization || '';
  const match = hdr.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  // Allow SCRAPE_API_TOKEN as a valid "service" credential for dev/dev-dashboard
  if (token && SCRAPE_API_TOKEN && token === SCRAPE_API_TOKEN) {
    // create synthetic auth info so handlers can use req.__auth
    req.__auth = { uid: 'service-scrape-token', email: 'service@kosh.local', service: true };
    return next();
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing Authorization token' });
  }
  try {
    if (!admin.auth) throw new Error('admin.auth not available');
    const decoded = await admin.auth().verifyIdToken(token);
    req.__auth = decoded;
    return next();
  } catch (err) {
    console.warn('verifyIdToken failed:', err && err.message ? err.message : err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Safe wrapper
function safe(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Unhandled handler error:', err && err.stack ? err.stack : err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
    });
  };
}

// -------------------- Health --------------------
app.get('/_health', (req, res) => res.json({ ok: true }));
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// -------------------- REGISTER (dev-friendly) --------------------
app.post('/register', safe(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing email/password' });

  // DEV fallback: if firestore not available, return success w/out persisting
  if (!db || process.env.DEV_NO_FIRESTORE === '1') {
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

  // Try to mint custom token (optional)
  let token = null;
  try {
    const uid = email.replace(/[@.+]/g, '_').slice(0, 120);
    token = await admin.auth().createCustomToken(uid, { email, name: name || '' });
  } catch (e) {
    console.warn('createCustomToken failed:', e && e.message ? e.message : e);
  }

  return res.json({ success: true, user: { email, name: name || '' }, token });
}));

// -------------------- LOGIN (dev fallback only; prefer Firebase Auth in prod) --------------------
app.post('/login', safe(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing email/password' });

  if (!db || process.env.DEV_NO_FIRESTORE === '1') {
    console.log('📁 Dev fallback login for:', email);
    return res.json({ success: true, user: { email, name: email.split('@')[0] }, token: null });
  }

  const docRef = db.collection('users').doc(email.toLowerCase());
  const doc = await docRef.get();
  if (!doc.exists) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  const user = doc.data();
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  let token = null;
  try {
    const uid = email.replace(/[@.+]/g, '_').slice(0, 120);
    token = await admin.auth().createCustomToken(uid, { email: user.email, name: user.name || '' });
  } catch (tErr) {
    console.warn('createCustomToken failed:', tErr && tErr.message ? tErr.message : tErr);
  }

  return res.json({ success: true, user: { email: user.email, name: user.name || '' }, token });
}));

// -------------------- Save entry (protected) --------------------
app.post('/saveEntry', safe(verifyIdTokenFromHeader, async (req, res) => {
  const { entry, userId } = req.body || {};
  const caller = req.__auth;
  if (!entry) return res.status(400).json({ success: false, message: 'Missing entry' });

  // Validate userId matches token subject/email (best-effort)
  // If caller.uid exists, prefer that; if token carries email, compare email
  // We'll still store userId provided, but you can enforce stricter checks if wanted.
  try {
    if (!db) {
      console.warn('Firestore not available; saveEntry skipped.');
      return res.json({ success: true, message: 'dev-saved' });
    }
    const payload = {
      ...entry,
      userId: userId || (caller && caller.uid) || null,
      timestamp: Date.now()
    };
    await db.collection('approvedEntries').add(payload);
    return res.json({ success: true });
  } catch (err) {
    console.error('saveEntry error', err);
    return res.status(500).json({ success: false, message: 'save failed' });
  }
}));

// -------------------- Get entries (protected) --------------------
app.get('/entries', safe(verifyIdTokenFromHeader, async (req, res) => {
  try {
    if (!db) return res.json({ success: true, entries: [] });

    // Determine user identifier from token (use email or uid)
    const uid = req.__auth.uid || null;
    const email = req.__auth.email || null;
    // Query by userId saved in documents (we expect saved userId to be uid or email)
    // Try both: first uid then email
    let entries = [];
    if (uid) {
      const snap = await db.collection('approvedEntries').where('userId', '==', uid).get();
      snap.forEach(d => entries.push(d.data()));
    }
    if (entries.length === 0 && email) {
      const snap2 = await db.collection('approvedEntries').where('userId', '==', email).get();
      snap2.forEach(d => entries.push(d.data()));
    }
    // As a last resort, fetch none (don't leak)
    return res.json({ success: true, entries });
  } catch (err) {
    console.error('/entries error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}));

// -------------------- Cleanup old data (protected) --------------------
app.post('/cleanup', safe(verifyIdTokenFromHeader, async (req, res) => {
  try {
    if (!db) return res.json({ success: true, deletedCount: 0 });

    const retentionDays = Number(req.body.retentionDays || process.env.DEFAULT_RETENTION_DAYS || 30);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const uid = req.__auth.uid || req.__auth.email || null;
    if (!uid) return res.status(400).json({ success: false, message: 'No user in token' });

    const snap = await db.collection('approvedEntries').where('userId', '==', uid).get();
    const batch = db.batch();
    let deleted = 0;
    snap.forEach(doc => {
      const data = doc.data();
      let ts = data.timestamp || data.processTime || data.time || null;
      let tsMs = null;
      if (typeof ts === 'number') tsMs = ts;
      else if (typeof ts === 'string' && /^\d+$/.test(ts)) {
        tsMs = ts.length === 10 ? parseInt(ts) * 1000 : parseInt(ts);
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
    console.error('/cleanup error', err);
    return res.status(500).json({ success: false, message: 'cleanup failed' });
  }
}));

// -------------------- Receive scrapes from extension --------------------
app.post('/api/scrapes', safe(async (req, res) => {
  // Simple token-based auth: if SCRAPE_API_TOKEN env var is set, require it.
  const expectedToken = process.env.SCRAPE_API_TOKEN || '';
  if (expectedToken) {
    const authHeader = (req.get('authorization') || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1] : null;
    if (!token || token !== expectedToken) {
      console.warn('Unauthorized attempt to /api/scrapes from', req.ip, 'auth:', !!token);
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  } // else: no token required (dev mode)

  const payload = req.body || {};
  if (!payload.fetchedAt || typeof payload.result === 'undefined') {
    return res.status(400).json({ ok: false, error: 'Invalid payload: missing fetchedAt/result' });
  }

  // Prevent huge payloads
  const size = JSON.stringify(payload).length;
  if (size > 300000) { // ~300KB limit
    return res.status(413).json({ ok: false, error: 'Payload too large' });
  }

  try {
    console.log('[api/scrapes] incoming scrape', { fetchedAt: payload.fetchedAt, rowCount: payload.result && payload.result.rowCount });

    // If Firestore is available, write to scrapes collection and update meta/latestScrape
    let docId = null;
    if (db) {
      const ref = db.collection('scrapes').doc();
      await ref.set({
        payload,
        receivedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      docId = ref.id;

      // update latest meta for UI convenience
      await db.collection('meta').doc('latestScrape').set({
        lastId: docId,
        fetchedAt: payload.fetchedAt,
        rowCount: payload.result && payload.result.rowCount || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      // no Firestore: just log
      console.log('[api/scrapes] firestore not available — logged only');
    }

    return res.json({ ok: true, id: docId });
  } catch (err) {
    console.error('Error saving scrape', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'save_failed' });
  }
}));
// -------------------- Scrapes endpoint for extension --------------------
// -------------------- Receive scrapes from extension --------------------
app.post('/api/scrapes', safe(async (req, res) => {
  // Token-based auth if SCRAPE_API_TOKEN is set
  const expectedToken = process.env.SCRAPE_API_TOKEN || '';
  if (expectedToken) {
    const auth = (req.get('authorization') || '');
    const match = auth.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1] : null;
    if (!token || token !== expectedToken) {
      console.warn('Unauthorized /api/scrapes attempt from', req.ip);
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const payload = req.body || {};
  if (!payload.fetchedAt || typeof payload.result === 'undefined') {
    return res.status(400).json({ ok: false, error: 'Invalid payload: missing fetchedAt or result' });
  }

  // Protect against huge payloads
  const size = JSON.stringify(payload).length;
  if (size > 300000) {
    return res.status(413).json({ ok: false, error: 'Payload too large' });
  }

  try {
    console.log('[api/scrapes] incoming scrape', { fetchedAt: payload.fetchedAt, rowCount: payload.result.rowCount || 0 });

    // If Firestore is available, persist; otherwise just log
    let docId = null;
    if (db) {
      const ref = db.collection('scrapes').doc();
      await ref.set({
        payload,
        receivedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      docId = ref.id;

      // Update latest meta doc for dashboard convenience
      await db.collection('meta').doc('latestScrape').set({
        lastId: docId,
        fetchedAt: payload.fetchedAt,
        rowCount: payload.result.rowCount || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.json({ ok: true, id: docId });
  } catch (err) {
    console.error('Error saving scrape', err);
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

// -------------------- Start --------------------
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});