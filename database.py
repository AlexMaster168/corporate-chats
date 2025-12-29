import sqlite3
from datetime import datetime
import json


def get_db():
    conn = sqlite3.connect('chat.db')
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = sqlite3.connect('chat.db')
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_active TEXT NOT NULL,
        public_key TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user TEXT NOT NULL,
        to_user TEXT,
        group_id TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        encrypted INTEGER DEFAULT 1,
        read_by TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS groups (
        group_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        members TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user TEXT NOT NULL,
        to_user TEXT,
        group_id TEXT,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS voice_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user TEXT NOT NULL,
        to_user TEXT,
        group_id TEXT,
        audio_data TEXT NOT NULL,
        timestamp TEXT NOT NULL
    )''')

    c.execute("SELECT group_id FROM groups WHERE group_id = 'general_chat'")
    if not c.fetchone():
        c.execute('''INSERT INTO groups (group_id, name, members, created_by, created_at)
                     VALUES (?, ?, ?, ?, ?)''',
                  ('general_chat', 'Загальний чат', '[]', 'system', datetime.now().isoformat()))

    conn.commit()
    conn.close()
