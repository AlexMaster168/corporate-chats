from flask import Flask, render_template, request, jsonify, session
from datetime import datetime
import secrets
import json
from database import init_db, get_db
from utils import atob_decode, replace_emoticons

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)

init_db()


@app.route('/')
def index():
    if 'user_id' not in session:
        return render_template('login.html')

    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE users SET last_active = ? WHERE user_id = ?',
              (datetime.now().isoformat(), session['user_id']))
    conn.commit()
    conn.close()

    return render_template('chat.html', user_name=session['user_name'])


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user_name = data.get('name', '').strip()

    if not user_name:
        return jsonify({'error': 'Введіть імя'}), 400

    user_id = secrets.token_hex(8)
    session['user_id'] = user_id
    session['user_name'] = user_name

    conn = get_db()
    c = conn.cursor()
    c.execute('INSERT INTO users (user_id, name, last_active, public_key) VALUES (?, ?, ?, ?)',
              (user_id, user_name, datetime.now().isoformat(), secrets.token_hex(16)))

    c.execute('SELECT members FROM groups WHERE group_id = ?', ('general_chat',))
    row = c.fetchone()
    members = json.loads(row['members'])
    if user_id not in members:
        members.append(user_id)
        c.execute('UPDATE groups SET members = ? WHERE group_id = ?',
                  (json.dumps(members), 'general_chat'))

    conn.commit()
    conn.close()

    return jsonify({'status': 'ok'})


@app.route('/api/users')
def get_users():
    current_user = session.get('user_id')
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM users WHERE user_id != ?', (current_user,))
    users = c.fetchall()
    conn.close()

    html = ''
    for user in users:
        last_active = datetime.fromisoformat(user['last_active'])
        active_status = (datetime.now() - last_active).seconds < 10
        status = 'Онлайн' if active_status else f"Активність: {last_active.strftime('%H:%M')}"
        indicator = '<span class="online-indicator"></span>' if active_status else ''

        html += f'''
        <div class="user-item" onclick="selectChat('{user['user_id']}', '{user['name']}', 'user')">
            <div class="user-name">{indicator}{user['name']}</div>
            <div class="user-activity">{status}</div>
        </div>
        '''

    return html or '<p style="padding:20px;text-align:center;color:#999;">Немає інших користувачів</p>'


@app.route('/api/groups')
def get_groups():
    current_user = session.get('user_id')
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM groups')
    groups = c.fetchall()
    conn.close()

    html = ''
    for group in groups:
        members = json.loads(group['members'])
        if current_user in members:
            html += f'''
            <div class="group-item" onclick="selectChat('{group['group_id']}', '{group['name']}', 'group')">
                <div class="user-name">👥 {group['name']}</div>
                <div class="user-activity">Учасників: {len(members)}</div>
            </div>
            '''

    return html or '<p style="padding:20px;text-align:center;color:#999;">Немає груп</p>'


@app.route('/api/users-list')
def get_users_list():
    current_user = session.get('user_id')
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT user_id, name FROM users WHERE user_id != ?', (current_user,))
    users = c.fetchall()
    conn.close()

    return jsonify([{'id': u['user_id'], 'name': u['name']} for u in users])


