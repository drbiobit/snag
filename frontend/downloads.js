/*
 * Snag - downloads page logic
 *
 * Lists the files in the downloads folder, with a download link and a
 * delete button for each. Refreshes on load.
 */

// Short helper to grab an element by id.
const $ = id => document.getElementById(id);

// Format a byte count as a human-readable string (e.g. "5.12 MB").
function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

// Render one row for a file.
function row(f) {
    const el = document.createElement('div');
    el.className = 'dl-row';
    el.innerHTML = `
        <span class="dl-name" title="${f.name}">${f.name}</span>
        <span class="dl-size">${formatSize(f.size)}</span>
        <a class="dl-btn" href="/downloads/${encodeURIComponent(f.name)}" download>download</a>
        <button class="dl-btn dl-del" data-name="${f.name}">delete</button>`;
    return el;
}

// Load the file list from the backend and render it.
async function load() {
    const r = await fetch('/api/downloads');
    const d = await r.json();
    const list = $('dl-list');
    list.innerHTML = '';

    const files = (d.downloads || []).sort((a, b) => b.size - a.size);
    $('dl-count').textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;

    if (!files.length) {
        list.innerHTML = '<p class="muted">No downloads yet. Grab something from the app.</p>';
        return;
    }
    files.forEach(f => list.appendChild(row(f)));
}

// Delete a file (with confirmation) and refresh the list.
async function del(name) {
    if (!confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/delete/${encodeURIComponent(name)}`, { method: 'POST' });
    load();
}

// Wire up the delete buttons (event delegation - rows are re-created).
$('dl-list').addEventListener('click', e => {
    const btn = e.target.closest('.dl-del');
    if (btn) del(btn.dataset.name);
});

// Initial load.
load();
