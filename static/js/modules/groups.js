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

export async function openGroupSettings(roomId, cachedUsers, socket) {
    const room = cachedRooms.find(r => r.id === roomId);
    if(!room) return;

    const myId = getMyId();
    const me = room.participants.find(p => p.id === myId);
    const myRole = me ? me.role : 'member';

    const isOwner = myRole === 'owner';
    const isAdmin = myRole === 'admin';
    const canEdit = isOwner || isAdmin;

    document.getElementById('group-settings-modal').classList.add('active');

    const nameInput = document.getElementById('group-settings-name');
    nameInput.value = room.name;
    nameInput.disabled = !canEdit;

    const av = document.getElementById('group-settings-avatar');
    av.style.backgroundImage = room.avatar ? `url(data:image/png;base64,${room.avatar})` : '';

    document.getElementById('save-group-btn').style.display = canEdit ? 'block' : 'none';
    document.getElementById('delete-group-btn').style.display = isOwner ? 'block' : 'none';
    document.getElementById('leave-group-btn').style.display = !isOwner ? 'block' : 'none';

    document.getElementById('add-participant-btn').style.display = canEdit ? 'block' : 'none';
    document.getElementById('new-participant-select').parentElement.style.display = canEdit ? 'flex' : 'none';
    document.getElementById('logs-tab-btn').style.display = canEdit ? 'inline-block' : 'none';

    document.querySelector('label[for="group-avatar-input"]').style.display = canEdit ? 'block' : 'none';

    UI.renderParticipants(
        room.participants,
        myId,
        myRole,
        canEdit ? (uid) => removeParticipant(roomId, uid, socket) : null,
        isOwner ? (uid) => promoteAdmin(roomId, uid, socket) : null,
        isOwner ? (uid) => demoteAdmin(roomId, uid, socket) : null
    );

    if(canEdit) {
        setupParticipantSelect(cachedUsers, room.participants);
        loadGroupLogs(roomId);
    }

    showGroupTab('info');
}

export function setupParticipantSelect(allUsers, currentParticipants) {
    const select = document.getElementById('new-participant-select');
    const currentIds = currentParticipants.map(p => p.id);
    const available = allUsers.filter(u => !currentIds.includes(u.id));
    select.innerHTML = available.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

export async function loadGroupLogs(roomId) {
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
            // We use window.socket or assume a refresh will happen via socket events
            // but usually avatar upload is via API, so we just wait for update.
            // Re-opening might need socket, let's grab it from window if not passed
            openGroupSettings(roomId, [], window.socket);
        });
    };
    reader.readAsDataURL(file);
    document.getElementById('group-avatar-input').value = '';
}

export function updateGroupInfo(roomId, socket) {
    const name = document.getElementById('group-settings-name').value;
    socket.emit('update_group_settings', { room_id: roomId, name: name, token: getAccessToken() });
    UI.closeModal('group-settings-modal');
}

export function deleteGroup(roomId, socket) {
    if(!confirm('Видалити групу?')) return;
    socket.emit('delete_group', { room_id: roomId, token: getAccessToken() });
    UI.closeModal('group-settings-modal');
}

export function leaveGroup(roomId, socket) {
    if(!confirm('Покинути групу?')) return;
    socket.emit('leave_group', { room_id: roomId, token: getAccessToken() });
    UI.closeModal('group-settings-modal');
}

export function addParticipant(roomId, socket) {
    const targetId = document.getElementById('new-participant-select').value;
    if(!targetId) return;
    socket.emit('add_group_participant', { room_id: roomId, target_id: targetId, token: getAccessToken() });
}

export function removeParticipant(roomId, uid, socket) {
    if(!confirm('Видалити користувача?')) return;
    socket.emit('remove_group_participant', { room_id: roomId, target_id: uid, token: getAccessToken() });
}

export function promoteAdmin(roomId, uid, socket) {
    if(confirm('Зробити цього користувача адміністратором?')) {
        socket.emit('promote_admin', { room_id: roomId, target_id: uid, token: getAccessToken() });
    }
}

export function demoteAdmin(roomId, uid, socket) {
    if(confirm('Забрати права адміністратора?')) {
        socket.emit('demote_admin', { room_id: roomId, target_id: uid, token: getAccessToken() });
    }
}

export function openDeleteChatModal() {
    document.getElementById('delete-chat-modal').classList.add('active');
}

export async function confirmDeleteChat(roomId) {
    const isMutual = document.getElementById('delete-mutual-checkbox').checked;
    await fetchWithAuth('/api/chat/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room_id: roomId, mutual: isMutual})
    });
    UI.closeModal('delete-chat-modal');
}