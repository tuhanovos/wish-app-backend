require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

const app = express();
const allowedOrigins = [
  'https://ispolnitel-front-tuhanovos.amvera.io',
  'https://id54645205.vk-miniapps.com',
  'https://vk.com',
  'http://localhost:3000',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ Блокируем CORS для:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

const db = new sqlite3.Database('./wishes.db');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const economy = require('./config/economy.json');

// =============================================
// КОНФИГИ
// =============================================
const ADMIN_IDS = process.env.ADMIN_IDS?.split(',') || [];
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const COIN_PACKAGES = economy.coinPackages;
const SERVICES = economy.services;
const COMMISSION_PERCENT = economy.commissionPercent;

// =============================================
// СОЗДАНИЕ ТАБЛИЦ
// =============================================
db.serialize(() => {
  // Пользователи
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      vk_id TEXT UNIQUE,
      name TEXT,
      avatar TEXT,
      rating INTEGER DEFAULT 0,
      wishes_granted INTEGER DEFAULT 0,
      wishes_created INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      experience INTEGER DEFAULT 0,
      coins INTEGER DEFAULT 0,
      subscription_plan TEXT DEFAULT 'free',
      subscription_until DATETIME,
      bio TEXT,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      ban_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Желания
  db.run(`
    CREATE TABLE IF NOT EXISTS wishes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT,
      description TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      is_vip INTEGER DEFAULT 0,
      is_urgent INTEGER DEFAULT 0,
      is_anonymous INTEGER DEFAULT 0,
      vip_until DATETIME,
      likes INTEGER DEFAULT 0,
      target_amount INTEGER DEFAULT 0,
      collected_amount INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      is_moderated INTEGER DEFAULT 0,
      moderation_status TEXT DEFAULT 'pending',
      moderation_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Помощь (заявки)
  db.run(`
    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      wish_id TEXT,
      user_id TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      FOREIGN KEY(wish_id) REFERENCES wishes(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Чат сообщения
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      wish_id TEXT,
      user_id TEXT,
      text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(wish_id) REFERENCES wishes(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Транзакции
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      amount INTEGER,
      type TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Уведомления
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      message TEXT,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Достижения
  db.run(`
    CREATE TABLE IF NOT EXISTS achievements (
      user_id TEXT,
      achievement_id TEXT,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, achievement_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Донаты
  db.run(`
    CREATE TABLE IF NOT EXISTS donations (
      id TEXT PRIMARY KEY,
      wish_id TEXT,
      user_id TEXT,
      amount INTEGER,
      message TEXT,
      is_anonymous INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(wish_id) REFERENCES wishes(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Подарки
  db.run(`
    CREATE TABLE IF NOT EXISTS gifts (
      id TEXT PRIMARY KEY,
      from_user_id TEXT,
      to_user_id TEXT,
      type TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(from_user_id) REFERENCES users(id),
      FOREIGN KEY(to_user_id) REFERENCES users(id)
    )
  `);

  // Push токены
  db.run(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      user_id TEXT PRIMARY KEY,
      token TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Рефералы
  db.run(`
    CREATE TABLE IF NOT EXISTS referrals (
      user_id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS referral_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id TEXT,
      new_user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(referrer_id) REFERENCES users(id),
      FOREIGN KEY(new_user_id) REFERENCES users(id)
    )
  `);

  // КОМНАТЫ
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      owner_id TEXT,
      is_private INTEGER DEFAULT 0,
      invite_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT,
      user_id TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY(room_id) REFERENCES rooms(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // ЕЖЕДНЕВНЫЕ ЗАДАНИЯ
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_quests (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      reward_coins INTEGER,
      requirement_type TEXT,
      requirement_value INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_quest_progress (
      user_id TEXT,
      quest_id TEXT,
      progress INTEGER DEFAULT 0,
      is_completed INTEGER DEFAULT 0,
      completed_at DATETIME,
      PRIMARY KEY (user_id, quest_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(quest_id) REFERENCES daily_quests(id)
    )
  `);

  // ЖАЛОБЫ (ДЛЯ МОДЕРАЦИИ)
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT,
      target_id TEXT,
      target_type TEXT,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      admin_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY(reporter_id) REFERENCES users(id)
    )
  `);

  // ГРУППОВЫЕ ЖЕЛАНИЯ
  db.run(`
    CREATE TABLE IF NOT EXISTS group_wishes (
      id TEXT PRIMARY KEY,
      wish_id TEXT,
      group_name TEXT,
      max_participants INTEGER DEFAULT 5,
      current_participants INTEGER DEFAULT 0,
      FOREIGN KEY(wish_id) REFERENCES wishes(id)
    )
  `);

  // ЧЕЛЛЕНДЖИ
  db.run(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      wish_id TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(creator_id) REFERENCES users(id),
      FOREIGN KEY(wish_id) REFERENCES wishes(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS challenge_invites (
      challenge_id TEXT,
      user_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (challenge_id, user_id),
      FOREIGN KEY(challenge_id) REFERENCES challenges(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Добавляем недостающие колонки
  db.run(`ALTER TABLE wishes ADD COLUMN target_amount INTEGER DEFAULT 0`, (err) => {
    if (err && err.message.includes('duplicate column name')) {
      console.log('✅ Колонка target_amount уже существует');
    }
  });

  db.run(`ALTER TABLE wishes ADD COLUMN collected_amount INTEGER DEFAULT 0`, (err) => {
    if (err && err.message.includes('duplicate column name')) {
      console.log('✅ Колонка collected_amount уже существует');
    }
  });

  db.run(`ALTER TABLE users ADD COLUMN wishes_created INTEGER DEFAULT 0`, (err) => {
    if (err && err.message.includes('duplicate column name')) {
      console.log('✅ Колонка wishes_created уже существует');
    }
  });

  db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, (err) => {
    if (err && err.message.includes('duplicate column name')) {
      console.log('✅ Колонка is_admin уже существует');
    }
  });

  db.run(`ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`, (err) => {
    if (err && err.message.includes('duplicate column name')) {
      console.log('✅ Колонка is_banned уже существует');
    }
  });

  db.run(`ALTER TABLE users ADD COLUMN ban_reason TEXT`, (err) => {
    if (err && err.message.includes('duplicate column name')) {
      console.log('✅ Колонка ban_reason уже существует');
    }
  });

  // Таблица заявок на вывод
db.run(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    wish_id TEXT,
    amount REAL,
    commission REAL,
    net_amount REAL,
    method TEXT DEFAULT 'card',
    recipient_name TEXT,
    recipient_phone TEXT,
    recipient_card TEXT,
    status TEXT DEFAULT 'pending',
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(wish_id) REFERENCES wishes(id)
  )
`);

// Таблица настроек
db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Добавляем настройки по умолчанию
db.run(`
  INSERT OR IGNORE INTO settings (key, value) VALUES
    ('exchange_rate', '100'),
    ('withdrawal_commission', '10'),
    ('min_withdrawal', '500')
`);

  // Индексы
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_vk ON users(vk_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_wishes_category_status ON wishes(category, status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_wishes_user_id ON wishes(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_contributions_wish_id ON contributions(wish_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_contributions_user_id ON contributions(user_id)`);
});

// =============================================
// ИНИЦИАЛИЗАЦИЯ ЕЖЕДНЕВНЫХ ЗАДАНИЙ
// =============================================
const DEFAULT_QUESTS = [
  { id: 'quest_1', title: '🎯 Исполни желание', description: 'Исполни одно желание', reward: 20, requirement_type: 'grant', requirement_value: 1 },
  { id: 'quest_2', title: '❤️ Поставь 5 лайков', description: 'Лайкни 5 желаний', reward: 10, requirement_type: 'likes', requirement_value: 5 },
  { id: 'quest_3', title: '📝 Создай желание', description: 'Создай одно желание', reward: 15, requirement_type: 'create', requirement_value: 1 },
  { id: 'quest_4', title: '🤝 Помоги 3 раза', description: 'Предложи помощь 3 раза', reward: 25, requirement_type: 'help', requirement_value: 3 },
];

db.serialize(() => {
  DEFAULT_QUESTS.forEach(quest => {
    db.run(
      `INSERT OR IGNORE INTO daily_quests (id, title, description, reward_coins, requirement_type, requirement_value) VALUES (?, ?, ?, ?, ?, ?)`,
      [quest.id, quest.title, quest.description, quest.reward, quest.requirement_type, quest.requirement_value]
    );
  });
});

// =============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================

function createNotification(userId, message, link = null) {
  const id = uuidv4();
  db.run(
    `INSERT INTO notifications (id, user_id, message, link) VALUES (?, ?, ?, ?)`,
    [id, userId, message, link],
    (err) => {
      if (err) console.error('❌ Ошибка создания уведомления:', err);
    }
  );
}

function checkLevelUp(userId) {
  db.get('SELECT experience, level FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return;

    const expForNext = user.level * 30;
    if (user.experience >= expForNext) {
      db.run(
        `UPDATE users SET level = level + 1, experience = experience - ? WHERE id = ?`,
        [expForNext, userId]
      );
      createNotification(
        userId,
        `🎉 Поздравляем! Вы достигли ${user.level + 1} уровня!`,
        `/profile`
      );
    }
  });
}

function checkAchievements(userId) {
  db.get(
    `SELECT wishes_granted, rating, wishes_created FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err || !user) return;

      const earned = [];

      if (user.wishes_created >= 1) earned.push('first_wish');
      if (user.wishes_granted >= 1) earned.push('first_help');
      if (user.wishes_granted >= 10) earned.push('wish_master');
      if (user.wishes_granted >= 25) earned.push('hero');
      if (user.rating >= 100) earned.push('legend');

      earned.forEach(achId => {
        db.run(
          `INSERT OR IGNORE INTO achievements (user_id, achievement_id) VALUES (?, ?)`,
          [userId, achId]
        );
      });
    }
  );
}

function isAdmin(userId) {
  return new Promise((resolve) => {
    db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, row) => {
      resolve(!err && row && row.is_admin === 1);
    });
  });
}

let pendingUpdates = [];

function addUpdate(type, data) {
  const update = {
    type: type,
    data: data,
    time: Date.now()
  };
  pendingUpdates.push(update);
  if (pendingUpdates.length > 100) {
    pendingUpdates = pendingUpdates.slice(-100);
  }
}

// =============================================
// ПОЛЬЗОВАТЕЛИ - ИСПРАВЛЕННАЯ ВЕРСИЯ
// =============================================

// =============================================
// JWT MIDDLEWARE
// =============================================
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Неверный токен' });
  }
};

// =============================================
// ВАЛИДАЦИЯ (ZOD)
// =============================================
const wishSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(2000),
  category: z.enum(['education', 'creative', 'help', 'career', 'other']),
  isAnonymous: z.boolean().optional(),
  targetAmount: z.number().int().min(0).max(1000000).optional(),
});

const donateSchema = z.object({
  wishId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().int().min(1).max(1000000),
  message: z.string().optional(),
  isAnonymous: z.boolean().optional(),
});

const giftSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  type: z.string().min(1),
  message: z.string().optional(),
});

const serviceSchema = z.object({
  userId: z.string().min(1),
  serviceId: z.enum(['vip', 'urgent', 'anonymous']),
  wishId: z.string().min(1),
});

const subscribeSchema = z.object({
  userId: z.string().min(1),
  plan: z.enum(['premium', 'business']),
});

app.post('/api/users', (req, res) => {
  const { id, vk_id, name, avatar } = req.body;

  db.run(
    `INSERT OR REPLACE INTO users (id, vk_id, name, avatar, coins, is_admin)
     VALUES (?, ?, ?, ?, 50, ?)`,
    [id, vk_id, name, avatar, ADMIN_IDS.includes(id) ? 1 : 0],
    function(err) {
      if (err) {
        console.error('❌ Ошибка создания пользователя:', err);
        return res.status(400).json({ error: err.message });
      }

      // Генерируем JWT токен
      const token = jwt.sign({ id: id }, JWT_SECRET, { expiresIn: '7d' });

      res.json({
        success: true,
        message: 'Добро пожаловать! +50 монет 🎁',
        token: token
      });
    }
  );
});

app.get('/api/users/:userId', (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT id, name, avatar, rating, wishes_granted, wishes_created, level, experience, coins, subscription_plan, subscription_until, is_admin, is_banned, created_at
     FROM users WHERE id = ? OR vk_id = ?`,
    [userId, userId],
    (err, row) => {
      if (err) {
        console.error('❌ Ошибка:', err);
        return res.status(400).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json(row);
    }
  );
});

// =============================================
// ЖЕЛАНИЯ
// =============================================

app.post('/api/wishes', (req, res) => {
  const { userId, title, description, category, isAnonymous, targetAmount } = req.body;
  const id = uuidv4();

  // Автоматически добавляем 10% комиссии
  const commissionRate = 0.10; // 10%
  const commission = Math.floor(targetAmount * commissionRate);
  const totalTarget = targetAmount + commission;

  db.get('SELECT is_banned FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (user && user.is_banned === 1) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован. Обратитесь в поддержку.' });
    }

    db.get(
      `SELECT COUNT(*) as count, subscription_plan FROM users WHERE id = ?`,
      [userId],
      (err, userData) => {
        if (err) {
          console.error('❌ Ошибка получения пользователя:', err);
          return res.status(400).json({ error: err.message });
        }

        const maxWishes = userData && userData.subscription_plan !== 'free' ? 10 : 3;

        db.get(
          `SELECT COUNT(*) as count FROM wishes WHERE user_id = ? AND status = 'active' AND moderation_status != 'rejected'`,
          [userId],
          (err, userWishes) => {
            if (err) {
              console.error('❌ Ошибка подсчёта желаний:', err);
              return res.status(400).json({ error: err.message });
            }

            if (userWishes.count >= maxWishes) {
              return res.status(400).json({
                error: `У вас уже ${maxWishes} активных желаний. Купите Премиум для большего!`
              });
            }

            db.run(
              `INSERT INTO wishes (id, user_id, title, description, category, is_anonymous, target_amount, moderation_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
              [id, userId, title, description, category, isAnonymous || 0, targetAmount || 0],
              function(err) {
                if (err) {
                  console.error('❌ Ошибка создания желания:', err);
                  return res.status(400).json({ error: err.message });
                }

                console.log(`✅ Желание создано: ${id} пользователем ${userId}`);

                db.run(`UPDATE users SET experience = experience + 10 WHERE id = ?`, [userId]);
                db.run(`UPDATE users SET wishes_created = wishes_created + 1 WHERE id = ?`, [userId]);

                checkLevelUp(userId);
                checkAchievements(userId);

                // Уведомление админам
                db.all(`SELECT id FROM users WHERE is_admin = 1`, (err, admins) => {
                  if (!err && admins) {
                    admins.forEach(admin => {
                      createNotification(
                        admin.id,
                        `🆕 Новое желание требует модерации: "${title}"`,
                        `/admin/wishes/${id}`
                      );
                    });
                  }
                });

                res.json({
                  id,
                  message: '✨ Желание создано и отправлено на модерацию!',
                  wishId: id
                });
              }
            );
          }
        );
      }
    );
  });
});

// Модерация желаний (АДМИНКА)
app.put('/api/admin/moderate-wish/:wishId', async (req, res) => {
  const { wishId } = req.params;
  const { adminId, status, comment } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Неверный статус модерации' });
  }

  db.run(
    `UPDATE wishes SET moderation_status = ?, moderation_comment = ?, is_moderated = 1 WHERE id = ?`,
    [status, comment || null, wishId],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      db.get(`SELECT user_id, title FROM wishes WHERE id = ?`, [wishId], (err, wish) => {
        if (!err && wish) {
          const message = status === 'approved'
            ? `✅ Ваше желание "${wish.title}" прошло модерацию и опубликовано!`
            : `❌ Ваше желание "${wish.title}" отклонено. Причина: ${comment || 'Не соответствует правилам'}`;
          createNotification(wish.user_id, message, `/wish/${wishId}`);
        }
      });

      res.json({
        success: true,
        message: `Желание ${status === 'approved' ? 'одобрено' : 'отклонено'}`
      });
    }
  );
});

// Получение желаний на модерацию
app.get('/api/admin/pending-wishes', async (req, res) => {
  const { adminId } = req.query;

  db.all(
    `SELECT w.*, u.name as author_name, u.avatar
     FROM wishes w
     JOIN users u ON w.user_id = u.id
     WHERE w.moderation_status = 'pending'
     ORDER BY w.created_at ASC`,
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

app.get('/api/wishes', (req, res) => {
  const { category, status, search } = req.query;
  let sql = `
    SELECT w.*,
           u.name as author_name,
           u.avatar,
           u.rating as author_rating,
           (SELECT COUNT(*) FROM contributions WHERE wish_id = w.id AND status = 'approved') as helpers_count,
           (SELECT COUNT(*) FROM contributions WHERE wish_id = w.id AND status = 'pending') as offers_count
    FROM wishes w
    JOIN users u ON w.user_id = u.id
    WHERE w.moderation_status = 'approved'
  `;

  const params = [];

  if (category && category !== 'all') {
    sql += ` AND w.category = ?`;
    params.push(category);
  }

  if (status && status !== 'all') {
    sql += ` AND w.status = ?`;
    params.push(status);
  }

  if (search && search.trim() !== '') {
    sql += ` AND (w.title LIKE ? COLLATE NOCASE OR w.description LIKE ? COLLATE NOCASE)`;
    const searchPattern = `%${search.trim()}%`;
    params.push(searchPattern, searchPattern);
  }

  sql += ` ORDER BY w.is_vip DESC, w.created_at DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('❌ Ошибка получения желаний:', err);
      return res.status(400).json({ error: err.message });
    }
    console.log(`📋 Найдено ${rows.length} желаний`);
    res.json(rows);
  });
});

app.get('/api/feed', (req, res) => {
  const { limit = 20, offset = 0, category, status, search } = req.query;

  let sql = `
    SELECT w.*,
           u.name as author_name,
           u.avatar,
           u.rating as author_rating,
           (SELECT COUNT(*) FROM contributions WHERE wish_id = w.id AND status = 'approved') as helpers_count,
           (SELECT COUNT(*) FROM contributions WHERE wish_id = w.id AND status = 'pending') as offers_count,
           (SELECT COUNT(*) FROM messages WHERE wish_id = w.id) as messages_count
    FROM wishes w
    JOIN users u ON w.user_id = u.id
    WHERE w.moderation_status = 'approved'
  `;

  const params = [];

  if (category && category !== 'all') {
    sql += ` AND w.category = ?`;
    params.push(category);
  }

  if (status && status !== 'all') {
    sql += ` AND w.status = ?`;
    params.push(status);
  }

  if (search) {
    sql += ` AND (w.title LIKE ? OR w.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY w.is_vip DESC, w.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  db.all(sql, params, (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }

    let countSql = `SELECT COUNT(*) as total FROM wishes w WHERE w.moderation_status = 'approved'`;
    const countParams = [];

    if (category && category !== 'all') {
      countSql += ` AND w.category = ?`;
      countParams.push(category);
    }
    if (status && status !== 'all') {
      countSql += ` AND w.status = ?`;
      countParams.push(status);
    }
    if (search) {
      countSql += ` AND (w.title LIKE ? OR w.description LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`);
    }

    db.get(countSql, countParams, (err, countRow) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }

      res.json({
        items: rows,
        total: countRow ? countRow.total : 0,
        hasMore: (parseInt(offset) + parseInt(limit)) < (countRow ? countRow.total : 0)
      });
    });
  });
});

app.post('/api/wishes/:id/like', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  db.run(`UPDATE wishes SET likes = likes + 1 WHERE id = ?`, [id], function(err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    db.run(`UPDATE users SET rating = rating + 1 WHERE id = ?`, [userId]);

    addUpdate('like', { wishId: id, userId: userId });

    // Обновляем прогресс квеста
    db.run(
      `INSERT INTO user_quest_progress (user_id, quest_id, progress) VALUES (?, 'quest_2', 1)
       ON CONFLICT(user_id, quest_id) DO UPDATE SET progress = progress + 1`,
      [userId]
    );

    db.get(`SELECT user_id FROM wishes WHERE id = ?`, [id], (err, wish) => {
      if (!err && wish && wish.user_id !== userId) {
        createNotification(
          wish.user_id,
          `❤️ Кто-то лайкнул ваше желание!`,
          `/wish/${id}`
        );
      }
    });

    res.json({ message: '❤️ Лайк!' });
  });
});

// =============================================
// ПОМОЩЬ (ЗАЯВКИ)
// =============================================

app.post('/api/contribute', (req, res) => {
  const { wishId, userId, message } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO contributions (id, wish_id, user_id, message) VALUES (?, ?, ?, ?)`,
    [id, wishId, userId, message],
    function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }

      addUpdate('help', { wishId: wishId, userId: userId });

      // Обновляем прогресс квеста
      db.run(
        `INSERT INTO user_quest_progress (user_id, quest_id, progress) VALUES (?, 'quest_4', 1)
         ON CONFLICT(user_id, quest_id) DO UPDATE SET progress = progress + 1`,
        [userId]
      );

      db.get(`SELECT user_id FROM wishes WHERE id = ?`, [wishId], (err, wish) => {
        if (!err && wish) {
          createNotification(
            wish.user_id,
            `🤝 Кто-то хочет помочь исполнить ваше желание!`,
            `/wish/${wishId}`
          );
        }
      });

      res.json({ id, message: 'Предложение отправлено! 🤝' });
    }
  );
});

app.get('/api/contributions/:wishId', (req, res) => {
  const { wishId } = req.params;

  db.all(
    `SELECT c.*, u.name, u.avatar, u.rating
     FROM contributions c
     JOIN users u ON c.user_id = u.id
     WHERE c.wish_id = ?
     ORDER BY c.created_at DESC`,
    [wishId],
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});


// =============================================
// ЧАТ
// =============================================

app.post('/api/chat/message', (req, res) => {
  const { wishId, userId, text } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO messages (id, wish_id, user_id, text) VALUES (?, ?, ?, ?)`,
    [id, wishId, userId, text],
    function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }

      db.all(
        `SELECT DISTINCT user_id FROM messages WHERE wish_id = ? AND user_id != ?`,
        [wishId, userId],
        (err, users) => {
          if (!err && users) {
            users.forEach(u => {
              createNotification(
                u.user_id,
                `💬 Новое сообщение в чате желания`,
                `/wish/${wishId}`
              );
            });
          }
        }
      );

      res.json({ id, message: 'Сообщение отправлено!' });
    }
  );
});

app.get('/api/chat/:wishId', (req, res) => {
  const { wishId } = req.params;

  db.all(
    `SELECT m.*, u.name, u.avatar
     FROM messages m
     JOIN users u ON m.user_id = u.id
     WHERE m.wish_id = ?
     ORDER BY m.created_at ASC`,
    [wishId],
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// =============================================
// МОНЕТЫ
// =============================================

app.post('/api/coins/buy', authMiddleware, (req, res) => {
  const { userId, amount } = req.body;

  // Проверяем, что userId совпадает с токеном
  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const pack = COIN_PACKAGES[amount];
  if (!pack) {
    return res.status(400).json({ error: 'Неверный пакет' });
  }

  const totalCoins = amount + pack.bonus;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user) {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Пользователь не найден' });
      }

      db.run(
        'UPDATE users SET coins = coins + ? WHERE id = ?',
        [totalCoins, userId],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(400).json({ error: err.message });
          }

          const transactionId = uuidv4();
          db.run(
            `INSERT INTO transactions (id, user_id, amount, type, description)
             VALUES (?, ?, ?, 'purchase', ?)`,
            [transactionId, userId, pack.price, `Куплено ${totalCoins} монет`],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: err.message });
              }
              db.run('COMMIT');
              res.json({
                success: true,
                coins: totalCoins,
                message: `💰 Пополнено! +${totalCoins} монет!`
              });
            }
          );
        }
      );
    });
  });
});

app.get('/api/coins/:userId', (req, res) => {
  const { userId } = req.params;

  db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ coins: row ? row.coins : 0 });
  });
});

// =============================================
// УСЛУГИ
// =============================================

app.post('/api/services/activate', authMiddleware, (req, res) => {
  const { userId, serviceId, wishId } = req.body;

  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const service = SERVICES[serviceId];
  if (!service) {
    return res.status(400).json({ error: 'Услуга не найдена' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user) {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Пользователь не найден' });
      }

      if (user.coins < service.cost) {
        db.run('ROLLBACK');
        return res.status(400).json({
          error: `Недостаточно монет! Нужно ${service.cost}, у вас ${user.coins}`
        });
      }

      db.run(
        'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
        [service.cost, userId, service.cost],
        function(err) {
          if (err || this.changes === 0) {
            db.run('ROLLBACK');
            return res.status(400).json({ error: 'Недостаточно монет' });
          }

          if (serviceId === 'vip') {
            db.run(
              `UPDATE wishes SET is_vip = 1, vip_until = datetime('now', '+7 days')
               WHERE id = ? AND user_id = ?`,
              [wishId, userId]
            );
          } else if (serviceId === 'urgent') {
            db.run(
              `UPDATE wishes SET is_urgent = 1 WHERE id = ? AND user_id = ?`,
              [wishId, userId]
            );
          } else if (serviceId === 'anonymous') {
            db.run(
              `UPDATE wishes SET is_anonymous = 1 WHERE id = ? AND user_id = ?`,
              [wishId, userId]
            );
          }

          const transactionId = uuidv4();
          db.run(
            `INSERT INTO transactions (id, user_id, amount, type, description)
             VALUES (?, ?, ?, 'spend', ?)`,
            [transactionId, userId, service.cost, `Активация: ${service.name}`]
          );

          db.run('COMMIT');
          res.json({
            success: true,
            message: `✅ Услуга "${service.name}" активирована!`
          });
        }
      );
    });
  });
});

app.get('/api/services', (req, res) => {
  const servicesList = Object.entries(SERVICES).map(([id, data]) => ({
    id,
    ...data
  }));
  res.json(servicesList);
});

// =============================================
// ПОДПИСКА
// =============================================

app.post('/api/subscribe', authMiddleware, (req, res) => {
  const { userId, plan } = req.body;

  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const PLANS = {
    premium: { price: 299, name: 'Премиум' },
    business: { price: 599, name: 'Бизнес' }
  };

  const planData = PLANS[plan];
  if (!planData) {
    return res.status(400).json({ error: 'Неверный план' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user) {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Пользователь не найден' });
      }

      if (user.coins < planData.price) {
        db.run('ROLLBACK');
        return res.status(400).json({
          error: `Недостаточно монет! Нужно ${planData.price}`
        });
      }

      db.run(
        'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
        [planData.price, userId, planData.price],
        function(err) {
          if (err || this.changes === 0) {
            db.run('ROLLBACK');
            return res.status(400).json({ error: 'Недостаточно монет' });
          }

          db.run(
            `UPDATE users SET subscription_plan = ?, subscription_until = datetime('now', '+30 days')
             WHERE id = ?`,
            [plan, userId]
          );

          const transactionId = uuidv4();
          db.run(
            `INSERT INTO transactions (id, user_id, amount, type, description)
             VALUES (?, ?, ?, 'spend', ?)`,
            [transactionId, userId, planData.price, `Подписка: ${planData.name}`]
          );

          db.run('COMMIT');
          createNotification(userId, `✅ Подписка "${planData.name}" активирована на 30 дней!`, `/profile`);
          res.json({
            success: true,
            message: `✅ Подписка "${planData.name}" активирована на 30 дней!`
          });
        }
      );
    });
  });
});

app.get('/api/subscription/:userId', (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT subscription_plan, subscription_until FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err || !user) {
        return res.json({ isActive: false });
      }

      const isActive = user.subscription_until && new Date(user.subscription_until) > new Date();

      res.json({
        isActive: isActive,
        plan: user.subscription_plan,
        until: user.subscription_until
      });
    }
  );
});

// =============================================
// УРОВНИ И ДОСТИЖЕНИЯ
// =============================================

app.get('/api/achievements/:userId', (req, res) => {
  const { userId } = req.params;

  db.all(
    `SELECT a.*, ach.name, ach.icon, ach.description
     FROM achievements a
     JOIN (
       SELECT 'first_wish' as id, 'Первый шаг' as name, '👣' as icon, 'Создать первое желание' as description UNION
       SELECT 'first_help', 'Помощник', '🤝', 'Помочь в исполнении' UNION
       SELECT 'wish_master', 'Мастер желаний', '🎯', 'Исполнить 10 желаний' UNION
       SELECT 'hero', 'Герой', '🦸', 'Исполнить 25 желаний' UNION
       SELECT 'legend', 'Легенда', '👑', 'Достичь 100 рейтинга' UNION
       SELECT 'philanthropist', 'Филантроп', '💝', 'Отправить 10 подарков' UNION
       SELECT 'vip', 'VIP', '⭐', 'Купить VIP-подписку' UNION
       SELECT 'popular', 'Популярный', '🔥', 'Получить 50 лайков'
     ) ach ON a.achievement_id = ach.id
     WHERE a.user_id = ?
     ORDER BY a.unlocked_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('❌ Ошибка получения достижений:', err);
        res.status(400).json({ error: err.message });
        return;
      }
      console.log(`🏅 Найдено достижений: ${rows.length}`);
      res.json(rows);
    }
  );
});

app.get('/api/level/:userId', (req, res) => {
  const { userId } = req.params;

  db.get('SELECT level, experience FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) {
      return res.status(400).json({ error: err.message });
    }

    const expForNext = user.level * 30;
    const progress = Math.floor((user.experience / expForNext) * 100);

    const titles = {
      1: '🌟 Новичок',
      2: '⭐ Помощник',
      3: '🌟 Мастер',
      5: '🏆 Герой',
      10: '👑 Легенда'
    };

    res.json({
      level: user.level,
      progress: progress,
      title: titles[user.level] || `Уровень ${user.level}`
    });
  });
});

// =============================================
// ТОПЫ
// =============================================

app.get('/api/top/users', (req, res) => {
  db.all(
    `SELECT * FROM users WHERE is_banned = 0 ORDER BY rating DESC LIMIT 10`,
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.get('/api/top/wishes', (req, res) => {
  db.all(
    `SELECT w.*, u.name as author_name
     FROM wishes w
     JOIN users u ON w.user_id = u.id
     WHERE w.status = 'completed' AND w.moderation_status = 'approved'
     ORDER BY w.likes DESC
     LIMIT 10`,
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// =============================================
// СТАТИСТИКА
// =============================================

app.get('/api/stats', (req, res) => {
  db.get(
    `SELECT
      (SELECT COUNT(*) FROM wishes WHERE moderation_status = 'approved') as total_wishes,
      (SELECT COUNT(*) FROM wishes WHERE status = 'completed' AND moderation_status = 'approved') as completed_wishes,
      (SELECT COUNT(*) FROM users WHERE is_banned = 0) as total_users,
      (SELECT COUNT(*) FROM contributions WHERE status = 'approved') as total_helps
    `,
    (err, row) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(row);
    }
  );
});

// =============================================
// УВЕДОМЛЕНИЯ
// =============================================

app.get('/api/notifications/:userId', (req, res) => {
  const { userId } = req.params;

  db.all(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
    [userId],
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.put('/api/notifications/:id/read', (req, res) => {
  const { id } = req.params;

  db.run(
    `UPDATE notifications SET is_read = 1 WHERE id = ?`,
    [id],
    function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ success: true });
    }
  );
});

// =============================================
// ОБНОВЛЕНИЯ (LONG POLLING)
// =============================================

app.get('/api/updates', (req, res) => {
  const { lastTime } = req.query;
  const since = parseInt(lastTime) || 0;

  const timeout = setTimeout(() => {
    res.json({ updates: [], lastTime: Date.now() });
  }, 30000);

  const newUpdates = pendingUpdates.filter(u => u.time > since);

  if (newUpdates.length > 0) {
    clearTimeout(timeout);
    res.json({
      updates: newUpdates,
      lastTime: Date.now()
    });
    pendingUpdates = pendingUpdates.filter(u => u.time > Date.now() - 60000);
  }
});

// =============================================
// ДОНАТЫ
// =============================================

app.post('/api/donate', authMiddleware, (req, res) => {
  try {
    const validated = donateSchema.parse(req.body);
    const { wishId, userId, amount, message, isAnonymous } = validated;

    if (userId !== req.userId) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const id = uuidv4();

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Пользователь не найден' });
        }

        if (user.coins < amount) {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Недостаточно монет!' });
        }

        db.run(
          'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
          [amount, userId, amount],
          function(err) {
            if (err || this.changes === 0) {
              db.run('ROLLBACK');
              return res.status(400).json({ error: 'Недостаточно монет' });
            }

            db.run(
              `INSERT INTO donations (id, wish_id, user_id, amount, message, is_anonymous)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [id, wishId, userId, amount, message || '', isAnonymous || 0],
              function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(400).json({ error: err.message });
                }

                db.run(
                  `UPDATE wishes SET collected_amount = collected_amount + ? WHERE id = ?`,
                  [amount, wishId]
                );

                db.run('COMMIT');

                db.get(`SELECT user_id FROM wishes WHERE id = ?`, [wishId], (err, wish) => {
                  if (!err && wish) {
                    createNotification(
                      wish.user_id,
                      `💰 Кто-то задонатил ${amount} монет на ваше желание!`,
                      `/wish/${wishId}`
                    );
                  }
                });

                res.json({
                  success: true,
                  message: `💰 +${amount} монет внесено в копилку!`
                });
              }
            );
          }
        );
      });
    });
  } catch (error) {
    return res.status(400).json({ error: error.errors || 'Неверные данные' });
  }
});

app.get('/api/donations/:wishId', (req, res) => {
  const { wishId } = req.params;

  db.all(
    `SELECT d.*, u.name, u.avatar
     FROM donations d
     JOIN users u ON d.user_id = u.id
     WHERE d.wish_id = ?
     ORDER BY d.created_at DESC`,
    [wishId],
    (err, rows) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// =============================================
// ПОДАРКИ
// =============================================

const GIFT_TYPES = {
  '❤️': { name: 'Сердце', cost: 10, rarity: 'common', emoji: '❤️' },
  '⭐': { name: 'Звезда', cost: 25, rarity: 'common', emoji: '⭐' },
  '🌺': { name: 'Цветок', cost: 30, rarity: 'common', emoji: '🌺' },
  '🎯': { name: 'Цель', cost: 50, rarity: 'uncommon', emoji: '🎯' },
  '🏆': { name: 'Трофей', cost: 75, rarity: 'uncommon', emoji: '🏆' },
  '💎': { name: 'Алмаз', cost: 150, rarity: 'rare', emoji: '💎' },
  '👑': { name: 'Корона', cost: 300, rarity: 'epic', emoji: '👑' },
  '🌟': { name: 'Легенда', cost: 500, rarity: 'legendary', emoji: '🌟' },
};

app.get('/api/gifts/types', (req, res) => {
  console.log('🎁 Запрос на получение типов подарков');
  const types = Object.entries(GIFT_TYPES).map(([id, data]) => ({
    id: id,
    name: data.name,
    emoji: data.emoji,
    cost: data.cost,
    rarity: data.rarity
  }));
  res.json(types);
});

app.get('/api/gifts/:userId/stats', (req, res) => {
  const { userId } = req.params;
  console.log(`📊 Запрос статистики подарков для ${userId}`);

  db.get(
    `SELECT
      COUNT(*) as total_received,
      SUM(CASE WHEN g.type = '❤️' THEN 1 ELSE 0 END) as hearts,
      SUM(CASE WHEN g.type = '⭐' THEN 1 ELSE 0 END) as stars,
      SUM(CASE WHEN g.type = '🌺' THEN 1 ELSE 0 END) as flowers,
      SUM(CASE WHEN g.type = '🎯' THEN 1 ELSE 0 END) as targets,
      SUM(CASE WHEN g.type = '🏆' THEN 1 ELSE 0 END) as trophies,
      SUM(CASE WHEN g.type = '💎' THEN 1 ELSE 0 END) as diamonds,
      SUM(CASE WHEN g.type = '👑' THEN 1 ELSE 0 END) as crowns,
      SUM(CASE WHEN g.type = '🌟' THEN 1 ELSE 0 END) as legends
     FROM gifts g
     WHERE g.to_user_id = ?`,
    [userId],
    (err, row) => {
      if (err) {
        console.error('❌ Ошибка статистики:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(row || { total_received: 0 });
    }
  );
});

app.post('/api/gift/send', authMiddleware, (req, res) => {
  try {
    const validated = giftSchema.parse(req.body);
    const { fromUserId, toUserId, type, message } = validated;

    if (fromUserId !== req.userId) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const gift = GIFT_TYPES[type];
    if (!gift) {
      return res.status(400).json({
        error: 'Неверный тип подарка',
        availableTypes: Object.keys(GIFT_TYPES)
      });
    }

    if (fromUserId === toUserId) {
      return res.status(400).json({ error: 'Нельзя отправить подарок самому себе' });
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      db.get('SELECT coins FROM users WHERE id = ?', [fromUserId], (err, user) => {
        if (err || !user) {
          db.run('ROLLBACK');
          return res.status(404).json({ error: 'Отправитель не найден' });
        }

        if (user.coins < gift.cost) {
          db.run('ROLLBACK');
          return res.status(400).json({
            error: `Недостаточно монет! Нужно ${gift.cost}, у вас ${user.coins}`,
            need: gift.cost,
            have: user.coins
          });
        }

        db.get('SELECT id FROM users WHERE id = ?', [toUserId], (err, receiver) => {
          if (err || !receiver) {
            db.run('ROLLBACK');
            return res.status(404).json({ error: 'Получатель не найден' });
          }

          db.run(
            'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
            [gift.cost, fromUserId, gift.cost],
            function(err) {
              if (err || this.changes === 0) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Недостаточно монет' });
              }

              const id = uuidv4();
              db.run(
                `INSERT INTO gifts (id, from_user_id, to_user_id, type, message, created_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [id, fromUserId, toUserId, type, message || ''],
                function(err) {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                  }

                  db.run('COMMIT');
                  console.log(`✅ Подарок ${type} отправлен от ${fromUserId} к ${toUserId}`);

                  createNotification(
                    toUserId,
                    `🎁 Вы получили подарок ${gift.emoji} ${gift.name}!`,
                    `/profile`
                  );

                  createNotification(
                    fromUserId,
                    `✅ Подарок ${gift.emoji} ${gift.name} отправлен! (-${gift.cost} монет)`,
                    `/profile`
                  );

                  res.json({
                    success: true,
                    message: `🎁 Подарок ${gift.emoji} ${gift.name} отправлен!`,
                    gift: {
                      id: id,
                      type: type,
                      name: gift.name,
                      emoji: gift.emoji,
                      cost: gift.cost
                    },
                    remainingCoins: user.coins - gift.cost
                  });
                }
              );
            }
          );
        });
      });
    });
  } catch (error) {
    return res.status(400).json({ error: error.errors || 'Неверные данные' });
  }
});

app.get('/api/gifts/:userId', (req, res) => {
  const { userId } = req.params;
  console.log(`🎁 Запрос подарков для пользователя ${userId}`);

  db.all(
    `SELECT
      g.*,
      u.name as from_name,
      u.avatar as from_avatar,
      u.vk_id as from_vk_id
     FROM gifts g
     LEFT JOIN users u ON g.from_user_id = u.id
     WHERE g.to_user_id = ?
     ORDER BY g.created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('❌ Ошибка получения подарков:', err);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ Найдено ${rows ? rows.length : 0} подарков`);

      const giftsWithInfo = (rows || []).map(gift => ({
        ...gift,
        giftInfo: GIFT_TYPES[gift.type] || null
      }));

      res.json(giftsWithInfo);
    }
  );
});

// =============================================
// PUSH УВЕДОМЛЕНИЯ
// =============================================

app.post('/api/push/register', (req, res) => {
  const { userId, token } = req.body;

  db.run(
    `INSERT OR REPLACE INTO push_tokens (user_id, token) VALUES (?, ?)`,
    [userId, token],
    function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ success: true });
    }
  );
});

