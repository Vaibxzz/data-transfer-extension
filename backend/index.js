// index.js — Kosh backend (Express + Firestore Admin + bcrypt + CORS)
'use strict';

const express = require('express');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

// Initialize Firebase Admin SDK
try {
  // In Cloud Run this will use the default service account.
  admin.initializeApp();
} catch (e) {
  console.warn('firebase-admin initializeApp warning:', e && e.message);
}

const db = admin.firestore();
const app = express();
app.use(express.json());

// ---------- CORS ----------
const WHITELIST = [
  'https://kosh-frontend.pages.dev',    // Cloudflare Pages
  'https://nimble-falcon-38ada.web.app',// optional Firebase hosting
  'http://localhost:3000',              // local dev
  'http://127.0.0.1:5500',
  'http://localhost:5000'
];

// Small wrapper so we echo back origin when allowed (needed for credentials)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    // server-to-server or curl
    res.header('Access-Control-Allow-Origin', '*');
    return next();
  }
  if (WHITELIST.indexOf(origin) !== -1) {
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
  return res.status(403).send('CORS not allowed');
});

// -------- helpers --------
function makeUidFromEmail(email) {
  if (!email) return '';
  return email.replace(/[@.+]/g, '_').slice(0, 120);
}

// -------- routes --------
app.get('/_health', (req, res) => res.send('ok'));
app.get('/ping', (req, res) => res.json({ ok: true }));

app.post('/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  try {
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

    // create Firebase custom token so the frontend can sign in to Firebase Auth
    const uid = makeUidFromEmail(email);
    const additionalClaims = { email, name: name || email.split('@')[0] };
    const token = await admin.auth().createCustomToken(uid, additionalClaims);

    return res.json({
      success: true,
      user: { email, name: name || email.split('@')[0] },
      token
    });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  try {
    const ref = db.collection('users').doc(email);
    const doc = await ref.get();
    if (!doc.exists) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = doc.data();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // mint firebase custom token
    const uid = makeUidFromEmail(email);
    const additionalClaims = { email: user.email, name: user.name || '' };
    const token = await admin.auth().createCustomToken(uid, additionalClaims);

    return res.json({
      success: true,
      user: { email: user.email, name: user.name || '' },
      token
    });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// optional: accept firebase idToken to mint session cookie (not required here)
app.post('/sessionLogin', async (req, res) => {
  // placeholder if you want to exchange idToken for secure session cookie
  return res.status(501).json({ success: false, message: 'Not implemented' });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Kosh backend listening on ${PORT}`));