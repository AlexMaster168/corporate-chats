import { fetchWithAuth, getAccessToken } from '../api.js';
import * as UI from '../ui.js';

let mediaRecorder;
let myPeer = null;
let myStream = null;
let peers = {};

export function startVoice(socket, currentRoom) {
    const btn = document.getElementById('voice-btn');
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        btn.innerText = '🎤';
        btn.style.color = 'var(--text-secondary)';
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        mediaRecorder = new MediaRecorder(stream);
        let audioChunks = [];
        mediaRecorder.addEventListener("dataavailable", event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        });
        mediaRecorder.addEventListener("stop", () => {
            if (audioChunks.length === 0) return;
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            if(audioBlob.size < 1000) return;
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                socket.emit('send_message', {
                    token: getAccessToken(),
                    room_id: currentRoom,
                    content: reader.result,
                    type: 'voice'
                });
            };
            stream.getTracks().forEach(track => track.stop());
        });
        mediaRecorder.start();
        btn.innerText = '⏹';
        btn.style.color = 'red';
    }).catch(e => alert("Нет доступа к микрофону"));
}

export function handleAvatarUpload(callback) {
    const file = document.getElementById('avatar-input').files[0];
    if(!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        UI.initCropper(e.target.result, async (base64) => {
            const res = await fetchWithAuth('/api/user/avatar/upload', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({image: base64})
            });
            const data = await res.json();
            callback(data);
        });
    };
    reader.readAsDataURL(file);
    document.getElementById('avatar-input').value = '';
}

export function startVideoCall(socket, currentRoom) {
    document.getElementById('video-modal').classList.add('active');

    myPeer = new Peer(undefined);

    myPeer.on('open', id => {
        socket.emit('join_video_room', { room_id: currentRoom, peer_id: id });
    });

    navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(stream => {
        myStream = stream;
        addVideoStream(document.createElement('video'), stream, true);

        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            call.on('stream', userVideoStream => {
                addVideoStream(video, userVideoStream);
            });
        });
    });
}

export function connectToNewUser(peerId, stream) {
    const call = myPeer.call(peerId, stream);
    const video = document.createElement('video');
    call.on('stream', userVideoStream => {
        addVideoStream(video, userVideoStream);
    });
    peers[peerId] = call;
}

export function handleUserDisconnect(peerId) {
    if (peers[peerId]) peers[peerId].close();
}

function addVideoStream(video, stream, muted=false) {
    const grid = document.getElementById('video-grid');
    video.srcObject = stream;
    video.playsInline = true;
    video.autoplay = true;
    video.addEventListener('loadedmetadata', () => video.play());
    video.muted = muted;
    const card = document.createElement('div');
    card.className = 'video-card';
    card.appendChild(video);
    grid.appendChild(card);
}

export function toggleScreenShare() {
    navigator.mediaDevices.getDisplayMedia({video:true}).then(stream => {
        const videoTrack = stream.getVideoTracks()[0];
        const sender = myStream.getVideoTracks()[0];
        myStream.removeTrack(sender);
        myStream.addTrack(videoTrack);

        for(let peerId in peers) {
            const pc = peers[peerId].peerConnection;
            const sender = pc.getSenders().find(s => s.track.kind === 'video');
            sender.replaceTrack(videoTrack);
        }

        videoTrack.onended = () => {
             navigator.mediaDevices.getUserMedia({video:true}).then(camStream => {
                 const camTrack = camStream.getVideoTracks()[0];
                 myStream.removeTrack(videoTrack);
                 myStream.addTrack(camTrack);
                 for(let peerId in peers) {
                    const pc = peers[peerId].peerConnection;
                    const sender = pc.getSenders().find(s => s.track.kind === 'video');
                    sender.replaceTrack(camTrack);
                 }
             });
        };
    });
}

export function toggleAudio() {
    if(myStream) {
        const track = myStream.getAudioTracks()[0];
        if(track) {
            track.enabled = !track.enabled;
            const btn = document.getElementById('toggle-mic-btn');
            btn.style.background = track.enabled ? 'var(--primary-color)' : 'red';
            btn.innerText = track.enabled ? 'Мікрофон вкл' : 'Мікрофон викл';
        }
    }
}

export function toggleVideo() {
    if(myStream) {
        const track = myStream.getVideoTracks()[0];
        if(track) {
            track.enabled = !track.enabled;
            const btn = document.getElementById('toggle-cam-btn');
            btn.style.background = track.enabled ? 'var(--primary-color)' : 'red';
            btn.innerText = track.enabled ? 'Камера вкл' : 'Камера викл';
        }
    }
}

export function closeVideoCall(socket, currentRoom) {
    document.getElementById('video-modal').classList.remove('active');
    if(myStream) myStream.getTracks().forEach(t => t.stop());
    if(myPeer) {
        socket.emit('leave_video_room', { room_id: currentRoom, peer_id: myPeer.id });
        myPeer.destroy();
    }
    document.getElementById('video-grid').innerHTML = '';
}