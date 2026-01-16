import {fetchWithAuth, getAccessToken} from '../api.js';
import * as UI from '../ui.js';

let fileToSend = null;

export function handleFileSelect(input) {
    if (input.files && input.files[0]) {
        fileToSend = input.files[0];
        document.getElementById('file-preview').style.display = 'block';
        document.getElementById('file-name').innerText = fileToSend.name;
    }
}

export function cancelFile() {
    fileToSend = null;
    document.getElementById('file-input').value = '';
    document.getElementById('file-preview').style.display = 'none';
    document.getElementById('file-caption').value = '';
}

export function sendMessage(socket, currentRoom) {
    if (!currentRoom) {
        alert('Будь ласка, оберіть чат');
        return;
    }

    if (fileToSend) {
        const formData = new FormData();
        formData.append('file', fileToSend);
        formData.append('room_id', currentRoom);
        formData.append('caption', document.getElementById('file-caption').value);

        fetchWithAuth('/api/upload', {
            method: 'POST',
            body: formData
        }).then(() => {
            cancelFile();
        });
        return;
    }

    if (UI.isEditing()) {
        const {id, content} = UI.finishEditing();
        if (content.trim()) {
            socket.emit('edit_message', {
                token: getAccessToken(),
                id: id,
                content: content,
                room_id: currentRoom
            });
        }
        return;
    }

    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content) return;

    socket.emit('send_message', {
        token: getAccessToken(),
        room_id: currentRoom,
        content: content,
        type: 'text'
    });
    input.value = '';
}

window.addReaction = (id, reaction) => {
    const currentRoom = window.currentRoomId || localStorage.getItem('lastRoom');
};

window.editMessage = (id, type) => {
    UI.startEditing(id, type);
};

window.deleteMessage = (id, forEveryone) => {
    if (confirm('Видалити повідомлення?')) {
        const currentRoom = document.querySelector('.list-item.active').getAttribute('onclick').match(/'([^']+)'/)[1];
        window.socket.emit('delete_message', {
            token: getAccessToken(),
            id: id,
            room_id: currentRoom,
            for_everyone: forEveryone
        });
    }
};

window.toggleReaction = (msgId, roomId) => {
    window.socket.emit('remove_reaction', {
        token: getAccessToken(),
        id: msgId,
        room_id: roomId
    });
};

window.addReaction = (msgId, reaction) => {
    const currentRoom = document.querySelector('.list-item.active').getAttribute('onclick').match(/'([^']+)'/)[1];
    window.socket.emit('add_reaction', {
        token: getAccessToken(),
        id: msgId,
        reaction: reaction,
        room_id: currentRoom
    });
};