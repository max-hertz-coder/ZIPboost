const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

const APP_SECRET = process.env.APP_SECRET || 'CHANGE_ME_SECRET'; // задай через переменную окружения
const app = express();
const db = new sqlite3.Database(path.join(__dirname, 'zboost.db'));

// Инициализация БД
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_hash TEXT UNIQUE,
    password_hash TEXT,
    created_at TEXT
  )`);
});

app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: APP_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Раздаём статику (включая styles.css, иконки и т.п.)
app.use(express.static(__dirname));

const hashEmail = (email) =>
  crypto.createHmac('sha256', APP_SECRET).update(email.toLowerCase()).digest('hex');

// Корень → логин
app.get('/', (req, res) => res.redirect('/login'));

// Страницы
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));

// Регистрация
app.post('/register', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  if (!email || !password) return res.redirect('/register?error=1');

  const emailHash = hashEmail(email);
  db.get(`SELECT id FROM users WHERE email_hash = ?`, [emailHash], async (err, row) => {
    if (err) return res.redirect('/register?error=1');
    if (row) return res.redirect('/register?error=2');

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      db.run(
        `INSERT INTO users (email_hash, password_hash, created_at) VALUES (?, ?, ?)`,
        [emailHash, passwordHash, new Date().toISOString()],
        (e) => e ? res.redirect('/register?error=1') : res.redirect('/login')
      );
    } catch {
      res.redirect('/register?error=1');
    }
  });
});

// Вход
app.post('/login', (req, res) => {
  const { email = '', password = '' } = req.body || {};
  if (!email || !password) return res.redirect('/login?error=1');

  const emailHash = hashEmail(email);
  db.get(`SELECT id, password_hash FROM users WHERE email_hash = ?`, [emailHash], async (err, row) => {
    if (err || !row) return res.redirect('/login?error=1');
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.redirect('/login?error=1');

    req.session.user = { email };
    res.redirect('/app');
  });
});

// Домашняя после входа
app.get('/app', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.send(`
    <!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/styles.css">
    <div class="auth-page">
      <div class="auth-card">
        <h1 class="auth-title">Welcome, ${req.session.user.email}</h1>
        <p class="auth-sub">Open the Chrome extension popup to compress / view ZIP files.</p>
        <a class="auth-link" href="/logout">Log out</a>
      </div>
    </div>
  `);
});

app.get('/logout', (req, res) => req.session.destroy(()=>res.redirect('/login')));

// API: кто залогинен
app.get('/session', (req, res) => {
  if (!req.session.user) return res.status(401).send('Unauthorized');
  res.json({ email: req.session.user.email });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
