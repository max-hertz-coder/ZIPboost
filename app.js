const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

// Configuration
const APP_SECRET = process.env.APP_SECRET || 'DEV_SECRET_CHANGE_THIS';
// ^ secret key for hashing emails and session. In production, set this via environment and keep it secret.

// Initialize app and database
const app = express();
const db = new sqlite3.Database('zboost.db');

// Create users table if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_hash TEXT UNIQUE,
    password_hash TEXT,
    sub_until TEXT,
    is_paid INTEGER
  )`);
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: APP_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, 'public')));  
// (Static files serve CSS/JS/images; HTML files are in 'views' for controlled access)

// Utility: HMAC hash for email
function hashEmail(email) {
  return crypto.createHmac('sha256', APP_SECRET).update(email).digest('hex');
}

// Routes

// Redirect root to /login or /app depending on session
app.get('/', (req, res) => {
  if (req.session.userEmail) {
    res.redirect('/app');
  } else {
    res.redirect('/login');
  }
});

// Serve registration page
app.get('/register', (req, res) => {
  if (req.session.userEmail) {
    return res.redirect('/app');
  }
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// Handle registration form
app.post('/register', async (req, res) => {
  const email = req.body.email || '';
  const password = req.body.password || '';
  if (!email || !password) {
    // Missing fields
    return res.redirect('/register?error=1');
  }
  const emailLower = email.toLowerCase();
  const emailHash = hashEmail(emailLower);
  // Check if already exists
  db.get(`SELECT id FROM users WHERE email_hash = ?`, [emailHash], async (err, row) => {
    if (err) {
      console.error('DB error on select', err);
      return res.redirect('/register?error=1');
    }
    if (row) {
      // Email already registered
      return res.redirect('/register?error=2');
    }
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      // Set subscription until date (default 30 days from now) and paid flag = 1
      const now = new Date();
      const subUntilDate = new Date(now.getTime() + 30*24*60*60*1000); // 30 days later
      const subUntilStr = subUntilDate.toISOString();
      db.run(
        `INSERT INTO users (email_hash, password_hash, sub_until, is_paid) VALUES (?, ?, ?, ?)`,
        [emailHash, passwordHash, subUntilStr, 1],
        function(err) {
          if (err) {
            console.error('DB error on insert', err);
            return res.redirect('/register?error=1');
          }
          // Registration successful – redirect to login
          return res.redirect('/login');
        }
      );
    } catch (hashErr) {
      console.error('Error hashing password', hashErr);
      return res.redirect('/register?error=1');
    }
  });
});

// Serve login page
app.get('/login', (req, res) => {
  if (req.session.userEmail) {
    return res.redirect('/app');
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Handle login form
app.post('/login', (req, res) => {
  const email = req.body.email || '';
  const password = req.body.password || '';
  const emailLower = email.toLowerCase();
  const emailHash = hashEmail(emailLower);
  db.get(`SELECT id, password_hash, sub_until, is_paid FROM users WHERE email_hash = ?`, [emailHash], async (err, row) => {
    if (err) {
      console.error('DB error on select', err);
      return res.redirect('/login?error=1');
    }
    if (!row) {
      // User not found
      return res.redirect('/login?error=1');
    }
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      // Wrong password
      return res.redirect('/login?error=1');
    }
    // Check subscription status
    const subUntil = new Date(row.sub_until);
    const now = new Date();
    if (row.is_paid !== 1 || (subUntil && subUntil < now)) {
      // Subscription not active or expired
      return res.redirect('/login?error=2');
    }
    // Credentials ok and subscription valid -> create session
    req.session.userEmail = emailLower;      // store plaintext email in session (for display)
    req.session.subUntil = row.sub_until;    // store subscription expiry in session
    return res.redirect('/app');
  });
});

// Serve main app page (only if logged in)
app.get('/app', (req, res) => {
  if (!req.session.userEmail) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'views', 'app.html'));
});

// Provide session info to frontend (email and subscription date)
app.get('/session', (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).send('Unauthorized');
  }
  res.json({ email: req.session.userEmail, subUntil: req.session.subUntil });
});

// Log out
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZBoost server running on http://localhost:${PORT}`);
});