// =============================================
// РЕФЕРАЛЬНАЯ СИСТЕМА
// =============================================

app.post('/api/referral/create', (req, res) => {
  const { userId } = req.body;
  const code = uuidv4().slice(0, 8);

  db.run(
    `INSERT OR REPLACE INTO referrals (user_id, code) VALUES (?, ?)`,
    [userId, code],
    function(err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ code });
    }
  );
});

app.post('/api/referral/use', (req, res) => {
  const { userId, code } = req.body;

  db.get(
    `SELECT user_id FROM referrals WHERE code = ?`,
    [code],
    (err, referral) => {
      if (err || !referral) {
        return res.status(400).json({ error: 'Неверный реферальный код' });
      }

      if (referral.user_id === userId) {
        return res.status(400).json({ error: 'Нельзя пригласить самого себя' });
      }

      db.run(
        `UPDATE users SET coins = coins + 30 WHERE id = ?`,
        [referral.user_id]
      );

      db.run(
        `UPDATE users SET coins = coins + 15 WHERE id = ?`,
        [userId]
      );

      db.run(
        `INSERT INTO referral_usage (referrer_id, new_user_id) VALUES (?, ?)`,
        [referral.user_id, userId]
      );

      createNotification(
        referral.user_id,
        `🎉 По вашей ссылке зарегистрировался новый пользователь! Вы получили +30 монет!`,
        `/profile`
      );

      createNotification(
        userId,
        `🎉 Вы зарегистрировались по реферальной ссылке и получили +15 монет!`,
        `/profile`
      );

      res.json({
        success: true,
        message: 'Реферальный код активирован! Вы получили +15 монет!'
      });
    }
  );
});

