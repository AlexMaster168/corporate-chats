import { decrypt, formatDate, encrypt } from './utils.js';
import { getMyId } from './api.js';

export const EMOJIS = [
    '👍','👎','❤️','🔥','🎉','😂','😮','😢','😡','🤔','👀','🤝','🙏','🤡','💩','👻','💀','👽','👾','🤖',
    '🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','👋','🤚','🖐','✋','🖖','👌','✌️','🤞','🤟',
    '🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏',
    '✍️','💅','🤳','💪','🦵','🦶','👣','👂','👃','🧠','🦷','🦴','👀','👁','👅',
    '👄','💋','👶','👧','🧒','👦','👩','🧑','👨','👩‍🦱','🧑‍🦱','👨‍🦱','👩‍🦰','🧑‍🦰','👨‍🦰','👱‍♀️','👱','👱‍♂️',
    '👩‍🦳','🧑‍🦳','👨‍🦳','👩‍🦲','🧑‍🦲','👨‍🦲','🧔','👵','🧓','👴','👲','👳‍♀️','👳','👳‍♂️','🧕','👮‍♀️','👮','👮‍♂️','👷‍♀️',
    '👷','👷‍♂️','💂‍♀️','💂','💂‍♂️','🕵️‍♀️','🕵️','🕵️‍♂️','👩‍⚕️','🧑‍⚕️','👨‍⚕️','👩‍🌾','🧑‍🌾','👨‍🌾','👩‍🍳','🧑‍🍳','👨‍🍳','👩‍🎓',
    '🧑‍🎓','👨‍🎓','👩‍🎤','🧑‍🎤','👨‍🎤','👩‍🏫','🧑‍🏫','👨‍🏫','👩‍🏭','🧑‍🏭','👨‍🏭','👩‍💻','🧑‍💻','👨‍💻','👩‍💼','🧑‍💼','👨‍💼'
];

let editingMessageId = null;

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

export function initEmojiPicker(onClick) {
    const picker = document.getElementById('emoji-picker');
    EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.innerText = emoji;
        btn.onclick = () => onClick(emoji);
        picker.appendChild(btn);
    });
}

export function toggleEmoji() {
    const picker = document.getElementById('emoji-picker');
    picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
}

