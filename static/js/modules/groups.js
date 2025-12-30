import { fetchWithAuth, getMyId, getAccessToken } from '../api.js';
import * as UI from '../ui.js';

let cachedRooms = [];
let currentRoom = null;

export function setCachedRooms(rooms) {
    cachedRooms = rooms;
}

export function getCachedRooms() {
    return cachedRooms;
}

export function setCurrentRoom(id) {
    currentRoom = id;
}

export function getCurrentRoom() {
    return currentRoom;
}

export function showCreateGroup(cachedUsers) {
    document.getElementById('group-modal').classList.add('active');
    const list = document.getElementById('user-select-list');
    list.innerHTML = cachedUsers.filter(u => u.id !== getMyId()).map(u =>
        `<label class="user-select-item"><input type="checkbox" value="${u.id}"> ${u.name}</label>`
    ).join('');
}

export function createGroup(socket) {
    const name = document.getElementById('new-group-name').value;
    const checkboxes = document.querySelectorAll('#user-select-list input:checked');
    const members = Array.from(checkboxes).map(cb => cb.value);
    if(!name || members.length === 0) return alert('Вкажіть назву та учасників');
    socket.emit('create_group', { token: getAccessToken(), name, members });
}

export async function openGroupSettings(roomId, cachedUsers) {
    const room = cachedRooms.find(r => r.id === roomId);
    if(!room) return;

    const isCreator = room.created_by === getMyId();

    document.getElementById('group-settings-modal').classList.add('active');
    document.getElementById('group-settings-name').value = room.name;
    document.getElementById('group-settings-name').disabled = !isCreator;
    const av = document.getElementById('group-settings-avatar');
    av.style.backgroundImage = room.avatar ? `url(data:image/png;base64,${room.avatar})` : '';

    document.getElementById('save-group-btn').style.display = isCreator ? 'block' : 'none';
    document.getElementById('delete-group-btn').style.display = isCreator ? 'block' : 'none';
    document.getElementById('leave-group-btn').style.display = !isCreator ? 'block' : 'none';
    document.getElementById('add-participant-btn').style.display = isCreator ? 'block' : 'none';
    document.getElementById('new-participant-select').style.display = isCreator ? 'block' : 'none';
    document.getElementById('logs-tab-btn').style.display = isCreator ? 'inline-block' : 'none';

    UI.renderParticipants(room.participants, getMyId(), isCreator ? removeParticipant : null);

    if(isCreator) {
        const select = document.getElementById('new-participant-select');
        const currentIds = room.participants.map(p => p.id);
        const available = cachedUsers.filter(u => !currentIds.includes(u.id));
        select.innerHTML = available.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    }

    showGroupTab('info');

    if(isCreator) {
        const logsRes = await fetchWithAuth('/api/group/logs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({room_id: roomId})
        });
        const logsData = await logsRes.json();
        if(logsData.status === 'ok') {
            const logContainer = document.getElementById('group-logs');
            logContainer.innerHTML = logsData.logs.map(l => `
                <div class="group-log-item">
                    <div><b>${l.action}</b>: ${l.details}</div>
                    <div class="group-log-date">${new Date(l.timestamp).toLocaleString()}</div>
                </div>
            `).join('');
            document.getElementById('group-info-meta').innerHTML = `Створено: ${new Date(logsData.info.created_at).toLocaleDateString()}`;
        }
    }
}

export function showGroupTab(tabName) {
    document.getElementById('group-tab-info').style.display = tabName === 'info' ? 'block' : 'none';
    document.getElementById('group-tab-logs').style.display = tabName === 'logs' ? 'block' : 'none';
}

export function handleGroupAvatarUpload(roomId) {
    const file = document.getElementById('group-avatar-input').files[0];
    if(!file) return;

    UI.closeModal('group-settings-modal');

    const reader = new FileReader();
    reader.onload = (e) => {
        UI.initCropper(e.target.result, async (base64) => {
            await fetchWithAuth('/api/group/update', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({room_id: roomId, image: base64})
            });
            openGroupSettings(roomId, []);
        });
    };
    reader.readAsDataURL(file);
    document.getElementById('group-avatar-input').value = '';
}

export async function updateGroupInfo(roomId) {
    const name = document.getElementById('group-settings-name').value;
    await fetchWithAuth('/api/group/update', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room_id: roomId, name: name})
    });
    UI.closeModal('group-settings-modal');
}

export async function deleteGroup(roomId) {
    if(!confirm('Видалити групу?')) return;
    const res = await fetchWithAuth('/api/chat/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room_id: roomId, mutual: true})
    });
    UI.closeModal('group-settings-modal');
}

export async function leaveGroup() {
    if(!confirm('Покинути групу?')) return;
    await fetchWithAuth('/api/group/participants', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ action: 'leave', room_id: currentRoom })
    });
    UI.closeModal('group-settings-modal');
    document.getElementById('messages-area').innerHTML = '';
    document.getElementById('room-name').innerText = 'Оберіть чат';
    document.getElementById('current-room-avatar').style.display = 'none';
    setCurrentRoom(null);
}

export function openDeleteChatModal() {
    document.getElementById('delete-chat-modal').classList.add('active');
}

export async function confirmDeleteChat() {
    const isMutual = document.getElementById('delete-mutual-checkbox').checked;
    await fetchWithAuth('/api/chat/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room_id: currentRoom, mutual: isMutual})
    });
    UI.closeModal('delete-chat-modal');
}

export async function addParticipant(roomId) {
    const targetId = document.getElementById('new-participant-select').value;
    if(!targetId) return;
    await fetchWithAuth('/api/group/participants', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ action: 'add', room_id: roomId, target_id: targetId })
    });
}

export async function removeParticipant(uid) {
    if(!confirm('Видалити користувача?')) return;
    await fetchWithAuth('/api/group/participants', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ action: 'remove', room_id: currentRoom, target_id: uid })
    });
}