import { getAccessToken } from './api.js';

export function initSocket() {
    return io({
        auth: { token: getAccessToken() }
    });
}