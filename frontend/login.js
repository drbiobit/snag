/*
 * Snag - login / first-setup page logic
 *
 * On load, asks the backend whether an account exists yet. If not, shows
 * the "create account" form (first run). Otherwise shows the sign-in form.
 */

const $ = id => document.getElementById(id);

async function init() {
    let needsSetup = false;
    try {
        const r = await fetch('/api/setup', { method: 'POST' });
        if (r.status === 400) needsSetup = true;
    } catch { /* server unreachable */ }

    if (needsSetup) {
        $('setup-panel').style.display = '';
        $('login-panel').style.display = 'none';
    }
}

$('setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('setup-error');
    err.textContent = '';
    const user = $('setup-user').value.trim();
    const pass = $('setup-pass').value;
    const pass2 = $('setup-pass2').value;
    if (pass !== pass2) {
        err.textContent = 'passwords don\u2019t match';
        return;
    }
    $('setup-btn').disabled = true;
    try {
        const r = await fetch('/api/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const d = await r.json();
        if (!d.success) {
            err.textContent = d.error || 'setup failed';
            return;
        }
        window.location.href = '/';
    } catch {
        err.textContent = 'could not reach the server';
    } finally {
        $('setup-btn').disabled = false;
    }
});

$('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('login-error');
    err.textContent = '';
    const user = $('login-user').value.trim();
    const pass = $('login-pass').value;
    $('login-btn').disabled = true;
    try {
        const r = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const d = await r.json();
        if (!d.success) {
            err.textContent = d.error || 'invalid credentials';
            return;
        }
        window.location.href = '/';
    } catch {
        err.textContent = 'could not reach the server';
    } finally {
        $('login-btn').disabled = false;
    }
});

init();