app.get('/api/referral/stats/:userId', (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT
      (SELECT COUNT(*) FROM referral_usage WHERE referrer_id = ?) as total,
      (SELECT COUNT(*) FROM referral_usage WHERE referrer_id = ? AND created_at > datetime('now', '-7 days')) as weekly
     `,
    [userId, userId],
    (err, row) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json(row);
    }
  );
});

// =============================================
// КОМНАТЫ
// =============================================

app.post('/api/rooms/create', (req, res) => {
  const { ownerId, name, description, isPrivate } = req.body;
  const id = uuidv4();
  const inviteCode = isPrivate ? uuidv4().slice(0, 8) : null;

  db.run(
    `INSERT INTO rooms (id, name, description, owner_id, is_private, invite_code) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, description, ownerId, isPrivate ? 1 : 0, inviteCode],
    function(err) {
      if (err) {
        console.error('❌ Ошибка создания комнаты:', err);
        return res.status(400).json({ error: err.message });
      }

      db.run(
        `INSERT INTO room_members (room_id, user_id) VALUES (?, ?)`,
        [id, ownerId]
      );

      res.json({
        id,
        inviteCode,
        message: '🏠 Комната создана!'
      });
    }
  );
});

app.post('/api/rooms/join', (req, res) => {
  const { roomId, userId, inviteCode } = req.body;

  let query = `INSERT INTO room_members (room_id, user_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ?`;
  const params = [roomId, userId, roomId];

  if (inviteCode) {
    query += ` AND (is_private = 0 OR invite_code = ?)`;
    params.push(inviteCode);
  } else {
    query += ` AND is_private = 0`;
  }
  query += `)`;

  db.run(query, params, function(err) {
    if (err) {
      return res.status(400).json({ error: 'Не удалось присоединиться к комнате' });
    }
    res.json({ success: true, message: '✅ Вы присоединились к комнате!' });
  });
});

