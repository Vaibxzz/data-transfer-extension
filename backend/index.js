// index.js
'use strict';

/**
 * KOSH backend (Express)
 * - Supports both /entries and /api/entries (and other legacy + new routes)
 * - Auth via Firebase ID token or SCRAPE_API_TOKEN
 * - Dev-friendly: falls back when Firestore not available
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }
  if (WHITELIST.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.header('access-control-request-headers') || 'Content-Type, Authorization'
    );
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'
    );
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }
  console.warn('[CORS] blocked origin:', origin, req.method, req.url);
  return res.status(403).send('CORS not allowed');
});

// -------------------- Logging --------------------
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.url} origin:${
      req.headers.origin || '-'
    } ip:${req.ip}`
  );
  next();
});

// -------------------- Firebase Admin init --------------------
let db = null;
try {
  admin.initializeApp();
  db = admin.firestore();
  console.log('✅ Firebase Admin initialized (Firestore available)');
} catch (err) {
  console.warn('⚠️ Firebase Admin init failed:', err.message || err);
  db = null;
}

// -------------------- Helpers --------------------
function safe(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error('Handler error:', err);
      if (!res.headersSent)
        res.status(500).json({ success: false, message: 'Server error' });
    });
  };
}

async function verifyIdTokenFromHeader(req, res, next) {
  const hdr = req.headers.authorization || '';
  const match = hdr.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  // Allow SCRAPE_API_TOKEN
  if (token && SCRAPE_API_TOKEN && token === SCRAPE_API_TOKEN) {
    req.__auth = {
      uid: 'service-scrape-token',
      email: 'service@kosh.local',
      service: true,
    };
    return next();
  }

  if (!token)
    return res
      .status(401)
      .json({ success: false, message: 'Missing Authorization token' });

  if (!admin || !admin.auth) {
    return res
      .status(500)
      .json({ success: false, message: 'Auth service unavailable' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.__auth = decoded;
    return next();
  } catch (err) {
    console.warn('verifyIdToken failed:', err.message || err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// -------------------- Health --------------------
app.get('/_health', (req, res) => res.json({ ok: true }));
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// -------------------- Register --------------------
app.post(
  '/register',
  safe(async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Missing email/password' });

    if (!db) {
      return res.json({
        success: true,
        user: { email, name: name || email.split('@')[0] },
        token: null,
      });
    }

    const docRef = db.collection('users').doc(email.toLowerCase());
    const doc = await docRef.get();
    if (doc.exists)
      return res.status(409).json({ success: false, message: 'User exists' });

    const hash = await bcrypt.hash(password, 10);
    await docRef.set({
      email,
      name: name || email.split('@')[0],
      passwordHash: hash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, user: { email, name }, token: null });
  })
);

// -------------------- Login --------------------
app.post(
  '/login',
  safe(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Missing email/password' });

    if (!db) {
      return res.json({
        success: true,
        user: { email, name: email.split('@')[0] },
        token: null,
      });
    }

    const docRef = db.collection('users').doc(email.toLowerCase());
    const doc = await docRef.get();
    if (!doc.exists)
      return res
        .status(401)
        .json({ success: false, message: 'Invalid credentials' });

    const user = doc.data();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok)
      return res
        .status(401)
        .json({ success: false, message: 'Invalid credentials' });

    return res.json({
      success: true,
      user: { email: user.email, name: user.name },
      token: null,
    });
  })
);

// -------------------- Entries --------------------
app.get(['/entries', '/api/entries'], verifyIdTokenFromHeader, safe(async (req, res) => {
  if (!db) return res.json({ success: true, entries: [] });

  const uid = req.__auth?.uid || null;
  const email = req.__auth?.email || null;

  let entries = [];
  if (uid) {
    const snap = await db
      .collection('approvedEntries')
      .where('userId', '==', uid)
      .get();
    snap.forEach((d) => entries.push(d.data()));
  }

  if (entries.length === 0 && email) {
    const snap2 = await db
      .collection('approvedEntries')
      .where('userId', '==', email)
      .get();
    snap2.forEach((d) => entries.push(d.data()));
  }

  return res.json({ success: true, entries });
}));

// -------------------- Save Entry --------------------
app.post(['/saveEntry', '/api/saveEntry'], verifyIdTokenFromHeader, safe(async (req, res) => {
  const { entry, userId } = req.body || {};
  if (!entry)
    return res.status(400).json({ success: false, message: 'Missing entry' });

  if (!db) {
    return res.json({ success: true, message: 'dev-saved' });
  }

  const caller = req.__auth || {};
  const payload = {
    ...entry,
    userId: userId || caller.uid || caller.email || null,
    timestamp: Date.now(),
  };

  await db.collection('approvedEntries').add(payload);
  return res.json({ success: true });
}));

// -------------------- Cleanup --------------------
app.post(['/cleanup', '/api/cleanup'], verifyIdTokenFromHeader, safe(async (req, res) => {
  if (!db) return res.json({ success: true, deletedCount: 0 });

  const retentionDays = Number(req.body.retentionDays || DEFAULT_RETENTION_DAYS);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const uid = req.__auth?.uid || req.__auth?.email || null;
  if (!uid)
    return res
      .status(400)
      .json({ success: false, message: 'No user in token' });

  const snap = await db.collection('approvedEntries').where('userId', '==', uid).get();
  const batch = db.batch();
  let deleted = 0;

  snap.forEach((doc) => {
    const data = doc.data();
    const ts = data.timestamp || data.processTime || data.time || null;
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
}));

// -------------------- Scrapes --------------------
app.post('/api/scrapes', safe(async (req, res) => {
  const expectedToken = process.env.SCRAPE_API_TOKEN || '';
  if (expectedToken) {
    const authHeader = req.get('authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1] : null;
    if (!token || token !== expectedToken) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const payload = req.body || {};
  if (!payload.fetchedAt)
    return res.status(400).json({ ok: false, error: 'Invalid payload' });

  if (!db) return res.json({ ok: true, id: null });

  const ref = db.collection('scrapes').doc();
  await ref.set({
    payload,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.json({ ok: true, id: ref.id });
}));

// -------------------- Fallback --------------------
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// -------------------- Error middleware --------------------
app.use((err, req, res, next) => {
  console.error('Error middleware:', err);
  if (!res.headersSent)
    res.status(500).json({ success: false, message: 'Server error' });
});

// -------------------- Start --------------------
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Backend listening on port ${port}`));
