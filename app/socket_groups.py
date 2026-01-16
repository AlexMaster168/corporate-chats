from flask import request
from flask_socketio import emit, join_room, leave_room
from flask_jwt_extended import decode_token
from .extensions import socketio
from .database import get_db
from datetime import datetime
import secrets
import json
from .socket_utils import connected_users


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
    try:
        with conn.cursor() as c:
            c.execute("INSERT INTO rooms (id, type, name, created_by, created_at) VALUES (%s, %s, %s, %s, %s)",
                      (new_room_id, 'group', name, creator, datetime.now().isoformat()))
            c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                      (new_room_id, 'create', f'Група створена', datetime.now().isoformat()))

            for member in members:
                role = 'owner' if member == creator else 'member'
                c.execute("INSERT INTO participants (room_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                          (new_room_id, member, role, datetime.now().isoformat()))
                if member in connected_users:
                    for sid in connected_users[member]:
                        socketio.emit('force_join_room', {'room_id': new_room_id}, room=sid)

            conn.commit()
            join_room(new_room_id)
            emit('group_created', {'id': new_room_id}, broadcast=True)
    finally:
        conn.close()


@socketio.on('update_group_settings')
def update_group_settings(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']
    name = data.get('name')

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            p = c.fetchone()

            if not p or p['role'] not in ('owner', 'admin'):
                return

            c.execute("UPDATE rooms SET name = %s WHERE id = %s", (name, room_id))

            if c.rowcount > 0:
                c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                          (room_id, 'update', f'Назву змінено на {name}', datetime.now().isoformat()))
                conn.commit()
                emit('group_update', {'room_id': room_id, 'name': name}, to=room_id)
    finally:
        conn.close()


@socketio.on('add_group_participant')
def add_group_participant(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']
    target_id = data['target_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            p = c.fetchone()

            if not p or p['role'] not in ('owner', 'admin'):
                return

            try:
                c.execute("INSERT INTO participants (room_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                          (room_id, target_id, 'member', datetime.now().isoformat()))

                c.execute("SELECT name FROM users WHERE id = %s", (target_id,))
                target_name = c.fetchone()['name']

                c.execute("SELECT name FROM users WHERE id = %s", (user_id,))
                requester_name = c.fetchone()['name']

                c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                          (room_id, 'add', f'{requester_name} додав {target_name}', datetime.now().isoformat()))
                conn.commit()

                if target_id in connected_users:
                    for sid in connected_users[target_id]:
                        socketio.emit('force_join_room', {'room_id': room_id}, room=sid)

                c.execute('''SELECT u.id, u.name, u.avatar, p.role
                             FROM users u
                                      JOIN participants p ON u.id = p.user_id
                             WHERE p.room_id = %s''', (room_id,))
                participants = [dict(u) for u in c.fetchall()]

                emit('group_update', {'room_id': room_id, 'participants': participants}, to=room_id)

            except:
                pass
    finally:
        conn.close()


@socketio.on('remove_group_participant')
def remove_group_participant(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']
    target_id = data['target_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            requester = c.fetchone()

            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, target_id))
            target = c.fetchone()

            if not requester or requester['role'] not in ('owner', 'admin'):
                return

            if target and target['role'] == 'owner':
                return

            if target and target['role'] == 'admin' and requester['role'] != 'owner':
                return

            c.execute("DELETE FROM participants WHERE room_id = %s AND user_id = %s", (room_id, target_id))

            c.execute("SELECT name FROM users WHERE id = %s", (target_id,))
            target_name = c.fetchone()['name']

            c.execute("SELECT name FROM users WHERE id = %s", (user_id,))
            requester_name = c.fetchone()['name']

            c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                      (room_id, 'remove', f'{requester_name} видалив {target_name}', datetime.now().isoformat()))
            conn.commit()

            if target_id in connected_users:
                for sid in connected_users[target_id]:
                    leave_room(room_id, sid)
                    socketio.emit('force_leave_room', {'room_id': room_id}, room=sid)

            c.execute('''SELECT u.id, u.name, u.avatar, p.role
                         FROM users u
                                  JOIN participants p ON u.id = p.user_id
                         WHERE p.room_id = %s''', (room_id,))
            participants = [dict(u) for u in c.fetchall()]

            emit('group_update', {'room_id': room_id, 'participants': participants}, to=room_id)
    finally:
        conn.close()


@socketio.on('leave_group')
def leave_group(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            requester = c.fetchone()

            if not requester:
                return

            if requester['role'] == 'owner':
                c.execute("SELECT count(*) as cnt FROM participants WHERE room_id = %s", (room_id,))
                if c.fetchone()['cnt'] > 1:
                    return

            c.execute("DELETE FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))

            c.execute("SELECT name FROM users WHERE id = %s", (user_id,))
            user_name = c.fetchone()['name']

            c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                      (room_id, 'leave', f'{user_name} покинув групу', datetime.now().isoformat()))
            conn.commit()

            leave_room(room_id, request.sid)
            socketio.emit('force_leave_room', {'room_id': room_id}, room=request.sid)

            c.execute('''SELECT u.id, u.name, u.avatar, p.role
                         FROM users u
                                  JOIN participants p ON u.id = p.user_id
                         WHERE p.room_id = %s''', (room_id,))
            participants = [dict(u) for u in c.fetchall()]

            emit('group_update', {'room_id': room_id, 'participants': participants}, to=room_id)
    finally:
        conn.close()


@socketio.on('promote_admin')
def promote_admin(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']
    target_id = data['target_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            requester = c.fetchone()

            if not requester or requester['role'] != 'owner':
                return

            c.execute("UPDATE participants SET role = 'admin' WHERE room_id = %s AND user_id = %s",
                      (room_id, target_id))

            c.execute("SELECT name FROM users WHERE id = %s", (target_id,))
            target_name = c.fetchone()['name']

            c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                      (room_id, 'promote', f'Користувача {target_name} призначено адміном', datetime.now().isoformat()))
            conn.commit()

            c.execute('''SELECT u.id, u.name, u.avatar, p.role
                         FROM users u
                                  JOIN participants p ON u.id = p.user_id
                         WHERE p.room_id = %s''', (room_id,))
            participants = [dict(u) for u in c.fetchall()]

            emit('group_update', {'room_id': room_id, 'participants': participants}, to=room_id)
    finally:
        conn.close()


@socketio.on('demote_admin')
def demote_admin(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']
    target_id = data['target_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            requester = c.fetchone()

            if not requester or requester['role'] != 'owner':
                return

            c.execute("UPDATE participants SET role = 'member' WHERE room_id = %s AND user_id = %s",
                      (room_id, target_id))

            c.execute("SELECT name FROM users WHERE id = %s", (target_id,))
            target_name = c.fetchone()['name']

            c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                      (room_id, 'demote', f'Адміна {target_name} розжалувано', datetime.now().isoformat()))
            conn.commit()

            c.execute('''SELECT u.id, u.name, u.avatar, p.role
                         FROM users u
                                  JOIN participants p ON u.id = p.user_id
                         WHERE p.room_id = %s''', (room_id,))
            participants = [dict(u) for u in c.fetchall()]

            emit('group_update', {'room_id': room_id, 'participants': participants}, to=room_id)
    finally:
        conn.close()


@socketio.on('delete_group')
def delete_group(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    room_id = data['room_id']

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            p = c.fetchone()

            if not p or p['role'] != 'owner':
                return

            c.execute("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = %s)",
                      (room_id,))
            c.execute("DELETE FROM messages WHERE room_id = %s", (room_id,))
            c.execute("DELETE FROM participants WHERE room_id = %s", (room_id,))
            c.execute("DELETE FROM group_logs WHERE room_id = %s", (room_id,))
            c.execute("DELETE FROM rooms WHERE id = %s", (room_id,))
            conn.commit()
            emit('force_leave_room', {'room_id': room_id}, to=room_id)
    finally:
        conn.close()
