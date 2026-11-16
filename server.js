const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_CATEGORIES = [
  { id: 'inc-salary', name: 'Salary', type: 'income', ownerId: null },
  { id: 'inc-freelance', name: 'Freelance', type: 'income', ownerId: null },
  { id: 'inc-investment', name: 'Investment', type: 'income', ownerId: null },
  { id: 'inc-other', name: 'Other income', type: 'income', ownerId: null },
  { id: 'exp-food', name: 'Food', type: 'expense', ownerId: null },
  { id: 'exp-transport', name: 'Transport', type: 'expense', ownerId: null },
  { id: 'exp-housing', name: 'Housing', type: 'expense', ownerId: null },
  { id: 'exp-shopping', name: 'Shopping', type: 'expense', ownerId: null },
  { id: 'exp-bills', name: 'Bills', type: 'expense', ownerId: null },
  { id: 'exp-health', name: 'Health', type: 'expense', ownerId: null },
  { id: 'exp-education', name: 'Education', type: 'expense', ownerId: null },
  { id: 'exp-entertainment', name: 'Entertainment', type: 'expense', ownerId: null },
  { id: 'exp-other', name: 'Other expense', type: 'expense', ownerId: null }
];

function readDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    return { users: [], categories: [...DEFAULT_CATEGORIES], transactions: [] };
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  data.users ||= [];
  data.categories ||= [...DEFAULT_CATEGORIES];
  data.transactions ||= [];
  return data;
}

let db = readDatabase();

function saveDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempPath, DB_PATH);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(storedHash, 'hex');
  return candidate.length === original.length && crypto.timingSafeEqual(candidate, original);
}

function createUser(name, email, password, role) {
  const secured = hashPassword(password);
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordSalt: secured.salt,
    passwordHash: secured.hash,
    role,
    createdAt: new Date().toISOString()
  };
}

