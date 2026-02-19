document.addEventListener('DOMContentLoaded', function () {

    // ── Constants ────────────────────────────────────────────────────────────
    const BASE = 'https://www.flurs.xyz';

    function getScriptUrl(hash) { return `${BASE}/files/v2/loader/${hash}.lua`; }
    function getLoadstring(hash) { return `loadstring(game:HttpGet("${BASE}/files/v2/loader/${hash}.lua", true))()`; }
    function getKeyLoaderSnippet(hash) { return `script_key = "YOUR-KEY"\nloadstring(game:HttpGet("${BASE}/files/v3/loader/${hash}.lua", true))()`; }

    // ── Navigation ───────────────────────────────────────────────────────────
    const navLinks = document.querySelectorAll('.nav-link');
    const pages    = document.querySelectorAll('.page');
    const navbar   = document.querySelector('.navbar');

    function showPage(name) {
        pages.forEach(p => {
            if (p.classList.contains('active')) {
                p.style.opacity = '0';
                setTimeout(() => { p.classList.remove('active'); p.style.opacity = ''; }, 200);
            }
        });
        const target = document.getElementById(name + '-page');
        if (!target) return;
        setTimeout(() => {
            target.classList.add('active');
            target.style.opacity = '0';
            requestAnimationFrame(() => {
                target.style.transition = 'opacity 0.4s ease';
                target.style.opacity = '1';
            });
        }, 200);
        navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('data-page') === name));
    }

    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            showPage(page);
            history.pushState(null, '', '#' + page);
        });
    });

    function handleInitialPage() {
        const hash = window.location.hash.replace('#', '') || 'home';
        if (hash === 'admin') { showAdminPage(); return; }
        const link = document.querySelector(`.nav-link[data-page="${hash}"]`);
        if (link) link.click();
        else document.querySelector('.nav-link[data-page="home"]')?.click();
    }

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '') || 'home';
        if (hash === 'admin') { showAdminPage(); return; }
        const link = document.querySelector(`.nav-link[data-page="${hash}"]`);
        if (link) link.click();
    });

    // ── Navbar scroll ────────────────────────────────────────────────────────
    window.addEventListener('scroll', () => {
        navbar?.classList.toggle('scrolled', window.pageYOffset > 50);
        const particles = document.querySelector('.floating-particles');
        if (particles) particles.style.transform = `translateY(${window.pageYOffset * 0.5}px)`;
    });

    // ── Social buttons ───────────────────────────────────────────────────────
    const discordBtn = document.getElementById('download-btn');
    const tiktokBtn  = document.getElementById('tiktok-btn');
    const youtubeBtn = document.getElementById('youtube-btn');

    if (discordBtn) {
        discordBtn.addEventListener('click', function () {
            this.disabled = true;
            const progress = this.querySelector('.btn-progress');
            if (progress) progress.style.width = '100%';
            setTimeout(() => {
                this.disabled = false;
                if (progress) progress.style.width = '0%';
                window.open('https://discord.gg/tWK2SqrrFf', '_blank')?.focus();
            }, 600);
        });
    }
    tiktokBtn?.addEventListener('click', () => window.open('https://tiktok.com/@flurs.xyz', '_blank')?.focus());
    youtubeBtn?.addEventListener('click', () => window.open('https://youtube.com/@flurshub', '_blank')?.focus());

    // ── Notification ─────────────────────────────────────────────────────────
    function showNotification(msg, type = 'success') {
        const n = document.createElement('div');
        n.textContent = msg;
        n.style.cssText = `position:fixed;bottom:20px;right:20px;padding:1rem 2rem;
            background:${type === 'success' ? '#10b981' : '#ef4444'};color:#fff;border-radius:8px;
            z-index:9999;opacity:0;transform:translateY(20px);transition:all 0.3s ease;
            box-shadow:0 4px 12px rgba(0,0,0,0.3);font-weight:500;`;
        document.body.appendChild(n);
        requestAnimationFrame(() => { n.style.opacity = '1'; n.style.transform = 'translateY(0)'; });
        setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 3000);
    }
    window.showNotification = showNotification;

    // ── Copy buttons (static) ────────────────────────────────────────────────
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
            const code = this.parentElement.querySelector('.script-code, .config-code, .path-code');
            if (!code) return;
            try {
                await navigator.clipboard.writeText(code.textContent);
                const orig = this.textContent; this.textContent = 'Copied!'; this.style.color = '#10b981';
                setTimeout(() => { this.textContent = orig; this.style.color = ''; }, 2000);
                showNotification('Copied!', 'success');
            } catch { showNotification('Failed to copy', 'error'); }
        });
    });

    // ── Scroll animations ────────────────────────────────────────────────────
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            if (el.classList.contains('stat-number')) {
                const target = parseInt(el.getAttribute('data-count') || 0);
                let start = 0; const inc = target / 125;
                const t = setInterval(() => { start += inc; if (start >= target) { el.textContent = target.toLocaleString(); clearInterval(t); } else el.textContent = Math.floor(start).toLocaleString(); }, 16);
            }
            el.style.opacity = '1'; el.style.transform = 'translateY(0)';
            observer.unobserve(el);
        });
    }, { threshold: 0.2, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.feature-card, .script-card, .config-card, .stat-number').forEach(el => {
        el.style.opacity = '0'; el.style.transform = 'translateY(40px)'; observer.observe(el);
    });
    window._scriptObserver = observer;

    // ── Image modal ──────────────────────────────────────────────────────────
    const imgModal = document.getElementById('image-modal');
    const enlargedImg = document.getElementById('enlarged-image');
    document.querySelector('.modal-overlay')?.addEventListener('click', () => {
        imgModal?.classList.remove('active'); document.body.style.overflow = '';
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && imgModal?.classList.contains('active')) { imgModal.classList.remove('active'); document.body.style.overflow = ''; }
    });
    function wireImageZoom(container) {
        container.querySelectorAll('.script-image img').forEach(img => {
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', () => {
                enlargedImg.src = img.src; imgModal.classList.add('active'); document.body.style.overflow = 'hidden';
            });
        });
    }
    wireImageZoom(document);

    // ── Search ───────────────────────────────────────────────────────────────
    const scriptSearch = document.getElementById('script-search');
    if (scriptSearch) {
        scriptSearch.addEventListener('input', () => {
            const term = scriptSearch.value.trim().toLowerCase();
            document.querySelectorAll('.script-card').forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                const tags = (card.getAttribute('data-tags') || '').toLowerCase();
                card.style.display = (!term || name.includes(term) || tags.includes(term)) ? '' : 'none';
            });
        });
    }

    // ── Dynamic public scripts (scripts page) ────────────────────────────────
    async function loadDynamicScripts() {
        const grid = document.querySelector('#scripts-page .scripts-grid');
        if (!grid) return;
        grid.querySelectorAll('.dynamic-script-card').forEach(el => el.remove());

        try {
            const res = await fetch(`${BASE}/api/uploadscript`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list' }),
            });
            const data = await res.json();
            if (!data.ok || !data.scripts?.length) return;

            data.scripts.forEach(script => {
                const tagsHtml = (script.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
                const imgHtml = script.image_data
                    ? `<img src="${escHtml(script.image_data)}" alt="${escHtml(script.name)} Preview" loading="lazy">`
                    : `<img src="./images/Hub.png" alt="${escHtml(script.name)} Preview">`;
                const card = document.createElement('div');
                card.className = 'script-card dynamic-script-card';
                card.setAttribute('data-name', script.name || '');
                card.setAttribute('data-tags', (script.tags || []).join(' '));
                card.innerHTML = `
                    <div class="script-image">${imgHtml}<div class="script-overlay"><span class="script-status">Active</span></div></div>
                    <div class="script-content">
                        <h3 class="script-name">${escHtml(script.name)}</h3>
                        <p class="script-description">${escHtml(script.description || '')}</p>
                        <div class="script-code-container">
                            <code class="script-code">${escHtml(script.loadstring)}</code>
                            <button class="copy-btn">Copy</button>
                        </div>
                        <div class="script-tags">${tagsHtml}</div>
                    </div>`;

                card.querySelector('.copy-btn')?.addEventListener('click', async function () {
                    const code = this.parentElement.querySelector('.script-code')?.textContent;
                    if (!code) return;
                    try {
                        await navigator.clipboard.writeText(code);
                        const orig = this.textContent; this.textContent = 'Copied!'; this.style.color = 'var(--green)';
                        setTimeout(() => { this.textContent = orig; this.style.color = ''; }, 2000);
                        showNotification('Copied!', 'success');
                    } catch { showNotification('Failed to copy', 'error'); }
                });

                card.style.opacity = '0'; card.style.transform = 'translateY(40px)';
                grid.appendChild(card);
                observer.observe(card);
                wireImageZoom(card);
            });
        } catch (err) {
            console.error('loadDynamicScripts:', err);
        }
    }
    loadDynamicScripts();
    window._loadDynamicScripts = loadDynamicScripts;

    // ── Admin password helpers ───────────────────────────────────────────────
    function getPw() { return localStorage.getItem('flurs_admin_pw') || ''; }
    function setPw(pw) { localStorage.setItem('flurs_admin_pw', pw); }
    function clearPw() { localStorage.removeItem('flurs_admin_pw'); }

    async function verifyPassword(pw) {
        const res = await fetch(`${BASE}/api/admin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list', password: pw }),
        });
        const data = await res.json();
        return data.ok === true;
    }

    // ── Show admin page ───────────────────────────────────────────────────────
    function showAdminPage() {
        pages.forEach(p => p.classList.remove('active'));
        const adminPage = document.getElementById('admin-page');
        if (adminPage) adminPage.classList.add('active');
        navLinks.forEach(l => l.classList.remove('active'));
        history.replaceState(null, '', '#admin');

        const savedPw = getPw();
        if (savedPw) {
            verifyPassword(savedPw).then(ok => {
                if (ok) unlockDashboard(savedPw);
                else { clearPw(); showLoginGate(); }
            });
        } else {
            showLoginGate();
        }
    }

    function showLoginGate() {
        const gate  = document.getElementById('admin-gate');
        const panel = document.getElementById('admin-panel');
        if (gate)  gate.style.display  = 'flex';
        if (panel) panel.style.display = 'none';
    }

    function unlockDashboard(pw) {
        setPw(pw);
        const gate  = document.getElementById('admin-gate');
        const panel = document.getElementById('admin-panel');
        if (gate)  gate.style.display  = 'none';
        if (panel) { panel.style.display = 'flex'; panel.style.flexDirection = 'row'; }
    }

    // ── Admin login button ───────────────────────────────────────────────────
    const loginBtn   = document.getElementById('admin-login-btn');
    const pwInput    = document.getElementById('admin-password-input');
    const loginError = document.getElementById('admin-login-error');

    async function doLogin() {
        const pw = pwInput?.value || '';
        if (!pw) return;
        if (loginBtn) { loginBtn.disabled = true; loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…'; }

        const ok = await verifyPassword(pw);

        if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Unlock Dashboard'; }

        if (ok) {
            if (loginError) loginError.style.display = 'none';
            unlockDashboard(pw);
        } else {
            clearPw();
            if (pwInput) pwInput.value = '';
            if (loginError) loginError.style.display = 'block';
        }
    }

    loginBtn?.addEventListener('click', doLogin);
    pwInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    // ── Expose helpers for dashboard (index.html inline script) ─────────────
    window.flursBase          = BASE;
    window.flursGetPw         = getPw;
    window.flursGetScriptUrl  = getScriptUrl;
    window.flursGetLoadstring = getLoadstring;
    window.flursGetKeySnippet = getKeyLoaderSnippet;
    window.flursShowNotif     = showNotification;

    // ── Expand/collapse ───────────────────────────────────────────────────────
    document.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const details = this.parentElement.querySelector('.config-details');
            if (!details) return;
            const hidden = !details.style.display || details.style.display === 'none';
            if (hidden) {
                details.style.display = 'block'; details.style.opacity = '0'; details.style.maxHeight = '0';
                requestAnimationFrame(() => { details.style.transition = 'opacity 0.3s,max-height 0.3s'; details.style.opacity = '1'; details.style.maxHeight = '1000px'; });
                this.textContent = 'Collapse'; this.classList.add('active');
            } else {
                details.style.opacity = '0'; details.style.maxHeight = '0';
                setTimeout(() => { details.style.display = 'none'; }, 300);
                this.textContent = 'Expand'; this.classList.remove('active');
            }
        });
    });

    // ── Escape HTML helper ────────────────────────────────────────────────────
    function escHtml(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    window.escHtml = escHtml;

    // ── Init ──────────────────────────────────────────────────────────────────
    handleInitialPage();

});
