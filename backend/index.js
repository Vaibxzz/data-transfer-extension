// index.js
'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const SCRAPE_API_TOKEN = process.env.SCRAPE_API_TOKEN || null;
const app = express();
app.use(bodyParser.json({ limit: '2mb' }));

// -------------------- Aliases for legacy clients --------------------
app.get('/entries', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/entries' }), res, next));
app.post('/saveEntry', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/saveEntry' }), res, next));
app.post('/cleanup', (req, res, next) => app._router.handle(Object.assign(req, { url: '/api/cleanup' }), res, next));
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
  return res.status(403).send('CORS not allowed');
});

// -------------------- Logging --------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} origin:${req.headers.origin || '-'} ip:${req.ip}`);
  next();
});

// -------------------- Firebase Admin --------------------
let db = null;
try {
  admin.initializeApp();
  db = admin.firestore();
  console.log('✅ Firebase Admin initialized');
} catch (err) {
  console.warn('⚠️ Firebase Admin init failed:', err.message || err);
  db = null;
}

// -------------------- Auth helpers --------------------
async function verifyIdTokenFromHeader(req, res, next) {
  const hdr = req.headers.authorization || '';
  const match = hdr.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  if (token && SCRAPE_API_TOKEN && token === SCRAPE_API_TOKEN) {
    req.__auth = { uid: 'service-token', email: 'service@kosh.local', service: true };
    return next();
  }

  if (!token) return res.status(401).json({ success: false, message: 'Missing Authorization token' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.__auth = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

function safe(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Handler error:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
    });
  };
}

// -------------------- Health --------------------
app.get('/_health', (req, res) => res.json({ ok: true }));

// -------------------- Register --------------------
app.post('/register', safe(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing email/password' });
  if (!db) return res.json({ success: true, user: { email, name: name || email.split('@')[0] }, token: null });

  const docRef = db.collection('users').doc(email.toLowerCase());
  const doc = await docRef.get();
  if (doc.exists) return res.status(409).json({ success: false, message: 'User exists' });

  const hash = await bcrypt.hash(password, 10);
  await docRef.set({ email, name, passwordHash: hash, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  return res.json({ success: true, user: { email, name }, token: null });
}));

// -------------------- Login --------------------
app.post('/login', safe(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing email/password' });
  if (!db) return res.json({ success: true, user: { email }, token: null });

  const docRef = db.collection('users').doc(email.toLowerCase());
  const doc = await docRef.get();
  if (!doc.exists) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  const user = doc.data();
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  return res.json({ success: true, user: { email: user.email, name: user.name }, token: null });
}));

// -------------------- Entries --------------------
app.get('/api/entries', safe(verifyIdTokenFromHeader, async (req, res) => {
  if (!db) return res.json({ success: true, entries: [] });
  const uid = req.__auth.uid || req.__auth.email;
  const snap = await db.collection('approvedEntries').where('userId', '==', uid).get();
  const entries = [];
  snap.forEach(d => entries.push(d.data()));
  return res.json({ success: true, entries });
}));

// -------------------- Save Entry --------------------
app.post('/api/saveEntry', safe(verifyIdTokenFromHeader, async (req, res) => {
  const { entry, userId } = req.body || {};
  if (!entry) return res.status(400).json({ success: false, message: 'Missing entry' });
  if (!db) return res.json({ success: true, message: 'dev-saved' });

  const payload = { ...entry, userId: userId || req.__auth.uid || null, timestamp: Date.now() };
  await db.collection('approvedEntries').add(payload);
  return res.json({ success: true });
}));

// -------------------- Cleanup --------------------
app.post('/api/cleanup', safe(verifyIdTokenFromHeader, async (req, res) => {
  if (!db) return res.json({ success: true, deletedCount: 0 });
  const retentionDays = Number(req.body.retentionDays || 30);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const uid = req.__auth.uid || req.__auth.email;
  const snap = await db.collection('approvedEntries').where('userId', '==', uid).get();
  const batch = db.batch();
  let deleted = 0;
  snap.forEach(doc => {
    const data = doc.data();
    if (data.timestamp && data.timestamp < cutoff) {
      batch.delete(doc.ref);
      deleted++;
    }
  });
  if (deleted > 0) await batch.commit();
  return res.json({ success: true, deletedCount: deleted });
}));

// -------------------- Scrapes --------------------
app.post('/api/scrapes', safe(async (req, res) => {
  const expected = process.env.SCRAPE_API_TOKEN || '';
  if (expected) {
    const hdr = req.get('authorization') || '';
    const token = (hdr.match(/^Bearer\s+(.+)$/i) || [])[1];
    if (!token || token !== expected) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const payload = req.body || {};
  if (!payload.fetchedAt) return res.status(400).json({ ok: false, error: 'Invalid payload' });
  if (!db) return res.json({ ok: true, id: null });
  const ref = db.collection('scrapes').doc();
  await ref.set({ payload, receivedAt: admin.firestore.FieldValue.serverTimestamp() });
  return res.json({ ok: true, id: ref.id });
}));

// -------------------- Fallback --------------------
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// -------------------- Error middleware --------------------
app.use((err, req, res, next) => {
  console.error('Error middleware:', err);
  if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
});

// -------------------- Start --------------------
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Backend listening on port ${port}`));
