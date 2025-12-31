import { fetchWithAuth, getAccessToken, getMyId, getMyName, logout } from './api.js';
import { decrypt } from './utils.js';
import { initSocket } from './socket.js';
import * as UI from './ui.js';
import * as Groups from './modules/groups.js';
import * as Chat from './modules/chat.js';
import * as Media from './modules/media.js';

if (!getAccessToken()) window.location.href = '/';

document.getElementById('my-name').innerText = getMyName();

if (Notification.permission !== "granted") {
    Notification.requestPermission();
}

const socket = initSocket();
// Делаем сокет глобально доступным для модулей, которые используют window.socket
window.socket = socket;

let currentTab = 'groups';
let cachedUsers = [];
let cachedProfile = { bio: '', avatars_gallery: [], avatar: null, blocked_users: [], real_name: '', birth_date: '', gender: 'male' };

const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

UI.initEmojiPicker((emoji) => {
    document.getElementById('msg-input').value += emoji;
    document.getElementById('msg-input').focus();
});

socket.on('connect', () => {
    socket.emit('get_data', {token: getAccessToken()});
});

socket.on('data_update', (data) => {
    Groups.setCachedRooms(data.rooms);
    cachedUsers = data.users;

    if(data.my_profile) {
        cachedProfile = data.my_profile;
    }

    updateMyAvatar();
    renderList();
});

socket.on('force_join_room', (data) => {
    socket.emit('join_chat', {room_id: data.room_id, token: getAccessToken()});
    socket.emit('get_data', {token: getAccessToken()});
});

socket.on('user_registered', (user) => {
    if (!cachedUsers.find(u => u.id === user.id) && user.id !== getMyId()) {
        cachedUsers.push(user);
        renderList();
    }
});

socket.on('user_status', (data) => {
    const user = cachedUsers.find(u => u.id === data.user_id);
    if (user) {
        user.is_online = (data.status === 'online');
        user.last_active = data.last_active;
        if(data.gender) user.gender = data.gender;
        if(currentTab === 'users') renderList();
    }
});

socket.on('profile_updated', (data) => {
    const idx = cachedUsers.findIndex(u => u.id === data.user_id);
    if (idx !== -1) {
        cachedUsers[idx] = { ...cachedUsers[idx], ...data.user_data };
    }

    if (data.user_id === getMyId()) {
        cachedProfile = { ...cachedProfile, ...data.user_data };
        updateMyAvatar();
    }

    renderList();

    if(document.getElementById('user-info-modal').classList.contains('active')) {
        const nameEl = document.getElementById('user-info-name');
        if(nameEl.innerText === data.user_data.name) {
             onUserClick(data.user_data);
        }
    }
});

socket.on('user_updated', (data) => {
    const user = cachedUsers.find(u => u.id === data.id);
    if(user) {
        if(data.avatar) user.avatar = data.avatar;
        if(data.avatars_gallery) user.avatars_gallery = data.avatars_gallery;
    }
    if(data.id === getMyId()) {
        if(data.avatar) cachedProfile.avatar = data.avatar;
        if(data.avatars_gallery) cachedProfile.avatars_gallery = data.avatars_gallery;
        updateMyAvatar();
    }
    renderList();
});

socket.on('group_updated', (data) => {
    const rooms = Groups.getCachedRooms();
    const room = rooms.find(r => r.id === data.id);
    if(room) {
        if(data.name) room.name = data.name;
        if(data.avatar) room.avatar = data.avatar;
    }
    renderList();
    if(Groups.getCurrentRoom() === data.id) {
        if(data.name) document.getElementById('room-name').innerText = data.name;
        if(data.avatar) {
             const av = document.getElementById('current-room-avatar');
             av.style.backgroundImage = `url(data:image/png;base64,${data.avatar})`;
             av.style.display = 'block';
        }
    }
});

socket.on('group_update', (data) => {
    const rooms = Groups.getCachedRooms();
    const room = rooms.find(r => r.id === data.room_id);
    if(room) {
        if(data.participants) room.participants = data.participants;
        if(data.name) room.name = data.name;
        if(data.avatar) room.avatar = data.avatar;
    }

    if(Groups.getCurrentRoom() === data.room_id) {
        if(data.name) document.getElementById('room-name').innerText = data.name;
        if(data.avatar) {
             const av = document.getElementById('current-room-avatar');
             av.style.backgroundImage = `url(data:image/png;base64,${data.avatar})`;
             av.style.display = 'block';
        }
        if(document.getElementById('group-settings-modal').classList.contains('active')) {
             // Pass socket here to ensure it's available
             Groups.openGroupSettings(data.room_id, cachedUsers, socket);
        }
    }
    renderList();
});

