const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bcrypt = require('bcryptjs');

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [
  'https://nimble-falcon-38ada.web.app',
  'http://localhost:5000'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS not allowed'), false);
  },
  credentials: true
}));

app.get('/ping', (req, res) => res.json({ ok: true }));

app.post('/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ success:false, message:'Missing fields' });
  try {
    const ref = db.collection('users').doc(email);
    const doc = await ref.get();
    if (doc.exists) return res.status(409).json({ success:false, message:'User exists' });
    const hash = await bcrypt.hash(password, 10);
    await ref.set({ email, passwordHash: hash, name: name||email.split('@')[0], createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ success:true, user:{ email, name: name||email.split('@')[0] } });
  } catch (e) { console.error(e); return res.status(500).json({ success:false, message:'Server error' }); }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success:false, message:'Missing fields' });
  try {
    const ref = db.collection('users').doc(email);
    const doc = await ref.get();
    if (!doc.exists) return res.status(401).json({ success:false, message:'Invalid credentials' });
    const user = doc.data();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.status(401).json({ success:false, message:'Invalid credentials' });
    return res.json({ success:true, user:{ email:user.email, name:user.name || '' } });
  } catch (e) { console.error(e); return res.status(500).json({ success:false, message:'Server error' }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log('Listening on', PORT));