app.get('/api/rooms/:userId', (req, res) => {
  const { userId } = req.params;

  db.all(
    `SELECT r.*, (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as members_count
     FROM rooms r
     JOIN room_members rm ON r.id = rm.room_id
     WHERE rm.user_id = ?
     ORDER BY r.created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Создание желания в комнате
app.post('/api/rooms/:roomId/wishes', (req, res) => {
  const { roomId } = req.params;
  const { userId, title, description, category, isAnonymous, targetAmount } = req.body;
  const id = uuidv4();

  // Проверяем, что пользователь в комнате
  db.get(
    `SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`,
    [roomId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'Вы не участник комнаты' });
      }

      db.run(
        `INSERT INTO wishes (id, user_id, title, description, category, is_anonymous, target_amount, room_id, moderation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
        [id, userId, title, description, category, isAnonymous || 0, targetAmount || 0, roomId],
        function(err) {
          if (err) return res.status(400).json({ error: err.message });

          // Уведомление участникам
          db.all(
            `SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?`,
            [roomId, userId],
            (err, members) => {
              if (!err && members) {
                members.forEach(m => {
                  createNotification(
                    m.user_id,
                    `🆕 Новое желание в комнате!`,
                    `/room/${roomId}`
                  );
                });
              }
            }
          );

          res.json({ id, message: '✨ Желание создано в комнате!' });
        }
      );
    }
  );
});