socket.on('chat_deleted', (data) => {
    let rooms = Groups.getCachedRooms();
    rooms = rooms.filter(r => r.id !== data.id);
    Groups.setCachedRooms(rooms);
    renderList();

    if(Groups.getCurrentRoom() === data.id) {
        Groups.setCurrentRoom(null);
        document.getElementById('room-name').innerText = 'Оберіть чат';
        document.getElementById('messages-area').innerHTML = '';
        document.getElementById('current-room-avatar').style.display = 'none';
        document.getElementById('group-settings-btn').style.display = 'none';
        document.getElementById('call-btn').style.display = 'none';
        document.getElementById('delete-chat-btn').style.display = 'none';
        UI.closeModal('group-settings-modal');
        UI.showNotification('Чат видалено', 'Цей чат було видалено');
    }
});

socket.on('force_leave_room', (data) => {
    let rooms = Groups.getCachedRooms();
    rooms = rooms.filter(r => r.id !== data.room_id);
    Groups.setCachedRooms(rooms);
    renderList();

    if(Groups.getCurrentRoom() === data.room_id) {
        Groups.setCurrentRoom(null);
        document.getElementById('room-name').innerText = 'Оберіть чат';
        document.getElementById('messages-area').innerHTML = '';
        document.getElementById('current-room-avatar').style.display = 'none';
        document.getElementById('group-settings-btn').style.display = 'none';
        document.getElementById('call-btn').style.display = 'none';
        document.getElementById('delete-chat-btn').style.display = 'none';
        UI.closeModal('group-settings-modal');
    }
});

socket.on('participant_added', (data) => {
    const rooms = Groups.getCachedRooms();
    const room = rooms.find(r => r.id === data.room_id);
    if(room) {
        if(!room.participants) room.participants = [];
        room.participants.push(data.user);
    }
    if(document.getElementById('group-settings-modal').classList.contains('active') && Groups.getCurrentRoom() === data.room_id) {
        Groups.openGroupSettings(data.room_id, cachedUsers, socket);
    }
});

socket.on('participant_removed', (data) => {
    const rooms = Groups.getCachedRooms();
    const room = rooms.find(r => r.id === data.room_id);
    if(room && room.participants) {
        room.participants = room.participants.filter(p => p.id !== data.user_id);
    }
    if(document.getElementById('group-settings-modal').classList.contains('active') && Groups.getCurrentRoom() === data.room_id) {
        Groups.openGroupSettings(data.room_id, cachedUsers, socket);
    }
});

socket.on('new_message', (msg) => {
    const rooms = Groups.getCachedRooms();
    if (!rooms.find(r => r.id === msg.room_id)) {
        socket.emit('get_data', {token: getAccessToken()});
    }

    if (Groups.getCurrentRoom() === msg.room_id) {
        UI.appendMessage(msg, socket);
    }

    if (msg.sender_id !== getMyId()) {
        notificationSound.play().catch(e => {});
        const content = msg.type === 'text' ? decrypt(msg.content) : 'Надіслав файл/голос';
        UI.showNotification(msg.sender_name, content);
    }
});

socket.on('reaction_added', (data) => {
    if(Groups.getCurrentRoom() === data.room_id) {
        UI.updateMessageReactions(data.id, data.reactions, socket, data.room_id);
    }
});

socket.on('notification', (data) => {
    UI.showNotification(data.title, data.body);
});

socket.on('message_error', (data) => {
    alert(data.error);
});

socket.on('message_edited', (data) => {
    if (Groups.getCurrentRoom() === data.room_id) {
        UI.updateMessageInDOM(data.id, data.content, data.edited_at);
    }
});

socket.on('message_hidden', (data) => {
    if (Groups.getCurrentRoom() === data.room_id) {
        UI.removeMessageFromDOM(data.id);
    }
});

socket.on('message_deleted', (data) => {
    if (Groups.getCurrentRoom() === data.room_id) {
        UI.removeMessageFromDOM(data.id);
    }
});

socket.on('chat_history', (data) => {
    const area = document.getElementById('messages-area');
    area.innerHTML = '';
    data.messages.forEach(msg => UI.appendMessage(msg, socket));
});

socket.on('private_chat_ready', (data) => {
    socket.emit('get_data', {token: getAccessToken()});
    setTimeout(() => {
        const rooms = Groups.getCachedRooms();
        const room = rooms.find(r => r.id === data.room_id) || {id: data.room_id, type: 'private'};
        onRoomClick(room);
    }, 100);
});

socket.on('group_created', (data) => {
    socket.emit('get_data', {token: getAccessToken()});
    UI.closeModal('group-modal');
});

