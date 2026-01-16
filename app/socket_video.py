from flask_socketio import emit
from .extensions import socketio


@socketio.on('join_video_room')
def handle_join_video_room(data):
    emit('user_connected_video', {'peer_id': data['peer_id']}, to=data['room_id'], include_self=False)


@socketio.on('leave_video_room')
def handle_leave_video_room(data):
    emit('user_disconnected_video', {'peer_id': data['peer_id']}, to=data['room_id'])
