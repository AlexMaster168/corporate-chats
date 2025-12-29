let currentChat = 'general_chat';
let currentChatType = 'group';
let currentTab = 'groups';
let mediaRecorder = null;
let recordingChunks = [];
let lastMessageCount = 0;
let isRefreshing = false;
function showTab(tab) {
currentTab = tab;
document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
event.target.classList.add('active');
if (tab === 'users') {
    htmx.ajax('GET', '/api/users', {target: '#userList'});
} else {
    htmx.ajax('GET', '/api/groups', {target: '#userList'});
}
}
function selectChat(id, name, type) {
currentChat = id;
currentChatType = type;
document.getElementById('chatTitle').textContent = name;
document.querySelectorAll('.user-item, .group-item').forEach(el => el.classList.remove('active'));
event.currentTarget.classList.add('active');
lastMessageCount = 0;
refreshMessages();
}
function refreshMessages() {
if (!currentChat || isRefreshing) return;
isRefreshing = true;
const url = '/api/messages?chat=' + encodeURIComponent(currentChat) + '&type=' + encodeURIComponent(currentChatType);

fetch(url)
    .then(r => r.text())
    .then(html => {
        const messagesDiv = document.getElementById('messages');
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newMessages = doc.querySelectorAll('.message, p');

        if (newMessages.length !== lastMessageCount) {
            const shouldScroll = messagesDiv.scrollHeight - messagesDiv.scrollTop <= messagesDiv.clientHeight + 100;
            messagesDiv.innerHTML = html;
            lastMessageCount = newMessages.length;

            if (shouldScroll) {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }

        isRefreshing = false;
    })
    .catch(err => {
        console.error('Error refreshing messages:', err);
        isRefreshing = false;
    });
}
function sendMessage() {
const input = document.getElementById('messageInput');
const message = input.value.trim();
if (!message || !currentChat) return;

const encrypted = btoa(unescape(encodeURIComponent(message)));

fetch('/api/send', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
        to: currentChat,
        content: encrypted,
        type: currentChatType
    })
}).then(r => r.json())
  .then(data => {
    input.value = '';
    lastMessageCount = 0;
    refreshMessages();
});
}
function uploadFile(input) {
if (!input.files.length || !currentChat) return;
const file = input.files[0];
const reader = new FileReader();

const progressModal = document.getElementById('progressModal');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

progressModal.classList.add('active');
progressFill.style.width = '0%';
progressText.textContent = '0%';

reader.onprogress = function(e) {
    if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = percent + '%';
        progressText.textContent = percent + '%';
    }
};

reader.onload = function(e) {
    progressFill.style.width = '100%';
    progressText.textContent = '100%';

    fetch('/api/upload', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            to: currentChat,
            filename: file.name,
            content: e.target.result,
            type: currentChatType
        })
    }).then(() => {
        setTimeout(() => {
            progressModal.classList.remove('active');
            input.value = '';
            lastMessageCount = 0;
            refreshMessages();
        }, 500);
    });
};

reader.readAsDataURL(file);
}
function recordVoice() {
if (!currentChat) {
alert('Оберіть отримувача');
return;
}
if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
}

navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        recordingChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) {
                recordingChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordingChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
                fetch('/api/voice', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        to: currentChat,
                        audio: reader.result,
                        type: currentChatType
                    })
                }).then(() => {
                    lastMessageCount = 0;
                    refreshMessages();
                });
            };
            reader.readAsDataURL(blob);
            stream.getTracks().forEach(track => track.stop());
            document.getElementById('voiceBtn').textContent = '🎤';
        };

        mediaRecorder.start();
        document.getElementById('voiceBtn').textContent = '⏹';
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, 180000);
    })
    .catch(err => alert('Помилка доступу до мікрофону'));
}
function showGroupModal() {
fetch('/api/users-list')
.then(r => r.json())
.then(users => {
const select = document.getElementById('groupMembers');
select.innerHTML = users.map(u =>
'<option value="' + u.id + '">' + u.name + '</option>'
).join('');
document.getElementById('groupModal').classList.add('active');
});
}
function hideGroupModal() {
document.getElementById('groupModal').classList.remove('active');
}
function createGroup() {
const name = document.getElementById('groupName').value.trim();
const select = document.getElementById('groupMembers');
const members = Array.from(select.selectedOptions).map(o => o.value);
if (!name || members.length < 2) {
    alert('Введіть назву та оберіть принаймні 2 учасників');
    return;
}

fetch('/api/group/create', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name: name, members: members })
}).then(() => {
    hideGroupModal();
    showTab('groups');
});
}
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keypress', function(e) {
if (e.key === 'Enter') {
sendMessage();
}
});
document.getElementById('fileInput').addEventListener('change', function() {
uploadFile(this);
});
document.getElementById('voiceBtn').addEventListener('click', recordVoice);
document.getElementById('createGroupBtn').addEventListener('click', createGroup);

setInterval(refreshMessages, 3000);