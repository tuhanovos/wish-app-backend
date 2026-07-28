import sqlite3

conn = sqlite3.connect('wishes.db')
cursor = conn.cursor()

# Создаём таблицу room_messages
cursor.execute('''
CREATE TABLE IF NOT EXISTS room_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  user_id TEXT,
  text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(room_id) REFERENCES rooms(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
)
''')

# Проверяем, что таблица создалась
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='room_messages'")
table = cursor.fetchone()

if table:
    print('✅ Таблица room_messages создана успешно!')
else:
    print('❌ Ошибка создания таблицы')

conn.commit()
conn.close()
