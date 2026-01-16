import psycopg
from psycopg.rows import dict_row
from datetime import datetime
import os


def get_db():
    conn = psycopg.connect(os.getenv('DATABASE_URL'), row_factory=dict_row)
    return conn


def init_db():
    conn = get_db()
    with conn.cursor() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS users
                     (
                         id
                         TEXT
                         PRIMARY
                         KEY,
                         name
                         TEXT
                         NOT
                         NULL
                         UNIQUE,
                         real_name
                         TEXT,
                         birth_date
                         TEXT,
                         gender
                         TEXT,
                         password_hash
                         TEXT
                         NOT
                         NULL,
                         avatar
                         TEXT,
                         avatars_gallery
                         TEXT,
                         bio
                         TEXT,
                         last_active
                         TEXT,
                         created_at
                         TEXT
                     )""")

        c.execute("""CREATE TABLE IF NOT EXISTS blocked_users
        (
            blocker_id
            TEXT,
            blocked_id
            TEXT,
            PRIMARY
            KEY
                     (
            blocker_id,
            blocked_id
                     ),
            FOREIGN KEY
                     (
                         blocker_id
                     ) REFERENCES users
                     (
                         id
                     ),
            FOREIGN KEY
                     (
                         blocked_id
                     ) REFERENCES users
                     (
                         id
                     )
            )""")

        c.execute("""CREATE TABLE IF NOT EXISTS rooms
        (
            id
            TEXT
            PRIMARY
            KEY,
            type
            TEXT
            CHECK (
            type
            IN
                     (
            'private',
            'group'
                     )),
            name TEXT,
            avatar TEXT,
            created_by TEXT,
            created_at TEXT,
            deleted_for TEXT
            )""")

        c.execute("""CREATE TABLE IF NOT EXISTS participants
        (
            room_id
            TEXT,
            user_id
            TEXT,
            role
            TEXT
            DEFAULT
            'member',
            joined_at
            TEXT,
            PRIMARY
            KEY
                     (
            room_id,
            user_id
                     ),
            FOREIGN KEY
                     (
                         room_id
                     ) REFERENCES rooms
                     (
                         id
                     ),
            FOREIGN KEY
                     (
                         user_id
                     ) REFERENCES users
                     (
                         id
                     )
            )""")

        c.execute("""CREATE TABLE IF NOT EXISTS messages
        (
            id
            SERIAL
            PRIMARY
            KEY,
            room_id
            TEXT
            NOT
            NULL,
            sender_id
            TEXT
            NOT
            NULL,
            type
            TEXT
            CHECK (
            type
            IN
                     (
            'text',
            'file',
            'voice',
            'video',
            'system'
                     )),
            content TEXT,
            filename TEXT,
            created_at TEXT,
            edited_at TEXT,
            deleted_for TEXT,
            FOREIGN KEY
                     (
                         room_id
                     ) REFERENCES rooms
                     (
                         id
                     ),
            FOREIGN KEY
                     (
                         sender_id
                     ) REFERENCES users
                     (
                         id
                     )
            )""")

        c.execute("""CREATE TABLE IF NOT EXISTS message_reactions
        (
            id
            SERIAL
            PRIMARY
            KEY,
            message_id
            INTEGER
            NOT
            NULL,
            user_id
            TEXT
            NOT
            NULL,
            reaction
            TEXT
            NOT
            NULL,
            created_at
            TEXT,
            FOREIGN
            KEY
                     (
            message_id
                     ) REFERENCES messages
                     (
                         id
                     ),
            FOREIGN KEY
                     (
                         user_id
                     ) REFERENCES users
                     (
                         id
                     ),
            UNIQUE
                     (
                         message_id,
                         user_id
                     )
            )""")

        c.execute("""CREATE TABLE IF NOT EXISTS group_logs
        (
            id
            SERIAL
            PRIMARY
            KEY,
            room_id
            TEXT
            NOT
            NULL,
            action
            TEXT
            NOT
            NULL,
            details
            TEXT,
            timestamp
            TEXT
            NOT
            NULL,
            FOREIGN
            KEY
                     (
            room_id
                     ) REFERENCES rooms
                     (
                         id
                     )
            )""")

        c.execute("SELECT id FROM rooms WHERE id = 'general'")
        if not c.fetchone():
            c.execute("INSERT INTO rooms (id, type, name, created_at) VALUES (%s, %s, %s, %s)",
                      ('general', 'group', 'Загальний чат', datetime.now().isoformat()))

        conn.commit()
    conn.close()
