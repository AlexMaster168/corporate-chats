import { getAccessToken, getMyId } from '../api.js';
import { encrypt, decrypt } from '../utils.js';
import * as UI from '../ui.js';

let selectedFile = null;

export function setSelectedFile(file) {
    selectedFile = file;
}

export function sendMessage(socket, currentRoom) {
    if (selectedFile) {
        uploadFile(currentRoom);
        return;
    }

    if (UI.finishEditing(socket, currentRoom)) {
        return;
    }

    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if(!text || !currentRoom) return;

    socket.emit('send_message', {
        token: getAccessToken(),
        room_id: currentRoom,
        content: encrypt(text),
        type: 'text'
    });
    input.value = '';
    document.getElementById('emoji-picker').style.display = 'none';
}

export function handleFileSelect(input) {
    if (input.files.length) {
        selectedFile = input.files[0];
        document.getElementById('file-preview').style.display = 'block';
        document.getElementById('file-name').innerText = selectedFile.name;
        document.getElementById('send-btn').innerText = 'Отправить';
    }
}

export function cancelFile() {
    selectedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('file-preview').style.display = 'none';
    document.getElementById('file-caption').value = '';
    document.getElementById('send-btn').innerText = '➤';
}

export async function uploadFile(currentRoom) {
    if(!selectedFile || !currentRoom) return;
    const caption = document.getElementById('file-caption').value.trim();
    let finalCaption = caption ? encrypt(caption) : '';
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('room_id', currentRoom);
    formData.append('caption', finalCaption);

    const token = getAccessToken();
    await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    cancelFile();
}