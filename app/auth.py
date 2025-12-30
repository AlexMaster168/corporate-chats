from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from .database import get_db
from .events import socketio
from datetime import datetime
import secrets
import sqlite3

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    password = data.get('password')

    if not name or not password:
        return jsonify({'error': 'Name and password required'}), 400

    conn = get_db()
    c = conn.cursor()

    try:
        user_id = secrets.token_hex(4)
        pw_hash = generate_password_hash(password)
        timestamp = datetime.now().isoformat()

        c.execute("INSERT INTO users (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                  (user_id, name, pw_hash, timestamp))

        c.execute("INSERT INTO participants (room_id, user_id, joined_at) VALUES (?, ?, ?)",
                  ('general', user_id, timestamp))
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
    except sqlite3.IntegrityError:
        return jsonify({'error': 'User already exists'}), 409
    finally:
        conn.close()


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.json
    name = data.get('name')
    password = data.get('password')

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE name = ?", (name,))
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


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    identity = get_jwt_identity()
    access_token = create_access_token(identity=identity)
    return jsonify(access_token=access_token)