socket.on('user_connected_video', (data) => {
    Media.connectToNewUser(data.peer_id, data.stream);
});

socket.on('user_disconnected_video', (data) => {
    Media.handleUserDisconnect(data.peer_id);
});

function updateMyAvatar() {
    if(cachedProfile.avatar) {
        document.getElementById('my-avatar-small').style.backgroundImage = `url(data:image/png;base64,${cachedProfile.avatar})`;
    }
}

function renderList() {
    if (currentTab === 'groups') {
        UI.renderRoomList(Groups.getCachedRooms(), Groups.getCurrentRoom(), onRoomClick);
    } else {
        UI.renderUserList(cachedUsers, onUserClick);
    }
}

function onRoomClick(room) {
    Groups.setCurrentRoom(room.id);
    document.getElementById('room-name').innerText = room.name || 'Чат';

    const avatarEl = document.getElementById('current-room-avatar');
    if(room.avatar) {
        avatarEl.style.backgroundImage = `url(data:image/png;base64,${room.avatar})`;
        avatarEl.style.display = 'block';
    } else {
        avatarEl.style.display = 'none';
    }

    const isCreator = (room.type === 'group' && room.created_by === getMyId());
    document.getElementById('group-settings-btn').style.display = (room.type === 'group') ? 'block' : 'none';
    document.getElementById('call-btn').style.display = 'block';
    document.getElementById('delete-chat-btn').style.display = (room.type === 'private') ? 'block' : 'none';

    renderList();
    socket.emit('join_chat', {room_id: room.id, token: getAccessToken()});
}

function onUserClick(user) {
    document.getElementById('user-info-modal').classList.add('active');
    document.getElementById('user-info-name').innerText = user.name;
    const bigAv = document.getElementById('user-info-avatar-big');
    bigAv.style.backgroundImage = user.avatar ? `url(data:image/png;base64,${user.avatar})` : '';

    if(user.real_name) {
        document.getElementById('user-info-realname').innerText = user.real_name;
        document.getElementById('user-info-birth').innerText = user.birth_date;
        document.getElementById('user-info-age').innerText = user.age ? `${user.age} років` : '';
    } else {
        document.getElementById('user-info-realname').innerText = 'Інформація прихована';
        document.getElementById('user-info-birth').innerText = '';
        document.getElementById('user-info-age').innerText = '';
    }

    const bioText = user.bio || 'Немає інформації';
    document.getElementById('user-info-bio').innerText = bioText;

    UI.renderReadOnlyGallery(user.avatars_gallery || []);

    const startBtn = document.getElementById('start-chat-btn');
    startBtn.onclick = () => {
        UI.closeModal('user-info-modal');
        socket.emit('start_private_chat', { token: getAccessToken(), target_id: user.id });
    };

    const isBlocked = cachedProfile.blocked_users.includes(user.id);
    let blockBtn = document.getElementById('block-user-btn');
    if(!blockBtn) {
        blockBtn = document.createElement('button');
        blockBtn.id = 'block-user-btn';
        blockBtn.className = 'btn-secondary';
        blockBtn.style.marginTop = '10px';
        startBtn.parentNode.insertBefore(blockBtn, startBtn);
    }

    blockBtn.innerText = isBlocked ? 'Розблокувати' : 'Заблокувати';
    blockBtn.style.color = isBlocked ? 'green' : 'red';

    blockBtn.onclick = async () => {
        const action = isBlocked ? 'unblock' : 'block';
        if(confirm(isBlocked ? 'Розблокувати?' : 'Заблокувати цього користувача?')) {
            await fetchWithAuth('/api/user/block', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({target_id: user.id, action})
            });
            if(isBlocked) {
                cachedProfile.blocked_users = cachedProfile.blocked_users.filter(id => id !== user.id);
            } else {
                cachedProfile.blocked_users.push(user.id);
            }
            onUserClick(user);
        }
    };
}

async function onAvatarSelect(avatarData) {
    document.getElementById('profile-avatar-big').style.backgroundImage = `url(data:image/png;base64,${avatarData})`;
    await fetchWithAuth('/api/user/avatar/select', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({avatar: avatarData})
    });
    cachedProfile.avatar = avatarData;
    updateMyAvatar();
}

async function onDeleteAvatar(avatarData) {
    if(!confirm('Видалити це фото?')) return;
    const res = await fetchWithAuth('/api/user/avatar/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({avatar: avatarData})
    });
    const data = await res.json();
    if(data.status === 'ok') {
        cachedProfile.avatars_gallery = data.gallery;
        cachedProfile.avatar = data.avatar;
        UI.renderProfileGallery(cachedProfile.avatars_gallery, cachedProfile.avatar, onAvatarSelect, onDeleteAvatar);
        if(cachedProfile.avatar) {
             document.getElementById('profile-avatar-big').style.backgroundImage = `url(data:image/png;base64,${cachedProfile.avatar})`;
        } else {
             document.getElementById('profile-avatar-big').style.backgroundImage = '';
        }
    }
}

