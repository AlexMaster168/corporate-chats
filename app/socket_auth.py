from flask import request
from flask_socketio import emit, join_room
from flask_jwt_extended import decode_token
from .extensions import socketio
from .database import get_db
from datetime import datetime
import json
from .socket_utils import connected_users, calculate_age


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
    with conn.cursor() as c:
        c.execute("UPDATE users SET last_active = %s WHERE id = %s", (datetime.now().isoformat(), user_id))
        conn.commit()

        c.execute("SELECT room_id FROM participants WHERE user_id = %s", (user_id,))
        rooms = c.fetchall()
        for room in rooms:
            join_room(room['room_id'])
    conn.close()


@socketio.on('disconnect')
def on_disconnect(reason=None):
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
        try:
            with conn.cursor() as c:
                c.execute("UPDATE users SET last_active = %s WHERE id = %s", (last_seen, dead_user))
                conn.commit()

                c.execute("SELECT gender FROM users WHERE id = %s", (dead_user,))
                user = c.fetchone()
                gender = user['gender'] if user else 'male'
                socketio.emit('user_status',
                              {'user_id': dead_user, 'status': 'offline', 'last_active': last_seen, 'gender': gender})
        except Exception:
            pass
        finally:
            conn.close()


@socketio.on('get_data')
def get_data(data):
    try:
        token = data.get('token')
        decoded = decode_token(token)
        user_id = decoded['sub']
    except:
        return

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT blocked_id FROM blocked_users WHERE blocker_id = %s", (user_id,))
            blocked_by_me = [r['blocked_id'] for r in c.fetchall()]

            c.execute("SELECT blocker_id FROM blocked_users WHERE blocked_id = %s", (user_id,))
            blockers = [r['blocker_id'] for r in c.fetchall()]

            all_invisible = set(blocked_by_me + blockers)

            c.execute('''SELECT r.id, r.name, r.type, r.avatar, r.created_by, r.deleted_for
                         FROM rooms r
                                  JOIN participants p ON r.id = p.room_id
                         WHERE p.user_id = %s''', (user_id,))
            my_rooms = []
            for row in c.fetchall():
                deleted_for = json.loads(row['deleted_for']) if row['deleted_for'] else []
                if user_id in deleted_for:
                    continue

                r_dict = dict(row)
                del r_dict['deleted_for']

                if r_dict['type'] == 'private':
                    c.execute('''SELECT u.id, u.name, u.avatar
                                 FROM users u
                                          JOIN participants p ON u.id = p.user_id
                                 WHERE p.room_id = %s
                                   AND u.id != %s''', (r_dict['id'], user_id))
                    other_user = c.fetchone()
                    if other_user:
                        if other_user['id'] in all_invisible:
                            r_dict['name'] = other_user['name']
                            r_dict['avatar'] = None
                        else:
                            r_dict['name'] = other_user['name']
                            r_dict['avatar'] = other_user['avatar']

                c.execute('''SELECT u.id, u.name, u.avatar, p.role
                             FROM users u
                                      JOIN participants p ON u.id = p.user_id
                             WHERE p.room_id = %s''', (r_dict['id'],))
                r_dict['participants'] = [dict(u) for u in c.fetchall()]
                my_rooms.append(r_dict)

            c.execute(
                "SELECT id, name, real_name, avatar, last_active, bio, avatars_gallery, gender, birth_date FROM users WHERE id != %s",
                (user_id,))
            all_users = []
            for row in c.fetchall():
                u = dict(row)

                if u['id'] in all_invisible:
                    u['bio'] = ''
                    u['real_name'] = ''
                    u['birth_date'] = ''
                    u['age'] = None
                    u['avatars_gallery'] = []
                    u['avatar'] = None
                    u['is_online'] = False
                    u['last_active'] = None
                else:
                    u['is_online'] = u['id'] in connected_users
                    u['age'] = calculate_age(u['birth_date'])
                    u['avatars_gallery'] = json.loads(u['avatars_gallery']) if u['avatars_gallery'] else []

                all_users.append(u)

            c.execute("SELECT bio, avatars_gallery, avatar, real_name, birth_date, gender FROM users WHERE id = %s",
                      (user_id,))
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

            emit('data_update', {'rooms': my_rooms, 'users': all_users, 'my_profile': my_profile})
    finally:
        conn.close()


@socketio.on('update_profile')
def update_profile(data):
    try:
        token = data.get('token')
        user_id = decode_token(token)['sub']
    except:
        return

    real_name = data.get('real_name')
    birth_date = data.get('birth_date')
    gender = data.get('gender')
    bio = data.get('bio')

    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("UPDATE users SET real_name = %s, birth_date = %s, gender = %s, bio = %s WHERE id = %s",
                      (real_name, birth_date, gender, bio, user_id))
            conn.commit()

            c.execute(
                "SELECT id, name, real_name, avatar, last_active, bio, avatars_gallery, gender, birth_date FROM users WHERE id = %s",
                (user_id,))
            user = dict(c.fetchone())
            user['age'] = calculate_age(user['birth_date'])
            user['avatars_gallery'] = json.loads(user['avatars_gallery']) if user['avatars_gallery'] else []
            user['is_online'] = True

            emit('profile_updated', {'user_id': user_id, 'user_data': user}, broadcast=True)
            emit('my_profile_saved', {'status': 'ok'})
    finally:
        conn.close()