// Получение желаний комнаты
app.get('/api/rooms/:roomId/wishes', (req, res) => {
  const { roomId } = req.params;

  db.all(
    `SELECT w.*, u.name as author_name, u.avatar,
     (SELECT COUNT(*) FROM contributions WHERE wish_id = w.id AND status = 'approved') as helpers_count
     FROM wishes w
     JOIN users u ON w.user_id = u.id
     WHERE w.room_id = ? AND w.moderation_status = 'approved'
     ORDER BY w.created_at DESC`,
    [roomId],
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Отправка сообщения в комнату
app.post('/api/rooms/:roomId/chat', (req, res) => {
  const { roomId } = req.params;
  const { userId, text } = req.body;
  const id = uuidv4();

  db.get(
    `SELECT * FROM room_members WHERE room_id = ? AND user_id = ?`,
    [roomId, userId],
    (err, member) => {
      if (err || !member) {
        return res.status(403).json({ error: 'Вы не участник комнаты' });
      }

      db.run(
        `INSERT INTO room_messages (id, room_id, user_id, text, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, roomId, userId, text],
        function(err) {
          if (err) return res.status(400).json({ error: err.message });

          // Уведомление участникам
          db.all(
            `SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?`,
            [roomId, userId],
            (err, members) => {
              if (!err && members) {
                members.forEach(m => {
                  createNotification(
                    m.user_id,
                    `💬 Новое сообщение в комнате`,
                    `/room/${roomId}`
                  );
                });
              }
            }
          );

          res.json({ id, message: 'Сообщение отправлено!' });
        }
      );
    }
  );
});

// Получение сообщений комнаты
app.get('/api/rooms/:roomId/chat', (req, res) => {
  const { roomId } = req.params;

  db.all(
    `SELECT rm.*, u.name, u.avatar
     FROM room_messages rm
     JOIN users u ON rm.user_id = u.id
     WHERE rm.room_id = ?
     ORDER BY rm.created_at ASC`,
    [roomId],
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.delete('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { userId } = req.body;

  db.get(
    `SELECT owner_id FROM rooms WHERE id = ?`,
    [roomId],
    (err, room) => {
      if (err || !room) return res.status(404).json({ error: 'Комната не найдена' });
      if (room.owner_id !== userId) {
        return res.status(403).json({ error: 'Только владелец может удалить комнату' });
      }

      db.run(`DELETE FROM room_members WHERE room_id = ?`, [roomId]);
      db.run(`DELETE FROM rooms WHERE id = ?`, [roomId], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ success: true, message: 'Комната удалена' });
      });
    }
  );
});

// =============================================
// ЕЖЕДНЕВНЫЕ ЗАДАНИЯ
// =============================================

app.get('/api/quests/:userId', (req, res) => {
  const { userId } = req.params;

  db.all(
    `SELECT q.*,
     COALESCE(uqp.progress, 0) as progress,
     COALESCE(uqp.is_completed, 0) as is_completed
     FROM daily_quests q
     LEFT JOIN user_quest_progress uqp ON q.id = uqp.quest_id AND uqp.user_id = ?
     WHERE date(uqp.completed_at) IS NULL OR date(uqp.completed_at) != date('now')`,
    [userId],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

app.post('/api/quests/update-progress', (req, res) => {
  const { userId, questId, increment } = req.body;

  db.run(
    `INSERT INTO user_quest_progress (user_id, quest_id, progress) VALUES (?, ?, ?)
     ON CONFLICT(user_id, quest_id) DO UPDATE SET progress = progress + ?`,
    [userId, questId, increment, increment],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      db.get(
        `SELECT q.reward_coins, q.requirement_value, uqp.progress
         FROM daily_quests q
         JOIN user_quest_progress uqp ON q.id = uqp.quest_id
         WHERE q.id = ? AND uqp.user_id = ? AND uqp.is_completed = 0`,
        [questId, userId],
        (err, data) => {
          if (!err && data && data.progress >= data.requirement_value) {
            db.run(
              `UPDATE user_quest_progress SET is_completed = 1, completed_at = CURRENT_TIMESTAMP WHERE quest_id = ? AND user_id = ?`,
              [questId, userId]
            );
            db.run(
              `UPDATE users SET coins = coins + ? WHERE id = ?`,
              [data.reward_coins, userId]
            );
            createNotification(
              userId,
              `🎉 Задание выполнено! +${data.reward_coins} монет!`,
              `/quests`
            );
          }
        }
      );

      res.json({ success: true });
    }
  );
});

// =============================================
// ЖАЛОБЫ (ДЛЯ МОДЕРАЦИИ)
// =============================================

app.post('/api/reports/create', (req, res) => {
  const { reporterId, targetId, targetType, reason } = req.body;
  const id = uuidv4();

  if (!['wish', 'user', 'comment'].includes(targetType)) {
    return res.status(400).json({ error: 'Неверный тип цели' });
  }

  db.run(
    `INSERT INTO reports (id, reporter_id, target_id, target_type, reason) VALUES (?, ?, ?, ?, ?)`,
    [id, reporterId, targetId, targetType, reason],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      db.all(`SELECT id FROM users WHERE is_admin = 1`, (err, admins) => {
        if (!err && admins) {
          admins.forEach(admin => {
            createNotification(
              admin.id,
              `⚠️ Новая жалоба от пользователя`,
              `/admin/reports/${id}`
            );
          });
        }
      });

      res.json({ success: true, message: 'Жалоба отправлена 📨' });
    }
  );
});

app.get('/api/admin/reports', async (req, res) => {
  const { adminId } = req.query;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  db.all(
    `SELECT r.*,
     u1.name as reporter_name,
     u2.name as target_name
     FROM reports r
     LEFT JOIN users u1 ON r.reporter_id = u1.id
     LEFT JOIN users u2 ON r.target_id = u2.id
     WHERE r.status = 'pending'
     ORDER BY r.created_at ASC`,
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

app.put('/api/admin/resolve-report/:reportId', async (req, res) => {
  const { reportId } = req.params;
  const { adminId, action, comment } = req.body;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Неверное действие' });
  }

  db.run(
    `UPDATE reports SET status = ?, admin_comment = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [action === 'approve' ? 'approved' : 'rejected', comment || null, reportId],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (action === 'approve') {
        db.get(`SELECT target_id, target_type FROM reports WHERE id = ?`, [reportId], (err, report) => {
          if (!err && report) {
            if (report.target_type === 'wish') {
              db.run(`UPDATE wishes SET status = 'hidden' WHERE id = ?`, [report.target_id]);
            } else if (report.target_type === 'user') {
              db.run(`UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?`, [comment || 'Нарушение правил', report.target_id]);
            }
          }
        });
      }

      res.json({ success: true });
    }
  );
});

// =============================================
// БАН ПОЛЬЗОВАТЕЛЯ (АДМИНКА)
// =============================================

app.put('/api/admin/ban-user', async (req, res) => {
  const { adminId, userId, reason } = req.body;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  db.run(
    `UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?`,
    [reason || 'Нарушение правил', userId],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      createNotification(userId, `⚠️ Ваш аккаунт заблокирован. Причина: ${reason || 'Нарушение правил'}`, `/support`);
      res.json({ success: true, message: 'Пользователь заблокирован' });
    }
  );
});

// =============================================
// ГРУППОВЫЕ ЖЕЛАНИЯ
// =============================================

app.post('/api/group-wish/create', (req, res) => {
  const { wishId, groupName, maxParticipants } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO group_wishes (id, wish_id, group_name, max_participants) VALUES (?, ?, ?, ?)`,
    [id, wishId, groupName, maxParticipants || 5],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json({ success: true, message: 'Групповое желание создано!' });
    }
  );
});

app.post('/api/group-wish/join', (req, res) => {
  const { groupWishId, userId } = req.body;

  db.get(
    `SELECT max_participants, current_participants FROM group_wishes WHERE id = ?`,
    [groupWishId],
    (err, group) => {
      if (err || !group) {
        return res.status(400).json({ error: 'Группа не найдена' });
      }

      if (group.current_participants >= group.max_participants) {
        return res.status(400).json({ error: 'Группа заполнена' });
      }

      db.run(
        `UPDATE group_wishes SET current_participants = current_participants + 1 WHERE id = ?`,
        [groupWishId],
        function(err) {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.json({ success: true, message: 'Вы присоединились к группе!' });
        }
      );
    }
  );
});

// =============================================
// ЧЕЛЛЕНДЖИ
// =============================================

app.post('/api/challenges/create', (req, res) => {
  const { userId, wishId, friendIds } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO challenges (id, creator_id, wish_id) VALUES (?, ?, ?)`,
    [id, userId, wishId],
    function(err) {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (friendIds && Array.isArray(friendIds)) {
        friendIds.forEach(friendId => {
          db.run(
            `INSERT INTO challenge_invites (challenge_id, user_id) VALUES (?, ?)`,
            [id, friendId]
          );
          createNotification(
            friendId,
            `🎯 Друг приглашает вас исполнить желание!`,
            `/challenge/${id}`
          );
        });
      }

      res.json({ success: true, challengeId: id });
    }
  );
});


app.post('/api/rewards/buy', authMiddleware, (req, res) => {
  const { userId, rewardId } = req.body;
  const reward = REAL_REWARDS[rewardId];
  if (!reward) return res.status(400).json({ error: 'Награда не найдена' });

  db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.coins < reward.cost) {
      return res.status(400).json({ error: 'Недостаточно монет' });
    }

    db.run('UPDATE users SET coins = coins - ? WHERE id = ?', [reward.cost, userId]);
    db.run(
      `INSERT INTO transactions (id, user_id, amount, type, description)
       VALUES (?, ?, ?, 'reward', ?)`,
      [uuidv4(), userId, reward.cost, `Куплено: ${reward.name}`]
    );

    res.json({
      success: true,
      message: `🎁 ${reward.name} получен!`,
      reward: reward
    });
  });
});

