from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from .database import get_db
from .extensions import socketio
from datetime import datetime
import secrets
import psycopg
import base64
import json

api_bp = Blueprint('api', __name__, url_prefix='/api')


def log_group_action(room_id, action, details):
    conn = get_db()
    with conn.cursor() as c:
        c.execute("INSERT INTO group_logs (room_id, action, details, timestamp) VALUES (%s, %s, %s, %s)",
                  (room_id, action, details, datetime.now().isoformat()))
        conn.commit()
    conn.close()


@api_bp.route('/auth/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    password = data.get('password')

    if not name or not password:
        return jsonify({'error': 'Required fields missing'}), 400

    conn = get_db()
    try:
        user_id = secrets.token_hex(4)
        pw_hash = generate_password_hash(password)
        timestamp = datetime.now().isoformat()

        with conn.cursor() as c:
            c.execute("INSERT INTO users (id, name, password_hash, created_at) VALUES (%s, %s, %s, %s)",
                      (user_id, name, pw_hash, timestamp))

            c.execute("INSERT INTO participants (room_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                      ('general', user_id, 'member', timestamp))
            conn.commit()

        access_token = create_access_token(identity=user_id)
        refresh_token = create_refresh_token(identity=user_id)

        socketio.emit('user_registered', {
            'id': user_id,
            'name': name,
            'avatar': None,
            'is_online': True,
            'last_active': timestamp
        })

        return jsonify({
            'status': 'ok',
            'access_token': access_token,
            'refresh_token': refresh_token,
            'user_id': user_id,
            'name': name
        })
    except psycopg.errors.UniqueViolation:
        return jsonify({'error': 'User already exists'}), 409
    finally:
        conn.close()


@api_bp.route('/auth/login', methods=['POST'])
def login():
    data = request.json
    name = data.get('name')
    password = data.get('password')

    conn = get_db()
    with conn.cursor() as c:
        c.execute("SELECT * FROM users WHERE name = %s", (name,))
        user = c.fetchone()
    conn.close()

    if user and check_password_hash(user['password_hash'], password):
        access_token = create_access_token(identity=user['id'])
        refresh_token = create_refresh_token(identity=user['id'])
        return jsonify({
            'access_token': access_token,
            'refresh_token': refresh_token,
            'user_id': user['id'],
            'name': user['name'],
            'avatar': user['avatar']
        })

    return jsonify({'error': 'Invalid credentials'}), 401


@api_bp.route('/auth/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    identity = get_jwt_identity()
    access_token = create_access_token(identity=identity)
    return jsonify(access_token=access_token)


@api_bp.route('/user/block', methods=['POST'])
@jwt_required()
def block_user():
    user_id = get_jwt_identity()
    target_id = request.json.get('target_id')
    action = request.json.get('action')

    conn = get_db()
    with conn.cursor() as c:
        if action == 'block':
            try:
                c.execute("INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (%s, %s)", (user_id, target_id))
            except psycopg.errors.UniqueViolation:
                pass
        else:
            c.execute("DELETE FROM blocked_users WHERE blocker_id = %s AND blocked_id = %s", (user_id, target_id))
        conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/user/profile', methods=['POST'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    bio = request.form.get('bio')
    real_name = request.form.get('real_name')
    birth_date = request.form.get('birth_date')
    gender = request.form.get('gender')

    conn = get_db()
    with conn.cursor() as c:
        c.execute("UPDATE users SET bio = %s, real_name = %s, birth_date = %s, gender = %s WHERE id = %s",
                  (bio, real_name, birth_date, gender, user_id))
        conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/user/avatar/upload', methods=['POST'])
@jwt_required()
def upload_avatar_gallery():
    user_id = get_jwt_identity()
    data = request.json
    file_content = data.get('image')

    if file_content:
        conn = get_db()
        with conn.cursor() as c:
            c.execute("SELECT avatars_gallery FROM users WHERE id = %s", (user_id,))
            row = c.fetchone()
            gallery = json.loads(row['avatars_gallery']) if row['avatars_gallery'] else []

            if file_content not in gallery:
                gallery.insert(0, file_content)

            c.execute("UPDATE users SET avatars_gallery = %s, avatar = %s WHERE id = %s",
                      (json.dumps(gallery), file_content, user_id))
            conn.commit()
            socketio.emit('user_updated', {'id': user_id, 'avatar': file_content, 'avatars_gallery': gallery})
        conn.close()
        return jsonify({'status': 'ok', 'avatar': file_content, 'gallery': gallery})
    return jsonify({'error': 'No file'}), 400


@api_bp.route('/user/avatar/delete', methods=['POST'])
@jwt_required()
def delete_avatar_from_gallery():
    user_id = get_jwt_identity()
    data = request.json
    avatar_to_delete = data.get('avatar')
    conn = get_db()
    with conn.cursor() as c:
        c.execute("SELECT avatars_gallery, avatar FROM users WHERE id = %s", (user_id,))
        row = c.fetchone()
        if row:
            gallery = json.loads(row['avatars_gallery']) if row['avatars_gallery'] else []
            if avatar_to_delete in gallery:
                gallery.remove(avatar_to_delete)
                new_current = row['avatar']
                if row['avatar'] == avatar_to_delete:
                    new_current = gallery[0] if gallery else None
                c.execute("UPDATE users SET avatars_gallery = %s, avatar = %s WHERE id = %s",
                          (json.dumps(gallery), new_current, user_id))
                conn.commit()
                socketio.emit('user_updated', {'id': user_id, 'avatar': new_current, 'avatars_gallery': gallery})
                conn.close()
                return jsonify({'status': 'ok', 'avatar': new_current, 'gallery': gallery})
    conn.close()
    return jsonify({'error': 'Not found'}), 404


@api_bp.route('/user/avatar/select', methods=['POST'])
@jwt_required()
def select_avatar():
    user_id = get_jwt_identity()
    data = request.json
    avatar_content = data.get('avatar')
    conn = get_db()
    with conn.cursor() as c:
        c.execute("UPDATE users SET avatar = %s WHERE id = %s", (avatar_content, user_id))
        conn.commit()
        socketio.emit('user_updated', {'id': user_id, 'avatar': avatar_content})
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/group/logs', methods=['POST'])
@jwt_required()
def get_group_logs():
    user_id = get_jwt_identity()
    room_id = request.json.get('room_id')
    conn = get_db()
    with conn.cursor() as c:
        c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
        participant = c.fetchone()

        if not participant or participant['role'] not in ('owner', 'admin'):
            conn.close()
            return jsonify({'error': 'Unauthorized'}), 403

        c.execute("SELECT created_by, created_at FROM rooms WHERE id = %s", (room_id,))
        room = c.fetchone()

        c.execute("SELECT * FROM group_logs WHERE room_id = %s ORDER BY timestamp DESC LIMIT 100", (room_id,))
        logs = [dict(row) for row in c.fetchall()]
        info = {'created_at': room['created_at'], 'created_by': room['created_by']}
    conn.close()
    return jsonify({'status': 'ok', 'logs': logs, 'info': info})


@api_bp.route('/group/update', methods=['POST'])
@jwt_required()
def update_group():
    user_id = get_jwt_identity()
    room_id = request.json.get('room_id')
    name = request.json.get('name')
    avatar_data = request.json.get('image')
    conn = get_db()
    with conn.cursor() as c:
        c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
        participant = c.fetchone()

        c.execute("SELECT name FROM rooms WHERE id = %s", (room_id,))
        room = c.fetchone()

        if not participant or participant['role'] not in ('owner', 'admin'):
            conn.close()
            return jsonify({'error': 'Unauthorized'}), 403

        updates = []
        params = []
        log_details = []
        if name and name != room['name']:
            updates.append("name = %s")
            params.append(name)
            log_details.append(f"Назва змінена на {name}")
        if avatar_data:
            updates.append("avatar = %s")
            params.append(avatar_data)
            log_details.append("Аватар оновлено")
        if updates:
            params.append(room_id)
            c.execute(f"UPDATE rooms SET {', '.join(updates)} WHERE id = %s", tuple(params))
            conn.commit()
            log_group_action(room_id, "Оновлення інфо", "; ".join(log_details))
            socketio.emit('group_updated', {'id': room_id, 'name': name, 'avatar': avatar_data})
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/chat/delete', methods=['POST'])
@jwt_required()
def delete_chat():
    user_id = get_jwt_identity()
    room_id = request.json.get('room_id')
    mutual = request.json.get('mutual')

    conn = get_db()
    with conn.cursor() as c:
        c.execute("SELECT created_by, type, deleted_for FROM rooms WHERE id = %s", (room_id,))
        room = c.fetchone()

        if not room:
            conn.close()
            return jsonify({'error': 'Not found'}), 404

        if mutual:
            if room['type'] == 'group' and room['created_by'] != user_id:
                conn.close()
                return jsonify({'error': 'Unauthorized'}), 403

            c.execute("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = %s)",
                      (room_id,))
            c.execute("DELETE FROM messages WHERE room_id = %s", (room_id,))
            c.execute("DELETE FROM participants WHERE room_id = %s", (room_id,))
            c.execute("DELETE FROM group_logs WHERE room_id = %s", (room_id,))
            c.execute("DELETE FROM rooms WHERE id = %s", (room_id,))
            conn.commit()
            socketio.emit('chat_deleted', {'id': room_id, 'mutual': True})
        else:
            deleted_for = json.loads(room['deleted_for']) if room['deleted_for'] else []
            if user_id not in deleted_for:
                deleted_for.append(user_id)
                c.execute("UPDATE rooms SET deleted_for = %s WHERE id = %s", (json.dumps(deleted_for), room_id))
                conn.commit()

            socketio.emit('chat_deleted', {'id': room_id, 'mutual': False}, to=request.sid)

    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/group/participants', methods=['POST'])
@jwt_required()
def manage_participants():
    user_id = get_jwt_identity()
    data = request.json
    action = data.get('action')
    room_id = data.get('room_id')
    target_id = data.get('target_id')

    conn = get_db()
    with conn.cursor() as c:
        c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
        requester = c.fetchone()
        requester_role = requester['role'] if requester else None

        if not requester_role:
            conn.close()
            return jsonify({'error': 'Unauthorized'}), 403

        if action in ('add', 'remove'):
            if requester_role not in ('owner', 'admin'):
                conn.close()
                return jsonify({'error': 'Unauthorized'}), 403

            if action == 'remove':
                c.execute("SELECT role FROM participants WHERE room_id = %s AND user_id = %s", (room_id, target_id))
                target = c.fetchone()
                if target:
                    if target['role'] == 'owner':
                        conn.close()
                        return jsonify({'error': 'Cannot remove owner'}), 403
                    if target['role'] == 'admin' and requester_role != 'owner':
                        conn.close()
                        return jsonify({'error': 'Admins cannot remove other admins'}), 403

        c.execute("SELECT name FROM users WHERE id = %s", (target_id,))
        target_user = c.fetchone()
        target_name = target_user['name'] if target_user else 'Unknown'

        c.execute("SELECT name FROM users WHERE id = %s", (user_id,))
        requester_name = c.fetchone()['name']

        if action == 'add':
            try:
                c.execute("INSERT INTO participants (room_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                          (room_id, target_id, 'member', datetime.now().isoformat()))
                conn.commit()
                c.execute("SELECT name, avatar FROM users WHERE id = %s", (target_id,))
                u = c.fetchone()
                log_group_action(room_id, "Додавання учасника", f"{requester_name} додав {target_name}")
                socketio.emit('participant_added',
                              {'room_id': room_id,
                               'user': {'id': target_id, 'name': u['name'], 'avatar': u['avatar'], 'role': 'member'}})
            except:
                pass

        elif action == 'remove':
            c.execute("DELETE FROM participants WHERE room_id = %s AND user_id = %s", (room_id, target_id))
            conn.commit()
            log_group_action(room_id, "Видалення учасника", f"{requester_name} видалив {target_name}")
            socketio.emit('participant_removed', {'room_id': room_id, 'user_id': target_id})

        elif action == 'leave':
            if requester_role == 'owner':
                c.execute("SELECT COUNT(*) as count FROM participants WHERE room_id = %s", (room_id,))
                if c.fetchone()['count'] > 1:
                    conn.close()
                    return jsonify({'error': 'Owner cannot leave without deleting or transferring ownership'}), 400

            c.execute("DELETE FROM participants WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            conn.commit()
            log_group_action(room_id, "Вихід учасника", f"{requester_name} покинув групу")
            socketio.emit('participant_removed', {'room_id': room_id, 'user_id': user_id})

    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/upload', methods=['POST'])
@jwt_required()
def upload_file():
    user_id = get_jwt_identity()
    file = request.files.get('file')
    room_id = request.form.get('room_id')
    caption = request.form.get('caption', '')
    if file and room_id:
        conn = get_db()
        with conn.cursor() as c:
            c.execute(
                "SELECT 1 FROM blocked_users WHERE blocker_id IN (SELECT user_id FROM participants WHERE room_id = %s AND user_id != %s) AND blocked_id = %s",
                (room_id, user_id, user_id))
            if c.fetchone():
                conn.close()
                return jsonify({'error': 'Blocked'}), 403

            file_content = base64.b64encode(file.read()).decode('utf-8')
            timestamp = datetime.now().isoformat()

            payload = json.dumps({'file': file_content, 'caption': caption})

            c.execute(
                "INSERT INTO messages (room_id, sender_id, type, content, filename, created_at) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (room_id, user_id, 'file', payload, file.filename, timestamp))
            file_msg_id = c.fetchone()['id']

            c.execute("SELECT name, avatar FROM users WHERE id = %s", (user_id,))
            user = c.fetchone()
            c.execute("SELECT type FROM rooms WHERE id = %s", (room_id,))
            room = c.fetchone()
            if room and room['type'] == 'group':
                log_group_action(room_id, "Файл", f"{user['name']} надіслав файл: {file.filename}")

            conn.commit()

            socketio.emit('new_message', {
                'id': file_msg_id, 'room_id': room_id, 'sender_id': user_id,
                'sender_name': user['name'], 'sender_avatar': user['avatar'],
                'type': 'file', 'content': payload, 'filename': file.filename, 'created_at': timestamp
            }, to=room_id)
        conn.close()
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Bad request'}), 400
