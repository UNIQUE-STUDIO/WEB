// ==================== NOTIFICATION MODULE ====================
// Handles: Telegram Bot, Browser Notifications, Sound Alerts, Badge Counter

(function () {
    'use strict';

    const STORAGE_KEY = 'notifier_config';
    const LEADS_COUNT_KEY = 'notifier_new_leads_count';

    function getConfig() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveConfig(cfg) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }

    function getNewLeadsCount() {
        return parseInt(localStorage.getItem(LEADS_COUNT_KEY) || '0', 10);
    }

    function setNewLeadsCount(n) {
        localStorage.setItem(LEADS_COUNT_KEY, String(Math.max(0, n)));
    }

    function incrementLeadsCount() {
        setNewLeadsCount(getNewLeadsCount() + 1);
        updateBadge();
    }

    function resetLeadsCount() {
        setNewLeadsCount(0);
        updateBadge();
    }

    let audioCtx = null;
    function playBeep() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.3);
        } catch (e) {
            // Audio not supported
        }
    }

    function showDesktopNotification(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        try {
            new Notification(title, { body, icon: '/favicon.ico', tag: 'new-lead' });
        } catch (e) {
            // Notification failed
        }
    }

    function updateBadge() {
        const btn = document.getElementById('adminToggleBtn');
        if (!btn) return;
        const count = getNewLeadsCount();
        let badge = btn.querySelector('.notif-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'notif-badge';
                badge.style.cssText =
                    'position:absolute;top:-6px;right:-6px;background:#e74c3c;color:#fff;font-size:0.65rem;font-weight:700;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1;pointer-events:none;';
                btn.style.position = 'relative';
                btn.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
        } else if (badge) {
            badge.style.display = 'none';
        }
    }

    async function sendToTelegram(botToken, chatId, text) {
        if (!botToken || !chatId) return { success: false, message: 'Telegram not configured' };
        try {
            const url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });
            const data = await resp.json();
            return {
                success: data.ok,
                message: data.ok ? 'Sent to Telegram' : data.description || 'Telegram error',
            };
        } catch (e) {
            return { success: false, message: 'Telegram fetch failed: ' + e.message };
        }
    }

    function formatLeadForTelegram(leadData, action) {
        const dt = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        const actionLabels = {
            demoRequest: '\u{1F4E6} Demo Request',
            consultRequest: '\u{1F4AC} Consultation',
            editRequest: '\u{270F}\u{FE0F} Edit Request',
            serviceOrder: '\u{1F4CB} Service Order',
            orderService: '\u{1F4CB} Service Order',
            submitPayment: '\u{1F4B0} Payment',
            newsletter: '\u{1F4E7} Newsletter',
        };
        const label = actionLabels[action] || action || 'New Lead';

        let msg = '<b>' + label + '</b>\n';
        msg += '\u{1F4C5} ' + dt + '\n';
        msg += '\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\n';

        if (leadData.name || leadData.business_name) {
            msg +=
                '\u{1F464} <b>Name:</b> ' +
                (leadData.name || leadData.business_name || 'N/A') +
                '\n';
        }
        if (leadData.email) msg += '\u{1F4E7} <b>Email:</b> ' + leadData.email + '\n';
        if (leadData.phone) msg += '\u{1F4DE} <b>Phone:</b> ' + leadData.phone + '\n';
        if (leadData.city) msg += '\u{1F3D9} <b>City:</b> ' + leadData.city + '\n';
        if (leadData.category) msg += '\u{1F4C2} <b>Type:</b> ' + leadData.category + '\n';
        if (leadData.service) msg += '\u{1F527} <b>Service:</b> ' + leadData.service + '\n';
        if (leadData.template_id || leadData['Template Used']) {
            msg +=
                '\u{1F3A8} <b>Template:</b> ' +
                (leadData.template_id || leadData['Template Used']) +
                '\n';
        }
        if (leadData.amount || leadData.spent) {
            msg += '\u{1F4B5} <b>Amount:</b> ' + (leadData.amount || leadData.spent) + ' RUB\n';
        }
        if (leadData.edit_type) msg += '\u{1F6E0} <b>Edit type:</b> ' + leadData.edit_type + '\n';
        if (leadData.description || leadData.message) {
            const desc = (leadData.description || leadData.message || '').substring(0, 200);
            if (desc) msg += '\u{1F4DD} <b>Details:</b> ' + desc + '\n';
        }
        if (leadData.vk_url) msg += '\u{1F517} <b>VK:</b> ' + leadData.vk_url + '\n';
        if (leadData.existing_site)
            msg += '\u{1F310} <b>Site:</b> ' + leadData.existing_site + '\n';

        msg += '\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\n';
        msg += '\u{1F4BB} Unique Web Studio';
        return msg;
    }

    function notify(leadData, action) {
        const cfg = getConfig();

        if (cfg.sound !== false) {
            playBeep();
        }

        if (cfg.desktop !== false) {
            const name = leadData.name || leadData.business_name || action || 'New Lead';
            showDesktopNotification('New Lead: ' + name, 'Click to view details');
        }

        incrementLeadsCount();

        if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
            const text = formatLeadForTelegram(leadData, action);
            sendToTelegram(cfg.telegram_bot_token, cfg.telegram_chat_id, text).then(function (r) {
                if (!r.success) console.warn('[Notifier] Telegram:', r.message);
            });
        }

        try {
            const logs = JSON.parse(localStorage.getItem('admin_logs') || '[]');
            logs.unshift({
                time: new Date().toISOString(),
                type: 'lead',
                action: action,
                lead: leadData.name || leadData.business_name || leadData.email || 'Unknown',
                notifications_sent: [
                    cfg.sound !== false ? 'sound' : null,
                    cfg.desktop !== false ? 'desktop' : null,
                    cfg.telegram_bot_token ? 'telegram' : null,
                ].filter(Boolean),
            });
            if (logs.length > 200) logs.length = 200;
            localStorage.setItem('admin_logs', JSON.stringify(logs));
        } catch (e) {
            // ignore
        }
    }

    function getConfigUI() {
        const cfg = getConfig();
        let html = '<h3>Notification Channels</h3>';
        html +=
            '<div style="background:var(--bg-card);padding:20px;border-radius:12px;max-width:550px;">';

        // Telegram section
        html += '<h4 style="margin-top:0;">Telegram Bot</h4>';
        html +=
            '<p style="font-size:0.85rem;margin-bottom:12px;">Get instant Telegram messages for every new lead.</p>';
        html += '<div class="form-group"><label class="field-label">Bot Token</label>';
        html +=
            '<input type="text" id="notifTgToken" value="' +
            (cfg.telegram_bot_token || '') +
            '" placeholder="123456:ABC-DEF1234ghikl" style="font-family:monospace;font-size:0.85rem;">';
        html +=
            '<div class="field-description">Get from <a href="https://t.me/BotFather" target="_blank">@BotFather</a></div></div>';
        html += '<div class="form-group"><label class="field-label">Chat ID</label>';
        html +=
            '<input type="text" id="notifTgChatId" value="' +
            (cfg.telegram_chat_id || '') +
            '" placeholder="-1001234567890 or @channelname">';
        html +=
            '<div class="field-description">Add bot to chat, send a message, then get ID from <a href="https://api.telegram.org/bot<TOKEN>/getUpdates" target="_blank">getUpdates</a></div></div>';
        if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
            html += '<p style="color:green;font-size:0.85rem;">Telegram configured</p>';
        } else {
            html += '<p style="color:#e67e22;font-size:0.85rem;">Telegram not configured yet</p>';
        }
        html +=
            '<button class="btn" id="notifTestTgBtn" style="margin-top:8px;font-size:0.85rem;">Send Test Message</button>';
        html += '<span id="notifTgResult" style="margin-left:10px;font-size:0.85rem;"></span>';

        html += '<hr style="border-color:var(--border-light);margin:20px 0;">';

        html += '<h4>In-Browser Alerts</h4>';
        html += '<label style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
        html +=
            '<input type="checkbox" id="notifSoundCfg" ' +
            (cfg.sound !== false ? 'checked' : '') +
            '> Play sound on new lead</label>';
        html += '<label style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
        html +=
            '<input type="checkbox" id="notifDesktopCfg" ' +
            (cfg.desktop !== false ? 'checked' : '') +
            '> Desktop notification';
        if (!('Notification' in window)) {
            html += ' <span style="color:red;font-size:0.8rem;">(not supported)</span>';
        } else if (Notification.permission === 'denied') {
            html += ' <span style="color:red;font-size:0.8rem;">(blocked)</span>';
        }
        html += '</label>';

        html +=
            '<button class="btn" id="notifSaveBtn" style="margin-top:12px;">Save Settings</button>';
        html +=
            '<button class="btn" id="notifTestBtn" style="margin-left:10px;margin-top:12px;">Test Alert</button>';
        html += '<span id="notifSaveResult" style="margin-left:10px;font-size:0.85rem;"></span>';

        html += '</div>';
        return html;
    }

    function bindConfigUI() {
        var saveBtn = document.getElementById('notifSaveBtn');
        var testBtn = document.getElementById('notifTestBtn');
        var testTgBtn = document.getElementById('notifTestTgBtn');
        var resultEl = document.getElementById('notifSaveResult');
        var tgResultEl = document.getElementById('notifTgResult');

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var cfg = getConfig();
                var tokenEl = document.getElementById('notifTgToken');
                var chatEl = document.getElementById('notifTgChatId');
                var soundEl = document.getElementById('notifSoundCfg');
                var desktopEl = document.getElementById('notifDesktopCfg');
                if (tokenEl) cfg.telegram_bot_token = tokenEl.value.trim();
                if (chatEl) cfg.telegram_chat_id = chatEl.value.trim();
                cfg.sound = soundEl ? soundEl.checked : true;
                cfg.desktop = desktopEl ? desktopEl.checked : true;
                saveConfig(cfg);
                if (resultEl) {
                    resultEl.innerHTML = '<span style="color:green;">Saved!</span>';
                    setTimeout(function () {
                        resultEl.innerHTML = '';
                    }, 2000);
                }
            });
        }

        if (testBtn) {
            testBtn.addEventListener('click', function () {
                playBeep();
                showDesktopNotification(
                    'Test Notification',
                    'Unique Web Studio notification system is working!',
                );
                incrementLeadsCount();
                if (resultEl) {
                    resultEl.innerHTML = '<span style="color:green;">Test sent!</span>';
                    setTimeout(function () {
                        resultEl.innerHTML = '';
                    }, 2000);
                }
            });
        }

        if (testTgBtn) {
            testTgBtn.addEventListener('click', function () {
                var token = (document.getElementById('notifTgToken') || {}).value || '';
                var chatId = (document.getElementById('notifTgChatId') || {}).value || '';
                if (!token || !chatId) {
                    if (tgResultEl)
                        tgResultEl.innerHTML =
                            '<span style="color:red;">Enter token and chat ID first</span>';
                    return;
                }
                if (tgResultEl)
                    tgResultEl.innerHTML = '<span style="color:#e67e22;">Sending...</span>';
                sendToTelegram(
                    token,
                    chatId,
                    '<b>Test Message</b>\n\nUnique Web Studio notification system configured successfully!',
                ).then(function (r) {
                    if (tgResultEl) {
                        tgResultEl.innerHTML = r.success
                            ? '<span style="color:green;">Sent! Check Telegram.</span>'
                            : '<span style="color:red;">Failed: ' +
                              (r.message || 'unknown') +
                              '</span>';
                    }
                });
            });
        }
    }

    function activate() {
        updateBadge();
        try {
            var saved = getConfig();
            if (saved.sound === undefined) {
                saved.sound = true;
                saveConfig(saved);
            }
            if (saved.desktop === undefined) {
                saved.desktop = true;
                saveConfig(saved);
            }
        } catch (e) {
            /* ignore */
        }
    }

    window.Notifier = {
        notify: notify,
        playBeep: playBeep,
        showDesktopNotification: showDesktopNotification,
        updateBadge: updateBadge,
        getNewLeadsCount: getNewLeadsCount,
        resetLeadsCount: resetLeadsCount,
        getConfig: getConfig,
        saveConfig: saveConfig,
        getConfigUI: getConfigUI,
        bindConfigUI: bindConfigUI,
        sendToTelegram: sendToTelegram,
        activate: activate,
    };
})();
