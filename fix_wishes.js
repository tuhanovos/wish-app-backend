const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./wishes.db');

console.log('🔧 Добавляем недостающие колонки в users...');

db.serialize(() => {
  // Добавляем колонку bio
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('✅ Колонка bio уже существует');
      } else {
        console.error('❌ Ошибка добавления bio:', err.message);
      }
    } else {
      console.log('✅ Колонка bio добавлена');
    }
  });

  // Проверяем, что колонка is_admin существует
  db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('✅ Колонка is_admin уже существует');
      } else {
        console.error('❌ Ошибка:', err.message);
      }
    } else {
      console.log('✅ Колонка is_admin добавлена');
    }
  });

  // Проверяем is_banned
  db.run(`ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('✅ Колонка is_banned уже существует');
      } else {
        console.error('❌ Ошибка:', err.message);
      }
    } else {
      console.log('✅ Колонка is_banned добавлена');
    }
  });

  // Проверяем ban_reason
  db.run(`ALTER TABLE users ADD COLUMN ban_reason TEXT`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('✅ Колонка ban_reason уже существует');
      } else {
        console.error('❌ Ошибка:', err.message);
      }
    } else {
      console.log('✅ Колонка ban_reason добавлена');
    }
  });
});

setTimeout(() => {
  db.close();
  console.log('✅ Готово! Перезапусти сервер.');
}, 1500);
