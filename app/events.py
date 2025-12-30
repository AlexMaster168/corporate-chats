from flask import request
from flask_socketio import emit, join_room
from flask_jwt_extended import decode_token
from . import socketio
from .database import get_db
from datetime import datetime
import secrets
import json

connected_users = {}


def calculate_age(birth_date_str):
    if not birth_date_str:
        return None
    try:
        birth_date = datetime.strptime(birth_date_str, "%Y-%m-%d")
        today = datetime.today()
        age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
        return age
    except:
        return None


@socketio.on('connect')
def on_connect(auth):
    token = auth.get('token') if auth else None
    user_id = None
    if token:
        try:
            decoded = decode_token(token)
            user_id = decoded['sub']
        except:
            return False

    if not user_id: return False

    if user_id not in connected_users:
        connected_users[user_id] = set()
    connected_users[user_id].add(request.sid)

    socketio.emit('user_status', {'user_id': user_id, 'status': 'online'})

    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE users SET last_active = ? WHERE id = ?", (datetime.now().isoformat(), user_id))
    conn.commit()

    c.execute("SELECT room_id FROM participants WHERE user_id = ?", (user_id,))
    rooms = c.fetchall()
    conn.close()

    for room in rooms:
        join_room(room['room_id'])


@socketio.on('disconnect')
def on_disconnect():
    dead_user = None
    for uid, sids in connected_users.items():
        if request.sid in sids:
            sids.remove(request.sid)
            if not sids:
                dead_user = uid
                del connected_users[uid]
            break

    if dead_user:
        last_seen = datetime.now().isoformat()
        conn = get_db()
        c = conn.cursor()
        c.execute("UPDATE users SET last_active = ? WHERE id = ?", (last_seen, dead_user))
        conn.commit()

        c.execute("SELECT gender FROM users WHERE id = ?", (dead_user,))
        user = c.fetchone()
        conn.close()

        gender = user['gender'] if user else 'male'
        socketio.emit('user_status',
                      {'user_id': dead_user, 'status': 'offline', 'last_active': last_seen, 'gender': gender})


@socketio.on('join_video_room')
def handle_join_video_room(data):
    emit('user_connected_video', {'peer_id': data['peer_id']}, to=data['room_id'], include_self=False)


@socketio.on('leave_video_room')
def handle_leave_video_room(data):
    emit('user_disconnected_video', {'peer_id': data['peer_id']}, to=data['room_id'])


@socketio.on('get_data')
def get_data(data):
    try:
        token = data.get('token')
        decoded = decode_token(token)
        user_id = decoded['sub']
    except:
        return

    conn = get_db()
    c = conn.cursor()

    c.execute('''SELECT r.id, r.name, r.type, r.avatar, r.created_by, r.deleted_for FROM rooms r
                 JOIN participants p ON r.id = p.room_id
                 WHERE p.user_id = ?''', (user_id,))
    my_rooms = []
    for row in c.fetchall():
        deleted_for = json.loads(row['deleted_for']) if row['deleted_for'] else []
        if user_id in deleted_for:
            continue

        r_dict = dict(row)
        del r_dict['deleted_for']

        if r_dict['type'] == 'private':
            c.execute('''SELECT u.name, u.avatar FROM users u 
                         JOIN participants p ON u.id = p.user_id 
                         WHERE p.room_id = ? AND u.id != ?''', (r_dict['id'], user_id))
            other_user = c.fetchone()
            if other_user:
                r_dict['name'] = other_user['name']
                r_dict['avatar'] = other_user['avatar']

        c.execute('''SELECT u.id, u.name, u.avatar FROM users u
                     JOIN participants p ON u.id = p.user_id
                     WHERE p.room_id = ?''', (r_dict['id'],))
        r_dict['participants'] = [dict(u) for u in c.fetchall()]
        my_rooms.append(r_dict)

    c.execute("SELECT blocker_id FROM blocked_users WHERE blocked_id = ?", (user_id,))
    blockers = [r['blocker_id'] for r in c.fetchall()]

    c.execute(
        "SELECT id, name, real_name, avatar, last_active, bio, avatars_gallery, gender, birth_date FROM users WHERE id != ?",
        (user_id,))
    all_users = []
    for row in c.fetchall():
        u = dict(row)
        u['is_online'] = u['id'] in connected_users
        u['age'] = calculate_age(u['birth_date'])

        if u['id'] in blockers:
            u['bio'] = ''
            u['real_name'] = ''
            u['birth_date'] = ''
            u['age'] = None
            u['avatars_gallery'] = []
        else:
            u['avatars_gallery'] = json.loads(u['avatars_gallery']) if u['avatars_gallery'] else []

        all_users.append(u)

    c.execute("SELECT blocked_id FROM blocked_users WHERE blocker_id = ?", (user_id,))
    blocked_by_me = [r['blocked_id'] for r in c.fetchall()]

    c.execute("SELECT bio, avatars_gallery, avatar, real_name, birth_date, gender FROM users WHERE id = ?", (user_id,))
    me = c.fetchone()
    my_profile = {
        'id': user_id,
        'bio': me['bio'],
        'real_name': me['real_name'],
        'birth_date': me['birth_date'],
        'age': calculate_age(me['birth_date']),
        'gender': me['gender'],
        'avatar': me['avatar'],
        'avatars_gallery': json.loads(me['avatars_gallery']) if me['avatars_gallery'] else [],
        'blocked_users': blocked_by_me
    }

    conn.close()
    emit('data_update', {'rooms': my_rooms, 'users': all_users, 'my_profile': my_profile})


