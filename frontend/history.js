/*
 * Snag - history page logic
 *
 * Shows the download history from the SQLite database, with a
 * "clear history" and "reset credentials" button.
 */

// Short helper to grab an element by id.
const $ = id => document.getElementById(id);

// Redirect to the login page if the session has expired.
const handle401 = r => { if (r.status === 401) { window.location.href = '/login'; return true; } return false; };

// Format a byte count as a human-readable string (e.g. "5.12 MB").
function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

// Format an ISO timestamp as a short local string (e.g. "Oct 3, 14:22").
function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        + ', '
        + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Status badge colour.
function statusClass(s) {
    if (s === 'completed') return 'hist-ok';
    if (s === 'cancelled') return 'hist-warn';
    return 'hist-err';
}

// Render one row for a history entry. Built with textContent/Attribute
// assignments only - never innerHTML - so crafted URLs or video titles
// can't inject markup into the page.
function row(h) {
    const el = document.createElement('div');
    el.className = 'hist-row';
    let files = [];
    try { files = h.files ? JSON.parse(h.files) : []; } catch (e) { files = []; }
    const fileNames = files.map(f => f.split('/').pop()).join(', ');
    const title = h.title || (fileNames ? fileNames.split(',')[0] : h.url);

    const status = document.createElement('span');
    status.className = `hist-status ${statusClass(h.status)}`;
    status.textContent = h.status || '';

    const titleEl = document.createElement('span');
    titleEl.className = 'hist-title';
    titleEl.setAttribute('title', title || '');
    titleEl.textContent = title || '';

    const urlEl = document.createElement('span');
    urlEl.className = 'hist-url';
    urlEl.setAttribute('title', h.url || '');
    urlEl.textContent = h.url || '';

    const sizeEl = document.createElement('span');
    sizeEl.className = 'hist-size';
    sizeEl.textContent = h.size_bytes ? formatSize(h.size_bytes) : '—';

    const timeEl = document.createElement('span');
    timeEl.className = 'hist-time';
    timeEl.textContent = formatTime(h.created_at);

    el.append(status, titleEl, urlEl, sizeEl, timeEl);
    return el;
}

// Load the history from the backend and render it.
async function load() {
    const r = await fetch('/api/history');
    if (handle401(r)) return;
    const d = await r.json();
    const list = $('hist-list');
    list.innerHTML = '';

    const entries = d.history || [];
    $('hist-count').textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

    if (!entries.length) {
        list.innerHTML = '<p class="muted">No downloads yet. Grab something from the app.</p>';
        return;
    }
    entries.forEach(h => list.appendChild(row(h)));
}

// Clear the download history (with confirmation).
async function clearHistory() {
    if (!confirm('Clear all download history?')) return;
    const r = await fetch('/api/history/clear', { method: 'POST' });
    if (handle401(r)) return;
    load();
}

// Reset credentials (with confirmation). Logs out the current session.
async function clearAuth() {
    if (!confirm('Reset credentials? This deletes the stored account and logs you out. You will need to create a new account.')) return;
    const r = await fetch('/api/auth/clear', { method: 'POST' });
    if (handle401(r)) return;
    window.location.href = '/login';
}

// Wire up the buttons.
$('clear-history-btn').addEventListener('click', clearHistory);
$('clear-auth-btn').addEventListener('click', clearAuth);

// Initial load.
load();
