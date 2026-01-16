from flask import Flask, render_template
from datetime import timedelta
from dotenv import load_dotenv
import os
from .database import init_db
from .extensions import socketio, jwt

load_dotenv()


def create_app():
    app = Flask(__name__, template_folder='../templates', static_folder='../static')
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev_key')
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev_jwt')
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(minutes=15)
    app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)
    app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

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
