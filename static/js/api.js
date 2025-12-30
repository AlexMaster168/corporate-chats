let accessToken = sessionStorage.getItem('access_token');
let refreshToken = sessionStorage.getItem('refresh_token');

export const getAccessToken = () => accessToken;
export const getMyId = () => sessionStorage.getItem('user_id');
export const getMyName = () => sessionStorage.getItem('user_name');

export async function fetchWithAuth(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${accessToken}`;

    let response = await fetch(url, options);

    if (response.status === 401) {
        const refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${refreshToken}` }
        });

        if (refreshRes.ok) {
            const data = await refreshRes.json();
            accessToken = data.access_token;
            sessionStorage.setItem('access_token', accessToken);
            options.headers['Authorization'] = `Bearer ${accessToken}`;
            response = await fetch(url, options);
        } else {
            window.location.href = '/';
        }
    }
    return response;
}

export async function login(name, password) {
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, password})
    });
    return await res.json();
}

export async function register(data) {
    const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    return await res.json();
}

export function saveSession(data) {
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    sessionStorage.setItem('access_token', data.access_token);
    sessionStorage.setItem('refresh_token', data.refresh_token);
    sessionStorage.setItem('user_id', data.user_id);
    sessionStorage.setItem('user_name', data.name);
}