window.sendMessage = () => Chat.sendMessage(socket, Groups.getCurrentRoom());
window.handleFileSelect = Chat.handleFileSelect;
window.cancelFile = Chat.cancelFile;
window.startVoice = () => Media.startVoice(socket, Groups.getCurrentRoom());
window.startVideoMessage = () => Media.startVideoMessage(socket, Groups.getCurrentRoom());

window.switchTab = (tab) => {
    currentTab = tab;
    document.getElementById('tab-groups').classList.toggle('active', tab === 'groups');
    document.getElementById('tab-users').classList.toggle('active', tab === 'users');
    renderList();
};
window.toggleEmoji = UI.toggleEmoji;
window.closeModal = UI.closeModal;
window.showCreateGroup = () => Groups.showCreateGroup(cachedUsers);
window.createGroup = () => Groups.createGroup(socket);

window.openProfileModal = () => {
    document.getElementById('profile-modal').classList.add('active');

    document.getElementById('profile-bio').value = cachedProfile.bio || '';
    document.getElementById('profile-realname').value = cachedProfile.real_name || '';
    document.getElementById('profile-birthdate').value = cachedProfile.birth_date || '';
    document.getElementById('profile-gender').value = cachedProfile.gender || 'male';

    if(cachedProfile.age) {
        document.getElementById('my-profile-age').innerText = `${cachedProfile.age} років`;
    } else {
        document.getElementById('my-profile-age').innerText = '';
    }

    if(cachedProfile.avatar) {
        document.getElementById('profile-avatar-big').style.backgroundImage = `url(data:image/png;base64,${cachedProfile.avatar})`;
    }
    UI.renderProfileGallery(cachedProfile.avatars_gallery, cachedProfile.avatar, onAvatarSelect, onDeleteAvatar);
};

window.handleAvatarUpload = () => Media.handleAvatarUpload((data) => {
    if(data.status === 'ok') {
        cachedProfile.avatars_gallery = data.gallery;
        cachedProfile.avatar = data.avatar;

        const bigAv = document.getElementById('profile-avatar-big');
        if(bigAv) bigAv.style.backgroundImage = `url(data:image/png;base64,${data.avatar})`;

        UI.renderProfileGallery(data.gallery, data.avatar, onAvatarSelect, onDeleteAvatar);
        updateMyAvatar();
    }
});

window.saveProfile = async () => {
    const bio = document.getElementById('profile-bio').value;
    const real_name = document.getElementById('profile-realname').value;
    const birth_date = document.getElementById('profile-birthdate').value;
    const gender = document.getElementById('profile-gender').value;

    socket.emit('update_profile', {
        token: getAccessToken(),
        bio, real_name, birth_date, gender
    });

    UI.closeModal('profile-modal');
};

window.logout = logout;
window.openGroupSettings = () => Groups.openGroupSettings(Groups.getCurrentRoom(), cachedUsers, socket);
window.handleGroupAvatarUpload = () => Groups.handleGroupAvatarUpload(Groups.getCurrentRoom());
window.updateGroupInfo = () => Groups.updateGroupInfo(Groups.getCurrentRoom(), socket);
window.deleteGroup = () => Groups.deleteGroup(Groups.getCurrentRoom(), socket);
window.leaveGroup = () => Groups.leaveGroup(Groups.getCurrentRoom(), socket);
window.addParticipant = () => Groups.addParticipant(Groups.getCurrentRoom(), socket);
window.removeParticipant = (uid) => Groups.removeParticipant(Groups.getCurrentRoom(), uid, socket);
window.promoteAdmin = (uid) => Groups.promoteAdmin(Groups.getCurrentRoom(), uid, socket);
window.demoteAdmin = (uid) => Groups.demoteAdmin(Groups.getCurrentRoom(), uid, socket);
window.showGroupTab = Groups.showGroupTab;
window.startVideoCall = () => Media.startVideoCall(socket, Groups.getCurrentRoom());
window.toggleScreenShare = Media.toggleScreenShare;
window.toggleAudio = Media.toggleAudio;
window.toggleVideo = Media.toggleVideo;
window.closeVideoCall = () => Media.closeVideoCall(socket, Groups.getCurrentRoom());
window.openDeleteChatModal = Groups.openDeleteChatModal;
window.confirmDeleteChat = () => Groups.confirmDeleteChat(Groups.getCurrentRoom());

document.getElementById('msg-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') window.sendMessage();
});