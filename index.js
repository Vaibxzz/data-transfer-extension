// backend/index.js — Kosh backend (Express + Firestore Admin + bcrypt + CORS)
const express = require('express');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

try {
  admin.initializeApp();
} catch (e) {
  console.warn('firebase-admin initializeApp warning:', e && e.message);
}
const db = admin.firestore();

const app = express();
app.use(express.json());

const WHITELIST = [
  'https://kosh-frontend.pages.dev',
  'https://nimble-falcon-38ada.web.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5000'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
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

function makeUidFromEmail(email) {
  if (!email) return '';
  return email.replace(/[@.+]/g, '_').slice(0, 120);
}

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
      name: name || (email.split('@')[0]),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // create firebase custom token
    const uid = makeUidFromEmail(email);
    const additionalClaims = { email, name: name || (email.split('@')[0]) };
    const token = await admin.auth().createCustomToken(uid, additionalClaims);

    return res.json({ success: true, user: { email, name: name || (email.split('@')[0]) }, token });
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

    const uid = makeUidFromEmail(email);
    const additionalClaims = { email: user.email, name: user.name || '' };
    const token = await admin.auth().createCustomToken(uid, additionalClaims);

    return res.json({ success: true, user: { email: user.email, name: user.name || '' }, token });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Kosh backend listening on ${PORT}`));