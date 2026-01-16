from flask_socketio import SocketIO
from flask_jwt_extended import JWTManager

socketio = SocketIO(cors_allowed_origins="*", max_http_buffer_size=500 * 1024 * 1024)
jwt = JWTManager()