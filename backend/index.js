// backend/index.js
// Robust Express backend with Firebase Admin (defensive) + dev fallback + verbose logging

const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

// ---- CORS (whitelist) ----
const WHITELIST = [
  'https://kosh-frontend.pages.dev',
  'https://nimble-falcon-38ada.web.app',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:8080',
  'http://127.0.0.1:5500'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    // allow curl / server-to-server
    res.header('Access-Control-Allow-Origin', '*');
    return next();
  }
  if (WHITELIST.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', req.header('access-control-request-headers') || 'Content-Type, Authorization');
      return res.sendStatus(204);
    }
    return next();
  }
  // For debugging, show origin in server log and deny
  console.warn('[CORS] blocked origin:', origin, req.method, req.url);
  return res.status(403).send('CORS not allowed');
});

// Basic request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - origin:${req.headers.origin || '-'} ip:${req.ip}`);
  next();
});

// ---- Initialize Firebase Admin (safe) ----
let db = null;
try {
  // If running on Cloud Run inside the same GCP project, this works with default credentials.
  admin.initializeApp();
  db = admin.firestore();
  console.log('✅ Firebase Admin initialized (default credentials)');
} catch (e) {
  console.warn('⚠️ Firebase Admin initializeApp warning:', e && e.message ? e.message : e);
  // keep db null — we'll use dev fallback if requested
}

// Helper: safe route wrapper
function safe(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Unhandled handler error:', err && err.stack ? err.stack : err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
    });
  };
}

// Health / ping
app.get('/_health', (req, res) => res.json({ ok: true }));
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// REGISTER
app.post('/register', safe(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  // Dev-only: skip Firestore if explicitly requested
  if (process.env.DEV_NO_FIRESTORE === '1' || !db) {
    console.log('📁 Dev fallback register (no Firestore) for:', email);
    // Do not persist passwords in dev fallback
    return res.json({
      success: true,
      user: { email, name: name || email.split('@')[0] },
      token: null
    });
  }

  // Real Firestore flow
  const ref = db.collection('users').doc(email);
  const doc = await ref.get();
  if (doc.exists) return res.status(409).json({ success: false, message: 'User exists' });

  const hash = await bcrypt.hash(password, 10);
  await ref.set({
    email,
    passwordHash: hash,
    name: name || email.split('@')[0],
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Try to mint a custom token for frontend sign-in (may fail if admin.auth not configured)
  let token = null;
  try {
    const uid = email.replace(/[@.+]/g, '_').slice(0, 120);
    token = await admin.auth().createCustomToken(uid, { email, name: name || email.split('@')[0] });
  } catch (tErr) {
    console.warn('createCustomToken failed (dev ok):', tErr && tErr.message ? tErr.message : tErr);
  }

  return res.json({ success: true, user: { email, name: name || email.split('@')[0] }, token });
}));

// LOGIN
app.post('/login', safe(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  if (process.env.DEV_NO_FIRESTORE === '1' || !db) {
    console.log('📁 Dev fallback login (no Firestore) for:', email);
    return res.json({ success: true, user: { email, name: email.split('@')[0] }, token: null });
  }

  const ref = db.collection('users').doc(email);
  const doc = await ref.get();
  if (!doc.exists) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  const user = doc.data();
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  let token = null;
  try {
    const uid = email.replace(/[@.+]/g, '_').slice(0, 120);
    token = await admin.auth().createCustomToken(uid, { email: user.email, name: user.name || '' });
  } catch (tErr) {
    console.warn('createCustomToken failed (dev ok):', tErr && tErr.message ? tErr.message : tErr);
  }

  return res.json({ success: true, user: { email: user.email, name: user.name || '' }, token });
}));

// Default 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Error middleware
app.use((err, req, res, next) => {
  console.error('Error middleware caught:', err && err.stack ? err.stack : err);
  if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Backend listening on http://localhost:${port}`));