// =============================================
// ДИАГНОСТИКА
// =============================================

app.get('/api/debug/user/:userId', (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT wishes_created, wishes_granted, rating, is_admin, is_banned FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err || !user) {
        return res.json({ error: 'Пользователь не найден' });
      }

      db.all(
        `SELECT * FROM achievements WHERE user_id = ?`,
        [userId],
        (err, achievements) => {
          res.json({
            user: user,
            achievements: achievements,
            achievements_count: achievements ? achievements.length : 0
          });
        }
      );
    }
  );
});

app.get('/api/debug/gifts', (req, res) => {
  db.all('SELECT * FROM gifts ORDER BY created_at DESC LIMIT 20', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      count: rows ? rows.length : 0,
      gifts: rows || [],
      sql: 'SELECT * FROM gifts ORDER BY created_at DESC LIMIT 20'
    });
  });
});

// Создание премиум-комнаты
app.post('/api/rooms/premium/create', (req, res) => {
  const { ownerId, name, description } = req.body;
  const id = uuidv4();
  const cost = 100; // монет

  db.get('SELECT coins FROM users WHERE id = ?', [ownerId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.coins < cost) {
      return res.status(400).json({ error: `Нужно ${cost} монет для премиум-комнаты` });
    }

    db.run('UPDATE users SET coins = coins - ? WHERE id = ?', [cost, ownerId]);
    db.run(
      `INSERT INTO rooms (id, name, description, owner_id, is_premium, is_private)
       VALUES (?, ?, ?, ?, 1, 0)`,
      [id, name, description, ownerId],
      function(err) {
        if (err) return res.status(400).json({ error: err.message });
        db.run(`INSERT INTO room_members (room_id, user_id) VALUES (?, ?)`, [id, ownerId]);
        res.json({ id, message: '🏠 Премиум-комната создана!' });
      }
    );
  });
});

