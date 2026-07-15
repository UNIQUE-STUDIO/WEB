/**
 * GitHub Cloud Storage Module
 * Monkey-patches localStorage.setItem to sync data to a GitHub repo.
 * Reads are from localStorage (populated by async GitHub pull on load).
 */
(function () {
    'use strict';

    var CONFIG_KEY = 'gh_storage_cfg';
    var SYNC_KEYS = [
        'localLeads',
        'reviews',
        'admin_followups',
        'admin_tickets',
        'newsletter_subscribers',
        'templatesData',
        'customImages',
        'admin_seo',
        'admin_settings',
        'admin_theme',
        'apps_script_url_override',
        'admin_logs',
        'lang',
        'custom_translations_ru',
        'custom_translations_en',
        'notifier_config',
        'admin_last_backup',
    ];

    var originalSetItem = Storage.prototype.setItem;
    var originalGetItem = Storage.prototype.getItem;
    var originalRemoveItem = Storage.prototype.removeItem;

    var pendingWrites = {};
    var flushTimer = null;

    function getConfig() {
        try {
            return JSON.parse(originalGetItem.call(localStorage, CONFIG_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function setConfig(c) {
        originalSetItem.call(localStorage, CONFIG_KEY, JSON.stringify(c));
    }

    function isConfigured() {
        var c = getConfig();
        return !!(c.owner && c.repo && c.token);
    }

    function isReadConfigured() {
        var c = getConfig();
        return !!(c.owner && c.repo);
    }

    function apiUrl(key) {
        var c = getConfig();
        return (
            'https://api.github.com/repos/' +
            c.owner +
            '/' +
            c.repo +
            '/contents/data/' +
            key +
            '.json'
        );
    }

    function authHeaders() {
        var c = getConfig();
        var h = { Accept: 'application/vnd.github.v3+json' };
        if (c.token) h['Authorization'] = 'token ' + c.token;
        return h;
    }

    function encode64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function decode64(str) {
        return decodeURIComponent(escape(atob(str)));
    }

    function pull(key) {
        if (!isReadConfigured()) return Promise.resolve(null);
        return fetch(apiUrl(key), { headers: authHeaders(), cache: 'no-cache' })
            .then(function (r) {
                if (!r.ok) return null;
                return r.json();
            })
            .then(function (data) {
                if (data && data.content) {
                    var cleaned = data.content.replace(/[\s\n\r]/g, '');
                    var val = decode64(cleaned);
                    var parsed = JSON.parse(val);
                    originalSetItem.call(localStorage, key, JSON.stringify(parsed));
                    return parsed;
                }
                return null;
            })
            .catch(function () {
                return null;
            });
    }

    function pullAll() {
        var promises = SYNC_KEYS.map(function (key) {
            return pull(key);
        });
        return Promise.all(promises);
    }

    function pushOne(key, value) {
        if (!isConfigured()) return Promise.resolve(false);
        var json = JSON.stringify(value, null, 2);
        var body = {
            message: 'Update ' + key,
            content: encode64(json),
        };
        var c = getConfig();
        if (c.branch) body.branch = c.branch;

        return fetch(apiUrl(key), { headers: authHeaders() })
            .then(function (r) {
                return r.ok ? r.json() : {};
            })
            .then(function (data) {
                if (data.sha) body.sha = data.sha;
                return fetch(apiUrl(key), {
                    method: 'PUT',
                    headers: Object.assign(authHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body),
                });
            })
            .then(function (r) {
                return r.ok;
            })
            .catch(function () {
                return false;
            });
    }

    function flushPending() {
        flushTimer = null;
        var keys = Object.keys(pendingWrites);
        if (!keys.length) return;
        var snapshot = {};
        keys.forEach(function (k) {
            snapshot[k] = pendingWrites[k];
        });
        pendingWrites = {};
        keys.forEach(function (k) {
            pushOne(k, snapshot[k]).then(function (ok) {
                if (ok) console.log('[GH] Synced:', k);
                else console.warn('[GH] Failed to sync:', k);
            });
        });
    }

    // Monkey-patch: intercept all syncable localStorage.setItem calls
    localStorage.setItem = function (key, value) {
        originalSetItem.call(localStorage, key, value);
        if (SYNC_KEYS.indexOf(key) !== -1 && isConfigured()) {
            try {
                pendingWrites[key] = JSON.parse(value);
            } catch (e) {
                pendingWrites[key] = value;
            }
            if (!flushTimer) flushTimer = setTimeout(flushPending, 2000);
        }
    };

    // Also intercept removeItem for syncable keys
    localStorage.removeItem = function (key) {
        originalRemoveItem.call(localStorage, key);
        if (SYNC_KEYS.indexOf(key) !== -1 && isConfigured()) {
            try {
                pendingWrites[key] = null;
            } catch (e) {}
            if (!flushTimer) flushTimer = setTimeout(flushPending, 2000);
        }
    };

    window.GitHubCloud = {
        SYNC_KEYS: SYNC_KEYS,
        pullAll: pullAll,
        pull: pull,
        push: pushOne,
        flush: flushPending,
        getConfig: getConfig,
        setConfig: setConfig,
        isConfigured: isConfigured,
        isReadConfigured: isReadConfigured,
        CONFIG_KEY: CONFIG_KEY,
    };

    // Auto-pull from GitHub on page load
    if (isReadConfigured()) {
        console.log('[GitHubCloud] Pulling data from cloud...');
        pullAll()
            .then(function () {
                console.log('[GitHubCloud] Cloud sync complete');
                window.dispatchEvent(new CustomEvent('github-cloud-synced'));
            })
            .catch(function (err) {
                console.warn('[GitHubCloud] Cloud pull failed:', err);
            });
    }
})();
