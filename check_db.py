import sqlite3

conn = sqlite3.connect('wishes.db')
cursor = conn.cursor()

# Проверяем таблицы
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
print("📋 Таблицы в БД:")
for table in tables:
    print(f"  - {table[0]}")

# Проверяем структуру rooms
try:
    cursor.execute("SELECT sql FROM sqlite_master WHERE name='rooms'")
    schema = cursor.fetchone()
    if schema:
        print("\n📝 Структура таблицы rooms:")
        print(schema[0])
    else:
        print("\n❌ Таблица rooms не существует!")
except Exception as e:
    print(f"❌ Ошибка: {e}")

# Проверяем структуру room_members
try:
    cursor.execute("SELECT sql FROM sqlite_master WHERE name='room_members'")
    schema = cursor.fetchone()
    if schema:
        print("\n📝 Структура таблицы room_members:")
        print(schema[0])
    else:
        print("\n❌ Таблица room_members не существует!")
except Exception as e:
    print(f"❌ Ошибка: {e}")

conn.close()
