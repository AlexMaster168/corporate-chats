import {getMyId} from './api.js';
import {decrypt} from './utils.js';

let editingMessageId = null;

const emojiData = {
    'Смайли': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔'],
    'Жести': ['👋', '🤚', '🖐', '✋', '🖖', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
    'Серця': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'],
    'Емоції': ['🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯'],
    'Об\'єкти': ['🔥', '🎉', '✨', '💩', '🤡', '👻', '💀', '👽', '🤖', '🎃', '🎄', '🎆', '🧨', '🎈', '🎁', '🎀', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾']
};

export function renderRoomList(rooms, currentRoomId, onClick) {
    const container = document.getElementById('list-container');
    container.innerHTML = rooms.map(room => {
        const isActive = room.id === currentRoomId ? 'active' : '';
        const avatarStyle = room.avatar
            ? `background-image: url(data:image/png;base64,${room.avatar})`
            : '';
        return `
            <div class="list-item ${isActive}" onclick="window.onRoomClick('${room.id}')">
                <div class="avatar" style="${avatarStyle}">${!room.avatar ? room.name[0].toUpperCase() : ''}</div>
                <div>
                    <div style="font-weight: 600;">${room.name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        ${room.type === 'private' ? 'Особистий' : 'Група'}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    window.onRoomClick = (id) => {
        const r = rooms.find(x => x.id === id);
        if (r) onClick(r);
    };
}

export function renderUserList(users, onClick, blockedUsers = []) {
    const container = document.getElementById('list-container');
    const myId = getMyId();
    container.innerHTML = users.filter(u => u.id !== myId).map(user => {
        const isBlocked = blockedUsers.includes(user.id) || (!user.avatar && !user.is_online && !user.bio && !user.real_name);

        let avatarStyle = '';
        if (user.avatar && !isBlocked) {
            avatarStyle = `background-image: url(data:image/png;base64,${user.avatar})`;
        }

        const statusColor = (user.is_online && !isBlocked) ? 'var(--success-color)' : 'var(--text-secondary)';
        let statusText = 'Offline';

        if (user.is_online && !isBlocked) {
            statusText = 'Online';
        } else if (user.last_active && !isBlocked) {
            const date = new Date(user.last_active);
            const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            const verb = user.gender === 'female' ? 'була' : 'був';
            statusText = `${verb} о ${timeStr}`;
        }

        return `
            <div class="list-item" onclick="window.onUserClick('${user.id}')">
                <div class="avatar" style="${avatarStyle}">
                    ${!avatarStyle ? user.name[0].toUpperCase() : ''}
                    <div style="position:absolute; bottom:0; right:0; width:12px; height:12px; background:${statusColor}; border-radius:50%; border:2px solid white;"></div>
                </div>
                <div>
                    <div style="font-weight: 600;">${user.name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${statusText}</div>
                </div>
            </div>
        `;
    }).join('');

    window.onUserClick = (id) => {
        const u = users.find(x => x.id === id);
        if (u) onClick(u);
    };
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return '📄';
    if (['doc', 'docx'].includes(ext)) return '📝';
    if (['xls', 'xlsx'].includes(ext)) return '📊';
    if (['ppt', 'pptx'].includes(ext)) return '📉';
    if (['exe', 'msi'].includes(ext)) return '🖥️';
    if (['zip', 'rar', '7z'].includes(ext)) return '📦';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return '🎵';
    return '📁';
}

export function appendMessage(msg, socket) {
    const area = document.getElementById('messages-area');
    const div = document.createElement('div');
    const isMe = msg.sender_id === getMyId();
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    div.id = `msg-${msg.id}`;

    let contentHtml = '';
    let captionHtml = '';

    if (msg.type === 'text') {
        const decrypted = decrypt(msg.content);
        contentHtml = linkify(decrypted);
    } else if (msg.type === 'file') {
        try {
            const data = JSON.parse(msg.content);
            const src = `data:application/octet-stream;base64,${data.file}`;
            const ext = msg.filename.split('.').pop().toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
            const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
            const isAudio = ['mp3', 'wav', 'ogg'].includes(ext);

            if (isImage) {
                contentHtml = `<img src="data:image/${ext};base64,${data.file}" class="chat-image" onclick="window.openImage(this.src)">`;
            } else if (isVideo) {
                contentHtml = `<video controls src="data:video/${ext};base64,${data.file}" style="max-width:100%; border-radius:10px;"></video>`;
            } else if (isAudio) {
                contentHtml = `<audio controls src="data:audio/${ext};base64,${data.file}" style="width:100%"></audio>`;
            } else {
                const icon = getFileIcon(msg.filename);
                contentHtml = `
                    <div style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.05); border-radius:10px;">
                        <div style="font-size:2rem;">${icon}</div>
                        <div style="flex:1; overflow:hidden;">
                            <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${msg.filename}</div>
                            <a href="${src}" download="${msg.filename}" style="font-size:0.8rem; text-decoration:none;">⬇️ Завантажити</a>
                        </div>
                    </div>
                `;
            }

            if (data.caption) {
                captionHtml = `<div style="margin-top:5px;">${linkify(data.caption)}</div>`;
            }
        } catch (e) {
            contentHtml = 'Error loading file';
        }
    } else if (msg.type === 'voice') {
        contentHtml = `<audio controls src="${msg.content}"></audio>`;
    } else if (msg.type === 'video') {
        contentHtml = `<video controls src="${msg.content}" class="video-msg"></video>`;
    }

    const senderName = isMe ? 'Ви' : msg.sender_name;
    const avatarStyle = (msg.sender_avatar)
        ? `background-image: url(data:image/png;base64,${msg.sender_avatar})`
        : '';

    const senderHtml = `
        <div class="msg-sender" onclick="window.openUserProfile('${msg.sender_id}')">
            <div class="msg-sender-avatar" style="${avatarStyle}"></div>
            <span>${senderName}</span>
        </div>
    `;

    div.innerHTML = `
        ${!isMe ? senderHtml : ''}
        <div class="msg-content">
            ${contentHtml}
            ${captionHtml}
        </div>
        <div class="reactions-list" id="reactions-${msg.id}"></div>
        <div class="msg-meta">
            ${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            ${msg.edited_at ? '<span title="Redacted">✏️</span>' : ''}
        </div>
        <div class="message-actions">
            <div style="position:relative;">
                <button class="action-btn" onclick="window.toggleReactionMenu(${msg.id})">➕</button>
                <div id="reaction-menu-${msg.id}" class="reaction-popover" style="display:none;"></div>
            </div>
            ${isMe ? `<button class="action-btn" onclick="window.editMessage(${msg.id}, '${msg.type}')">✏️</button>` : ''}
            <button class="action-btn delete-me" onclick="window.deleteMessage(${msg.id}, false)">🗑</button>
            ${isMe ? `<button class="action-btn delete-all" onclick="window.deleteMessage(${msg.id}, true)">🗑 All</button>` : ''}
        </div>
    `;

    area.appendChild(div);
    area.scrollTop = area.scrollHeight;

    if (msg.reactions) {
        updateMessageReactions(msg.id, msg.reactions, socket, msg.room_id);
    }
}

window.toggleReactionMenu = (msgId) => {
    const menu = document.getElementById(`reaction-menu-${msgId}`);
    const wasVisible = menu.style.display === 'block';

    document.querySelectorAll('.reaction-popover').forEach(el => el.style.display = 'none');

    if (!wasVisible) {
        menu.style.display = 'block';
        if (!menu.hasChildNodes()) {
            const tabs = document.createElement('div');
            tabs.className = 'emoji-tabs';
            const content = document.createElement('div');
            content.className = 'emoji-grid';

            Object.keys(emojiData).forEach((cat, idx) => {
                const btn = document.createElement('button');
                btn.className = `emoji-tab-btn ${idx === 0 ? 'active' : ''}`;
                btn.innerText = cat;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    menu.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    renderReactionGrid(content, emojiData[cat], msgId);
                };
                tabs.appendChild(btn);
            });

            menu.appendChild(tabs);
            menu.appendChild(content);
            renderReactionGrid(content, emojiData['Смайли'], msgId);
        }
    }
};

function renderReactionGrid(container, emojis, msgId) {
    container.innerHTML = emojis.map(e => `
        <button class="emoji-btn" onclick="window.addReaction(${msgId}, '${e}'); document.getElementById('reaction-menu-${msgId}').style.display='none'">${e}</button>
    `).join('');
}

export function updateMessageReactions(msgId, reactions, socket, roomId) {
    const container = document.getElementById(`reactions-${msgId}`);
    if (!container) return;

    const reactionGroups = {};
    for (const uid in reactions) {
        const r = reactions[uid];
        if (!reactionGroups[r.reaction]) reactionGroups[r.reaction] = [];
        reactionGroups[r.reaction].push(r);
    }

    container.innerHTML = Object.keys(reactionGroups).map(reaction => {
        const users = reactionGroups[reaction];
        const avatars = users.slice(0, 3).map(u => {
            const style = u.avatar ? `background-image: url(data:image/png;base64,${u.avatar})` : '';
            return `<div class="reaction-avatar" style="${style}" title="${u.name}"></div>`;
        }).join('');

        return `
            <div class="reaction-pill" onclick="window.toggleReaction(${msgId}, '${roomId}')">
                ${reaction} 
                <div style="display:flex; margin-left:4px;">${avatars}</div>
                <span style="font-size:0.8rem; margin-left:4px;">${users.length}</span>
            </div>
        `;
    }).join('');
}

export function updateMessageInDOM(msgId, newContent, editedAt) {
    const msgEl = document.getElementById(`msg-${msgId}`);
    if (msgEl) {
        const contentEl = msgEl.querySelector('.msg-content');
        if (contentEl) {
            const existingCaption = contentEl.querySelector('div[style="margin-top:5px;"]');
            if (existingCaption) {
                existingCaption.innerHTML = linkify(newContent);
            } else {
                contentEl.innerHTML = linkify(newContent);
            }
        }
        const metaEl = msgEl.querySelector('.msg-meta');
        if (metaEl && !metaEl.innerHTML.includes('✏️')) {
            metaEl.innerHTML += ' <span title="Redacted">✏️</span>';
        }
    }
}

export function removeMessageFromDOM(msgId) {
    const msgEl = document.getElementById(`msg-${msgId}`);
    if (msgEl) msgEl.remove();
}

export function initEmojiPicker(onSelect) {
    const picker = document.getElementById('emoji-picker');
    picker.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'emoji-tabs';

    const content = document.createElement('div');
    content.className = 'emoji-grid';

    Object.keys(emojiData).forEach((cat, idx) => {
        const btn = document.createElement('button');
        btn.className = `emoji-tab-btn ${idx === 0 ? 'active' : ''}`;
        btn.innerText = cat;
        btn.onclick = () => {
            picker.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderEmojiGrid(content, emojiData[cat], onSelect);
        };
        tabs.appendChild(btn);
    });

    picker.appendChild(tabs);
    picker.appendChild(content);
    renderEmojiGrid(content, emojiData['Смайли'], onSelect);
}

function renderEmojiGrid(container, emojis, onSelect) {
    container.innerHTML = emojis.map(e => `<button class="emoji-btn">${e}</button>`).join('');
    container.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.onclick = () => {
            onSelect(btn.innerText);
            document.getElementById('emoji-picker').style.display = 'none';
        };
    });
}

export function toggleEmoji() {
    const p = document.getElementById('emoji-picker');
    p.style.display = p.style.display === 'none' ? 'flex' : 'none';
    p.style.flexDirection = 'column';
}

export function showNotification(title, body, onClick) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';

    toast.innerHTML = `
        <button class="toast-close-btn">&times;</button>
        <div class="toast-title">${title}</div>
        <div class="toast-msg">${body}</div>
    `;

    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        toast.style.animation = 'slideInRight 0.3s reverse forwards';
        setTimeout(() => toast.remove(), 300);
    };

    toast.onclick = () => {
        if (onClick) onClick();
        toast.style.animation = 'slideInRight 0.3s reverse forwards';
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);
}

export function renderProfileGallery(gallery, currentAvatar, onSelect, onDelete) {
    const container = document.getElementById('profile-gallery');
    if (!gallery || gallery.length === 0) {
        container.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:gray;">Немає фото</p>';
        return;
    }

    container.innerHTML = gallery.map(img => {
        const isSelected = img === currentAvatar ? 'selected' : '';
        return `
            <div class="gallery-item ${isSelected}" style="background-image: url(data:image/png;base64,${img})">
                 <div class="delete-gallery-btn">×</div>
            </div>
        `;
    }).join('');

    const items = container.querySelectorAll('.gallery-item');
    items.forEach((item, index) => {
        item.onclick = (e) => {
            if (e.target.classList.contains('delete-gallery-btn')) {
                e.stopPropagation();
                onDelete(gallery[index]);
            } else {
                onSelect(gallery[index]);
            }
        };
    });
}

export function renderReadOnlyGallery(gallery) {
    const container = document.getElementById('user-info-gallery');
    if (!gallery || gallery.length === 0) {
        container.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:gray;">Немає фото</p>';
        return;
    }
    container.innerHTML = gallery.map(img => `
        <div class="gallery-item" style="background-image: url(data:image/png;base64,${img}); cursor:default;"></div>
    `).join('');
}

export function renderParticipants(participants, myId, myRole, onRemove, onPromote, onDemote) {
    const container = document.getElementById('group-participants-list');
    container.innerHTML = participants.map(p => {
        const isMe = p.id === myId;
        const roleLabel = p.role === 'owner' ? '👑' : (p.role === 'admin' ? '⭐' : '');
        let actions = '';

        if (!isMe) {
            if (myRole === 'owner') {
                if (p.role === 'member') actions += `<span class="remove-btn" onclick="window.promoteParticipant('${p.id}')">⬆️ Адмін</span> `;
                if (p.role === 'admin') actions += `<span class="remove-btn" onclick="window.demoteParticipant('${p.id}')">⬇️ Мембер</span> `;
                actions += `<span class="remove-btn" onclick="window.removeParticipant('${p.id}')">Видалити</span>`;
            } else if (myRole === 'admin' && p.role === 'member') {
                actions += `<span class="remove-btn" onclick="window.removeParticipant('${p.id}')">Видалити</span>`;
            }
        }

        return `
            <div class="participant-row">
                <div style="display:flex; align-items:center;">
                    <div class="avatar" style="width:32px; height:32px; font-size:0.8rem; margin-right:10px; background-image: url(data:image/png;base64,${p.avatar || ''})">
                        ${!p.avatar ? p.name[0] : ''}
                    </div>
                    <div>
                        <div style="font-weight:600; font-size:0.9rem;">${p.name} ${roleLabel}</div>
                    </div>
                </div>
                <div style="font-size:0.8rem;">${actions}</div>
            </div>
        `;
    }).join('');

    window.removeParticipant = onRemove;
    window.promoteParticipant = onPromote;
    window.demoteParticipant = onDemote;
}

export function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

export function initCropper(imageSrc, onSave) {
    const modal = document.getElementById('crop-modal');
    const img = document.getElementById('crop-image');
    modal.classList.add('active');
    img.src = imageSrc;

    let cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1
    });

    document.getElementById('crop-save-btn').onclick = () => {
        const canvas = cropper.getCroppedCanvas({width: 200, height: 200});
        onSave(canvas.toDataURL().split(',')[1]);
        cropper.destroy();
        modal.classList.remove('active');
    };

    document.getElementById('crop-cancel-btn').onclick = () => {
        cropper.destroy();
        modal.classList.remove('active');
    };
}

export function startEditing(id, type) {
    if (type !== 'text') return;
    const msgEl = document.getElementById(`msg-${id}`);
    const content = msgEl.querySelector('.msg-content a')
        ? msgEl.querySelector('.msg-content a').href
        : msgEl.querySelector('.msg-content').innerText;

    document.getElementById('msg-input').value = content;
    document.getElementById('msg-input').focus();
    editingMessageId = id;

    const sendBtn = document.getElementById('send-btn');
    sendBtn.innerText = '✓';
    sendBtn.style.color = 'var(--success-color)';
}

export function finishEditing() {
    const content = document.getElementById('msg-input').value;
    document.getElementById('msg-input').value = '';

    const sendBtn = document.getElementById('send-btn');
    sendBtn.innerText = '➤';
    sendBtn.style.color = 'var(--primary-color)';

    const id = editingMessageId;
    editingMessageId = null;
    return {id, content};
}

export function isEditing() {
    return editingMessageId !== null;
}

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, url => `<a href="${url}" target="_blank">${url}</a>`);
}

window.openImage = (src) => {
    const w = window.open("");
    w.document.write(`<img src="${src}" style="max-width:100%">`);
};