function addSeedUser(name, email, password, role) {
  if (!db.users.some(user => user.email === email.toLowerCase())) {
    db.users.push(createUser(name, email, password, role));
  }
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function seedDatabase() {
  if (!db.categories.length) db.categories = [...DEFAULT_CATEGORIES];
  addSeedUser('PaisaTrack Administrator', 'admin@paisa.local', 'Admin@123', 'admin');

  let demoUser = db.users.find(user => user.email === 'user@paisa.local');
  if (!demoUser) {
    demoUser = createUser('Demo User', 'user@paisa.local', 'User@123', 'user');
    db.users.push(demoUser);
    db.transactions.push(
      { id: crypto.randomUUID(), userId: demoUser.id, type: 'income', amount: 42000, category: 'Salary', description: 'Monthly salary', date: daysAgo(25), createdAt: new Date().toISOString() },
      { id: crypto.randomUUID(), userId: demoUser.id, type: 'expense', amount: 8500, category: 'Housing', description: 'Rent contribution', date: daysAgo(20), createdAt: new Date().toISOString() },
      { id: crypto.randomUUID(), userId: demoUser.id, type: 'expense', amount: 1850, category: 'Food', description: 'Groceries and meals', date: daysAgo(12), createdAt: new Date().toISOString() },
      { id: crypto.randomUUID(), userId: demoUser.id, type: 'expense', amount: 900, category: 'Transport', description: 'Bus and metro', date: daysAgo(6), createdAt: new Date().toISOString() },
      { id: crypto.randomUUID(), userId: demoUser.id, type: 'income', amount: 3500, category: 'Freelance', description: 'Website project', date: daysAgo(3), createdAt: new Date().toISOString() }
    );
  }
  saveDatabase();
}

seedDatabase();

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `paisa_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'paisa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function authenticate(req, res, next) {
  const token = getCookie(req, 'paisa_session');
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  const user = db.users.find(item => item.id === session.userId);
  if (!user) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Account not found. Please sign in again.' });
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'You do not have permission to access this section.' });
    }
    next();
  };
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

function availableCategories(userId) {
  return db.categories
    .filter(category => category.ownerId === null || category.ownerId === userId)
    .map(category => ({ ...category, isCustom: category.ownerId !== null }));
}

function validTransaction(body, userId) {
  const type = String(body.type || '');
  const amount = Number(body.amount);
  const category = String(body.category || '').trim();
  const description = String(body.description || '').trim();
  const date = String(body.date || '');

  if (!['income', 'expense'].includes(type)) return { error: 'Choose income or expense.' };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) return { error: 'Enter an amount greater than zero.' };
  if (!category || category.length > 40) return { error: 'Choose a valid category.' };
  const categoryExists = db.categories.some(item =>
    item.name.toLowerCase() === category.toLowerCase() &&
    item.type === type &&
    (item.ownerId === null || item.ownerId === userId)
  );
  if (!categoryExists) return { error: 'This category is not available for this transaction type.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose a valid date.' };
  const parsedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return { error: 'Choose a valid date.' };
  if (description.length > 120) return { error: 'Description must be 120 characters or fewer.' };

  return { value: { type, amount: Math.round(amount * 100) / 100, category, description, date } };
}

function userTransactions(userId, query = {}) {
  let list = db.transactions.filter(item => item.userId === userId);
  if (query.from) list = list.filter(item => item.date >= query.from);
  if (query.to) list = list.filter(item => item.date <= query.to);
  if (query.type && ['income', 'expense'].includes(query.type)) list = list.filter(item => item.type === query.type);
  if (query.category) list = list.filter(item => item.category === query.category);
  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return list;
}

function buildSummary(transactions) {
  const income = transactions.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expenses = transactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  const monthlyMap = new Map();
  const categoryMap = new Map();

  transactions.forEach(item => {
    const month = item.date.slice(0, 7);
    if (!monthlyMap.has(month)) monthlyMap.set(month, { month, income: 0, expense: 0 });
    monthlyMap.get(month)[item.type] += item.amount;
    if (item.type === 'expense') categoryMap.set(item.category, (categoryMap.get(item.category) || 0) + item.amount);
  });

  return {
    totals: {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      balance: Math.round((income - expenses) * 100) / 100
    },
    transactionCount: transactions.length,
    monthly: [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    expenseByCategory: [...categoryMap.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
  };
}

// Sign-in and session endpoints
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '');
  if (!email || !password || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Enter email, password and account type.' });
  }
  const user = db.users.find(item => item.email === email);
  if (!user || user.role !== role || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return res.status(401).json({ error: 'Email, password or account type is incorrect.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL });
  setSessionCookie(res, token);
  res.json({ user: safeUser(user) });
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: safeUser(req.user) }));

app.post('/api/auth/logout', authenticate, (req, res) => {
  sessions.delete(req.sessionToken);
  clearSessionCookie(res);
  res.json({ message: 'Signed out.' });
});

// User category endpoints
app.get('/api/categories', authenticate, requireRole('user'), (req, res) => {
  res.json({ categories: availableCategories(req.user.id) });
});

app.post('/api/categories', authenticate, requireRole('user'), (req, res) => {
  const name = String(req.body.name || '').trim();
  const type = String(req.body.type || '');
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Category name must be 2 to 40 characters.' });
  if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Choose a valid category type.' });
  const duplicate = availableCategories(req.user.id).some(item => item.type === type && item.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return res.status(409).json({ error: 'This category already exists.' });
  const category = { id: crypto.randomUUID(), name, type, ownerId: req.user.id };
  db.categories.push(category);
  saveDatabase();
  res.status(201).json({ category: { ...category, isCustom: true } });
});

app.delete('/api/categories/:id', authenticate, requireRole('user'), (req, res) => {
  const category = db.categories.find(item => item.id === req.params.id && item.ownerId === req.user.id);
  if (!category) return res.status(404).json({ error: 'Custom category not found.' });
  const inUse = db.transactions.some(item => item.userId === req.user.id && item.category === category.name);
  if (inUse) return res.status(409).json({ error: 'This category is in use. Remove or update its transactions first.' });
  db.categories = db.categories.filter(item => item.id !== category.id);
  saveDatabase();
  res.json({ message: 'Category deleted.' });
});

// User transaction endpoints. Each query is scoped to the signed-in user.
app.get('/api/transactions', authenticate, requireRole('user'), (req, res) => {
  const list = userTransactions(req.user.id, req.query);
  const limit = Number(req.query.limit);
  res.json({ transactions: Number.isInteger(limit) && limit > 0 ? list.slice(0, Math.min(limit, 500)) : list });
});

app.post('/api/transactions', authenticate, requireRole('user'), (req, res) => {
  const validation = validTransaction(req.body, req.user.id);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const transaction = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    ...validation.value,
    createdAt: new Date().toISOString()
  };
  db.transactions.push(transaction);
  saveDatabase();
  res.status(201).json({ transaction });
});

app.put('/api/transactions/:id', authenticate, requireRole('user'), (req, res) => {
  const transaction = db.transactions.find(item => item.id === req.params.id && item.userId === req.user.id);
  if (!transaction) return res.status(404).json({ error: 'Transaction not found.' });
  const validation = validTransaction(req.body, req.user.id);
  if (validation.error) return res.status(400).json({ error: validation.error });
  Object.assign(transaction, validation.value);
  saveDatabase();
  res.json({ transaction });
});

app.delete('/api/transactions/:id', authenticate, requireRole('user'), (req, res) => {
  const before = db.transactions.length;
  db.transactions = db.transactions.filter(item => !(item.id === req.params.id && item.userId === req.user.id));
  if (before === db.transactions.length) return res.status(404).json({ error: 'Transaction not found.' });
  saveDatabase();
  res.json({ message: 'Transaction deleted.' });
});

app.get('/api/reports/summary', authenticate, requireRole('user'), (req, res) => {
  res.json(buildSummary(userTransactions(req.user.id, { from: req.query.from, to: req.query.to })));
});

// Admin endpoints. Admin sees account-level totals, not individual transaction descriptions.
app.get('/api/admin/overview', authenticate, requireRole('admin'), (req, res) => {
  const summary = buildSummary(db.transactions);
  res.json({
    totalUsers: db.users.filter(user => user.role === 'user').length,
    totalTransactions: db.transactions.length,
    totals: summary.totals,
    monthly: summary.monthly
  });
});

app.get('/api/admin/users', authenticate, requireRole('admin'), (req, res) => {
  const users = db.users.filter(user => user.role === 'user').map(user => {
    const summary = buildSummary(db.transactions.filter(item => item.userId === user.id));
    return {
      ...safeUser(user),
      transactionCount: summary.transactionCount,
      balance: summary.totals.balance
    };
  });
  res.json({ users });
});

app.post('/api/admin/users', authenticate, requireRole('admin'), (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Name must be 2 to 60 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.users.some(user => user.email === email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = createUser(name, email, password, 'user');
  db.users.push(user);
  saveDatabase();
  res.status(201).json({ user: safeUser(user) });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

app.listen(PORT, HOST, () => {
  console.log('\nPaisaTrack Personal Finance Tracker');
  console.log(`Local server: http://${HOST}:${PORT}`);
  console.log('Press Ctrl + C to stop the server.\n');
});