export function renderUserList(users, onUserClick) {
    const container = document.getElementById('list-container');
    container.innerHTML = '';

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.onclick = () => onUserClick(user);

        let statusText = '';
        let color = '#999';

        if (user.is_online) {
            statusText = '● Online';
            color = 'var(--success-color)';
        } else {
            const gender = user.gender || 'male';
            const genderVerb = gender === 'female' ? 'Була' : 'Був';
            statusText = `${genderVerb} ${formatDate(user.last_active)}`;
        }

        let avatarStyle = user.avatar
            ? `background-image:url(data:image/png;base64,${user.avatar})`
            : 'background-color:#ccc';

        div.innerHTML = `
            <div class="avatar" style="${avatarStyle}">${user.avatar ? '' : user.name[0]}</div>
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:500">${user.name}</span>
                <span style="color:${color}; font-size:11px;">${statusText}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

export function renderRoomList(rooms, currentRoomId, onRoomClick) {
    const container = document.getElementById('list-container');
    container.innerHTML = '';

    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'list-item';
        if(currentRoomId === room.id) div.classList.add('active');

        let avatarStyle = room.avatar
            ? `background-image:url(data:image/png;base64,${room.avatar})`
            : 'background-color:#3b82f6; color:white';

        div.innerHTML = `
            <div class="avatar" style="${avatarStyle}">${room.avatar ? '' : '#'}</div>
            <span style="font-weight:500">${room.name || 'Чат'}</span>
        `;
        div.onclick = () => onRoomClick(room);
        container.appendChild(div);
    });
}

export function appendMessage(msg, socket) {
    const area = document.getElementById('messages-area');
    const myId = getMyId();
    const isMe = msg.sender_id === myId;

    let contentHtml = '';
    let rawText = '';

    if (msg.type === 'text') {
        rawText = decrypt(msg.content);
        let safeText = rawText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        contentHtml = `<span class="msg-content-span">${safeText}</span>`;
    } else if (msg.type === 'file') {
        const isImage = msg.filename && /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.filename);
        const isAudio = msg.filename && /\.(mp3|wav|ogg|m4a)$/i.test(msg.filename);

        if (isImage) {
            contentHtml = `<img src="data:image;base64,${msg.content}" class="chat-image" alt="image">`;
        } else if (isAudio) {
             contentHtml = `
                <div style="display:flex; align-items:center; gap:5px;">
                    <span>🎵 ${msg.filename}</span>
                </div>
                <audio controls src="data:audio/${msg.filename.split('.').pop()};base64,${msg.content}" style="width:200px; margin-top:5px;"></audio>
             `;
        } else {
            contentHtml = `<a href="data:application/octet-stream;base64,${msg.content}" download="${msg.filename}" target="_blank">📎 ${msg.filename}</a>`;
        }
    } else if (msg.type === 'voice') {
        contentHtml = `<audio controls src="${msg.content}"></audio>`;
    } else if (msg.type === 'video') {
        contentHtml = `<video src="${msg.content}" controls class="video-msg"></video>`;
    }

    let avatarHtml = '';
    if(!isMe) {
        let bg = msg.sender_avatar ? `background-image:url(data:image/png;base64,${msg.sender_avatar})` : 'background-color:#ccc';
        avatarHtml = `<div class="msg-avatar" style="${bg}; width:24px; height:24px; border-radius:50%; display:inline-block; margin-right:5px; background-size:cover;"></div>`;
    }

    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    div.dataset.id = msg.id;

    let actionsHtml = `<div class="message-actions">`;
    actionsHtml += `<button class="action-btn react-btn" title="Реакція">☺</button>`;
    actionsHtml += `<button class="action-btn delete-me" title="Видалити для себе">✖Я</button>`;
    if (isMe) {
        actionsHtml += `<button class="action-btn delete-all" title="Видалити для всіх">✖Всі</button>`;
        if(msg.type === 'text') actionsHtml += `<button class="action-btn edit">✎</button>`;
    }
    actionsHtml += `</div>`;

    let timeHtml = formatDate(msg.created_at);
    if (msg.edited_at) {
        timeHtml += ` <span style="font-style:italic; font-size:9px;">(ред. ${formatDate(msg.edited_at)})</span>`;
    }

    div.innerHTML = `
        ${actionsHtml}
        ${!isMe ? `<div class="msg-sender">${avatarHtml} ${msg.sender_name}</div>` : ''}
        <div class="msg-body">${contentHtml}</div>
        <div class="reactions-list"></div>
        <div class="msg-meta">${timeHtml}</div>
    `;

    if(msg.reactions) renderReactions(div, msg.reactions, socket, msg.room_id);

    div.querySelector('.react-btn').onclick = () => {
        showReactionPicker(socket, msg.id, msg.room_id, div);
    };

    div.querySelector('.delete-me').onclick = () => {
        socket.emit('delete_message', { id: msg.id, room_id: msg.room_id, for_everyone: false, token: sessionStorage.getItem('access_token') });
    };

    if (isMe) {
        div.querySelector('.delete-all').onclick = () => {
            if(confirm('Видалити для всіх?'))
                socket.emit('delete_message', { id: msg.id, room_id: msg.room_id, for_everyone: true, token: sessionStorage.getItem('access_token') });
        };
        if(msg.type === 'text') {
            div.querySelector('.edit').onclick = () => startEditing(msg.id, rawText);
        }
    }

    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

function showReactionPicker(socket, msgId, roomId, messageDiv) {
    const existing = document.querySelector('.reaction-picker-popup');
    if(existing) existing.remove();

    const picker = document.createElement('div');
    picker.className = 'reaction-picker-popup';
    picker.style.position = 'absolute';
    picker.style.bottom = '100%';
    picker.style.left = '0';
    picker.style.background = 'white';
    picker.style.border = '1px solid #ccc';
    picker.style.borderRadius = '8px';
    picker.style.padding = '5px';
    picker.style.display = 'grid';
    picker.style.gridTemplateColumns = 'repeat(6, 1fr)';
    picker.style.gap = '5px';
    picker.style.zIndex = '100';
    picker.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    picker.style.width = '300px';
    picker.style.maxHeight = '200px';
    picker.style.overflowY = 'auto';

    EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.innerText = emoji;
        btn.style.border = 'none';
        btn.style.background = 'transparent';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '18px';
        btn.onclick = () => {
            socket.emit('add_reaction', { id: msgId, room_id: roomId, reaction: emoji, token: sessionStorage.getItem('access_token') });
            picker.remove();
        };
        picker.appendChild(btn);
    });

    messageDiv.appendChild(picker);
    setTimeout(() => {
        const close = (e) => {
            if(!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', close);
            }
        };
        document.addEventListener('click', close);
    }, 100);
}

export function updateMessageReactions(id, reactions, socket, roomId) {
    const div = document.querySelector(`.message[data-id="${id}"]`);
    if(div) renderReactions(div, reactions, socket, roomId);
}

function renderReactions(div, reactions, socket, roomId) {
    const list = div.querySelector('.reactions-list');
    list.innerHTML = '';
    const myId = getMyId();

    for(const [uid, data] of Object.entries(reactions)) {
        const pill = document.createElement('div');
        pill.className = 'reaction-pill';

        let avatarStyle = data.avatar ? `background-image:url(data:image/png;base64,${data.avatar})` : 'background-color:#ccc';

        pill.innerHTML = `
            <div class="reaction-avatar" style="${avatarStyle}" title="${data.name}"></div>
            <span>${data.reaction}</span>
        `;

        if (uid === myId) {
            pill.style.cursor = 'pointer';
            pill.style.borderColor = 'var(--primary-color)';
            pill.title = 'Натисніть, щоб видалити';
            pill.onclick = () => {
                if(confirm('Видалити вашу реакцію?')) {
                    socket.emit('remove_reaction', { id: div.dataset.id, room_id: roomId, token: sessionStorage.getItem('access_token') });
                }
            };
        }

        list.appendChild(pill);
    }
}

function startEditing(id, text) {
    editingMessageId = id;
    const input = document.getElementById('msg-input');
    input.value = text;
    input.focus();
    input.style.borderColor = 'var(--primary-color)';
    document.getElementById('send-btn').innerText = '✓';
}

export function finishEditing(socket, currentRoom) {
    if (!editingMessageId) return false;
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return false;

    socket.emit('edit_message', {
        id: editingMessageId,
        content: encrypt(text),
        room_id: currentRoom,
        token: sessionStorage.getItem('access_token')
    });

    editingMessageId = null;
    input.value = '';
    input.style.borderColor = 'var(--border-color)';
    document.getElementById('send-btn').innerText = '➤';
    return true;
}

export function updateMessageInDOM(id, newContent, editedAt) {
    const div = document.querySelector(`.message[data-id="${id}"]`);
    if (div) {
        const body = div.querySelector('.msg-content-span');
        if (body) {
            let text = decrypt(newContent);
            body.innerText = text;
        }
        const meta = div.querySelector('.msg-meta');
        if (meta && !meta.innerText.includes('ред.')) {
            meta.innerHTML += ` <span style="font-style:italic; font-size:9px;">(ред. ${formatDate(editedAt)})</span>`;
        }
    }
}

export function removeMessageFromDOM(id) {
    const div = document.querySelector(`.message[data-id="${id}"]`);
    if (div) div.remove();
}

export function renderParticipants(participants, myId, myRole, onRemove, onPromote, onDemote) {
    const list = document.getElementById('group-participants-list');

    list.innerHTML = participants.map(p => {
        let actions = '';
        if (myId !== p.id) {
            if (myRole === 'owner' || (myRole === 'admin' && p.role === 'member')) {
                actions += `<span class="remove-btn" data-uid="${p.id}" title="Видалити">✖</span>`;
            }
            if (myRole === 'owner') {
                if (p.role === 'member') {
                    actions += `<span class="promote-btn" data-uid="${p.id}" style="cursor:pointer; color:var(--success-color); font-weight:bold; margin-left:10px;" title="Зробити адміном">↑</span>`;
                } else if (p.role === 'admin') {
                    actions += `<span class="demote-btn" data-uid="${p.id}" style="cursor:pointer; color:var(--text-secondary); font-weight:bold; margin-left:10px;" title="Забрати адмінку">↓</span>`;
                }
            }
        }

        let roleLabel = '';
        if(p.role === 'owner') roleLabel = '<span style="font-size:10px; background:gold; padding:2px 5px; border-radius:4px; margin-left:5px;">Власник</span>';
        else if(p.role === 'admin') roleLabel = '<span style="font-size:10px; background:#e0e7ff; color:var(--primary-color); padding:2px 5px; border-radius:4px; margin-left:5px;">Адмін</span>';

        return `
        <div class="participant-row">
            <div style="display:flex; align-items:center; gap:10px;">
                <div class="avatar" style="width:30px; height:30px; ${p.avatar ? `background-image:url(data:image/png;base64,${p.avatar})` : ''}"></div>
                <span>${p.name} ${roleLabel}</span>
            </div>
            <div>${actions}</div>
        </div>
        `;
    }).join('');

    if (onRemove) {
        list.querySelectorAll('.remove-btn').forEach(btn => {
            btn.onclick = () => onRemove(btn.dataset.uid);
        });
    }
    if (onPromote) {
        list.querySelectorAll('.promote-btn').forEach(btn => {
            btn.onclick = () => onPromote(btn.dataset.uid);
        });
    }
    if (onDemote) {
        list.querySelectorAll('.demote-btn').forEach(btn => {
            btn.onclick = () => onDemote(btn.dataset.uid);
        });
    }
}

export function renderProfileGallery(gallery, currentAvatar, onSelect, onDelete) {
    const container = document.getElementById('profile-gallery');
    container.innerHTML = '';

    gallery.forEach(imgData => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.style.backgroundImage = `url(data:image/png;base64,${imgData})`;
        if (imgData === currentAvatar) div.classList.add('selected');

        div.onclick = (e) => {
            if(e.target.classList.contains('delete-gallery-btn')) return;
            document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            onSelect(imgData);
        };

        const delBtn = document.createElement('div');
        delBtn.className = 'delete-gallery-btn';
        delBtn.innerText = 'x';
        delBtn.onclick = () => onDelete(imgData);

        div.appendChild(delBtn);
        container.appendChild(div);
    });
}

export function renderReadOnlyGallery(gallery) {
    const container = document.getElementById('user-info-gallery');
    container.innerHTML = '';

    if(gallery.length === 0) {
        container.innerHTML = '<p style="color:#999; font-size:12px;">Немає фото</p>';
        return;
    }

    gallery.forEach(imgData => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.style.backgroundImage = `url(data:image/png;base64,${imgData})`;
        div.style.cursor = 'default';
        container.appendChild(div);
    });
}

export function showNotification(title, message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-msg">${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

export function initCropper(imageSrc, callback) {
    const modal = document.getElementById('crop-modal');
    const imgEl = document.getElementById('crop-image');

    imgEl.src = '';

    const startCropper = () => {
        imgEl.src = imageSrc;
        modal.classList.add('active');

        let cropper = new Cropper(imgEl, {
            aspectRatio: 1,
            viewMode: 1
        });

        const saveBtn = document.getElementById('crop-save-btn');
        const cancelBtn = document.getElementById('crop-cancel-btn');

        const cleanup = () => {
            cropper.destroy();
            modal.classList.remove('active');
            imgEl.src = '';

            const newSave = saveBtn.cloneNode(true);
            const newCancel = cancelBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSave, saveBtn);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        };

        document.getElementById('crop-save-btn').onclick = () => {
            const canvas = cropper.getCroppedCanvas({ width: 300, height: 300 });
            const base64 = canvas.toDataURL('image/png').split(',')[1];
            callback(base64);
            cleanup();
        };

        document.getElementById('crop-cancel-btn').onclick = cleanup;
    };

    startCropper();
}