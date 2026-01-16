from flask import request
from flask_socketio import emit, join_room
from flask_jwt_extended import decode_token
from .extensions import socketio
from .database import get_db
from datetime import datetime
import secrets
import json
from .socket_utils import connected_users


@socketio.on('start_private_chat')
def start_private_chat(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    target_id = data['target_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute('''SELECT r.id, r.deleted_for
                         FROM rooms r
                                  JOIN participants p1 ON r.id = p1.room_id
                                  JOIN participants p2 ON r.id = p2.room_id
                         WHERE r.type = 'private'
                           AND p1.user_id = %s
                           AND p2.user_id = %s''', (user_id, target_id))
            existing = c.fetchone()

            if existing:
                room_id = existing['id']
                deleted_for = json.loads(existing['deleted_for']) if existing['deleted_for'] else []
                if user_id in deleted_for:
                    deleted_for.remove(user_id)
                    c.execute("UPDATE rooms SET deleted_for = %s WHERE id = %s", (json.dumps(deleted_for), room_id))
                    conn.commit()
            else:
                room_id = secrets.token_hex(8)
                c.execute("INSERT INTO rooms (id, type, created_by, created_at) VALUES (%s, %s, %s, %s)",
                          (room_id, 'private', user_id, datetime.now().isoformat()))
                c.execute("INSERT INTO participants (room_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                          (room_id, user_id, 'member', datetime.now().isoformat()))
                c.execute("INSERT INTO participants (room_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                          (room_id, target_id, 'member', datetime.now().isoformat()))
                conn.commit()

            join_room(room_id)
            if target_id in connected_users:
                for sid in connected_users[target_id]:
                    socketio.emit('force_join_room', {'room_id': room_id}, room=sid)

            emit('private_chat_ready', {'room_id': room_id})
    finally:
        conn.close()


@socketio.on('join_chat')
def join_chat(data):
    room_id = data['room_id']
    join_room(room_id)
    conn = get_db()

    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        conn.close()
        return

    try:
        with conn.cursor() as c:
            c.execute("SELECT blocked_id FROM blocked_users WHERE blocker_id = %s", (user_id,))
            blocked_by_me = [r['blocked_id'] for r in c.fetchall()]
            c.execute("SELECT blocker_id FROM blocked_users WHERE blocked_id = %s", (user_id,))
            blockers = [r['blocker_id'] for r in c.fetchall()]
            all_invisible = set(blocked_by_me + blockers)

            c.execute('''SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
                         FROM messages m
                                  JOIN users u ON m.sender_id = u.id
                         WHERE m.room_id = %s
                         ORDER BY m.created_at''', (room_id,))

            raw_messages = c.fetchall()
            messages = []

            for row in raw_messages:
                deleted_for = json.loads(row['deleted_for']) if row['deleted_for'] else []
                if user_id not in deleted_for:
                    msg_dict = dict(row)

                    if msg_dict['sender_id'] in all_invisible:
                        msg_dict['sender_avatar'] = None

                    c.execute('''SELECT r.user_id, r.reaction, u.name, u.avatar
                                 FROM message_reactions r
                                          JOIN users u ON r.user_id = u.id
                                 WHERE message_id = %s''', (msg_dict['id'],))
                    reactions_rows = c.fetchall()
                    reactions_map = {}
                    for r in reactions_rows:
                        reactions_map[r['user_id']] = {'reaction': r['reaction'], 'name': r['name'],
                                                       'avatar': r['avatar']}

                    msg_dict['reactions'] = reactions_map
                    messages.append(msg_dict)

            c.execute("SELECT * FROM rooms WHERE id = %s", (room_id,))
            room_info = c.fetchone()

            if room_info and room_info['type'] == 'group':
                c.execute('''SELECT u.id, u.name, u.avatar, p.role
                             FROM users u
                                      JOIN participants p ON u.id = p.user_id
                             WHERE p.room_id = %s''', (room_id,))
                participants = [dict(u) for u in c.fetchall()]

                for p in participants:
                    if p['id'] in all_invisible:
                        p['avatar'] = None

                emit('group_details',
                     {'room_id': room_id, 'created_by': room_info['created_by'], 'participants': participants})

            emit('chat_history', {'room_id': room_id, 'messages': messages})
    finally:
        conn.close()


@socketio.on('send_message')
def handle_message(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data.get('room_id')
    content = data.get('content')
    msg_type = data.get('type', 'text')

    if not room_id:
        emit('message_error', {'error': 'Чат не обрано'})
        return

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute(
                "SELECT 1 FROM blocked_users WHERE blocker_id IN (SELECT user_id FROM participants WHERE room_id = %s AND user_id != %s) AND blocked_id = %s",
                (room_id, user_id, user_id))
            if c.fetchone():
                emit('message_error', {'error': 'User has blocked you'})
                return

            c.execute(
                "INSERT INTO messages (room_id, sender_id, type, content, created_at) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (room_id, user_id, msg_type, content, datetime.now().isoformat()))
            msg_id = c.fetchone()['id']

            c.execute("SELECT name, avatar FROM users WHERE id = %s", (user_id,))
            user = c.fetchone()

            c.execute("SELECT type, deleted_for FROM rooms WHERE id = %s", (room_id,))
            room = c.fetchone()
            if room:
                deleted_for = json.loads(room['deleted_for']) if room['deleted_for'] else []
                if deleted_for:
                    c.execute("UPDATE rooms SET deleted_for = NULL WHERE id = %s", (room_id,))

                if room['type'] == 'group':
                    details = 'Надіслав повідомлення'
                    if msg_type == 'voice':
                        details = 'Надіслав голосове'
                    elif msg_type == 'video':
                        details = 'Надіслав відеоповідомлення'
                    c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                              (room_id, 'message', f"{user['name']}: {details}", datetime.now().isoformat()))

            conn.commit()

            emit('new_message', {
                'id': msg_id, 'room_id': room_id, 'sender_id': user_id,
                'sender_name': user['name'], 'sender_avatar': user['avatar'],
                'type': msg_type, 'content': content, 'created_at': datetime.now().isoformat(), 'reactions': {}
            }, to=room_id)
    finally:
        conn.close()


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
    try:
        with conn.cursor() as c:
            c.execute("SELECT sender_id FROM messages WHERE id = %s", (msg_id,))
            msg = c.fetchone()
            if not msg:
                return

            sender_id = msg['sender_id']
            c.execute("SELECT 1 FROM blocked_users WHERE blocker_id = %s AND blocked_id = %s", (sender_id, user_id))
            if c.fetchone():
                return

            c.execute(
                """INSERT INTO message_reactions (message_id, user_id, reaction, created_at)
                   VALUES (%s, %s, %s, %s) ON CONFLICT (message_id, user_id) 
                   DO
                UPDATE SET reaction = EXCLUDED.reaction, created_at = EXCLUDED.created_at""",
                (msg_id, user_id, reaction, datetime.now().isoformat()))
            conn.commit()

            c.execute(
                "SELECT r.user_id, r.reaction, u.name, u.avatar FROM message_reactions r JOIN users u ON r.user_id = u.id WHERE message_id = %s",
                (msg_id,))
            rows = c.fetchall()
            reactions_map = {}
            for r in rows:
                reactions_map[r['user_id']] = {'reaction': r['reaction'], 'name': r['name'], 'avatar': r['avatar']}

            c.execute("SELECT name FROM users WHERE id = %s", (user_id,))
            user = c.fetchone()

            emit('reaction_added', {'id': msg_id, 'room_id': room_id, 'reactions': reactions_map}, to=room_id)

            if sender_id != user_id and sender_id in connected_users:
                for sid in connected_users[sender_id]:
                    emit('notification',
                         {'title': user['name'], 'body': f'Відреагував {reaction} на ваше повідомлення'},
                         room=sid)
    finally:
        conn.close()


@socketio.on('remove_reaction')
def remove_reaction(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    msg_id = data['id']
    room_id = data['room_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT sender_id FROM messages WHERE id = %s", (msg_id,))
            msg = c.fetchone()

            c.execute("DELETE FROM message_reactions WHERE message_id = %s AND user_id = %s", (msg_id, user_id))
            conn.commit()

            c.execute(
                "SELECT r.user_id, r.reaction, u.name, u.avatar FROM message_reactions r JOIN users u ON r.user_id = u.id WHERE message_id = %s",
                (msg_id,))
            rows = c.fetchall()
            reactions_map = {}
            for r in rows:
                reactions_map[r['user_id']] = {'reaction': r['reaction'], 'name': r['name'], 'avatar': r['avatar']}

            c.execute("SELECT name FROM users WHERE id = %s", (user_id,))
            user = c.fetchone()

            emit('reaction_added', {'id': msg_id, 'room_id': room_id, 'reactions': reactions_map}, to=room_id)

            if msg and msg['sender_id'] != user_id and msg['sender_id'] in connected_users:
                for sid in connected_users[msg['sender_id']]:
                    emit('notification', {'title': user['name'], 'body': f'Прибрав реакцію з вашого повідомлення'},
                         room=sid)
    finally:
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
    try:
        with conn.cursor() as c:
            c.execute("UPDATE messages SET content = %s, edited_at = %s WHERE id = %s AND sender_id = %s",
                      (new_content, edited_at, msg_id, user_id))

            if c.rowcount > 0:
                conn.commit()
                emit('message_edited',
                     {'id': msg_id, 'content': new_content, 'room_id': room_id, 'edited_at': edited_at},
                     to=room_id)
    finally:
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
    try:
        with conn.cursor() as c:
            if for_everyone:
                c.execute("DELETE FROM messages WHERE id = %s AND sender_id = %s", (msg_id, user_id))
                if c.rowcount > 0:
                    c.execute("DELETE FROM message_reactions WHERE message_id = %s", (msg_id,))
                    conn.commit()
                    emit('message_deleted', {'id': msg_id, 'room_id': room_id}, to=room_id)
            else:
                c.execute("SELECT deleted_for FROM messages WHERE id = %s", (msg_id,))
                row = c.fetchone()
                if row:
                    deleted_for = json.loads(row['deleted_for']) if row['deleted_for'] else []
                    if user_id not in deleted_for:
                        deleted_for.append(user_id)
                        c.execute("UPDATE messages SET deleted_for = %s WHERE id = %s",
                                  (json.dumps(deleted_for), msg_id))
                        conn.commit()
                        emit('message_hidden', {'id': msg_id, 'room_id': room_id}, room=request.sid)
    finally:
        conn.close()
