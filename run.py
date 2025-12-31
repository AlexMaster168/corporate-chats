from app import create_app, socketio
import os

app = create_app()

if __name__ == '__main__':
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        print('Сервер успішно запущено!')
        print('Посилання на сайт: http://127.0.0.1:5000')

    socketio.run(app, debug=True, port=5000)