@socketio.on('start_private_chat')
def start_private_chat(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    target_id = data['target_id']

    conn = get_db()
    c = conn.cursor()
    c.execute('''SELECT r.id, r.deleted_for FROM rooms r
                 JOIN participants p1 ON r.id = p1.room_id
                 JOIN participants p2 ON r.id = p2.room_id
                 WHERE r.type = 'private' AND p1.user_id = ? AND p2.user_id = ?''', (user_id, target_id))
    existing = c.fetchone()

    if existing:
        room_id = existing['id']
        deleted_for = json.loads(existing['deleted_for']) if existing['deleted_for'] else []
        if user_id in deleted_for:
            deleted_for.remove(user_id)
            c.execute("UPDATE rooms SET deleted_for = ? WHERE id = ?", (json.dumps(deleted_for), room_id))
            conn.commit()
    else:
        room_id = secrets.token_hex(8)
        c.execute("INSERT INTO rooms (id, type, created_by, created_at) VALUES (?, ?, ?, ?)",
                  (room_id, 'private', user_id, datetime.now().isoformat()))
        c.execute("INSERT INTO participants (room_id, user_id, joined_at) VALUES (?, ?, ?)",
                  (room_id, user_id, datetime.now().isoformat()))
        c.execute("INSERT INTO participants (room_id, user_id, joined_at) VALUES (?, ?, ?)",
                  (room_id, target_id, datetime.now().isoformat()))
        conn.commit()
    conn.close()

    join_room(room_id)
    if target_id in connected_users:
        for sid in connected_users[target_id]:
            socketio.emit('force_join_room', {'room_id': room_id}, room=sid)

    emit('private_chat_ready', {'room_id': room_id})


@socketio.on('join_chat')
def join_chat(data):
    room_id = data['room_id']
    join_room(room_id)
    conn = get_db()
    c = conn.cursor()

    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        conn.close()
        return

    c.execute('''SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.room_id = ? ORDER BY m.created_at''', (room_id,))

    raw_messages = c.fetchall()
    messages = []

    for row in raw_messages:
        deleted_for = json.loads(row['deleted_for']) if row['deleted_for'] else []
        if user_id not in deleted_for:
            msg_dict = dict(row)

            c.execute("SELECT user_id, reaction FROM message_reactions WHERE message_id = ?", (msg_dict['id'],))
            reactions_rows = c.fetchall()
            reactions_map = {}
            for r in reactions_rows:
                reactions_map[r['user_id']] = r['reaction']

            msg_dict['reactions'] = reactions_map
            messages.append(msg_dict)

    conn.close()
    emit('chat_history', {'room_id': room_id, 'messages': messages})


@socketio.on('send_message')
def handle_message(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']
    content = data['content']
    msg_type = data.get('type', 'text')

    conn = get_db()
    c = conn.cursor()

    c.execute(
        "SELECT 1 FROM blocked_users WHERE blocker_id = (SELECT user_id FROM participants WHERE room_id = ? AND user_id != ?) AND blocked_id = ?",
        (room_id, user_id, user_id))
    if c.fetchone():
        conn.close()
        emit('message_error', {'error': 'User has blocked you'})
        return

    c.execute("INSERT INTO messages (room_id, sender_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
              (room_id, user_id, msg_type, content, datetime.now().isoformat()))
    msg_id = c.lastrowid

    c.execute("SELECT name, avatar FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()

    c.execute("SELECT type, deleted_for FROM rooms WHERE id = ?", (room_id,))
    room = c.fetchone()
    if room:
        deleted_for = json.loads(room['deleted_for']) if room['deleted_for'] else []
        if deleted_for:
            c.execute("UPDATE rooms SET deleted_for = NULL WHERE id = ?", (room_id,))

        if room['type'] == 'group':
            details = 'Надіслав повідомлення'
            if msg_type == 'voice': details = 'Надіслав голосове'
            c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (?, ?, ?, ?)",
                      (room_id, 'message', f"{user['name']}: {details}", datetime.now().isoformat()))

    conn.commit()
    conn.close()

    emit('new_message', {
        'id': msg_id, 'room_id': room_id, 'sender_id': user_id,
        'sender_name': user['name'], 'sender_avatar': user['avatar'],
        'type': msg_type, 'content': content, 'created_at': datetime.now().isoformat(), 'reactions': {}
    }, to=room_id)


@socketio.on('add_reaction')
def add_reaction(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    msg_id = data['id']
    reaction = data['reaction']
    room_id = data['room_id']

    conn = get_db()
    c = conn.cursor()

    c.execute("SELECT sender_id FROM messages WHERE id = ?", (msg_id,))
    msg = c.fetchone()
    if not msg:
        conn.close()
        return

    sender_id = msg['sender_id']
    c.execute("SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?", (sender_id, user_id))
    if c.fetchone():
        conn.close()
        return

    c.execute(
        "INSERT OR REPLACE INTO message_reactions (message_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?)",
        (msg_id, user_id, reaction, datetime.now().isoformat()))
    conn.commit()

    c.execute("SELECT user_id, reaction FROM message_reactions WHERE message_id = ?", (msg_id,))
    rows = c.fetchall()
    reactions_map = {}
    for r in rows:
        reactions_map[r['user_id']] = r['reaction']

    c.execute("SELECT name FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()

    emit('reaction_added', {'id': msg_id, 'room_id': room_id, 'reactions': reactions_map}, to=room_id)

    if sender_id != user_id and sender_id in connected_users:
        for sid in connected_users[sender_id]:
            emit('notification', {'title': user['name'], 'body': f'Відреагував {reaction} на ваше повідомлення'},
                 room=sid)

    conn.close()


@socketio.on('edit_message')
def edit_message(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    msg_id = data['id']
    new_content = data['content']
    room_id = data['room_id']
    edited_at = datetime.now().isoformat()

    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND sender_id = ?",
              (new_content, edited_at, msg_id, user_id))

    if c.rowcount > 0:
        conn.commit()
        emit('message_edited', {'id': msg_id, 'content': new_content, 'room_id': room_id, 'edited_at': edited_at},
             to=room_id)
    conn.close()


@socketio.on('delete_message')
def delete_message(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    msg_id = data['id']
    room_id = data['room_id']
    for_everyone = data.get('for_everyone', False)

    conn = get_db()
    c = conn.cursor()

    if for_everyone:
        c.execute("DELETE FROM messages WHERE id = ? AND sender_id = ?", (msg_id, user_id))
        if c.rowcount > 0:
            c.execute("DELETE FROM message_reactions WHERE message_id = ?", (msg_id,))
            conn.commit()
            emit('message_deleted', {'id': msg_id, 'room_id': room_id}, to=room_id)
    else:
        c.execute("SELECT deleted_for FROM messages WHERE id = ?", (msg_id,))
        row = c.fetchone()
        if row:
            deleted_for = json.loads(row['deleted_for']) if row['deleted_for'] else []
            if user_id not in deleted_for:
                deleted_for.append(user_id)
                c.execute("UPDATE messages SET deleted_for = ? WHERE id = ?", (json.dumps(deleted_for), msg_id))
                conn.commit()
                emit('message_hidden', {'id': msg_id, 'room_id': room_id}, room=request.sid)

    conn.close()


@socketio.on('create_group')
def create_group(data):
    try:
        token = data.get('token')
        creator = decode_token(token)['sub']
    except:
        return

    name = data['name']
    members = data['members']
    new_room_id = secrets.token_hex(4)
    members.append(creator)

    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO rooms (id, type, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
              (new_room_id, 'group', name, creator, datetime.now().isoformat()))
    c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (?, ?, ?, ?)",
              (new_room_id, 'create', f'Група створена', datetime.now().isoformat()))

    for member in members:
        c.execute("INSERT INTO participants (room_id, user_id, joined_at) VALUES (?, ?, ?)",
                  (new_room_id, member, datetime.now().isoformat()))
        if member in connected_users:
            for sid in connected_users[member]:
                socketio.emit('force_join_room', {'room_id': new_room_id}, room=sid)

    conn.commit()
    conn.close()

    join_room(new_room_id)
    emit('group_created', {'id': new_room_id}, broadcast=True)
