'use strict';

/**
 * Fixed KOSH backend (Express)
 * - Single canonical handlers for each route (no app._router.handle rewriting)
 * - Accepts both legacy and /api/* prefixed routes via arrays (no recursion)
 * - Protected endpoints accept Firebase ID token (Bearer) OR SCRAPE_API_TOKEN service token
 * - Dev-friendly fallbacks when Firestore (admin) isn't initialized
 *
 * Paste this file as-is into backend/index.js (replaces the broken file).
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
 * verifyIdTokenFromHeader middleware:
 * - Checks Authorization: Bearer <token>
 * - If token equals SCRAPE_API_TOKEN, allow as service
 * - Otherwise verifies via Firebase Admin SDK
 */
async function verifyIdTokenFromHeader(req, res, next) {
  const hdr = req.headers.authorization || '';
  const match = hdr.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  // Allow SCRAPE_API_TOKEN as a service credential (dev)
  if (token && SCRAPE_API_TOKEN && token === SCRAPE_API_TOKEN) {
    req.__auth = { uid: 'service-scrape-token', email: 'service@kosh.local', service: true };
    return next();
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing Authorization token' });
  }

  // If Admin SDK not initialized, refuse (avoid silently accepting invalid tokens)
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
}

// -------------------- Health --------------------
app.get('/_health', (req, res) => res.json({ ok: true }));
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// -------------------- Register (dev-friendly) --------------------
app.post(['/register', '/api/register'], safe(async (req, res) => {
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
app.post(['/login', '/api/login'], safe(async (req, res) => {
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
app.get(['/entries', '/api/entries'], verifyIdTokenFromHeader, safe(async (req, res) => {
  try {
    if (!db) return res.json({ success: true, entries: [] });

    const uid = req.__auth && req.__auth.uid ? req.__auth.uid : null;
    const email = req.__auth && req.__auth.email ? req.__auth.email : null;

    let entries = [];
    if (uid) {
      const snap = await db.collection('approvedEntries').where('userId', '==', uid).get();
      snap.forEach(d => entries.push(d.data()));
    }

    if (entries.length === 0 && email) {
      const snap2 = await db.collection('approvedEntries').where('userId', '==', email).get();
      snap2.forEach(d => entries.push(d.data()));
    }

    return res.json({ success: true, entries });
  } catch (err) {
    console.error('/entries error', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}));

// -------------------- Save Entry (protected) --------------------
app.post(['/saveEntry', '/api/saveEntry'], verifyIdTokenFromHeader, safe(async (req, res) => {
  try {
    const { entry, userId } = req.body || {};
    if (!entry) return res.status(400).json({ success: false, message: 'Missing entry' });

    // Dev fallback: if no Firestore, pretend to save
    if (!db) {
      console.warn('Firestore not available; saveEntry skipped (dev).');
      return res.json({ success: true, message: 'dev-saved' });
    }

    const caller = req.__auth || {};
    const payload = {
      ...entry,
      userId: userId || caller.uid || caller.email || null,
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
app.post(['/cleanup', '/api/cleanup'], verifyIdTokenFromHeader, safe(async (req, res) => {
  try {
    if (!db) return res.json({ success: true, deletedCount: 0 });

    const retentionDays = Number(req.body.retentionDays || DEFAULT_RETENTION_DAYS);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const uid = req.__auth && (req.__auth.uid || req.__auth.email) ? (req.__auth.uid || req.__auth.email) : null;
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

// -------------------- Scrapes (optional token) --------------------
app.post(['/scrapes', '/api/scrapes'], safe(async (req, res) => {
  try {
    const expectedToken = process.env.SCRAPE_API_TOKEN || '';
    if (expectedToken) {
      const authHeader = (req.get('authorization') || '');
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const token = match ? match[1] : null;
      if (!token || token !== expectedToken) {
        console.warn('Unauthorized attempt to /api/scrapes from', req.ip, 'auth:', !!token);
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
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

    const ref = db.collection('scrapes').doc();
    await ref.set({ payload, receivedAt: admin.firestore.FieldValue.serverTimestamp() });

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