app.get('/api/daily-bonus/:userId', (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT last_bonus FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      const today = new Date().toDateString();
      const lastBonus = user?.last_bonus ? new Date(user.last_bonus).toDateString() : '';

      if (lastBonus === today) {
        return res.json({ claimed: true, message: 'Бонус уже получен сегодня' });
      }

      const bonus = Math.floor(Math.random() * 20) + 10; // 10-30 монет
      db.run(
        `UPDATE users SET coins = coins + ?, last_bonus = CURRENT_TIMESTAMP WHERE id = ?`,
        [bonus, userId]
      );

      res.json({ claimed: false, bonus, message: `🎉 +${bonus} монет!` });
    }
  );
});

app.get('/api/feedback/all', async (req, res) => {
  const { adminId } = req.query;

  // Проверка админа
  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  db.all(
    `SELECT f.*, u.name as user_name, u.avatar as user_avatar
     FROM feedback f
     LEFT JOIN users u ON f.user_id = u.id
     ORDER BY f.created_at DESC`,
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// =============================================
// WEBSOCKET ЧАТ
// =============================================

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const userId = url.searchParams.get('userId');

  if (userId) {
    clients.set(userId, ws);
    console.log(`✅ Пользователь ${userId} подключился к чату`);
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { wishId, userId, text } = data;

      const id = uuidv4();
      db.run(
        `INSERT INTO messages (id, wish_id, user_id, text) VALUES (?, ?, ?, ?)`,
        [id, wishId, userId, text]
      );

      db.all(
        `SELECT DISTINCT user_id FROM messages WHERE wish_id = ?`,
        [wishId],
        (err, users) => {
          if (!err && users) {
            users.forEach(u => {
              const client = clients.get(u.user_id);
              if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'new_message',
                  wishId: wishId,
                  userId: userId,
                  text: text,
                  time: new Date().toISOString()
                }));
              }
            });
          }
        }
      );
    } catch (error) {
      console.error('❌ Ошибка чата:', error);
    }
  });

  ws.on('close', () => {
    if (userId) {
      clients.delete(userId);
      console.log(`❌ Пользователь ${userId} отключился от чата`);
    }
  });
});

console.log('💬 WebSocket сервер запущен на порту 8080');

// =============================================
// АНАЛИТИКА
// =============================================

// Таблицы (добавь в db.serialize())
db.run(`
  CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event_type TEXT,
    event_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS analytics_daily (
    date DATE PRIMARY KEY,
    users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    wishes_created INTEGER DEFAULT 0,
    wishes_completed INTEGER DEFAULT 0,
    coins_spent INTEGER DEFAULT 0,
    coins_purchased INTEGER DEFAULT 0
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT,
    message TEXT,
    rating INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS contests (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    prize TEXT,
    end_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS contest_participants (
    contest_id TEXT,
    user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, user_id),
    FOREIGN KEY(contest_id) REFERENCES contests(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`);

// =============================================
// ЭНДПОИНТЫ АНАЛИТИКИ
// =============================================

