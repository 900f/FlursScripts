document.addEventListener('DOMContentLoaded', function() {
    // Enhanced navigation functionality
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    const navbar = document.querySelector('.navbar');
   
    // Handle navigation clicks with smooth transitions
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
           
            // Update active nav link
            navLinks.forEach(navLink => {
                navLink.classList.remove('active');
                navLink.setAttribute('aria-current', 'false');
            });
            this.classList.add('active');
            this.setAttribute('aria-current', 'page');
           
            // Fade out current page
            pages.forEach(page => {
                if (page.classList.contains('active')) {
                    page.style.opacity = '0';
                    page.style.transform = 'translateY(20px)';
                    setTimeout(() => {
                        page.classList.remove('active');
                        page.style.opacity = '';
                        page.style.transform = '';
                    }, 200);
                }
            });
           
            // Fade in target page
            const targetPage = this.getAttribute('data-page');
            const targetElement = document.getElementById(targetPage + '-page');
           
            if (targetElement) {
                setTimeout(() => {
                    targetElement.classList.add('active');
                    targetElement.style.opacity = '0';
                    targetElement.style.transform = 'translateY(20px)';
                   
                    requestAnimationFrame(() => {
                        targetElement.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                        targetElement.style.opacity = '1';
                        targetElement.style.transform = 'translateY(0)';
                    });
                }, 200);
            }
           
            // Update URL hash
            history.pushState(null, '', `#${targetPage}`);
           
            // Accessibility: Focus the new page
            if (targetElement) {
                targetElement.setAttribute('tabindex', '-1');
                targetElement.focus();
            }
        });
    });
   
    // Handle initial page load from URL hash
    function handleInitialPage() {
        const hash = window.location.hash.replace('#', '') || 'home';
        const targetLink = document.querySelector(`.nav-link[data-page="${hash}"]`);
        if (targetLink) targetLink.click();
        else document.querySelector('.nav-link[data-page="home"]')?.click();
    }
    // handleInitialPage is called after special route check below
   
    // Navbar scroll effect + parallax
    let lastScrollTop = 0;
    const scrollThreshold = 50;
   
    window.addEventListener('scroll', function() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
       
        if (scrollTop > scrollThreshold) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
       
        const particles = document.querySelector('.floating-particles');
        if (particles) {
            particles.style.transform = `translateY(${scrollTop * 0.5}px)`;
        }
       
        lastScrollTop = scrollTop;
    });
   
    // Social Buttons
    const discordBtn = document.getElementById('download-btn');
    const tiktokBtn = document.getElementById('tiktok-btn');
    const youtubeBtn = document.getElementById('youtube-btn');
   
    if (discordBtn) {
        discordBtn.addEventListener('click', function() {
            this.disabled = true;
            this.style.pointerEvents = 'none';
            this.style.transform = 'scale(0.95)';
           
            const progress = this.querySelector('.btn-progress');
            if (progress) progress.style.width = '100%';
           
            setTimeout(() => {
                this.style.transform = '';
                this.style.pointerEvents = '';
                this.disabled = false;
                if (progress) progress.style.width = '0%';
                window.open('https://discord.gg/tWK2SqrrFf', '_blank')?.focus();
            }, 600);
        });
       
        ['mouseenter', 'focus'].forEach(ev => discordBtn.addEventListener(ev, () => {
            const icon = discordBtn.querySelector('.btn-icon');
            if (icon) icon.style.transform = 'translateY(2px)';
        }));
        ['mouseleave', 'blur'].forEach(ev => discordBtn.addEventListener(ev, () => {
            const icon = discordBtn.querySelector('.btn-icon');
            if (icon) icon.style.transform = '';
        }));
        discordBtn.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), discordBtn.click()));
    }
   
    if (tiktokBtn) {
        tiktokBtn.addEventListener('click', () => window.open('https://tiktok.com/@flurs.xyz', '_blank')?.focus());
        tiktokBtn.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), tiktokBtn.click()));
    }
   
    if (youtubeBtn) {
        youtubeBtn.addEventListener('click', () => {
            window.open('https://youtube.com/@YourChannel', '_blank')?.focus();
            showNotification('Opening YouTube channel!', 'success');
        });
        youtubeBtn.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), youtubeBtn.click()));
    }
   
    // Copy buttons (scripts, configs, paths)
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            const codeEl = this.parentElement.querySelector('.script-code, .config-code, .path-code');
            if (!codeEl) return;
           
            try {
                await navigator.clipboard.writeText(codeEl.textContent);
                this.innerHTML = 'Copied';
                this.style.color = '#10b981';
                this.style.transform = 'scale(1.2)';
                showNotification('Copied to clipboard!', 'success');
               
                setTimeout(() => {
                    this.innerHTML = 'Copy';
                    this.style.color = '';
                    this.style.transform = '';
                }, 2000);
            } catch (err) {
                showNotification('Failed to copy', 'error');
            }
        });
        btn.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), btn.click()));
    });
   
    // Expand/Collapse config details
    document.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const details = this.parentElement.querySelector('.config-details');
            const isHidden = details.style.display === 'none' || !details.style.display;
           
            details.style.display = 'block';
            details.style.transition = 'opacity 0.3s ease, max-height 0.3s ease';
           
            if (isHidden) {
                details.style.opacity = '0';
                details.style.maxHeight = '0';
                requestAnimationFrame(() => {
                    details.style.opacity = '1';
                    details.style.maxHeight = '1000px';
                });
                this.textContent = 'Collapse';
                this.classList.add('active');
            } else {
                details.style.opacity = '0';
                details.style.maxHeight = '0';
                this.textContent = 'Expand';
                this.classList.remove('active');
                setTimeout(() => { details.style.display = 'none'; }, 300);
            }
        });
        btn.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), btn.click()));
    });
   
    // Script & Config Search
    function setupSearch(inputId, cardSelector, useTags = false) {
        const input = document.getElementById(inputId);
        const cards = document.querySelectorAll(cardSelector);
        if (!input) return;
       
        input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();
            cards.forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                const tags = useTags ? (card.getAttribute('data-tags') || '').toLowerCase() : '';
                const matches = term === '' || name.includes(term) || (useTags && tags.includes(term));
               
                if (matches) {
                    card.style.display = '';
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    requestAnimationFrame(() => {
                        card.style.transition = 'all 0.4s ease';
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    });
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    setTimeout(() => card.style.display = 'none', 400);
                }
            });
        });
       
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                input.value = '';
                input.dispatchEvent(new Event('input'));
            }
        });
    }
   
    setupSearch('script-search', '.script-card', true);
    setupSearch('config-search', '.config-card');
    setupSearch('brainrot-search', '#brainrots-page .script-card', true);
   
    // Notification system
    function showNotification(message, type = 'success') {
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.textContent = message;
        notif.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 1rem 2rem;
            background: ${type === 'success' ? '#10b981' : '#ef4444'};
            color: white; border-radius: 8px; z-index: 2000;
            opacity: 0; transform: translateY(20px); transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-weight: 500;
        `;
        document.body.appendChild(notif);
        requestAnimationFrame(() => {
            notif.style.opacity = '1';
            notif.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            notif.style.opacity = '0';
            notif.style.transform = 'translateY(20px)';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }
   
    // Animated counters
    function animateCounter(el, target, duration = 2000) {
        let start = 0;
        const increment = target / (duration / 16);
        const timer = setInterval(() => {
            start += increment;
            if (start >= target) {
                el.textContent = target.toLocaleString();
                clearInterval(timer);
            } else {
                el.textContent = Math.floor(start).toLocaleString();
            }
        }, 16);
    }
   
    // Intersection Observer for scroll animations
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                if (el.classList.contains('stat-number')) {
                    const target = parseInt(el.getAttribute('data-count') || 0);
                    animateCounter(el, target);
                }
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.2, rootMargin: '0px 0px -50px 0px' });
   
    document.querySelectorAll('.feature-card, .script-card, .config-card, .stat-number').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(40px)';
        observer.observe(el);
    });
   
    // Progress bars animation
    const barObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const bar = entry.target;
                const width = bar.getAttribute('data-width') || '0%';
                bar.style.transition = 'width 1.4s ease-out';
                requestAnimationFrame(() => bar.style.width = width);
                barObserver.unobserve(bar);
            }
        });
    }, { threshold: 0.6 });
   
    document.querySelectorAll('.bar-fill').forEach(bar => {
        bar.style.width = '0';
        barObserver.observe(bar);
    });
   
    // Skip to content link (accessibility)
    const skipLink = document.createElement('a');
    skipLink.href = '#home-page';
    skipLink.className = 'skip-link';
    skipLink.textContent = 'Skip to main content';
    skipLink.style.cssText = `
        position: absolute; top: -100px; left: 6px; background: #000; color: #fff;
        padding: 8px 16px; z-index: 10000; transition: top 0.3s;
    `;
    skipLink.addEventListener('focus', () => skipLink.style.top = '6px');
    skipLink.addEventListener('blur', () => skipLink.style.top = '-100px');
    document.body.prepend(skipLink);
   
    // Image modal
    const modal = document.getElementById('image-modal');
    const enlargedImg = document.getElementById('enlarged-image');
    const overlay = document.querySelector('.modal-overlay');
   
    document.querySelectorAll('.script-image img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => {
            enlargedImg.src = img.src;
            enlargedImg.alt = img.alt;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
        img.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), img.click()));
    });
   
    if (overlay) {
        overlay.addEventListener('click', () => {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
   
    // Resize handler (re-trigger animations if needed)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            document.querySelectorAll('.feature-card, .script-card, .config-card, .stat-number')
                .forEach(el => {
                    if (el.style.opacity === '0') observer.observe(el);
                });
        }, 200);
    });

    // ─── SCRIPT HOST / ADMIN SYSTEM (Vercel KV backed) ──────────────────────

    let sessionPassword = null; // held in memory only, never persisted

    function generateHash() {
        const chars = '0123456789abcdef';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }

    function getScriptUrl(hash) {
        return `${window.location.origin}/api/execute/${hash}.lua`;
    }

    function getLoadstring(hash) {
        return `loadstring(game:HttpGet("${window.location.origin}/api/execute/${hash}.lua", true))()`;
    }

    async function adminApi(payload) {
        const res = await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, password: sessionPassword }),
        });
        return res.json();
    }

    // ── Edit Modal ───────────────────────────────────────────────────────────

    function openEditModal(hash, label, content) {
        // Remove any existing modal
        document.getElementById('edit-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'edit-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);padding:1rem;
        `;
        modal.innerHTML = `
            <div style="background:#111;border:1px solid rgba(255,255,255,0.12);border-radius:16px;
                        padding:2rem;width:100%;max-width:680px;max-height:90vh;display:flex;flex-direction:column;gap:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="color:#e2e8f0;font-size:1.1rem;font-weight:700;margin:0;">Edit Script</h3>
                    <button id="edit-modal-close" style="background:none;border:none;color:rgba(255,255,255,0.4);
                        font-size:1.4rem;cursor:pointer;line-height:1;padding:0.25rem;">✕</button>
                </div>
                <div style="font-family:monospace;font-size:0.78rem;color:rgba(255,255,255,0.3);">${hash}.lua</div>
                <div>
                    <label style="display:block;font-size:0.82rem;color:rgba(255,255,255,0.5);margin-bottom:0.35rem;">Label</label>
                    <input id="edit-label" value="${(label || '').replace(/"/g, '&quot;')}"
                        style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                               border-radius:8px;padding:0.6rem 1rem;color:#fff;font-size:0.9rem;outline:none;box-sizing:border-box;">
                </div>
                <div style="flex:1;display:flex;flex-direction:column;">
                    <label style="display:block;font-size:0.82rem;color:rgba(255,255,255,0.5);margin-bottom:0.35rem;">Script Content</label>
                    <textarea id="edit-content"
                        style="flex:1;min-height:280px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);
                               border-radius:8px;padding:0.8rem 1rem;color:#a5f3fc;font-family:monospace;
                               font-size:0.83rem;line-height:1.5;resize:vertical;outline:none;box-sizing:border-box;">${escapeHtml(content)}</textarea>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
                    <button id="edit-modal-cancel" class="option-btn">Cancel</button>
                    <button id="edit-modal-save" class="option-btn" style="color:#10b981;">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('edit-modal-close').addEventListener('click', () => modal.remove());
        document.getElementById('edit-modal-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

        document.getElementById('edit-modal-save').addEventListener('click', async () => {
            const newLabel = document.getElementById('edit-label').value.trim();
            const newContent = document.getElementById('edit-content').value;
            if (!newContent.trim()) { showNotification('Content cannot be empty.', 'error'); return; }

            const saveBtn = document.getElementById('edit-modal-save');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';

            const data = await adminApi({ action: 'save', hash, label: newLabel, content: newContent });

            if (data.ok) {
                showNotification('Script updated!', 'success');
                modal.remove();
                renderHostedScriptsList();
            } else {
                showNotification('Save failed: ' + (data.error || 'unknown'), 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Changes';
            }
        });
    }

    function escapeHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Render the hosted scripts list (fetches from server)
    async function renderHostedScriptsList() {
        const list = document.getElementById('hosted-scripts-list');
        const noMsg = document.getElementById('no-scripts-msg');
        if (!list) return;

        list.querySelectorAll('.hosted-script-row').forEach(r => r.remove());
        if (noMsg) noMsg.textContent = 'Loading…';

        const data = await adminApi({ action: 'list' });

        if (!data.ok || !data.scripts || data.scripts.length === 0) {
            if (noMsg) { noMsg.textContent = 'No scripts uploaded yet.'; noMsg.style.display = ''; }
            return;
        }
        if (noMsg) noMsg.style.display = 'none';

        data.scripts.forEach(entry => {
            const hash = entry.hash;
            const row = document.createElement('div');
            row.className = 'hosted-script-row';
            row.innerHTML = `
                <div class="hosted-script-info">
                    <span class="hosted-script-label">${entry.label || 'Unnamed'}</span>
                    <span class="hosted-script-hash">${hash}.lua</span>
                </div>
                <div class="hosted-script-actions">
                    <button class="option-btn hs-copy-btn" data-hash="${hash}">Copy URL</button>
                    <button class="option-btn hs-copy-ls-btn" data-hash="${hash}">Copy Loadstring</button>
                    <button class="option-btn hs-edit-btn" data-hash="${hash}" data-label="${entry.label || ''}">Edit</button>
                    <button class="option-btn hs-delete-btn" data-hash="${hash}" style="color:#ef4444;">Delete</button>
                </div>
            `;
            list.appendChild(row);
        });

        list.querySelectorAll('.hs-copy-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await navigator.clipboard.writeText(getScriptUrl(btn.dataset.hash));
                showNotification('URL copied!', 'success');
            });
        });
        list.querySelectorAll('.hs-copy-ls-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await navigator.clipboard.writeText(getLoadstring(btn.dataset.hash));
                showNotification('Loadstring copied!', 'success');
            });
        });
        list.querySelectorAll('.hs-edit-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const hash = btn.dataset.hash;
                btn.disabled = true;
                btn.textContent = '…';

                const data = await adminApi({ action: 'get', hash });

                btn.disabled = false;
                btn.textContent = 'Edit';

                if (!data.ok) { showNotification('Could not load script.', 'error'); return; }
                openEditModal(hash, data.label, data.content);
            });
        });
        list.querySelectorAll('.hs-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this script? This cannot be undone.')) return;
                btn.disabled = true;
                btn.textContent = '…';
                const data = await adminApi({ action: 'delete', hash: btn.dataset.hash });
                if (data.ok) {
                    showNotification('Script deleted.', 'success');
                    renderHostedScriptsList();
                } else {
                    showNotification('Delete failed.', 'error');
                    btn.disabled = false;
                    btn.textContent = 'Delete';
                }
            });
        });
    }

    // Admin login gate
    const adminLoginBtn = document.getElementById('admin-login-btn');
    const adminPasswordInput = document.getElementById('admin-password-input');
    const adminGate = document.getElementById('admin-gate');
    const adminPanel = document.getElementById('admin-panel');
    const adminLoginError = document.getElementById('admin-login-error');

    async function unlockAdmin() {
        const pw = adminPasswordInput ? adminPasswordInput.value : '';
        if (!pw) return;
        if (adminLoginBtn) { adminLoginBtn.disabled = true; adminLoginBtn.textContent = '…'; }

        // Test the password by calling list — server will 401 if wrong
        sessionPassword = pw;
        const data = await adminApi({ action: 'list' });

        if (data.error === 'Unauthorized') {
            sessionPassword = null;
            if (adminLoginError) adminLoginError.style.display = 'block';
            if (adminPasswordInput) adminPasswordInput.value = '';
            if (adminLoginBtn) { adminLoginBtn.disabled = false; adminLoginBtn.textContent = 'Unlock'; }
            return;
        }

        if (adminGate) adminGate.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'block';
        if (adminLoginError) adminLoginError.style.display = 'none';
        if (adminLoginBtn) { adminLoginBtn.disabled = false; adminLoginBtn.textContent = 'Unlock'; }
        renderHostedScriptsList();
    }

    if (adminLoginBtn) {
        adminLoginBtn.addEventListener('click', unlockAdmin);
        adminPasswordInput?.addEventListener('keydown', e => {
            if (e.key === 'Enter') unlockAdmin();
        });
    }

    // Upload script
    const uploadBtn = document.getElementById('upload-script-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            const label = document.getElementById('upload-label')?.value.trim();
            const content = document.getElementById('upload-content')?.value || '';
            if (!content.trim()) { showNotification('Script content cannot be empty.', 'error'); return; }

            uploadBtn.disabled = true;
            const titleEl = uploadBtn.querySelector('.btn-title');
            if (titleEl) titleEl.textContent = 'Saving…';

            const hash = generateHash(24);
            const data = await adminApi({ action: 'save', hash, label, content });

            uploadBtn.disabled = false;
            if (titleEl) titleEl.textContent = 'Generate & Save';

            if (!data.ok) { showNotification('Save failed: ' + (data.error || 'unknown error'), 'error'); return; }

            const resultDiv = document.getElementById('upload-result');
            const resultUrl = document.getElementById('upload-result-url');
            const resultLs = document.getElementById('upload-result-loadstring');
            if (resultUrl) resultUrl.textContent = getScriptUrl(hash);
            if (resultLs) resultLs.textContent = getLoadstring(hash);
            if (resultDiv) resultDiv.style.display = 'block';

            if (document.getElementById('upload-label')) document.getElementById('upload-label').value = '';
            if (document.getElementById('upload-content')) document.getElementById('upload-content').value = '';
            renderHostedScriptsList();
            showNotification('Script hosted!', 'success');
        });
    }

    // Copy buttons inside upload result
    document.getElementById('upload-copy-btn')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(document.getElementById('upload-result-url')?.textContent || '');
        showNotification('URL copied!', 'success');
    });
    document.getElementById('upload-copy-ls-btn')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(document.getElementById('upload-result-loadstring')?.textContent || '');
        showNotification('Loadstring copied!', 'success');
    });

    // Handle #admin route in URL (no more #raw — that's a real server path now)
    function handleSpecialRoutes() {
        const hash = window.location.hash.replace('#', '');
        if (hash === 'admin') {
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById('admin-page')?.classList.add('active');
            navLinks.forEach(l => l.classList.remove('active'));
            return true;
        }
        return false;
    }

    // Intercept initial load and hash changes
    if (!handleSpecialRoutes()) {
        handleInitialPage();
    }

    window.addEventListener('hashchange', () => {
        if (!handleSpecialRoutes()) {
            const hash = window.location.hash.replace('#', '') || 'home';
            const targetLink = document.querySelector(`.nav-link[data-page="${hash}"]`);
            if (targetLink) targetLink.click();
        }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // OBFUSCATOR PAGE
    // ═══════════════════════════════════════════════════════════════════════

    if (document.getElementById('obfuscator-page')) {
        const inputTextarea = document.getElementById('obf-input');
        const outputTextarea = document.getElementById('obf-output');
        const obfuscateBtn = document.getElementById('obfuscate-btn');
        const swapBtn = document.getElementById('obf-swap-btn');
        const clearBtn = document.getElementById('obf-clear-btn');
        const copyBtn = document.getElementById('obf-copy-btn');
        
        const inputLines = document.getElementById('input-lines');
        const inputChars = document.getElementById('input-chars');
        const outputLines = document.getElementById('output-lines');
        const outputChars = document.getElementById('output-chars');
        const statusEl = document.getElementById('obf-status');

        function updateStats() {
            const inputText = inputTextarea.value;
            const outputText = outputTextarea.value;
            
            inputLines.textContent = `${inputText.split('\n').length} lines`;
            inputChars.textContent = `${inputText.length} chars`;
            outputLines.textContent = `${outputText.split('\n').length} lines`;
            outputChars.textContent = `${outputText.length} chars`;
        }

        inputTextarea?.addEventListener('input', updateStats);
        outputTextarea?.addEventListener('input', updateStats);

        obfuscateBtn?.addEventListener('click', async () => {
            const code = inputTextarea.value.trim();
            if (!code) {
                showNotification('Please enter some code first', 'error');
                return;
            }

            obfuscateBtn.disabled = true;
            const btnText = obfuscateBtn.querySelector('.obf-btn-text');
            if (btnText) btnText.textContent = 'Obfuscating...';
            statusEl.textContent = '';
            statusEl.className = 'obf-status';

            try {
                const res = await fetch('/api/obfuscate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        password: sessionPassword || prompt('Enter admin password:'),
                        code 
                    }),
                });

                const data = await res.json();

                if (data.ok) {
                    outputTextarea.value = data.obfuscated;
                    updateStats();
                    statusEl.textContent = '✓ Success';
                    statusEl.className = 'obf-status success';
                    showNotification('Code obfuscated successfully!', 'success');
                } else {
                    throw new Error(data.error || 'Obfuscation failed');
                }
            } catch (err) {
                statusEl.textContent = '✗ Failed';
                statusEl.className = 'obf-status error';
                showNotification(err.message, 'error');
            } finally {
                obfuscateBtn.disabled = false;
                if (btnText) btnText.textContent = 'Obfuscate';
            }
        });

        swapBtn?.addEventListener('click', () => {
            const temp = inputTextarea.value;
            inputTextarea.value = outputTextarea.value;
            outputTextarea.value = temp;
            updateStats();
            showNotification('Input/Output swapped', 'success');
        });

        clearBtn?.addEventListener('click', () => {
            if (confirm('Clear all text?')) {
                inputTextarea.value = '';
                outputTextarea.value = '';
                updateStats();
                statusEl.textContent = '';
                showNotification('Cleared', 'success');
            }
        });

        copyBtn?.addEventListener('click', async () => {
            if (!outputTextarea.value) {
                showNotification('Nothing to copy', 'error');
                return;
            }
            await navigator.clipboard.writeText(outputTextarea.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
            showNotification('Copied to clipboard!', 'success');
        });

        updateStats();
    }
});