@app.route('/api/messages')
def get_messages():
    chat_id = request.args.get('chat')
    chat_type = request.args.get('type', 'user')
    current_user = session.get('user_id')

    if not chat_id:
        return ''

    conn = get_db()
    c = conn.cursor()

    html = ''

    if chat_type == 'user':
        c.execute('''SELECT m.*, u.name as from_name FROM messages m
                     JOIN users u ON m.from_user = u.user_id
                     WHERE (m.from_user = ? AND m.to_user = ?)
                        OR (m.from_user = ? AND m.to_user = ?)
                     ORDER BY m.timestamp''',
                  (current_user, chat_id, chat_id, current_user))
    else:
        c.execute('''SELECT m.*, u.name as from_name FROM messages m
                     JOIN users u ON m.from_user = u.user_id
                     WHERE m.group_id = ?
                     ORDER BY m.timestamp''', (chat_id,))

    messages = c.fetchall()

    for msg in messages:
        try:
            decrypted = atob_decode(msg['content'])
        except:
            decrypted = msg['content']
        decrypted = replace_emoticons(decrypted)
        is_sent = msg['from_user'] == current_user
        timestamp = datetime.fromisoformat(msg['timestamp']).strftime('%H:%M')

        read_info = ''
        if is_sent and chat_type == 'user':
            read_info = '<div class="read-status">✓ Доставлено</div>'
        elif is_sent and chat_type == 'group':
            read_by = json.loads(msg['read_by']) if msg['read_by'] else []
            c.execute('SELECT members FROM groups WHERE group_id = ?', (chat_id,))
            group = c.fetchone()
            total_members = len(json.loads(group['members'])) if group else 0
            read_info = f'<div class="read-status">✓ Прочитано: {len(read_by)}/{total_members}</div>'

        html += f'''
        <div class="message {'sent' if is_sent else ''}" data-msg-id="{msg['id']}">
            <div class="message-header">{msg['from_name']}</div>
            <div class="message-content">{decrypted}</div>
            <div class="message-time">{timestamp}</div>
            {read_info}
        </div>
        '''

    c.execute('''SELECT f.*, u.name as from_name FROM files f
                 JOIN users u ON f.from_user = u.user_id
                 WHERE ''' + (
        '(f.from_user = ? AND f.to_user = ?) OR (f.from_user = ? AND f.to_user = ?)' if chat_type == 'user' else 'f.group_id = ?'),
              (current_user, chat_id, chat_id, current_user) if chat_type == 'user' else (chat_id,))

    files = c.fetchall()
    for file in files:
        is_sent = file['from_user'] == current_user
        timestamp = datetime.fromisoformat(file['timestamp']).strftime('%H:%M')
        html += f'''
        <div class="message {'sent' if is_sent else ''}" data-file-id="{file['id']}">
            <div class="message-header">{file['from_name']}</div>
            <div class="message-content">📎 Файл: {file['filename']}</div>
            <div class="message-time">{timestamp}</div>
        </div>
        '''

    c.execute('''SELECT v.*, u.name as from_name FROM voice_messages v
                 JOIN users u ON v.from_user = u.user_id
                 WHERE ''' + (
        '(v.from_user = ? AND v.to_user = ?) OR (v.from_user = ? AND v.to_user = ?)' if chat_type == 'user' else 'v.group_id = ?'),
              (current_user, chat_id, chat_id, current_user) if chat_type == 'user' else (chat_id,))

    voices = c.fetchall()
    for voice in voices:
        is_sent = voice['from_user'] == current_user
        timestamp = datetime.fromisoformat(voice['timestamp']).strftime('%H:%M')
        html += f'''
        <div class="message {'sent' if is_sent else ''}" data-voice-id="{voice['id']}">
            <div class="message-header">{voice['from_name']}</div>
            <div class="message-content">
                🎤 Голосове повідомлення
                <audio controls style="width:100%;margin-top:5px;">
                    <source src="{voice['audio_data']}" type="audio/webm">
                </audio>
            </div>
            <div class="message-time">{timestamp}</div>
        </div>
        '''

    if chat_type == 'group':
        c.execute('SELECT id FROM messages WHERE group_id = ? AND from_user != ?', (chat_id, current_user))
        msg_ids = [row['id'] for row in c.fetchall()]
        for msg_id in msg_ids:
            c.execute('SELECT read_by FROM messages WHERE id = ?', (msg_id,))
            row = c.fetchone()
            read_by = json.loads(row['read_by']) if row['read_by'] else []
            if current_user not in read_by:
                read_by.append(current_user)
                c.execute('UPDATE messages SET read_by = ? WHERE id = ?', (json.dumps(read_by), msg_id))

    conn.commit()
    conn.close()

    return html or '<p style="text-align:center;color:#999;margin-top:50px;">Поки що немає повідомлень</p>'


@app.route('/api/send', methods=['POST'])
def send_message():
    data = request.json
    current_user = session.get('user_id')

    conn = get_db()
    c = conn.cursor()

    if data.get('type') == 'group':
        c.execute('''INSERT INTO messages (from_user, group_id, content, timestamp, encrypted, read_by)
                     VALUES (?, ?, ?, ?, 1, ?)''',
                  (current_user, data['to'], data['content'], datetime.now().isoformat(), json.dumps([current_user])))
    else:
        c.execute('''INSERT INTO messages (from_user, to_user, content, timestamp, encrypted)
                     VALUES (?, ?, ?, ?, 1)''',
                  (current_user, data['to'], data['content'], datetime.now().isoformat()))

    msg_id = c.lastrowid

    c.execute('UPDATE users SET last_active = ? WHERE user_id = ?',
              (datetime.now().isoformat(), current_user))

    conn.commit()
    conn.close()

    return jsonify({'status': 'ok', 'msg_id': msg_id})


@app.route('/api/upload', methods=['POST'])
def upload_file():
    data = request.json
    current_user = session.get('user_id')

    conn = get_db()
    c = conn.cursor()

    if data.get('type') == 'group':
        c.execute('''INSERT INTO files (from_user, group_id, filename, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)''',
                  (current_user, data['to'], data['filename'], data['content'], datetime.now().isoformat()))
    else:
        c.execute('''INSERT INTO files (from_user, to_user, filename, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)''',
                  (current_user, data['to'], data['filename'], data['content'], datetime.now().isoformat()))

    c.execute('UPDATE users SET last_active = ? WHERE user_id = ?',
              (datetime.now().isoformat(), current_user))

    conn.commit()
    conn.close()

    return jsonify({'status': 'ok'})


@app.route('/api/voice', methods=['POST'])
def send_voice():
    data = request.json
    current_user = session.get('user_id')

    conn = get_db()
    c = conn.cursor()

    if data.get('type') == 'group':
        c.execute('''INSERT INTO voice_messages (from_user, group_id, audio_data, timestamp)
                     VALUES (?, ?, ?, ?)''',
                  (current_user, data['to'], data['audio'], datetime.now().isoformat()))
    else:
        c.execute('''INSERT INTO voice_messages (from_user, to_user, audio_data, timestamp)
                     VALUES (?, ?, ?, ?)''',
                  (current_user, data['to'], data['audio'], datetime.now().isoformat()))

    c.execute('UPDATE users SET last_active = ? WHERE user_id = ?',
              (datetime.now().isoformat(), current_user))

    conn.commit()
    conn.close()

    return jsonify({'status': 'ok'})


@app.route('/api/group/create', methods=['POST'])
def create_group():
    data = request.json
    current_user = session.get('user_id')

    group_id = secrets.token_hex(8)
    members = [current_user] + data['members']

    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO groups (group_id, name, members, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?)''',
              (group_id, data['name'], json.dumps(members), current_user, datetime.now().isoformat()))
    conn.commit()
    conn.close()

    return jsonify({'status': 'ok', 'group_id': group_id})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