// Сохранение события
app.post('/api/analytics/track', (req, res) => {
  const { userId, eventType, eventData } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO analytics_events (id, user_id, event_type, event_data, created_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, userId, eventType, JSON.stringify(eventData)],
    (err) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Получение статистики (только для админа)
app.get('/api/analytics/stats', async (req, res) => {
  const { adminId, period = 'week' } = req.query;

  const dateFilter = period === 'week' ? "datetime('now', '-7 days')" :
                     period === 'month' ? "datetime('now', '-30 days')" :
                     "datetime('now', '-1 day')";

  db.get(
    `SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM users WHERE created_at > ${dateFilter}) as new_users,
      (SELECT COUNT(*) FROM wishes) as total_wishes,
      (SELECT COUNT(*) FROM wishes WHERE status = 'completed') as completed_wishes,
      (SELECT COUNT(*) FROM wishes WHERE created_at > ${dateFilter}) as new_wishes,
      (SELECT COUNT(*) FROM transactions WHERE type = 'purchase' AND created_at > ${dateFilter}) as coins_purchased,
      (SELECT COUNT(*) FROM transactions WHERE type = 'spend' AND created_at > ${dateFilter}) as coins_spent,
      (SELECT COUNT(*) FROM gifts WHERE created_at > ${dateFilter}) as gifts_sent,
      (SELECT SUM(amount) FROM transactions WHERE type = 'purchase' AND created_at > ${dateFilter}) as total_revenue
     `,
    (err, row) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(row);
    }
  );
});

// Топ услуг
app.get('/api/analytics/services', async (req, res) => {
  const { adminId } = req.query;

  db.all(
    `SELECT
      description as service,
      COUNT(*) as count,
      SUM(amount) as total_spent
     FROM transactions
     WHERE type = 'spend'
     GROUP BY description
     ORDER BY count DESC`,
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// =============================================
// ОБРАТНАЯ СВЯЗЬ
// =============================================

app.post('/api/feedback', (req, res) => {
  const { userId, type, message, rating } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO feedback (id, user_id, type, message, rating, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, userId, type, message, rating],
    (err) => {
      if (err) return res.status(400).json({ error: err.message });

      db.all(`SELECT id FROM users WHERE is_admin = 1`, (err, admins) => {
        if (!err && admins) {
          admins.forEach(admin => {
            createNotification(
              admin.id,
              `💬 Новый отзыв от пользователя!`,
              `/admin/feedback`
            );
          });
        }
      });

      res.json({ success: true });
    }
  );
});

// =============================================
// СЕЗОННЫЕ СОБЫТИЯ
// =============================================

app.get('/api/events/current', (req, res) => {
  const month = new Date().getMonth();
  const events = {
    0: { name: '🎄 Новогодний марафон', bonus: 2, description: 'Двойные монеты за желания', icon: '🎄' },
    5: { name: '🌞 Летний фестиваль', bonus: 1.5, description: '+50% к опыту', icon: '🌞' },
    9: { name: '🍂 Осенний сбор', bonus: 1.3, description: 'Скидка 30% на услуги', icon: '🍂' },
  };

  const currentEvent = events[month] || {
    name: '🌟 Обычный сезон',
    bonus: 1,
    description: 'Без бонусов',
    icon: '🌟'
  };
  res.json(currentEvent);
});

// =============================================
// КОНКУРСЫ
// =============================================

app.post('/api/contests/create', async (req, res) => {
  const { adminId, name, description, prize, endDate } = req.body;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const id = uuidv4();
  db.run(
    `INSERT INTO contests (id, name, description, prize, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, name, description, prize, endDate],
    (err) => {
      if (err) return res.status(400).json({ error: err.message });

      db.all(`SELECT id FROM users`, (err, users) => {
        if (!err && users) {
          users.forEach(user => {
            createNotification(
              user.id,
              `🏆 Новый конкурс: ${name}! Приз: ${prize}`,
              `/contests/${id}`
            );
          });
        }
      });

      res.json({ id, message: 'Конкурс создан!' });
    }
  );
});

app.post('/api/contests/join', (req, res) => {
  const { contestId, userId } = req.body;

  db.run(
    `INSERT OR IGNORE INTO contest_participants (contest_id, user_id) VALUES (?, ?)`,
    [contestId, userId],
    (err) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ success: true, message: 'Вы участвуете в конкурсе!' });
    }
  );
});

app.get('/api/contests/active', (req, res) => {
  db.all(
    `SELECT * FROM contests WHERE end_date > CURRENT_TIMESTAMP ORDER BY created_at DESC`,
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// =============================================
// РЕАЛЬНЫЕ НАГРАДЫ
// =============================================

const REAL_REWARDS = {
  steam_100: { name: 'Steam Gift Card 100₽', cost: 500, type: 'steam', icon: '🎮' },
  steam_500: { name: 'Steam Gift Card 500₽', cost: 2000, type: 'steam', icon: '🎮' },
  apple_100: { name: 'Apple Gift Card 100₽', cost: 500, type: 'apple', icon: '🍎' },
  apple_500: { name: 'Apple Gift Card 500₽', cost: 2000, type: 'apple', icon: '🍎' },
  vk_100: { name: 'VK Donut', cost: 300, type: 'vk', icon: '🍩' },
};

app.get('/api/rewards', (req, res) => {
  const rewards = Object.entries(REAL_REWARDS).map(([id, data]) => ({ id, ...data }));
  res.json(rewards);
});

app.post('/api/rewards/buy', authMiddleware, (req, res) => {
  const { userId, rewardId } = req.body;
  const reward = REAL_REWARDS[rewardId];
  if (!reward) return res.status(400).json({ error: 'Награда не найдена' });

  db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.coins < reward.cost) {
      return res.status(400).json({ error: 'Недостаточно монет' });
    }

    db.run('UPDATE users SET coins = coins - ? WHERE id = ?', [reward.cost, userId]);
    db.run(
      `INSERT INTO transactions (id, user_id, amount, type, description)
       VALUES (?, ?, ?, 'reward', ?)`,
      [uuidv4(), userId, reward.cost, `Куплено: ${reward.name}`]
    );

    // Уведомление админу (для выполнения)
    db.all(`SELECT id FROM users WHERE is_admin = 1`, (err, admins) => {
      if (!err && admins) {
        admins.forEach(admin => {
          createNotification(
            admin.id,
            `🎁 Пользователь ${userId} купил ${reward.name}!`,
            `/admin/rewards`
          );
        });
      }
    });

    res.json({
      success: true,
      message: `🎁 ${reward.name} получен!`,
      reward: reward
    });
  });
});

// =============================================
// ВЫВОД ДЕНЕГ (WITHDRAWALS)
// =============================================

// Получить курс обмена и настройки
app.get('/api/settings', (req, res) => {
  db.all('SELECT * FROM settings', (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });

    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json({
      exchangeRate: parseInt(settings.exchange_rate) || 100,
      commission: parseInt(settings.withdrawal_commission) || 10,
      minWithdrawal: parseInt(settings.min_withdrawal) || 500
    });
  });
});

// Запросить вывод (только для авторизованных)
app.post('/api/withdraw/request', (req, res) => {
  const { userId, wishId, amount, recipientName, recipientPhone, recipientCard } = req.body;

  // Проверяем пользователя
  db.get('SELECT coins FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверяем, что желание принадлежит пользователю и собрано
    db.get(
      `SELECT target_amount, collected_amount FROM wishes WHERE id = ? AND user_id = ?`,
      [wishId, userId],
      (err, wish) => {
        if (err || !wish) {
          return res.status(404).json({ error: 'Желание не найдено' });
        }

        if (wish.collected_amount < wish.target_amount) {
          return res.status(400).json({ error: 'Сумма не собрана' });
        }

        // Проверяем, не было ли уже заявки
        db.get(
          `SELECT id FROM withdrawals WHERE wish_id = ? AND status IN ('pending', 'approved')`,
          [wishId],
          (err, existing) => {
            if (existing) {
              return res.status(400).json({ error: 'Заявка уже подана' });
            }

            // Получаем настройки
            db.all('SELECT * FROM settings', (err, settingsRows) => {
              const settings = {};
              settingsRows.forEach(row => {
                settings[row.key] = row.value;
              });

              const exchangeRate = parseInt(settings.exchange_rate) || 100;
              const commission = parseInt(settings.withdrawal_commission) || 10;
              const minWithdrawal = parseInt(settings.min_withdrawal) || 500;

              // Считаем сумму в рублях
              const amountInRub = Math.floor(wish.collected_amount / exchangeRate);
              const commissionAmount = Math.floor(amountInRub * commission / 100);
              const netAmount = amountInRub - commissionAmount;

              if (amountInRub < minWithdrawal) {
                return res.status(400).json({
                  error: `Минимальная сумма вывода: ${minWithdrawal} ₽`
                });
              }

              // Создаём заявку
              const id = uuidv4();
              db.run(
                `INSERT INTO withdrawals (
                  id, user_id, wish_id, amount, commission, net_amount,
                  method, recipient_name, recipient_phone, recipient_card, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'card', ?, ?, ?, 'pending')`,
                [id, userId, wishId, amountInRub, commissionAmount, netAmount,
                 recipientName, recipientPhone, recipientCard],
                function(err) {
                  if (err) {
                    return res.status(400).json({ error: err.message });
                  }

                  // Уведомление админам
                  db.all(`SELECT id FROM users WHERE is_admin = 1`, (err, admins) => {
                    if (!err && admins) {
                      admins.forEach(admin => {
                        createNotification(
                          admin.id,
                          `💰 Новая заявка на вывод ${netAmount} ₽ от пользователя`,
                          `/admin/withdrawals/${id}`
                        );
                      });
                    }
                  });

                  res.json({
                    success: true,
                    withdrawalId: id,
                    amount: amountInRub,
                    commission: commissionAmount,
                    netAmount: netAmount,
                    message: `Заявка на вывод ${netAmount} ₽ отправлена!`
                  });
                }
              );
            });
          }
        );
      }
    );
  });
});

// Получить заявки (для админа)
app.get('/api/admin/withdrawals', async (req, res) => {
  const { adminId, status } = req.query;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  let sql = `
    SELECT w.*,
           u.name as user_name,
           u.avatar as user_avatar,
           u.phone as user_phone,
           wsh.title as wish_title
    FROM withdrawals w
    JOIN users u ON w.user_id = u.id
    LEFT JOIN wishes wsh ON w.wish_id = wsh.id
  `;

  const params = [];

  if (status && status !== 'all') {
    sql += ` WHERE w.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY w.created_at DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
  });
});

// Обновить статус заявки (для админа)
app.put('/api/admin/withdrawals/:id', async (req, res) => {
  const { id } = req.params;
  const { adminId, status, comment } = req.body;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  if (!['approved', 'rejected', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }

  db.run(
    `UPDATE withdrawals SET status = ?, admin_comment = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, comment || null, id],
    function(err) {
      if (err) return res.status(400).json({ error: err.message });

      // Уведомление пользователю
      db.get(`SELECT user_id FROM withdrawals WHERE id = ?`, [id], (err, withdrawal) => {
        if (!err && withdrawal) {
          const messages = {
            'approved': '✅ Ваша заявка на вывод одобрена! Деньги будут переведены в ближайшее время.',
            'paid': '💰 Деньги переведены на вашу карту!',
            'rejected': `❌ Заявка отклонена. Причина: ${comment || 'Не указана'}`
          };
          createNotification(withdrawal.user_id, messages[status] || 'Статус заявки обновлён', `/profile`);
        }
      });

      res.json({ success: true });
    }
  );
});

// Обновить настройки (для админа)
app.put('/api/admin/settings', async (req, res) => {
  const { adminId, exchangeRate, commission, minWithdrawal } = req.body;

  const isAdminUser = await isAdmin(adminId);
  if (!isAdminUser) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const updates = [];
  if (exchangeRate) updates.push(['exchange_rate', exchangeRate]);
  if (commission) updates.push(['withdrawal_commission', commission]);
  if (minWithdrawal) updates.push(['min_withdrawal', minWithdrawal]);

  const promises = updates.map(([key, value]) => {
    return new Promise((resolve) => {
      db.run(
        `UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
        [String(value), key],
        (err) => resolve(!err)
      );
    });
  });

  await Promise.all(promises);
  res.json({ success: true, message: 'Настройки обновлены' });
});

// =============================================
// ЦЕНТРАЛИЗОВАННАЯ ОБРАБОТКА ОШИБОК
// =============================================
app.use((err, req, res, next) => {
  console.error('❌ Ошибка:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Внутренняя ошибка сервера'
  });
});

// =============================================
// ЗАПУСК СЕРВЕРА
// =============================================

const PORT = 5000;
app.listen(PORT, () => {
  console.log('🚀 Сервер запущен на порту 5000');
  console.log('💰 Монетизация активирована!');
  console.log('💬 Чат доступен!');
  console.log('🪙 Пакеты монет: 50, 150, 350, 800, 2000');
  console.log('🎁 Подарки: ❤️ ⭐ 🌺 🎯 🏆 💎 👑 🌟');
  console.log('🏠 Комнаты доступны!');
  console.log('📋 Ежедневные задания активны!');
  console.log('🛡️ Система модерации включена!');
});
