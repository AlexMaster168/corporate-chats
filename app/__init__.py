from flask import Flask, render_template
from flask_socketio import SocketIO
from flask_jwt_extended import JWTManager
from datetime import timedelta
from .database import init_db

socketio = SocketIO(cors_allowed_origins="*")
jwt = JWTManager()


def create_app():
    app = Flask(__name__, template_folder='../templates', static_folder='../static')
    app.config['SECRET_KEY'] = 'super-secret-key-change-in-prod'
    app.config['JWT_SECRET_KEY'] = 'jwt-secret-key-change-in-prod'
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(minutes=15)
    app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)

    jwt.init_app(app)
    socketio.init_app(app)

    init_db()

    from .auth import auth_bp
    from .api import api_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return render_template('login.html')

    @app.route('/chat')
    def chat():
        return render_template('chat.html')

    from . import events

    return app
