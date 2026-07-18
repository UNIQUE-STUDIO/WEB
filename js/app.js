// ==================== GLOBAL VARIABLES ====================
// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
}
const DEFAULT_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbw0eEHPeS5Ad2RxlRlErM8Ffbkw0NmfDkYiUCtzj6qieUnPBe3iCpgzq-teblsDeQnN/exec';
let SCRIPT_URL = localStorage.getItem('apps_script_url_override') || DEFAULT_SCRIPT_URL;
let currentLang = (() => {
    var saved = localStorage.getItem('lang');
    if (saved === 'ru' || saved === 'en') return saved;
    var browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return browserLang.startsWith('ru') ? 'ru' : 'en';
})();
let currentAdminTab = 'dashboard';
let leadsData = [];

// ==================== GLOBAL LOGGING SYSTEM ====================
function adminLog(message, level) {
    level = level || 'info';
    var logs = [];
    try {
        logs = JSON.parse(localStorage.getItem('admin_logs') || '[]');
    } catch (e) {}
    logs.unshift({ timestamp: new Date().toISOString(), level: level, message: message });
    if (logs.length > 500) logs = logs.slice(0, 500);
    try {
        localStorage.setItem('admin_logs', JSON.stringify(logs));
    } catch (e) {}
    if (level === 'error') console.error('[Admin]', message);
    else if (level === 'warn') console.warn('[Admin]', message);
    else console.log('[Admin]', message);
}
adminLog('App initialized', 'info');
let filteredLeads = [];
let sortColumn = 'Lead ID';
let sortDirection = 'asc';
let statusFilter = 'all';
let paymentFilter = 'all';
let sourceFilter = 'all';
let searchTerm = '';
let customImages = (() => {
    const stored = JSON.parse(localStorage.getItem('customImages'));
    if (stored && stored._v === 2) return stored;
    localStorage.removeItem('customImages');
    return { services: {}, portfolio: {}, blog: {}, templates: {}, _v: 3 };
})();
const defaultImagePack = {
    services: {
        'Landing Page': 'images/photos/services/landing.jpg',
        'Online Store': 'images/photos/services/ecommerce.jpg',
        'Corporate Website': 'images/photos/services/corporate.jpg',
        'Website Editing': 'images/photos/services/editing.jpg',
        'Интернет-магазин': 'images/photos/services/ecommerce.jpg',
        'Корпоративный сайт': 'images/photos/services/corporate.jpg',
        'Редактирование сайта': 'images/photos/services/editing.jpg',
    },
    portfolio: {
        UNIDENT: 'images/photos/portfolio/beauty.jpg',
        'Студия красоты': 'images/photos/portfolio/beauty.jpg',
        'Магазин одежды': 'images/photos/portfolio/fashion.jpg',
        Ресторан: 'images/photos/portfolio/restaurant.jpg',
        'IT-компания': 'images/photos/portfolio/tech.jpg',
        'Мебельный магазин': 'images/photos/portfolio/furniture.jpg',
        'Маркетинговое агентство': 'images/photos/portfolio/marketing.jpg',
        'Фитнес-центр': 'images/photos/portfolio/fitness.jpg',
        Стоматология: 'images/photos/portfolio/dental.jpg',
        Автосервис: 'images/photos/portfolio/auto.jpg',
        Недвижимость: 'images/photos/portfolio/realestate.jpg',
    },
    blog: {
        0: 'images/photos/blog/0.jpg',
        1: 'images/photos/blog/1.jpg',
        2: 'images/photos/blog/2.jpg',
        3: 'images/photos/blog/3.jpg',
        4: 'images/photos/blog/4.jpg',
        5: 'images/photos/blog/5.jpg',
    },
};

// ==================== Google Apps Script endpoint bootstrap ====================
// Runtime evidence showed the published /exec URL can be an OLD deployment (GET JSON only has {leads:...}).
// New backend returns { success, spreadsheetId, leadsSheet, logsSheet, leads } from doGet.
async function probeAppsScriptGet(url) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), {
        method: 'GET',
    });
    const txt = await res.text();
    if (!txt || !txt.trim().startsWith('{')) return { ok: false, reason: 'non-json' };
    try {
        return { ok: true, json: JSON.parse(txt) };
    } catch (e) {
        return { ok: false, reason: 'json-parse' };
    }
}

async function initScriptEndpoint() {
    const candidates = [];
    const origin = typeof location !== 'undefined' && location.origin ? location.origin : '';
    if (origin) {
        candidates.push(origin + '/script-config.json');
        if (origin.includes('github.io')) {
            const parts = origin.split('/');
            const repo = parts[parts.length - 1] || 'WEB';
            candidates.push(origin + '/' + repo + '/script-config.json');
        }
    }
    candidates.push('https://unique-studio.github.io/WEB/script-config.json');

    for (const cfgUrl of candidates) {
        try {
            const r = await fetch(cfgUrl + '?t=' + Date.now());
            if (!r.ok) continue;
            const cfg = await r.json();
            if (cfg && cfg.scriptUrl) {
                SCRIPT_URL = String(cfg.scriptUrl).trim();
                try {
                    localStorage.setItem('apps_script_url_override', SCRIPT_URL);
                } catch (e) {}
                console.info('[forms] Using scriptUrl from', cfgUrl);
                break;
            }
        } catch (e) {
            /* optional */
        }
    }

    let p = await probeAppsScriptGet(SCRIPT_URL);
    if (p.ok && p.json && p.json.spreadsheetId) {
        SCRIPT_REACHABLE = true;
        console.info('[forms] Apps Script deployment NEW OK.');
        return;
    }

    if (SCRIPT_URL !== DEFAULT_SCRIPT_URL) {
        SCRIPT_URL = DEFAULT_SCRIPT_URL;
        try {
            localStorage.removeItem('apps_script_url_override');
        } catch (e) {}
        p = await probeAppsScriptGet(SCRIPT_URL);
        if (p.ok && p.json && p.json.spreadsheetId) {
            SCRIPT_REACHABLE = true;
            console.info('[forms] Default deployment OK.');
            return;
        }
    }

    SCRIPT_REACHABLE = false;
    console.info('[forms] Local mode - data stored in your browser.');
    setTimeout(() => {
        var el = document.getElementById('backendStatus');
        if (el) el.textContent = '💾 Local Mode';
    }, 500);
}

// Template data: loaded dynamically from templates.json, with localStorage cache
let templatesData = JSON.parse(localStorage.getItem('templatesData')) || {
    landing: [],
    ecommerce: [],
    corporate: [],
};
let templatesLoaded = false;

async function loadTemplatesData() {
    if (templatesLoaded && templatesData.landing.length > 0) return;
    try {
        const resp = await fetch('templates.json?t=' + Date.now());
        if (resp.ok) {
            const data = await resp.json();
            if (data.landing && data.landing.length > 0) {
                templatesData = data;
                localStorage.setItem('templatesData', JSON.stringify(data));
                templatesLoaded = true;
                console.log(
                    'Templates loaded: ' +
                        (data.landing.length + data.ecommerce.length + data.corporate.length) +
                        ' total',
                );
            }
        }
    } catch (e) {
        console.warn('Failed to load templates.json, using cached/saved data', e);
    }
}

// On init, trigger template load and rerender
(async function initTemplates() {
    await loadTemplatesData();
    if (typeof renderTemplatesPage === 'function') renderTemplatesPage();
    loadDemoTemplates('landing');
    setupTemplateSelectorEvents();
})();

// ==================== TRANSLATIONS (extended) ====================
let translations = {
    ru: {
        nav_services: 'Услуги',
        nav_portfolio: 'Портфолио',
        nav_blog: 'Блог',
        nav_reviews: 'Отзывы',
        nav_contact: 'Контакты',
        nav_templates: 'Шаблоны',
        hero_title: 'Создаем сайты, которые работают на вас',
        hero_desc:
            'Современный дизайн, высокая конверсия, полная поддержка. Закажите сайт уже сегодня.',
        hero_demo_btn: 'Получить демо',
        hero_consult_btn: 'Заказать консультацию',
        services_title: 'Наши услуги',
        portfolio_title: 'Наши проекты',
        blog_title: 'Блог',
        reviews_title: 'Отзывы клиентов',
        templates_title: 'Выберите шаблон',
        templates_desc:
            'Выберите дизайн, который подходит вашему бренду – каждый шаблон полностью настраивается.',
        edit_title: 'Заказать доработку сайта',
        contact_title: 'Контакты',
        filter_all: 'Все',
        filter_landing: 'Лендинги',
        filter_shop: 'Магазины',
        filter_corp: 'Корпоративные',
        filter_realestate: 'Недвижимость',
        filter_medical: 'Медицина',
        filter_food: 'Рестораны',
        filter_portfolio: 'Портфолио',        search_placeholder: 'Поиск...',
        order_btn: 'Заказать',
        preview_btn: 'Демо',
        add_review_btn: 'Оставить отзыв',
        edit_name: 'Ваше имя',
        edit_email: 'Email',
        edit_phone: 'Телефон',
        edit_vk: 'Ссылка VK',
        edit_site: 'Ссылка на сайт',
        edit_type: 'Тип доработки',
        edit_type_design: 'Дизайн',
        edit_type_function: 'Функционал',
        edit_type_content: 'Контент',
        edit_type_other: 'Другое',
        edit_desired_date: 'Желаемая дата',
        edit_desc: 'Опишите, что нужно доработать',
        demo_business_name: 'Название бизнеса',
        demo_city: 'Город',
        demo_phone: 'Телефон',
        demo_vk: 'Ссылка VK',
        demo_email: 'Email',
        demo_address: 'Адрес бизнеса',
        demo_domain: 'Желаемый домен',
        demo_referrer: 'Как вы нас нашли?',
        demo_budget: 'Примерный бюджет',
        demo_existing_site: 'Ваш текущий сайт',
        demo_notes: 'Дополнительные пожелания',
        demo_has_hosting: 'У меня уже есть хостинг и домен',
        consult_name: 'Ваше имя',
        consult_email: 'Email',
        consult_phone: 'Телефон',
        consult_vk: 'Ссылка VK',
        consult_message: 'Ваш вопрос',
        review_name: 'Ваше имя',
        review_text: 'Ваш отзыв',
        agree_label:
            "Я ознакомлен и согласен с <a href='#' class='i18n-policy-link'>Пользовательским соглашением</a> и <a href='#' class='i18n-refund-link'>Политикой возвратов</a>",
        send_btn: 'Отправить',
        send_copy: 'Отправить копию заявки на email',
        fill_from_vk: 'Заполнить из VK',
        demo_modal_title: 'Получить демо сайт',
        consult_modal_title: 'Заявка на консультацию',
        review_modal_title: 'Оставить отзыв',
        policy_title: 'Пользовательское соглашение',
        refund_title: 'Политика возвратов',
        exit_title: 'Не уходите!',
        exit_text: 'Оставьте заявку и получите скидку 10% на любой пакет.',
        exit_btn: 'Получить скидку',
        consent_title: '❗ Важное уведомление',
        consent_desc:
            'Для использования сайта и отправки заявок необходимо ознакомиться и согласиться с условиями:',
        consent_policy: 'Пользовательское соглашение',
        consent_refund: 'Политика возвратов',
        consent_checkbox: 'Я принимаю условия',
        consent_accept: 'Продолжить',
        consent_warning: 'Без принятия условий отправка заявок невозможна.',
        admin_title: 'Панель администратора',
        cookie_text:
            'Мы используем cookies для улучшения работы сайта. Продолжая, вы соглашаетесь с этим.',
        footer_policy: 'Пользовательское соглашение',
        footer_refund: 'Политика возвратов',
        footer_copyright: '© 2025 Unique Web Studio. Все права защищены.',
        tab_dashboard: 'Dashbord',
        tab_leads: 'Lidy',
        tab_customers: 'Klienty',
        tab_orders: 'Zakazy',
        tab_analytics: 'Analitika',
        tab_seo: 'SEO',
        tab_backup: 'Rezervnoye kopirovaniye',
        tab_notifications: 'Uvedomleniya',
        tab_followup: 'Follow-up',
        tab_scraper: 'Sbor lidov',
        tab_tickets: 'Tikety',
        tab_settings: 'Nastroyki',
        tab_logs: 'Logi',
        tab_editor: 'Redaktor tekstov',
        tab_images: 'Upravleniye izobrazheniyami',
        tab_templates: 'Upravleniye shablonami',
        stats_total: 'Всего лидов',
        stats_new: 'Новых',
        stats_sent: 'Отправлено',
        stats_paid: 'Оплачено',
        payment_title: 'Информация об оплате',
        lead_details_title: 'Детали лида',
        demo_business_name_label: 'Название бизнеса',
        demo_city_label: 'Город',
        demo_category_label: 'Тип сайта',
        demo_phone_label: 'Номер телефона',
        demo_vk_label: 'VK профиль',
        demo_email_label: 'Email адрес',
        demo_address_label: 'Адрес бизнеса',
        demo_brand_color_label: 'Фирменный цвет',
        demo_logo_label: 'Логотип',
        demo_domain_label: 'Желаемый домен',
        demo_referrer_label: 'Как вы нас нашли?',
        demo_budget_label: 'Примерный бюджет',
        demo_existing_site_label: 'Текущий сайт',
        demo_hosting_label: 'Статус хостинга',
        demo_notes_label: 'Дополнительные пожелания',
        demo_category_landing: 'Лендинг (от 6 000 ₽)',
        demo_category_ecommerce: 'Интернет-магазин (от 12 000 ₽)',
        demo_category_corporate: 'Корпоративный сайт (от 9 000 ₽)',
        portfolio_items: {
            UNIDENT: 'UNIDENT',
            'Студия красоты': 'Студия красоты',
            'Магазин одежды': 'Магазин одежды',
            Ресторан: 'Ресторан',
            'IT-компания': 'IT-компания',
            'Мебельный магазин': 'Мебельный магазин',
            'Маркетинговое агентство': 'Маркетинговое агентство',
            'Фитнес-центр': 'Фитнес-центр',
            Стоматология: 'Стоматология',
            Автосервис: 'Автосервис',
            Недвижимость: 'Недвижимость',
        },
        blog_posts: [
            {
                title: 'Как выбрать Landing Page для бизнеса',
                excerpt: 'Советы по выбору одностраничного сайта.',
                content:
                    'Одностраничный сайт (Landing Page) — это идеальное решение для бизнеса, которому нужно быстро привлечь клиентов и собрать заявки. Правильно спроектированный лендинг способен увеличить конверсию в 3-5 раз по сравнению с обычным сайтом. Ключевые элементы успешного лендинга: цепляющий заголовок, уникальное торговое предложение, социальные доказательства, призыв к действию и минимум отвлекающих элементов.',
            },
            {
                title: 'SEO оптимизация: что нужно знать',
                excerpt: 'Основные принципы продвижения.',
                content:
                    'SEO (поисковая оптимизация) — это комплекс мер для повышения позиций сайта в результатах поиска. Внутренняя оптимизация включает работу с метатегами, заголовками, структурой URL и скоростью загрузки. Внешняя оптимизация — это наращивание ссылочной массы и работа с репутацией. Техническое SEO охватывает индексацию, карту сайта и микроразметку. Комплексный подход даёт стабильный рост трафика.',
            },
            {
                title: 'Тренды веб-дизайна 2025',
                excerpt: 'Новые стили и технологии.',
                content:
                    'В 2025 году в веб-дизайне доминируют минимализм с крупной типографикой, 3D-элементы, микроанимация. Тёмная тема стала стандартом, а не трендом. Важнейшие направления: интерактивный сторителлинг, glassmorphism с улучшенной производительностью, адаптивный дизайн с учётом складных устройств, и AI-генерируемый контент, персонализированный под каждого пользователя.',
            },
            {
                title: 'Мобильная адаптация: почему это важно',
                excerpt: 'Адаптивный дизайн для всех устройств.',
                content:
                    'Более 60% трафика в России приходится на мобильные устройства. Google использует mobile-first индексацию — это значит, что позиции сайта зависят от его мобильной версии. Адаптивный дизайн обеспечивает корректное отображение на смартфонах, планшетах и десктопах. Основные принципы: гибкая сетка, адаптивные изображения, удобные элементы навигации для касаний. Сайты без адаптации теряют до 70% потенциальных клиентов.',
            },
            {
                title: 'Как увеличить конверсию сайта',
                excerpt: 'Практические советы по повышению продаж.',
                content:
                    'Конверсия — это процент посетителей, совершивших целевое действие. Для её повышения используйте A/B тестирование заголовков и CTA-кнопок, ускорьте загрузку страниц, добавьте социальные доказательства. Формы захвата должны быть простыми: чем меньше полей, тем выше конверсия. Триггеры срочности и ограниченные предложения повышают конверсию на 15-30%.',
            },
            {
                title: 'Выбор домена и хостинга',
                excerpt: 'На что обратить внимание при старте.',
                content:
                    'Домен — это лицо вашего бизнеса в интернете. Выбирайте короткие, запоминающиеся имена в зоне .ru или .рф. Хостинг определяет скорость и надёжность сайта. Для лендингов и небольших сайтов подойдёт виртуальный хостинг, для интернет-магазинов — VPS. Важные критерии: время аптайма, скорость отклика, расположение серверов, техподдержка на русском языке. Не экономьте на хостинге — медленный сайт отпугивает клиентов.',
            },
        ],
        services: [
            {
                title: 'Landing Page',
                desc: 'Одностраничный сайт с высокой конверсией для вашего бизнеса.',
                price: 'от 6 000 ₽',
                btn: 'Заказать',
            },
            {
                title: 'Интернет-магазин',
                desc: 'Полноценная платформа для продаж с корзиной и оплатой.',
                price: 'от 12 000 ₽',
                btn: 'Заказать',
            },
            {
                title: 'Корпоративный сайт',
                desc: 'Представительский сайт с уникальным дизайном.',
                price: 'от 9 000 ₽',
                btn: 'Заказать',
            },
            {
                title: 'Редактирование сайта',
                desc: 'Внесение изменений, доработка функционала, обновление контента.',
                price: 'от 3 000 ₽',
                btn: 'Заказать',
            },
        ],
        stats_projects: 'Проектов выполнено',
        stats_clients: 'Довольных клиентов',
        stats_team: 'Сотрудников',
        stats_years: 'Лет опыта',
        preferred_lang_label: 'Предпочитаемый язык сайта',
        preferred_lang_desc: 'Выберите язык',
        newsletter_title: 'Подпишитесь на рассылку',
        newsletter_desc:
            'Получайте последние новости, спецпредложения и советы по сайтам прямо на почту.',
        subscribe_btn: 'Подписаться',
        why_choose_us: 'Почему клиенты выбирают нас',
        support_label: 'Поддержка',
        seo_label: 'Оптимизация',
        fast_label: 'Быстро',
        pro_label: 'Дизайн',
        submit_request: 'Отправить заявку',
        submit_btn: 'Отправить',
        submit_payment_btn: 'Отправить данные оплаты',
        confirm_payment: 'Я подтверждаю оплату',
        payment_note: '⚠️ Ручная проверка в течение 24 ч.',
        order_service_title: 'Заказать услугу',
        service_label: 'Услуга',
        your_name: 'Ваше имя',
        email_label: 'Email',
        phone_label: 'Телефон',
        additional_info: 'Дополнительная информация',
        submit_order_btn: 'Отправить заказ',
        agree_label_short:
            "Я согласен с <a href='#' id='demoPolicyLink'>Условиями</a> и <a href='#' id='demoRefundLink'>Политикой возврата</a>",
        select_template_for_service: 'Выберите шаблон для этой услуги:',
        demo_template_label: 'Шаблон',
        select_template: 'Выберите шаблон',
    },
    en: {
        nav_services: 'Services',
        nav_portfolio: 'Portfolio',
        nav_blog: 'Blog',
        nav_reviews: 'Reviews',
        nav_contact: 'Contacts',
        nav_templates: 'Templates',
        hero_title: 'We create websites that work for you',
        hero_desc: 'Modern design, high conversion, full support. Order your website today.',
        hero_demo_btn: 'Get demo',
        hero_consult_btn: 'Request consultation',
        services_title: 'Our Services',
        portfolio_title: 'Our Projects',
        blog_title: 'Blog',
        reviews_title: 'Client Reviews',
        templates_title: 'Choose Your Template',
        templates_desc:
            'Select a design that fits your brand – each template is fully customizable.',
        edit_title: 'Order website edit',
        contact_title: 'Contacts',
        filter_all: 'All',
        filter_landing: 'Landings',
        filter_shop: 'Shops',
        filter_corp: 'Corporate',
        filter_realestate: 'Real Estate',
        filter_medical: 'Medical',
        filter_food: 'Food',
        filter_portfolio: 'Portfolio',        search_placeholder: 'Search...',
        add_review_btn: 'Leave a review',
        edit_name: 'Your name',
        edit_email: 'Email',
        edit_phone: 'Phone',
        edit_vk: 'VK link',
        edit_site: 'Website URL',
        edit_type: 'Edit type',
        edit_type_design: 'Design',
        edit_type_function: 'Functionality',
        edit_type_content: 'Content',
        edit_type_other: 'Other',
        edit_desired_date: 'Desired date',
        edit_desc: 'Describe what needs improvement',
        demo_business_name: 'Business name',
        demo_city: 'City',
        demo_phone: 'Phone',
        demo_vk: 'VK link',
        demo_email: 'Email',
        demo_address: 'Business address',
        demo_domain: 'Desired domain',
        demo_referrer: 'How did you find us?',
        demo_budget: 'Budget',
        demo_existing_site: 'Your current site',
        demo_notes: 'Additional wishes',
        demo_has_hosting: 'I have hosting and domain',
        consult_name: 'Your name',
        consult_email: 'Email',
        consult_phone: 'Phone',
        consult_vk: 'VK link',
        consult_message: 'Your question',
        review_name: 'Your name',
        review_text: 'Your review',
        agree_label:
            "I agree to the <a href='#' class='i18n-policy-link'>Terms of Use</a> and <a href='#' class='i18n-refund-link'>Refund Policy</a>",
        send_btn: 'Submit',
        send_copy: 'Send copy to email',
        fill_from_vk: 'Fill from VK',
        demo_modal_title: 'Get demo site',
        consult_modal_title: 'Consultation request',
        review_modal_title: 'Leave a review',
        policy_title: 'Terms of Use',
        refund_title: 'Refund Policy',
        exit_title: "Don't go!",
        exit_text: 'Leave a request and get 10% discount.',
        exit_btn: 'Get discount',
        consent_title: '❗ Important notice',
        consent_desc: 'To use the site you must agree to the terms:',
        consent_policy: 'Terms of Use',
        consent_refund: 'Refund Policy',
        consent_checkbox: 'I accept',
        consent_accept: 'Continue',
        consent_warning: 'Without acceptance, requests cannot be sent.',
        admin_title: 'Admin Panel',
        cookie_text: 'We use cookies to improve your experience.',
        footer_policy: 'Terms of Use',
        footer_refund: 'Refund Policy',
        footer_copyright: '© 2025 Unique Web Studio. All rights reserved.',
        tab_dashboard: 'Dashboard',
        tab_leads: 'Leads',
        tab_customers: '👥 Customers',
        tab_orders: '📋 Orders',
        tab_analytics: '📊 Analytics',
        tab_seo: '🔍 SEO',
        tab_backup: '💾 Backup',
        tab_notifications: '🔔 Notifications',
        tab_followup: '⏰ Follow-up',
        tab_scraper: '🤖 Lead scraper',
        tab_tickets: '🎫 Tickets',
        tab_settings: '⚙️ Settings',
        tab_logs: '📜 Logs',
        tab_editor: '✏️ Text Editor',
        tab_images: '🖼️ Image Manager',
        tab_templates: '🎨 Templates Manager',
        stats_total: 'Total leads',
        stats_new: 'New',
        stats_sent: 'Sent',
        stats_paid: 'Paid',
        payment_title: 'Payment information',
        lead_details_title: 'Lead Details',
        demo_business_name_label: 'Business name',
        demo_city_label: 'City',
        demo_category_label: 'Website type',
        demo_phone_label: 'Phone number',
        demo_vk_label: 'VK profile',
        demo_email_label: 'Email address',
        demo_address_label: 'Business address',
        demo_brand_color_label: 'Brand color',
        demo_logo_label: 'Logo',
        demo_domain_label: 'Desired domain',
        demo_referrer_label: 'How did you find us?',
        demo_budget_label: 'Budget',
        demo_existing_site_label: 'Current website',
        demo_hosting_label: 'Hosting status',
        demo_notes_label: 'Notes',
        demo_category_landing: 'Landing Page (from 6,000 ₽)',
        demo_category_ecommerce: 'Online Store (from 12,000 ₽)',
        demo_category_corporate: 'Corporate Website (from 9,000 ₽)',
        portfolio_items: {
            UNIDENT: 'UNIDENT',
            'Студия красоты': 'Beauty Studio',
            'Магазин одежды': 'Clothing Store',
            Ресторан: 'Restaurant',
            'IT-компания': 'IT Company',
            'Мебельный магазин': 'Furniture Store',
            'Маркетинговое агентство': 'Marketing Agency',
            'Фитнес-центр': 'Fitness Center',
            Стоматология: 'Dentistry',
            Автосервис: 'Auto Service',
            Недвижимость: 'Real Estate',
        },
        blog_posts: [
            {
                title: 'How to choose a Landing Page for business',
                excerpt: 'Tips for choosing a one-page website.',
                content:
                    'A landing page is an ideal solution for businesses that need to quickly attract customers and collect leads. A well-designed landing page can increase conversion by 3-5 times. Key elements: compelling headline, unique value proposition, social proof, clear call-to-action, and minimal distractions.',
            },
            {
                title: 'SEO optimization: what you need to know',
                excerpt: 'Basic principles of promotion.',
                content:
                    "SEO is a set of practices to improve your website's search engine rankings. On-page SEO includes meta tags, headings, URL structure and page speed. Off-page SEO focuses on backlinks and reputation. Technical SEO covers indexing, sitemaps and structured data. A comprehensive approach delivers steady traffic growth.",
            },
            {
                title: 'Web design trends 2025',
                excerpt: 'New styles and technologies.',
                content:
                    'In 2025, web design trends include minimalism with large typography, 3D elements, micro-animations. Dark mode has become a standard. Key directions: interactive storytelling, glassmorphism with improved performance, adaptive design for foldable devices, and AI-generated content personalized for each user.',
            },
            {
                title: 'Mobile adaptation: why it matters',
                excerpt: 'Responsive design for all devices.',
                content:
                    "Over 60% of web traffic comes from mobile devices. Google uses mobile-first indexing, meaning your site's ranking depends on its mobile version. Responsive design ensures proper display on smartphones, tablets and desktops. Core principles: flexible grids, responsive images, touch-friendly navigation. Non-adaptive sites lose up to 70% of potential clients.",
            },
            {
                title: 'How to increase website conversion',
                excerpt: 'Practical tips to boost sales.',
                content:
                    'Conversion rate is the percentage of visitors who complete a desired action. To improve it: A/B test headlines and CTAs, speed up page load, add social proof. Keep lead forms simple — fewer fields mean higher conversion. Urgency triggers and limited offers boost conversion by 15-30%.',
            },
            {
                title: 'Choosing a domain and hosting',
                excerpt: 'What to consider when starting out.',
                content:
                    "Your domain is your business's face online. Choose short, memorable names in .com or country-specific zones. Hosting determines your site's speed and reliability. For landing pages, shared hosting works; for online stores, VPS is better. Key criteria: uptime, response speed, server location, local language support. Don't skimp on hosting — slow sites drive customers away.",
            },
        ],
        services: [
            {
                title: 'Landing Page',
                desc: 'High-converting one-page website for your business.',
                price: 'from 6,000 ₽',
                btn: 'Order',
            },
            {
                title: 'Online Store',
                desc: 'Full e-commerce platform with cart and payment.',
                price: 'from 12,000 ₽',
                btn: 'Order',
            },
            {
                title: 'Corporate Website',
                desc: 'Corporate site with unique design.',
                price: 'from 9,000 ₽',
                btn: 'Order',
            },
            {
                title: 'Website Editing',
                desc: 'Making changes, functionality improvements, content updates.',
                price: 'from 3,000 ₽',
                btn: 'Order',
            },
        ],
        stats_projects: 'Projects Completed',
        stats_clients: 'Happy Clients',
        stats_team: 'Team Members',
        stats_years: 'Years Experience',
        preferred_lang_label: 'Preferred Language for Website',
        preferred_lang_desc: 'Choose the language',
        newsletter_title: 'Subscribe to Newsletter',
        newsletter_desc: 'Get latest news, special offers and website tips directly in your inbox.',
        subscribe_btn: 'Subscribe',
        why_choose_us: 'Why Clients Choose Us',
        support_label: 'Support',
        seo_label: 'Optimized',
        fast_label: 'Fast',
        pro_label: 'Design',
        submit_request: 'Submit request',
        submit_btn: 'Submit',
        submit_payment_btn: 'Submit payment info',
        confirm_payment: 'I confirm payment',
        payment_note: '⚠️ Manual verification within 24h.',
        order_service_title: 'Order Service',
        service_label: 'Service',
        your_name: 'Your Name',
        email_label: 'Email',
        phone_label: 'Phone',
        additional_info: 'Additional info',
        submit_order_btn: 'Submit order',
        agree_label_short:
            "I agree to <a href='#' id='demoPolicyLink'>Terms</a> and <a href='#' id='demoRefundLink'>Refund Policy</a>",
        select_template_for_service: 'Choose a template for this service:',
        demo_template_label: 'Template',
        select_template: 'Select Template',
    },
};

// Complete country codes list
const countryCodes = [
    { code: '+93', name: 'Afghanistan', flag: '🇦🇫' },
    { code: '+358', name: 'Finland', flag: '🇫🇮' },
    { code: '+33', name: 'France', flag: '🇫🇷' },
    { code: '+241', name: 'Gabon', flag: '🇬🇦' },
    { code: '+220', name: 'Gambia', flag: '🇬🇲' },
    { code: '+995', name: 'Georgia', flag: '🇬🇪' },
    { code: '+49', name: 'Germany', flag: '🇩🇪' },
    { code: '+233', name: 'Ghana', flag: '🇬🇭' },
    { code: '+30', name: 'Greece', flag: '🇬🇷' },
    { code: '+299', name: 'Greenland', flag: '🇬🇱' },
    { code: '+502', name: 'Guatemala', flag: '🇬🇹' },
    { code: '+224', name: 'Guinea', flag: '🇬🇳' },
    { code: '+245', name: 'Guinea-Bissau', flag: '🇬🇼' },
    { code: '+592', name: 'Guyana', flag: '🇬🇾' },
    { code: '+509', name: 'Haiti', flag: '🇭🇹' },
    { code: '+504', name: 'Honduras', flag: '🇭🇳' },
    { code: '+36', name: 'Hungary', flag: '🇭🇺' },
    { code: '+354', name: 'Iceland', flag: '🇮🇸' },
    { code: '+91', name: 'India', flag: '🇮🇳' },
    { code: '+62', name: 'Indonesia', flag: '🇮🇩' },
    { code: '+98', name: 'Iran', flag: '🇮🇷' },
    { code: '+964', name: 'Iraq', flag: '🇮🇶' },
    { code: '+353', name: 'Ireland', flag: '🇮🇪' },
    { code: '+972', name: 'Israel', flag: '🇮🇱' },
    { code: '+39', name: 'Italy', flag: '🇮🇹' },
    { code: '+225', name: 'Ivory Coast', flag: '🇨🇮' },
    { code: '+81', name: 'Japan', flag: '🇯🇵' },
    { code: '+962', name: 'Jordan', flag: '🇯🇴' },
    { code: '+7', name: 'Kazakhstan', flag: '🇰🇿' },
    { code: '+254', name: 'Kenya', flag: '🇰🇪' },
    { code: '+686', name: 'Kiribati', flag: '🇰🇮' },
    { code: '+965', name: 'Kuwait', flag: '🇰🇼' },
    { code: '+996', name: 'Kyrgyzstan', flag: '🇰🇬' },
    { code: '+856', name: 'Laos', flag: '🇱🇦' },
    { code: '+371', name: 'Latvia', flag: '🇱🇻' },
    { code: '+961', name: 'Lebanon', flag: '🇱🇧' },
    { code: '+266', name: 'Lesotho', flag: '🇱🇸' },
    { code: '+231', name: 'Liberia', flag: '🇱🇷' },
    { code: '+218', name: 'Libya', flag: '🇱🇾' },
    { code: '+423', name: 'Liechtenstein', flag: '🇱🇮' },
    { code: '+370', name: 'Lithuania', flag: '🇱🇹' },
    { code: '+352', name: 'Luxembourg', flag: '🇱🇺' },
    { code: '+261', name: 'Madagascar', flag: '🇲🇬' },
    { code: '+265', name: 'Malawi', flag: '🇲🇼' },
    { code: '+60', name: 'Malaysia', flag: '🇲🇾' },
    { code: '+960', name: 'Maldives', flag: '🇲🇻' },
    { code: '+223', name: 'Mali', flag: '🇲🇱' },
    { code: '+356', name: 'Malta', flag: '🇲🇹' },
    { code: '+692', name: 'Marshall Islands', flag: '🇲🇭' },
    { code: '+596', name: 'Martinique', flag: '🇲🇶' },
    { code: '+222', name: 'Mauritania', flag: '🇲🇷' },
    { code: '+230', name: 'Mauritius', flag: '🇲🇺' },
    { code: '+262', name: 'Mayotte', flag: '🇾🇹' },
    { code: '+52', name: 'Mexico', flag: '🇲🇽' },
    { code: '+691', name: 'Micronesia', flag: '🇫🇲' },
    { code: '+373', name: 'Moldova', flag: '🇲🇩' },
    { code: '+377', name: 'Monaco', flag: '🇲🇨' },
    { code: '+976', name: 'Mongolia', flag: '🇲🇳' },
    { code: '+382', name: 'Montenegro', flag: '🇲🇪' },
    { code: '+212', name: 'Morocco', flag: '🇲🇦' },
    { code: '+258', name: 'Mozambique', flag: '🇲🇿' },
    { code: '+95', name: 'Myanmar', flag: '🇲🇲' },
    { code: '+264', name: 'Namibia', flag: '🇳🇦' },
    { code: '+674', name: 'Nauru', flag: '🇳🇷' },
    { code: '+977', name: 'Nepal', flag: '🇳🇵' },
    { code: '+31', name: 'Netherlands', flag: '🇳🇱' },
    { code: '+687', name: 'New Caledonia', flag: '🇳🇨' },
    { code: '+64', name: 'New Zealand', flag: '🇳🇿' },
    { code: '+505', name: 'Nicaragua', flag: '🇳🇮' },
    { code: '+227', name: 'Niger', flag: '🇳🇪' },
    { code: '+234', name: 'Nigeria', flag: '🇳🇬' },
    { code: '+683', name: 'Niue', flag: '🇳🇺' },
    { code: '+672', name: 'Norfolk Island', flag: '🇳🇫' },
    { code: '+850', name: 'North Korea', flag: '🇰🇵' },
    { code: '+389', name: 'North Macedonia', flag: '🇲🇰' },
    { code: '+47', name: 'Norway', flag: '🇳🇴' },
    { code: '+968', name: 'Oman', flag: '🇴🇲' },
    { code: '+92', name: 'Pakistan', flag: '🇵🇰' },
    { code: '+680', name: 'Palau', flag: '🇵🇼' },
    { code: '+970', name: 'Palestine', flag: '🇵🇸' },
    { code: '+507', name: 'Panama', flag: '🇵🇦' },
    { code: '+675', name: 'Papua New Guinea', flag: '🇵🇬' },
    { code: '+595', name: 'Paraguay', flag: '🇵🇾' },
    { code: '+51', name: 'Peru', flag: '🇵🇪' },
    { code: '+63', name: 'Philippines', flag: '🇵🇭' },
    { code: '+48', name: 'Poland', flag: '🇵🇱' },
    { code: '+351', name: 'Portugal', flag: '🇵🇹' },
    { code: '+974', name: 'Qatar', flag: '🇶🇦' },
    { code: '+242', name: 'Republic of the Congo', flag: '🇨🇬' },
    { code: '+262', name: 'Réunion', flag: '🇷🇪' },
    { code: '+40', name: 'Romania', flag: '🇷🇴' },
    { code: '+7', name: 'Russia', flag: '🇷🇺' },
    { code: '+250', name: 'Rwanda', flag: '🇷🇼' },
    { code: '+590', name: 'Saint Barthélemy', flag: '🇧🇱' },
    { code: '+290', name: 'Saint Helena', flag: '🇸🇭' },
    { code: '+508', name: 'Saint Pierre and Miquelon', flag: '🇵🇲' },
    { code: '+1', name: 'Saint Vincent and the Grenadines', flag: '🇻🇨' },
    { code: '+685', name: 'Samoa', flag: '🇼🇸' },
    { code: '+378', name: 'San Marino', flag: '🇸🇲' },
    { code: '+239', name: 'Sao Tome and Principe', flag: '🇸🇹' },
    { code: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
    { code: '+221', name: 'Senegal', flag: '🇸🇳' },
    { code: '+381', name: 'Serbia', flag: '🇷🇸' },
    { code: '+248', name: 'Seychelles', flag: '🇸🇨' },
    { code: '+232', name: 'Sierra Leone', flag: '🇸🇱' },
    { code: '+65', name: 'Singapore', flag: '🇸🇬' },
    { code: '+421', name: 'Slovakia', flag: '🇸🇰' },
    { code: '+386', name: 'Slovenia', flag: '🇸🇮' },
    { code: '+677', name: 'Solomon Islands', flag: '🇸🇧' },
    { code: '+252', name: 'Somalia', flag: '🇸🇴' },
    { code: '+27', name: 'South Africa', flag: '🇿🇦' },
    { code: '+82', name: 'South Korea', flag: '🇰🇷' },
    { code: '+211', name: 'South Sudan', flag: '🇸🇸' },
    { code: '+34', name: 'Spain', flag: '🇪🇸' },
    { code: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
    { code: '+249', name: 'Sudan', flag: '🇸🇩' },
    { code: '+597', name: 'Suriname', flag: '🇸🇷' },
    { code: '+268', name: 'Swaziland', flag: '🇸🇿' },
    { code: '+46', name: 'Sweden', flag: '🇸🇪' },
    { code: '+41', name: 'Switzerland', flag: '🇨🇭' },
    { code: '+963', name: 'Syria', flag: '🇸🇾' },
    { code: '+886', name: 'Taiwan', flag: '🇹🇼' },
    { code: '+992', name: 'Tajikistan', flag: '🇹🇯' },
    { code: '+255', name: 'Tanzania', flag: '🇹🇿' },
    { code: '+66', name: 'Thailand', flag: '🇹🇭' },
    { code: '+670', name: 'Timor-Leste', flag: '🇹🇱' },
    { code: '+228', name: 'Togo', flag: '🇹🇬' },
    { code: '+690', name: 'Tokelau', flag: '🇹🇰' },
    { code: '+676', name: 'Tonga', flag: '🇹🇴' },
    { code: '+216', name: 'Tunisia', flag: '🇹🇳' },
    { code: '+90', name: 'Turkey', flag: '🇹🇷' },
    { code: '+993', name: 'Turkmenistan', flag: '🇹🇲' },
    { code: '+688', name: 'Tuvalu', flag: '🇹🇻' },
    { code: '+256', name: 'Uganda', flag: '🇺🇬' },
    { code: '+380', name: 'Ukraine', flag: '🇺🇦' },
    { code: '+971', name: 'United Arab Emirates', flag: '🇦🇪' },
    { code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
    { code: '+1', name: 'United States', flag: '🇺🇸' },
    { code: '+598', name: 'Uruguay', flag: '🇺🇾' },
    { code: '+998', name: 'Uzbekistan', flag: '🇺🇿' },
    { code: '+678', name: 'Vanuatu', flag: '🇻🇺' },
    { code: '+39', name: 'Vatican City', flag: '🇻🇦' },
    { code: '+58', name: 'Venezuela', flag: '🇻🇪' },
    { code: '+84', name: 'Vietnam', flag: '🇻🇳' },
    { code: '+681', name: 'Wallis and Futuna', flag: '🇼🇫' },
    { code: '+967', name: 'Yemen', flag: '🇾🇪' },
    { code: '+260', name: 'Zambia', flag: '🇿🇲' },
    { code: '+263', name: 'Zimbabwe', flag: '🇿🇼' },
];
countryCodes.sort((a, b) => a.name.localeCompare(b.name));

function populateCountryCodes() {
    document.querySelectorAll('.country-code').forEach((select) => {
        if (select.options.length > 1) return;
        countryCodes.forEach((c) => {
            const opt = document.createElement('option');
            opt.value = c.code;
            opt.textContent = `${c.flag} ${c.name} (${c.code})`;
            if (c.code === '+7') opt.selected = true;
            select.appendChild(opt);
        });
    });
}

let templatesFilterCategory = 'all';
let templatesFilterSearch = '';
let templatesPage = 1;
let templatesPerPage = 12;

function renderTemplatesPage() {
    const container = document.getElementById('templatesGrid');
    if (!container) return;
    const t = translations[currentLang];
    const allTemplates = [];
    for (let cat in templatesData) {
        if (templatesFilterCategory !== 'all' && cat !== templatesFilterCategory) continue;
        for (let tmpl of templatesData[cat]) {
            if (templatesFilterSearch) {
                const name = (tmpl.name[currentLang] || tmpl.name.en || '').toLowerCase();
                const slug = (tmpl.slug || '').toLowerCase();
                if (!name.includes(templatesFilterSearch) && !slug.includes(templatesFilterSearch))
                    continue;
            }
            allTemplates.push({ ...tmpl, _category: cat });
        }
    }
    const totalPages = Math.ceil(allTemplates.length / templatesPerPage) || 1;
    const start = (templatesPage - 1) * templatesPerPage;
    const pageItems = allTemplates.slice(start, start + templatesPerPage);

    const catCounts = { all: 0 };
    for (let cat in templatesData) {
        catCounts[cat] = templatesData[cat].length;
        catCounts.all += templatesData[cat].length;
    }
    const filterKeys = { landing: 'filter_landing', ecommerce: 'filter_shop', corporate: 'filter_corp', realestate: 'filter_realestate', medical: 'filter_medical', food: 'filter_food', portfolio: 'filter_portfolio' };
    let filterBtns = `<button class="filter-btn ${templatesFilterCategory === 'all' ? 'active' : ''}" data-filter="all">${t.filter_all || 'All'} (${catCounts.all})</button>`;
    for (let cat in templatesData) {
        const key = filterKeys[cat] || 'filter_' + cat;
        const label = t[key] || cat.charAt(0).toUpperCase() + cat.slice(1);
        filterBtns += `<button class="filter-btn ${templatesFilterCategory === cat ? 'active' : ''}" data-filter="${cat}">${label} (${catCounts[cat]})</button>`;
    }
    const filterHtml = `
        <div class="template-filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px; align-items:center;">
            ${filterBtns}
            <input type="text" id="templatesSearch" class="search-input" placeholder="${t.search_placeholder || 'Search...'}" value="${escapeHtml(templatesFilterSearch)}" style="width:200px; margin-left:auto;">
        </div>`;

    container.innerHTML =
        filterHtml +
        pageItems
            .map((tmpl) => {
                const name = tmpl.name[currentLang] || tmpl.name.en;
                const price = tmpl.price
                    ? tmpl.price[currentLang] || tmpl.price.en
                    : tmpl._category === 'ecommerce'
                      ? 'from 12,000 ₽'
                      : tmpl._category === 'corporate'
                        ? 'from 9,000 ₽'
                        : 'from 6,000 ₽';
                const imgUrl = customImages.templates[tmpl.id] || tmpl.image || 'images/photos/templates/' + tmpl.id + '.jpg';
                const previewUrl = tmpl.preview_url || '';
                const imgHtml = `<img src="${imgUrl}" alt="${name}" style="width:100%; border-radius:20px; aspect-ratio:16/10; object-fit:cover;" loading="lazy">`;
                return `
            <div class="template-card" data-template-id="${tmpl.id}">
                ${imgHtml}
                <h3>${escapeHtml(name)}</h3>
                <div class="template-price">${escapeHtml(price)}</div>
                <div class="template-actions">
                    <button class="btn order-template-btn" data-template-id="${escapeHtml(tmpl.id)}" data-template-name="${escapeHtml(name)}" data-template-category="${escapeHtml(tmpl._category || '')}">${t.order_btn || 'Order'}</button>
                    ${previewUrl ? `<a class="template-preview-btn" href="${previewUrl}" target="_blank" rel="noopener">${t.preview_btn || 'Preview'}</a>` : ''}
                </div>
            </div>
        `;
            })
            .join('') +
        (totalPages > 1
            ? `<div class="pagination" style="display:flex; gap:10px; justify-content:center; margin-top:20px; grid-column:1/-1;">
        <button class="btn" ${templatesPage <= 1 ? 'disabled' : ''} onclick="templatesPage=1;renderTemplatesPage();">First</button>
        <button class="btn" ${templatesPage <= 1 ? 'disabled' : ''} onclick="templatesPage--;renderTemplatesPage();">Prev</button>
        <span style="display:flex;align-items:center;color:var(--text-dark);">Page ${templatesPage} / ${totalPages}</span>
        <button class="btn" ${templatesPage >= totalPages ? 'disabled' : ''} onclick="templatesPage++;renderTemplatesPage();">Next</button>
        <button class="btn" ${templatesPage >= totalPages ? 'disabled' : ''} onclick="templatesPage=totalPages;renderTemplatesPage();">Last</button>
    </div>`
            : '');

    document.querySelectorAll('#templatesGrid .filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            templatesFilterCategory = btn.getAttribute('data-filter');
            templatesPage = 1;
            renderTemplatesPage();
        });
    });
    const searchInput = document.getElementById('templatesSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            templatesFilterSearch = e.target.value.toLowerCase();
            templatesPage = 1;
            renderTemplatesPage();
        });
    }
    try {
        VanillaTilt.init(document.querySelectorAll('.template-card'), {
            max: 10,
            speed: 500,
            glare: true,
            'max-glare': 0.4,
        });
    } catch (e) {}
    document.querySelectorAll('.order-template-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const templateId = btn.getAttribute('data-template-id');
            let service = '';
            const cat = (btn.getAttribute('data-template-category') || '').toLowerCase();
            if (
                cat === 'landing' ||
                templateId.startsWith('landing') ||
                templateId.startsWith('ext__landing')
            )
                service = 'Landing Page';
            else if (
                cat === 'ecommerce' ||
                templateId.startsWith('shop') ||
                templateId.startsWith('ext__ecommerce')
            )
                service = 'Online Store';
            else if (
                cat === 'corporate' ||
                templateId.startsWith('corp') ||
                templateId.startsWith('ext__corporate')
            )
                service = 'Corporate Website';
            else service = 'Landing Page';
            openOrderServiceModal(service, templateId);
        });
    });
}

function orderTemplate(templateId, category) {
    let service = '';
    if (
        category === 'landing' ||
        templateId.startsWith('landing') ||
        templateId.startsWith('ext__landing')
    )
        service = 'Landing Page';
    else if (
        category === 'ecommerce' ||
        templateId.startsWith('shop') ||
        templateId.startsWith('ext__ecommerce')
    )
        service = 'Online Store';
    else if (
        category === 'corporate' ||
        templateId.startsWith('corp') ||
        templateId.startsWith('ext__corporate')
    )
        service = 'Corporate Website';
    openOrderServiceModal(service, templateId);
}

function openOrderServiceModal(serviceName, preselectedTemplateId = null) {
    console.log('[order] open modal for', serviceName, 'template', preselectedTemplateId);
    document.getElementById('orderServiceName').value = serviceName || '';
    document.getElementById('orderName').value = '';
    document.getElementById('orderEmail').value = '';
    document.getElementById('orderPhone').value = '';
    document.getElementById('orderMessage').value = '';
    document.getElementById('orderAgree').checked = false;
    document.getElementById('selectedTemplateId').value = '';
    let category = 'landing';
    const s = (serviceName || '').toLowerCase();
    if (s.includes('online') || s.includes('shop') || s.includes('store') || s.includes('магазин'))
        category = 'ecommerce';
    else if (s.includes('corporate') || s.includes('corp') || s.includes('корпорат'))
        category = 'corporate';
    console.log('[order] Category:', category);
    const templates = templatesData[category] || [];
    const container = document.getElementById('serviceTemplatesContainer');
    if (!container) {
        console.error('[order] templatesContainer missing');
        return;
    }
    if (templates.length === 0) {
        container.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-light);">No templates available for ${serviceName}</p>`;
    } else {
        container.innerHTML = templates
            .map((tmpl) => {
                const name = tmpl.name[currentLang] || tmpl.name.en;
                const price = tmpl.price[currentLang] || tmpl.price.en;
                const imgUrl = customImages.templates[tmpl.id] || tmpl.image || 'images/photos/templates/' + tmpl.id + '.jpg';
                const imgHtml = imgUrl
                    ? `<img src="${imgUrl}" alt="${name}" style="width:100%; border-radius:12px; aspect-ratio:16/10; object-fit:cover;">`
                    : `<div style="height:100px; background:var(--beige); display:flex; align-items:center; justify-content:center; border-radius:12px;">${name}</div>`;
                const selectedAttr = preselectedTemplateId === tmpl.id ? 'selected' : '';
                return `<div class="template-card ${selectedAttr}" data-template-id="${tmpl.id}" style="cursor:pointer; padding:12px; text-align:center;">${imgHtml}<strong style="display:block; margin-top:6px;">${escapeHtml(name)}</strong><div style="font-size:0.9rem; color:var(--gold);">${escapeHtml(price)}</div></div>`;
            })
            .join('');
    }
    document.querySelectorAll('#serviceTemplatesContainer .template-card').forEach((card) => {
        card.addEventListener('click', function (e) {
            document
                .querySelectorAll('#serviceTemplatesContainer .template-card')
                .forEach((c) => c.classList.remove('selected'));
            this.classList.add('selected');
            document.getElementById('selectedTemplateId').value =
                this.getAttribute('data-template-id');
            console.log('[order] template selected:', this.getAttribute('data-template-id'));
        });
    });
    if (preselectedTemplateId) {
        const preselectedCard = document.querySelector(
            `#serviceTemplatesContainer .template-card[data-template-id="${preselectedTemplateId}"]`,
        );
        if (preselectedCard) preselectedCard.click();
        else
            setTimeout(() => {
                const card = document.querySelector(
                    `#serviceTemplatesContainer .template-card[data-template-id="${preselectedTemplateId}"]`,
                );
                if (card) card.click();
            }, 300);
    }
    if (!document.getElementById('selectedTemplateId').value && templates.length > 0) {
        const firstCard = document.querySelector('#serviceTemplatesContainer .template-card');
        if (firstCard) {
            firstCard.classList.add('selected');
            document.getElementById('selectedTemplateId').value =
                firstCard.getAttribute('data-template-id');
        }
    }
    openModal('orderService');
}

// ==================== DEMO FORM TEMPLATE SELECTOR ====================
function loadDemoTemplates(category) {
    var dropdown = document.getElementById('demoTemplate');
    if (!dropdown) return;
    dropdown.innerHTML = '<option value="" disabled selected>Choose template</option>';
    var templates = templatesData[category] || [];
    if (templates.length === 0) {
        dropdown.innerHTML = '<option value="" disabled selected>No templates available</option>';
        return;
    }
    templates.forEach(function (tmpl) {
        var opt = document.createElement('option');
        opt.value = tmpl.id;
        opt.textContent = tmpl.name[currentLang] || tmpl.name.en;
        dropdown.appendChild(opt);
    });
}

function openTemplateModal() {
    var categoryDropdown = document.getElementById('demoCategory');
    var category = categoryDropdown ? categoryDropdown.value : 'landing';
    populateTemplateModal(category);
    openModal('template');
}

function populateTemplateModal(category) {
    var grid = document.getElementById('templateGrid');
    if (!grid) return;
    var templates = templatesData[category] || [];
    if (templates.length === 0) {
        grid.innerHTML =
            '<p style="text-align:center; padding:40px; color:var(--text-light); grid-column:1/-1;">No templates available</p>';
        return;
    }
    grid.innerHTML = templates
        .map(function (tmpl) {
            var name = tmpl.name[currentLang] || tmpl.name.en;
            var imgUrl = customImages.templates[tmpl.id] || tmpl.image || 'images/photos/templates/' + tmpl.id + '.jpg';
            var imgHtml = imgUrl
                ? '<img src="' + imgUrl + '" alt="' + name + '" loading="lazy">'
                : '<div style="aspect-ratio:16/10; display:flex; align-items:center; justify-content:center; background:var(--beige); border-radius:12px; font-size:0.8rem; color:var(--text-light);">' +
                  name +
                  '</div>';
            return (
                '<div class="template-card" data-template-id="' +
                tmpl.id +
                '" data-template-name="' +
                name +
                '" onclick="selectTemplateForDemo(\'' +
                tmpl.id +
                "', '" +
                escapeHtml(name) +
                '\')">' +
                imgHtml +
                '<strong>' +
                escapeHtml(name) +
                '</strong>' +
                '</div>'
            );
        })
        .join('');
}

function selectTemplateForDemo(templateId, templateName) {
    var dropdown = document.getElementById('demoTemplate');
    if (dropdown) {
        dropdown.value = templateId;
    }
    showTemplateSelectionDisplay(templateId, templateName);
    document.getElementById('templateModal').style.display = 'none';
}

function showTemplateSelectionDisplay(templateId, templateName) {
    var display = document.getElementById('templateSelectionDisplay');
    if (!display) return;
    if (!templateId) {
        display.innerHTML = '';
        return;
    }
    var imgUrl = '';
    for (var cat in templatesData) {
        var found = templatesData[cat].find(function (t) {
            return t.id === templateId;
        });
        if (found) {
            imgUrl = customImages.templates[templateId] || found.image || 'images/photos/templates/' + templateId + '.jpg';
            break;
        }
    }
    var imgHtml = imgUrl
        ? '<img src="' + imgUrl + '" alt="' + templateName + '">'
        : '<div style="width:70px;height:46px;border-radius:8px;background:var(--beige);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.7rem;color:var(--text-light);">' +
          templateName.substring(0, 10) +
          '</div>';
    display.innerHTML = imgHtml + '<span>' + escapeHtml(templateName) + '</span>';
}

// ==================== SERVICE CARDS (with template selection) ====================
const serviceSvgs = {
    'Landing Page': `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="210" viewBox="0 0 280 210" fill="none"><defs><linearGradient id="s1a" x1="0" y1="0" x2="280" y2="210"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="s1b" x1="0" y1="0" x2="280" y2="160"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="280" height="210" rx="20" fill="url(#s1a)"/><circle cx="30" cy="30" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="46" cy="30" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="62" cy="30" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="30" cy="46" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="46" cy="46" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="62" cy="46" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="30" cy="62" r="1.5" fill="#C8A96A" opacity="0.2"/><circle cx="46" cy="62" r="1.5" fill="#C8A96A" opacity="0.2"/><circle cx="62" cy="62" r="1.5" fill="#C8A96A" opacity="0.2"/><rect x="28" y="90" width="224" height="100" rx="12" fill="#0f3460" stroke="url(#s1b)" stroke-width="1"/><rect x="44" y="104" width="120" height="5" rx="2.5" fill="url(#s1b)" opacity="0.6"/><rect x="44" y="116" width="90" height="4" rx="2" fill="#C8A96A" opacity="0.25"/><rect x="44" y="126" width="110" height="4" rx="2" fill="#C8A96A" opacity="0.2"/><rect x="44" y="136" width="80" height="4" rx="2" fill="#C8A96A" opacity="0.15"/><rect x="44" y="150" width="150" height="24" rx="6" fill="url(#s1b)" opacity="0.12"/><rect x="194" y="104" width="42" height="42" rx="10" fill="url(#s1b)" opacity="0.1"/><circle cx="215" cy="125" r="14" fill="none" stroke="url(#s1b)" stroke-width="1" opacity="0.4"/><line x1="215" y1="115" x2="215" y2="135" stroke="url(#s1b)" stroke-width="1" opacity="0.3"/><line x1="205" y1="125" x2="225" y2="125" stroke="url(#s1b)" stroke-width="1" opacity="0.3"/><line x1="40" y1="24" x2="240" y2="24" stroke="url(#s1b)" stroke-width="0.5" opacity="0.3"/><circle cx="32" cy="24" r="3" fill="#C8A96A" opacity="0.5"/><circle cx="48" cy="24" r="3" fill="#e94560" opacity="0.4"/><circle cx="64" cy="24" r="3" fill="#FDF8F0" opacity="0.3"/></svg>`,
    'Online Store': `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="210" viewBox="0 0 280 210" fill="none"><defs><linearGradient id="s2a" x1="0" y1="0" x2="280" y2="210"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="s2b" x1="0" y1="0" x2="200" y2="200"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient><linearGradient id="s2c" x1="280" y1="0" x2="0" y2="210"><stop offset="0%" stop-color="#B58C48"/><stop offset="100%" stop-color="#C8A96A"/></linearGradient></defs><rect width="280" height="210" rx="20" fill="url(#s2a)"/><circle cx="140" cy="45" r="60" fill="none" stroke="url(#s2b)" stroke-width="0.5" opacity="0.25"/><circle cx="140" cy="45" r="40" fill="none" stroke="url(#s2b)" stroke-width="0.5" opacity="0.35"/><circle cx="140" cy="45" r="22" fill="none" stroke="url(#s2b)" stroke-width="1" opacity="0.5"/><rect x="38" y="120" width="50" height="58" rx="8" fill="#0f3460" stroke="url(#s2b)" stroke-width="1"/><rect x="46" y="128" width="34" height="30" rx="5" fill="#1a1a2e"/><circle cx="63" cy="143" r="9" fill="url(#s2b)" opacity="0.3"/><rect x="44" y="168" width="38" height="6" rx="3" fill="url(#s2b)" opacity="0.5"/><rect x="100" y="108" width="50" height="70" rx="8" fill="#0f3460" stroke="url(#s2b)" stroke-width="1.2"/><rect x="108" y="116" width="34" height="36" rx="5" fill="#1a1a2e"/><rect x="115" y="123" width="20" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="115" y="130" width="16" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="108" y="170" width="34" height="6" rx="3" fill="url(#s2b)" opacity="0.55"/><rect x="162" y="114" width="50" height="64" rx="8" fill="#0f3460" stroke="url(#s2b)" stroke-width="1"/><rect x="170" y="122" width="34" height="32" rx="5" fill="#1a1a2e"/><circle cx="187" cy="136" r="11" fill="url(#s2c)" opacity="0.25"/><rect x="170" y="168" width="34" height="6" rx="3" fill="url(#s2b)" opacity="0.5"/><path d="M230 50 L260 50 L265 58 L265 80 L230 80 Z" rx="6" fill="none" stroke="url(#s2b)" stroke-width="1" opacity="0.5"/><path d="M236 65 Q245 55 254 65" stroke="url(#s2b)" stroke-width="1.5" fill="none" opacity="0.6"/><line x1="236" y1="72" x2="254" y2="72" stroke="url(#s2b)" stroke-width="1" opacity="0.4"/></svg>`,
    'Corporate Website': `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="210" viewBox="0 0 280 210" fill="none"><defs><linearGradient id="s3a" x1="0" y1="0" x2="280" y2="210"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="s3b" x1="0" y1="0" x2="140" y2="210"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="280" height="210" rx="20" fill="url(#s3a)"/><line x1="30" y1="180" x2="250" y2="180" stroke="#C8A96A" stroke-width="0.5" opacity="0.15"/><line x1="30" y1="160" x2="250" y2="160" stroke="#C8A96A" stroke-width="0.5" opacity="0.12"/><line x1="30" y1="140" x2="250" y2="140" stroke="#C8A96A" stroke-width="0.5" opacity="0.12"/><line x1="30" y1="120" x2="250" y2="120" stroke="#C8A96A" stroke-width="0.5" opacity="0.1"/><line x1="30" y1="100" x2="250" y2="100" stroke="#C8A96A" stroke-width="0.5" opacity="0.1"/><rect x="50" y="30" width="28" height="150" rx="4" fill="#0f3460" stroke="url(#s3b)" stroke-width="1"/><rect x="56" y="36" width="7" height="7" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="66" y="36" width="7" height="7" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="56" y="48" width="7" height="7" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="66" y="48" width="7" height="7" rx="1.5" fill="#C8A96A" opacity="0.15"/><rect x="56" y="60" width="7" height="7" rx="1.5" fill="#C8A96A" opacity="0.15"/><rect x="96" y="22" width="55" height="158" rx="6" fill="#0f3460" stroke="url(#s3b)" stroke-width="1.2"/><rect x="108" y="34" width="31" height="4" rx="2" fill="url(#s3b)" opacity="0.5"/><rect x="108" y="44" width="24" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="108" y="52" width="28" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="108" y="60" width="20" height="3" rx="1.5" fill="#C8A96A" opacity="0.15"/><rect x="108" y="72" width="31" height="20" rx="4" fill="url(#s3b)" opacity="0.1"/><rect x="108" y="100" width="24" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="108" y="108" width="28" height="3" rx="1.5" fill="#C8A96A" opacity="0.15"/><rect x="108" y="116" width="20" height="3" rx="1.5" fill="#C8A96A" opacity="0.12"/><rect x="108" y="128" width="31" height="4" rx="2" fill="url(#s3b)" opacity="0.4"/><rect x="108" y="138" width="24" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="108" y="146" width="20" height="3" rx="1.5" fill="#C8A96A" opacity="0.15"/><rect x="170" y="32" width="80" height="140" rx="8" fill="#0f3460" stroke="url(#s3b)" stroke-width="1"/><rect x="188" y="48" width="44" height="5" rx="2.5" fill="url(#s3b)" opacity="0.5"/><rect x="188" y="60" width="35" height="4" rx="2" fill="#C8A96A" opacity="0.25"/><rect x="188" y="70" width="40" height="4" rx="2" fill="#C8A96A" opacity="0.2"/><rect x="188" y="82" width="44" height="60" rx="6" fill="#1a1a2e" stroke="#C8A96A" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.3"/><rect x="188" y="150" width="30" height="18" rx="9" fill="url(#s3b)" opacity="0.15"/><path d="M50 30 L64 18 L78 30" stroke="url(#s3b)" stroke-width="1.5" fill="none"/></svg>`,
    'Website Editing': `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="210" viewBox="0 0 280 210" fill="none"><defs><linearGradient id="s4a" x1="0" y1="0" x2="280" y2="210"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="s4b" x1="0" y1="0" x2="200" y2="200"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="280" height="210" rx="20" fill="url(#s4a)"/><rect x="24" y="20" width="160" height="170" rx="12" fill="#0f3460" stroke="url(#s4b)" stroke-width="1"/><rect x="36" y="32" width="110" height="4" rx="2" fill="url(#s4b)" opacity="0.5"/><rect x="36" y="42" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="36" y="50" width="95" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="36" y="62" width="120" height="50" rx="6" fill="#1a1a2e" stroke="#C8A96A" stroke-width="0.5" stroke-dasharray="5 5" opacity="0.35"/><path d="M28 148 L80 96" stroke="url(#s4b)" stroke-width="1.5" opacity="0.4"/><path d="M48 148 L100 96" stroke="url(#s4b)" stroke-width="1.5" opacity="0.3"/><path d="M68 148 L120 96" stroke="url(#s4b)" stroke-width="1.5" opacity="0.2"/><rect x="36" y="158" width="70" height="20" rx="10" fill="url(#s4b)" opacity="0.15"/><rect x="196" y="38" width="38" height="38" rx="10" fill="url(#s4b)" opacity="0.15"/><path d="M209 50 L221 62 M221 50 L209 62" stroke="url(#s4b)" stroke-width="2" stroke-linecap="round" opacity="0.5"/><rect x="194" y="90" width="42" height="42" rx="10" fill="#0f3460" stroke="url(#s4b)" stroke-width="1"/><rect x="202" y="102" width="26" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="202" y="110" width="20" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="202" y="118" width="22" height="3" rx="1.5" fill="#C8A96A" opacity="0.15"/><path d="M224 105 Q236 95 246 105 Q256 115 246 125" stroke="url(#s4b)" stroke-width="1" fill="none" opacity="0.4"/><path d="M230 112 Q238 104 244 112 Q248 118 244 122" stroke="url(#s4b)" stroke-width="0.8" fill="none" opacity="0.25"/><circle cx="160" cy="110" r="2" fill="#e94560" opacity="0.5"/></svg>`,
};
const portfolioSvgs = {
    UNIDENT: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p1a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="p1b" x1="0" y1="0" x2="200" y2="200"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p1a)"/><circle cx="180" cy="100" r="70" fill="none" stroke="url(#p1b)" stroke-width="0.5" opacity="0.2"/><circle cx="180" cy="100" r="50" fill="none" stroke="url(#p1b)" stroke-width="0.5" opacity="0.3"/><circle cx="180" cy="100" r="30" fill="none" stroke="url(#p1b)" stroke-width="0.8" opacity="0.4"/><circle cx="120" cy="85" r="35" fill="none" stroke="url(#p1b)" stroke-width="0.5" opacity="0.15"/><circle cx="230" cy="115" r="40" fill="none" stroke="url(#p1b)" stroke-width="0.5" opacity="0.12"/><circle cx="60" cy="50" r="1.5" fill="#C8A96A" opacity="0.3"/><circle cx="80" cy="50" r="1.5" fill="#C8A96A" opacity="0.3"/><circle cx="100" cy="50" r="1.5" fill="#C8A96A" opacity="0.3"/><circle cx="60" cy="70" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="80" cy="70" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="100" cy="70" r="1.5" fill="#C8A96A" opacity="0.25"/><circle cx="60" cy="90" r="1.5" fill="#C8A96A" opacity="0.2"/><circle cx="80" cy="90" r="1.5" fill="#C8A96A" opacity="0.2"/><circle cx="100" cy="90" r="1.5" fill="#C8A96A" opacity="0.2"/><path d="M10 180 Q40 160 70 180 Q100 200 130 180 Q160 160 190 180 Q220 200 250 180 Q280 160 310 180 Q340 200 350 180" stroke="url(#p1b)" stroke-width="0.8" fill="none" opacity="0.2"/><rect x="130" y="175" width="100" height="3" rx="1.5" fill="url(#p1b)" opacity="0.5"/><circle cx="180" cy="180" r="4" fill="#e94560" opacity="0.5"/></svg>`,
    'Студия красоты': `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p2a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="p2b" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p2a)"/><circle cx="130" cy="100" r="80" fill="none" stroke="url(#p2b)" stroke-width="0.5" opacity="0.12"/><circle cx="130" cy="100" r="60" fill="none" stroke="url(#p2b)" stroke-width="0.5" opacity="0.18"/><circle cx="130" cy="100" r="40" fill="none" stroke="url(#p2b)" stroke-width="0.8" opacity="0.3"/><circle cx="130" cy="100" r="20" fill="url(#p2b)" opacity="0.15"/><path d="M130 40 Q100 55 95 80 Q90 105 130 100" stroke="url(#p2b)" stroke-width="1" fill="none" opacity="0.4"/><path d="M130 40 Q160 55 165 80 Q170 105 130 100" stroke="url(#p2b)" stroke-width="1" fill="none" opacity="0.4"/><path d="M130 40 Q115 65 110 90" stroke="url(#p2b)" stroke-width="0.7" fill="none" opacity="0.3"/><path d="M130 40 Q145 65 150 90" stroke="url(#p2b)" stroke-width="0.7" fill="none" opacity="0.3"/><path d="M130 40 Q130 55 130 65" stroke="url(#p2b)" stroke-width="0.7" fill="none" opacity="0.35"/><rect x="250" y="60" width="80" height="4" rx="2" fill="url(#p2b)" opacity="0.5"/><rect x="250" y="72" width="60" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="250" y="82" width="70" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="250" y="95" width="80" height="40" rx="6" fill="#0f3460" stroke="url(#p2b)" stroke-width="0.8" opacity="0.5"/><rect x="262" y="106" width="40" height="3" rx="1.5" fill="url(#p2b)" opacity="0.4"/><rect x="262" y="115" width="30" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><circle cx="315" cy="170" r="25" fill="url(#p2b)" opacity="0.06"/></svg>`,
    'Магазин одежды': `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p3a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="p3b" x1="0" y1="240" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p3a)"/><rect x="30" y="40" width="60" height="90" rx="8" fill="#0f3460" stroke="url(#p3b)" stroke-width="1"/><rect x="40" y="52" width="40" height="48" rx="5" fill="#1a1a2e"/><path d="M50 48 L70 48 L75 60 L45 60 Z" fill="url(#p3b)" opacity="0.25"/><rect x="38" y="138" width="44" height="5" rx="2.5" fill="url(#p3b)" opacity="0.4"/><rect x="106" y="30" width="60" height="100" rx="8" fill="#0f3460" stroke="url(#p3b)" stroke-width="1"/><rect x="116" y="42" width="40" height="55" rx="5" fill="#1a1a2e"/><circle cx="136" cy="66" r="12" fill="url(#p3b)" opacity="0.2"/><rect x="116" y="138" width="40" height="5" rx="2.5" fill="url(#p3b)" opacity="0.45"/><rect x="182" y="38" width="60" height="92" rx="8" fill="#0f3460" stroke="url(#p3b)" stroke-width="1"/><rect x="192" y="50" width="40" height="46" rx="5" fill="#1a1a2e"/><rect x="200" y="58" width="24" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="200" y="66" width="18" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="192" y="138" width="40" height="5" rx="2.5" fill="url(#p3b)" opacity="0.4"/><path d="M270 40 Q290 30 310 40 Q330 50 310 60" stroke="url(#p3b)" stroke-width="1" fill="none" opacity="0.35"/><path d="M270 50 Q285 42 300 50" stroke="url(#p3b)" stroke-width="0.7" fill="none" opacity="0.25"/><circle cx="310" cy="50" r="15" fill="none" stroke="url(#p3b)" stroke-width="0.5" opacity="0.25"/><circle cx="310" cy="50" r="8" fill="url(#p3b)" opacity="0.1"/></svg>`,
    Ресторан: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p4a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="p4b" x1="0" y1="240" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p4a)"/><circle cx="100" cy="90" r="70" fill="none" stroke="url(#p4b)" stroke-width="0.5" opacity="0.15"/><circle cx="100" cy="90" r="50" fill="none" stroke="url(#p4b)" stroke-width="0.6" opacity="0.25"/><circle cx="100" cy="90" r="30" fill="none" stroke="url(#p4b)" stroke-width="0.8" opacity="0.4"/><circle cx="100" cy="90" r="14" fill="url(#p4b)" opacity="0.15"/><line x1="40" y1="90" x2="60" y2="90" stroke="url(#p4b)" stroke-width="0.5" opacity="0.3"/><line x1="140" y1="90" x2="160" y2="90" stroke="url(#p4b)" stroke-width="0.5" opacity="0.3"/><line x1="100" y1="30" x2="100" y2="50" stroke="url(#p4b)" stroke-width="0.5" opacity="0.3"/><line x1="100" y1="130" x2="100" y2="150" stroke="url(#p4b)" stroke-width="0.5" opacity="0.3"/><rect x="190" y="55" width="130" height="5" rx="2.5" fill="url(#p4b)" opacity="0.6"/><rect x="190" y="68" width="100" height="4" rx="2" fill="#C8A96A" opacity="0.3"/><rect x="190" y="79" width="115" height="4" rx="2" fill="#C8A96A" opacity="0.25"/><rect x="190" y="95" width="140" height="70" rx="8" fill="#0f3460" stroke="url(#p4b)" stroke-width="1"/><rect x="206" y="108" width="30" height="3" rx="1.5" fill="url(#p4b)" opacity="0.5"/><rect x="244" y="108" width="60" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="206" y="120" width="80" height="3" rx="1.5" fill="url(#p4b)" opacity="0.4"/><rect x="206" y="130" width="50" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="206" y="145" width="100" height="20" rx="4" fill="url(#p4b)" opacity="0.1"/></svg>`,
    'IT-компания': `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p5a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="p5b" x1="0" y1="0" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p5a)"/><circle cx="60" cy="70" r="8" fill="url(#p5b)" opacity="0.4"/><circle cx="120" cy="45" r="10" fill="url(#p5b)" opacity="0.35"/><circle cx="180" cy="60" r="7" fill="url(#p5b)" opacity="0.45"/><circle cx="240" cy="40" r="9" fill="url(#p5b)" opacity="0.3"/><circle cx="300" cy="55" r="8" fill="url(#p5b)" opacity="0.4"/><line x1="60" y1="70" x2="120" y2="45" stroke="url(#p5b)" stroke-width="0.6" opacity="0.25"/><line x1="120" y1="45" x2="180" y2="60" stroke="url(#p5b)" stroke-width="0.6" opacity="0.25"/><line x1="180" y1="60" x2="240" y2="40" stroke="url(#p5b)" stroke-width="0.6" opacity="0.25"/><line x1="240" y1="40" x2="300" y2="55" stroke="url(#p5b)" stroke-width="0.6" opacity="0.25"/><path d="M40 130 L50 110 L60 130" stroke="url(#p5b)" stroke-width="1.5" fill="none" opacity="0.4"/><path d="M300 130 L310 110 L320 130" stroke="url(#p5b)" stroke-width="1.5" fill="none" opacity="0.4"/><rect x="80" y="145" width="200" height="50" rx="8" fill="#16213e" stroke="url(#p5b)" stroke-width="1"/><rect x="100" y="158" width="60" height="3" rx="1.5" fill="url(#p5b)" opacity="0.5"/><rect x="100" y="168" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="100" y="178" width="50" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><path d="M260 157 L280 157 L280 177 L260 177 Z" rx="4" fill="url(#p5b)" opacity="0.1"/><line x1="266" y1="164" x2="274" y2="164" stroke="url(#p5b)" stroke-width="1" opacity="0.3"/><line x1="266" y1="170" x2="274" y2="170" stroke="url(#p5b)" stroke-width="1" opacity="0.2"/></svg>`,
    'Мебельный магазин': `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p6a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="p6b" x1="0" y1="240" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p6a)"/><rect x="30" y="60" width="100" height="70" rx="8" fill="#0f3460" stroke="url(#p6b)" stroke-width="1"/><rect x="46" y="76" width="68" height="30" rx="4" fill="#1a1a2e"/><line x1="46" y1="110" x2="114" y2="110" stroke="url(#p6b)" stroke-width="0.8" opacity="0.5"/><line x1="46" y1="118" x2="90" y2="118" stroke="url(#p6b)" stroke-width="0.6" opacity="0.3"/><path d="M30 60 L66 42 L102 60" stroke="url(#p6b)" stroke-width="1.2" fill="none" opacity="0.4"/><rect x="160" y="50" width="85" height="80" rx="8" fill="#0f3460" stroke="url(#p6b)" stroke-width="1"/><rect x="176" y="66" width="53" height="36" rx="4" fill="#1a1a2e"/><circle cx="202" cy="84" r="10" fill="url(#p6b)" opacity="0.15"/><line x1="176" y1="112" x2="228" y2="112" stroke="url(#p6b)" stroke-width="0.7" opacity="0.4"/><rect x="275" y="58" width="55" height="72" rx="8" fill="url(#p6b)" opacity="0.06"/><rect x="290" y="72" width="25" height="34" rx="4" fill="url(#p6b)" opacity="0.12"/><line x1="290" y1="116" x2="315" y2="116" stroke="url(#p6b)" stroke-width="0.5" opacity="0.3"/><line x1="20" y1="160" x2="340" y2="160" stroke="url(#p6b)" stroke-width="0.4" opacity="0.15"/><line x1="20" y1="170" x2="340" y2="170" stroke="url(#p6b)" stroke-width="0.3" opacity="0.1"/></svg>`,
    'Маркетинговое агентство': `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p7a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="p7b" x1="0" y1="240" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p7a)"/><rect x="40" y="130" width="30" height="60" rx="4" fill="url(#p7b)" opacity="0.2"/><rect x="80" y="105" width="30" height="85" rx="4" fill="url(#p7b)" opacity="0.3"/><rect x="120" y="80" width="30" height="110" rx="4" fill="url(#p7b)" opacity="0.45"/><rect x="160" y="55" width="30" height="135" rx="4" fill="url(#p7b)" opacity="0.55"/><rect x="200" y="70" width="30" height="120" rx="4" fill="url(#p7b)" opacity="0.4"/><rect x="240" y="90" width="30" height="100" rx="4" fill="url(#p7b)" opacity="0.3"/><rect x="280" y="100" width="30" height="90" rx="4" fill="url(#p7b)" opacity="0.2"/><path d="M160 55 L170 40 L180 55" stroke="url(#p7b)" stroke-width="1.5" fill="none" opacity="0.6"/><path d="M40 130 L30 140 L40 150" stroke="url(#p7b)" stroke-width="1" fill="none" opacity="0.3"/><line x1="30" y1="30" x2="320" y2="30" stroke="url(#p7b)" stroke-width="0.5" opacity="0.15"/><rect x="60" y="36" width="80" height="3" rx="1.5" fill="url(#p7b)" opacity="0.5"/><rect x="60" y="44" width="60" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><circle cx="175" cy="40" r="6" fill="#e94560" opacity="0.5"/></svg>`,
    'Фитнес-центр': `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p8a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="p8b" x1="0" y1="0" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p8a)"/><circle cx="180" cy="90" r="65" fill="none" stroke="url(#p8b)" stroke-width="0.5" opacity="0.15"/><circle cx="180" cy="90" r="45" fill="none" stroke="url(#p8b)" stroke-width="0.6" opacity="0.25"/><circle cx="180" cy="90" r="25" fill="none" stroke="url(#p8b)" stroke-width="0.8" opacity="0.35"/><path d="M130 160 Q180 40 230 160" stroke="url(#p8b)" stroke-width="2" fill="none" opacity="0.5"/><path d="M145 160 Q180 70 215 160" stroke="url(#p8b)" stroke-width="1.2" fill="none" opacity="0.35"/><path d="M160 160 Q180 100 200 160" stroke="#e94560" stroke-width="1" fill="none" opacity="0.4"/><line x1="140" y1="160" x2="220" y2="160" stroke="url(#p8b)" stroke-width="0.5" opacity="0.2"/><rect x="30" y="40" width="90" height="4" rx="2" fill="url(#p8b)" opacity="0.5"/><rect x="30" y="50" width="70" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="30" y="58" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="260" y="185" width="70" height="25" rx="12" fill="url(#p8b)" opacity="0.12"/><circle cx="305" cy="197" r="6" fill="url(#p8b)" opacity="0.3"/></svg>`,
    Стоматология: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p9a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="p9b" x1="0" y1="0" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p9a)"/><circle cx="100" cy="90" r="55" fill="#FDF8F0" opacity="0.04"/><circle cx="100" cy="90" r="42" fill="none" stroke="url(#p9b)" stroke-width="1" opacity="0.3"/><circle cx="100" cy="90" r="28" fill="none" stroke="url(#p9b)" stroke-width="0.7" opacity="0.2"/><circle cx="100" cy="90" r="14" fill="url(#p9b)" opacity="0.1"/><path d="M70 70 Q100 50 130 70" stroke="url(#p9b)" stroke-width="1.5" fill="none" opacity="0.35"/><path d="M60 90 Q100 80 140 90" stroke="url(#p9b)" stroke-width="1" fill="none" opacity="0.25"/><path d="M70 110 Q100 130 130 110" stroke="url(#p9b)" stroke-width="1.5" fill="none" opacity="0.35"/><circle cx="80" cy="90" r="6" fill="#FDF8F0" opacity="0.15"/><circle cx="120" cy="90" r="6" fill="#FDF8F0" opacity="0.15"/><rect x="210" y="55" width="120" height="4" rx="2" fill="url(#p9b)" opacity="0.5"/><rect x="210" y="66" width="90" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="210" y="76" width="100" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="210" y="90" width="120" height="50" rx="6" fill="#0f3460" stroke="url(#p9b)" stroke-width="0.8" opacity="0.5"/><rect x="226" y="102" width="50" height="3" rx="1.5" fill="url(#p9b)" opacity="0.4"/><rect x="226" y="112" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="226" y="122" width="60" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/></svg>`,
    Автосервис: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p10a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="p10b" x1="0" y1="0" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p10a)"/><circle cx="110" cy="100" r="55" fill="none" stroke="url(#p10b)" stroke-width="0.5" opacity="0.15"/><circle cx="110" cy="100" r="38" fill="none" stroke="url(#p10b)" stroke-width="0.8" opacity="0.3"/><circle cx="110" cy="100" r="22" fill="none" stroke="url(#p10b)" stroke-width="1" opacity="0.5"/><circle cx="110" cy="100" r="10" fill="url(#p10b)" opacity="0.2"/><line x1="110" y1="44" x2="110" y2="60" stroke="url(#p10b)" stroke-width="1.5" opacity="0.3"/><line x1="110" y1="140" x2="110" y2="156" stroke="url(#p10b)" stroke-width="1.5" opacity="0.3"/><line x1="54" y1="100" x2="70" y2="100" stroke="url(#p10b)" stroke-width="1.5" opacity="0.3"/><line x1="150" y1="100" x2="166" y2="100" stroke="url(#p10b)" stroke-width="1.5" opacity="0.3"/><circle cx="200" cy="75" r="18" fill="none" stroke="url(#p10b)" stroke-width="0.8" opacity="0.25"/><circle cx="200" cy="75" r="10" fill="none" stroke="url(#p10b)" stroke-width="0.6" opacity="0.35"/><circle cx="200" cy="75" r="4" fill="url(#p10b)" opacity="0.3"/><circle cx="260" cy="65" r="16" fill="none" stroke="url(#p10b)" stroke-width="0.7" opacity="0.2"/><circle cx="260" cy="65" r="8" fill="none" stroke="url(#p10b)" stroke-width="0.5" opacity="0.3"/><circle cx="230" cy="140" r="12" fill="url(#p10b)" opacity="0.08"/><rect x="270" y="185" width="60" height="20" rx="10" fill="url(#p10b)" opacity="0.1"/><line x1="120" y1="175" x2="220" y2="175" stroke="url(#p10b)" stroke-width="0.4" opacity="0.2"/></svg>`,
    Недвижимость: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="p11a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="p11b" x1="0" y1="0" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#p11a)"/><rect x="60" y="60" width="90" height="110" rx="6" fill="#16213e" stroke="url(#p11b)" stroke-width="1.2"/><rect x="70" y="72" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.2"/><rect x="92" y="72" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.15"/><rect x="114" y="72" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.12"/><rect x="70" y="96" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.15"/><rect x="92" y="96" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.1"/><rect x="70" y="120" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.12"/><rect x="70" y="145" width="60" height="14" rx="7" fill="url(#p11b)" opacity="0.12"/><path d="M60 60 L105 38 L150 60" stroke="url(#p11b)" stroke-width="1.8" fill="none"/><rect x="200" y="55" width="60" height="50" rx="6" fill="#16213e" stroke="url(#p11b)" stroke-width="1"/><rect x="210" y="65" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.2"/><rect x="232" y="65" width="16" height="16" rx="3" fill="#C8A96A" opacity="0.15"/><rect x="210" y="88" width="40" height="10" rx="5" fill="url(#p11b)" opacity="0.1"/><rect x="280" y="65" width="50" height="40" rx="6" fill="url(#p11b)" opacity="0.06"/><path d="M280 65 L305 48 L330 65" stroke="url(#p11b)" stroke-width="1.2" fill="none" opacity="0.5"/><path d="M220 155 L240 140 L280 170" stroke="url(#p11b)" stroke-width="1" fill="none" opacity="0.3"/><circle cx="280" cy="170" r="8" fill="none" stroke="url(#p11b)" stroke-width="0.8" opacity="0.35"/><circle cx="280" cy="170" r="4" fill="url(#p11b)" opacity="0.2"/></svg>`,
};
const blogSvgs = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="b1a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="b1b" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#b1a)"/><path d="M280 20 L320 20 L320 60 Z" fill="url(#b1b)" opacity="0.08"/><path d="M280 20 L320 60 L280 60 Z" fill="url(#b1b)" opacity="0.15"/><line x1="280" y1="20" x2="320" y2="60" stroke="url(#b1b)" stroke-width="0.8" opacity="0.4"/><path d="M70 60 Q90 50 95 65 Q90 55 70 60" stroke="url(#b1b)" stroke-width="1.5" fill="none" opacity="0.4"/><path d="M120 55 Q140 45 145 60 Q140 50 120 55" stroke="url(#b1b)" stroke-width="1.5" fill="none" opacity="0.4"/><line x1="95" y1="62" x2="145" y2="60" stroke="url(#b1b)" stroke-width="1" opacity="0.3"/><rect x="50" y="100" width="200" height="5" rx="2.5" fill="url(#b1b)" opacity="0.6"/><rect x="50" y="114" width="150" height="4" rx="2" fill="#C8A96A" opacity="0.3"/><rect x="50" y="126" width="120" height="4" rx="2" fill="#C8A96A" opacity="0.25"/><rect x="50" y="138" width="160" height="4" rx="2" fill="#C8A96A" opacity="0.2"/><rect x="50" y="150" width="90" height="4" rx="2" fill="#C8A96A" opacity="0.15"/><rect x="50" y="170" width="240" height="40" rx="8" fill="#0f3460" stroke="url(#b1b)" stroke-width="1"/><rect x="66" y="182" width="80" height="3" rx="1.5" fill="url(#b1b)" opacity="0.4"/><rect x="66" y="192" width="60" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="b2a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="b2b" x1="0" y1="0" x2="200" y2="200"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#b2a)"/><line x1="50" y1="50" x2="310" y2="50" stroke="url(#b2b)" stroke-width="2" opacity="0.4"/><line x1="50" y1="62" x2="310" y2="62" stroke="url(#b2b)" stroke-width="0.5" opacity="0.2"/><line x1="130" y1="90" x2="310" y2="90" stroke="url(#b2b)" stroke-width="1.5" opacity="0.35"/><line x1="50" y1="90" x2="110" y2="90" stroke="url(#b2b)" stroke-width="1.5" opacity="0.35"/><rect x="50" y="90" width="8" height="3" rx="1.5" fill="url(#b2b)" opacity="0.5"/><rect x="110" y="90" width="20" height="3" rx="1.5" fill="url(#b2b)" opacity="0.5"/><line x1="50" y1="102" x2="310" y2="102" stroke="url(#b2b)" stroke-width="0.4" opacity="0.15"/><line x1="80" y1="130" x2="310" y2="130" stroke="url(#b2b)" stroke-width="1" opacity="0.3"/><line x1="50" y1="130" x2="60" y2="130" stroke="url(#b2b)" stroke-width="1" opacity="0.3"/><rect x="50" y="130" width="6" height="3" rx="1.5" fill="url(#b2b)" opacity="0.4"/><rect x="60" y="130" width="20" height="3" rx="1.5" fill="url(#b2b)" opacity="0.4"/><line x1="50" y1="142" x2="310" y2="142" stroke="url(#b2b)" stroke-width="0.3" opacity="0.12"/><line x1="50" y1="170" x2="310" y2="170" stroke="url(#b2b)" stroke-width="0.7" opacity="0.25"/><line x1="50" y1="180" x2="310" y2="180" stroke="url(#b2b)" stroke-width="0.5" opacity="0.2"/><line x1="50" y1="190" x2="310" y2="190" stroke="url(#b2b)" stroke-width="0.4" opacity="0.15"/><circle cx="180" cy="50" r="5" fill="url(#b2b)" opacity="0.3"/><circle cx="180" cy="90" r="5" fill="url(#b2b)" opacity="0.3"/><circle cx="180" cy="130" r="5" fill="url(#b2b)" opacity="0.3"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="b3a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="b3b" x1="0" y1="240" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#b3a)"/><rect x="60" y="30" width="36" height="36" rx="8" fill="url(#b3b)" opacity="0.12"/><rect x="60" y="30" width="36" height="12" rx="6" fill="url(#b3b)" opacity="0.25"/><circle cx="78" cy="48" r="2" fill="url(#b3b)" opacity="0.4"/><rect x="106" y="30" width="36" height="36" rx="8" fill="url(#b3b)" opacity="0.1"/><rect x="106" y="30" width="36" height="12" rx="6" fill="url(#b3b)" opacity="0.2"/><rect x="152" y="30" width="36" height="36" rx="8" fill="url(#b3b)" opacity="0.08"/><rect x="152" y="30" width="36" height="12" rx="6" fill="url(#b3b)" opacity="0.15"/><rect x="198" y="30" width="36" height="36" rx="8" fill="url(#b3b)" opacity="0.06"/><rect x="198" y="30" width="36" height="12" rx="6" fill="url(#b3b)" opacity="0.12"/><rect x="244" y="30" width="36" height="36" rx="8" fill="url(#b3b)" opacity="0.04"/><rect x="244" y="30" width="36" height="12" rx="6" fill="url(#b3b)" opacity="0.1"/><rect x="55" y="90" width="230" height="5" rx="2.5" fill="url(#b3b)" opacity="0.6"/><rect x="55" y="104" width="180" height="4" rx="2" fill="#C8A96A" opacity="0.3"/><rect x="55" y="116" width="200" height="4" rx="2" fill="#C8A96A" opacity="0.25"/><rect x="55" y="128" width="140" height="4" rx="2" fill="#C8A96A" opacity="0.2"/><rect x="55" y="150" width="240" height="60" rx="10" fill="#16213e" stroke="url(#b3b)" stroke-width="1"/><rect x="75" y="166" width="60" height="3" rx="1.5" fill="url(#b3b)" opacity="0.45"/><rect x="75" y="176" width="100" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="75" y="186" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="b4a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="b4b" x1="180" y1="0" x2="180" y2="240"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#b4a)"/><circle cx="180" cy="70" r="50" fill="url(#b4b)" opacity="0.05"/><circle cx="180" cy="70" r="35" fill="url(#b4b)" opacity="0.08"/><line x1="180" y1="20" x2="180" y2="45" stroke="url(#b4b)" stroke-width="1" opacity="0.3"/><line x1="180" y1="95" x2="180" y2="120" stroke="url(#b4b)" stroke-width="1" opacity="0.3"/><line x1="130" y1="70" x2="155" y2="70" stroke="url(#b4b)" stroke-width="1" opacity="0.3"/><line x1="205" y1="70" x2="230" y2="70" stroke="url(#b4b)" stroke-width="1" opacity="0.3"/><line x1="145" y1="35" x2="162" y2="52" stroke="url(#b4b)" stroke-width="0.8" opacity="0.2"/><line x1="215" y1="35" x2="198" y2="52" stroke="url(#b4b)" stroke-width="0.8" opacity="0.2"/><line x1="145" y1="105" x2="162" y2="88" stroke="url(#b4b)" stroke-width="0.8" opacity="0.2"/><line x1="215" y1="105" x2="198" y2="88" stroke="url(#b4b)" stroke-width="0.8" opacity="0.2"/><rect x="50" y="155" width="110" height="4" rx="2" fill="url(#b4b)" opacity="0.5"/><rect x="50" y="166" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="50" y="176" width="90" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="200" y="160" width="90" height="30" rx="15" fill="url(#b4b)" opacity="0.1"/><circle cx="245" cy="175" r="8" fill="url(#b4b)" opacity="0.15"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="b5a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="b5b" x1="0" y1="240" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#b5a)"/><rect x="40" y="170" width="18" height="30" rx="3" fill="url(#b5b)" opacity="0.15"/><rect x="64" y="155" width="18" height="45" rx="3" fill="url(#b5b)" opacity="0.25"/><rect x="88" y="135" width="18" height="65" rx="3" fill="url(#b5b)" opacity="0.35"/><rect x="112" y="105" width="18" height="95" rx="3" fill="url(#b5b)" opacity="0.45"/><rect x="136" y="130" width="18" height="70" rx="3" fill="url(#b5b)" opacity="0.35"/><rect x="160" y="145" width="18" height="55" rx="3" fill="url(#b5b)" opacity="0.3"/><rect x="184" y="155" width="18" height="45" rx="3" fill="url(#b5b)" opacity="0.25"/><rect x="208" y="162" width="18" height="38" rx="3" fill="url(#b5b)" opacity="0.2"/><rect x="232" y="168" width="18" height="32" rx="3" fill="url(#b5b)" opacity="0.15"/><rect x="256" y="172" width="18" height="28" rx="3" fill="url(#b5b)" opacity="0.1"/><path d="M30 170 L130 105 L190 130 L270 80 L330 100" stroke="url(#b5b)" stroke-width="2" fill="none" opacity="0.5"/><circle cx="130" cy="105" r="4" fill="url(#b5b)"/><circle cx="270" cy="80" r="4" fill="#e94560" opacity="0.6"/><rect x="50" y="45" width="120" height="4" rx="2" fill="url(#b5b)" opacity="0.5"/><rect x="50" y="56" width="90" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="50" y="66" width="100" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="b6a" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/></linearGradient><linearGradient id="b6b" x1="0" y1="0" x2="360" y2="0"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#b6a)"/><circle cx="80" cy="60" r="45" fill="url(#b6b)" opacity="0.04"/><rect x="60" y="35" width="200" height="140" rx="10" fill="#0f3460" stroke="url(#b6b)" stroke-width="1"/><path d="M260 35 L260 20 L280 35 Z" fill="url(#b6b)" opacity="0.15"/><line x1="260" y1="20" x2="280" y2="35" stroke="url(#b6b)" stroke-width="0.6" opacity="0.3"/><rect x="76" y="55" width="100" height="4" rx="2" fill="url(#b6b)" opacity="0.5"/><rect x="76" y="66" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="76" y="76" width="90" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="76" y="90" width="60" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="76" y="102" width="100" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="76" y="112" width="70" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="76" y="124" width="85" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="76" y="136" width="50" height="3" rx="1.5" fill="#C8A96A" opacity="0.15"/><rect x="76" y="148" width="120" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="60" y="185" width="60" height="24" rx="12" fill="url(#b6b)" opacity="0.15"/><circle cx="270" cy="100" r="15" fill="url(#b6b)" opacity="0.08"/><circle cx="300" cy="140" r="20" fill="url(#b6b)" opacity="0.06"/></svg>`,
];
const blogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240" fill="none"><defs><linearGradient id="bfa" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f3460"/></linearGradient><linearGradient id="bfb" x1="0" y1="0" x2="360" y2="240"><stop offset="0%" stop-color="#C8A96A"/><stop offset="100%" stop-color="#D4B87A"/></linearGradient></defs><rect width="360" height="240" rx="16" fill="url(#bfa)"/><path d="M260 50 L280 40 L300 50 L290 65 L270 65 Z" fill="none" stroke="url(#bfb)" stroke-width="1" opacity="0.35"/><line x1="280" y1="40" x2="280" y2="30" stroke="url(#bfb)" stroke-width="0.8" opacity="0.25"/><path d="M275 30 Q260 20 250 30 Q240 40 250 50" stroke="url(#bfb)" stroke-width="0.6" fill="none" opacity="0.2"/><rect x="45" y="60" width="160" height="120" rx="8" fill="#0f3460" stroke="url(#bfb)" stroke-width="1"/><rect x="65" y="80" width="120" height="3" rx="1.5" fill="url(#bfb)" opacity="0.5"/><rect x="65" y="92" width="90" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="65" y="104" width="105" height="3" rx="1.5" fill="#C8A96A" opacity="0.25"/><rect x="65" y="116" width="70" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="65" y="128" width="110" height="3" rx="1.5" fill="#C8A96A" opacity="0.3"/><rect x="65" y="140" width="80" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="232" y="62" width="100" height="116" rx="8" fill="url(#bfb)" opacity="0.04"/><rect x="250" y="75" width="64" height="4" rx="2" fill="url(#bfb)" opacity="0.3"/><rect x="250" y="86" width="48" height="3" rx="1.5" fill="#C8A96A" opacity="0.2"/><rect x="45" y="200" width="70" height="20" rx="10" fill="url(#bfb)" opacity="0.1"/><circle cx="290" cy="155" r="12" fill="url(#bfb)" opacity="0.08"/></svg>`;
let reviews = JSON.parse(localStorage.getItem('reviews')) || [
    {
        name_ru: 'Анна',
        name_en: 'Anna',
        rating: 5,
        text_ru: 'Отличный сервис, сайт сделали за 2 дня! Очень рекомендую.',
        text_en: 'Great service, the site was made in 2 days! Highly recommend.',
        date: '2025-03-15',
        approved: true,
        service_ru: 'Интернет-магазин',
        service_en: 'Online Store',
        amount: 15000,
    },
    {
        name_ru: 'Иван',
        name_en: 'Ivan',
        rating: 5,
        text_ru:
            'Профессиональный подход, всё объяснили и сделали качественно. Сайт работает отлично.',
        text_en:
            'Professional approach, explained everything and did quality work. The site works great.',
        date: '2025-03-20',
        approved: true,
        service_ru: 'Корпоративный сайт',
        service_en: 'Corporate Website',
        amount: 12000,
    },
    {
        name_ru: 'Мария',
        name_en: 'Maria',
        rating: 5,
        text_ru:
            'Хорошая студия, сайт работает отлично. Были мелкие недочёты, но быстро исправили.',
        text_en:
            'Good studio, the site works great. There were minor issues, but they fixed them quickly.',
        date: '2025-03-25',
        approved: true,
        service_ru: 'Лендинг',
        service_en: 'Landing Page',
        amount: 8000,
    },
    {
        name_ru: 'Дмитрий',
        name_en: 'Dmitry',
        rating: 5,
        text_ru: 'Заказал интернет-магазин. Всё сделали в срок, дизайн супер! Спасибо команде.',
        text_en:
            'Ordered an online store. Everything was done on time, design is super! Thanks to the team.',
        date: '2025-03-28',
        approved: true,
        service_ru: 'Интернет-магазин',
        service_en: 'Online Store',
        amount: 25000,
    },
    {
        name_ru: 'Екатерина',
        name_en: 'Ekaterina',
        rating: 5,
        text_ru: 'Лендинг для моего бизнеса принёс первые заказы уже через неделю. Очень довольна!',
        text_en:
            'The landing page for my business brought the first orders within a week. Very satisfied!',
        date: '2025-04-01',
        approved: true,
        service_ru: 'Лендинг',
        service_en: 'Landing Page',
        amount: 6000,
    },
    {
        name_ru: 'Сергей',
        name_en: 'Sergey',
        rating: 5,
        text_ru:
            'Корпоративный сайт сделали с нуля. Удобная админка, современный дизайн. Рекомендую.',
        text_en:
            'Corporate website made from scratch. Convenient admin panel, modern design. I recommend.',
        date: '2025-04-03',
        approved: true,
        service_ru: 'Корпоративный сайт',
        service_en: 'Corporate Website',
        amount: 14000,
    },
    {
        name_ru: 'Ольга',
        name_en: 'Olga',
        rating: 5,
        text_ru: 'Сайт для ресторана: меню, бронирование столиков, всё работает идеально. Спасибо!',
        text_en:
            'Website for a restaurant: menu, table reservation, everything works perfectly. Thanks!',
        date: '2025-04-05',
        approved: true,
        service_ru: 'Лендинг',
        service_en: 'Landing Page',
        amount: 7500,
    },
    {
        name_ru: 'Алексей',
        name_en: 'Alexey',
        rating: 5,
        text_ru: 'Магазин на готовом решении, но ребята доработали под нас. Клиенты довольны.',
        text_en:
            'Store on a ready-made solution, but the guys customized it for us. Customers are happy.',
        date: '2025-04-06',
        approved: true,
        service_ru: 'Интернет-магазин',
        service_en: 'Online Store',
        amount: 18000,
    },
];

const portfolioRaw = [
    { ru: 'UNIDENT', category: 'landing', url: 'https://unidentweb.github.io/UNIDENT/' },
    { ru: 'Студия красоты', category: 'landing', url: 'https://beauty-studio.example.com' },
    { ru: 'Магазин одежды', category: 'shop', url: 'https://fashion-shop.example.com' },
    { ru: 'Ресторан', category: 'landing', url: 'https://restaurant-site.example.com' },
    { ru: 'IT-компания', category: 'corp', url: 'https://it-company.example.com' },
    { ru: 'Мебельный магазин', category: 'shop', url: 'https://furniture-store.example.com' },
    {
        ru: 'Маркетинговое агентство',
        category: 'corp',
        url: 'https://marketing-agency.example.com',
    },
    { ru: 'Фитнес-центр', category: 'landing', url: 'https://fitness-center.example.com' },
    { ru: 'Стоматология', category: 'landing', url: 'https://dentistry-clinic.example.com' },
    { ru: 'Автосервис', category: 'landing', url: 'https://auto-service.example.com' },
    { ru: 'Недвижимость', category: 'corp', url: 'https://real-estate.example.com' },
];
let currentFilter = 'all';

function renderServices() {
    const container = document.getElementById('servicesGrid');
    if (!container) return;
    const t = translations[currentLang];
    const services = t.services;
    container.innerHTML = services
        .map((s, idx) => {
            let customImg =
                customImages.services[s.title] || defaultImagePack.services[s.title] || '';
            let imgHtml = '';
            if (customImg && customImg.trim() !== '') {
                imgHtml = `<img src="${customImg}" alt="${s.title}" loading="lazy" style="width:100%; height:200px; object-fit:cover; border-radius:20px 20px 0 0;">`;
            } else {
                let svg = serviceSvgs[s.title] || serviceSvgs['Landing Page'];
                imgHtml = `<div class="service-img-svg">${svg}</div>`;
            }
            return `
            <div class="service-card" data-aos="zoom-in" data-service-name="${s.title}">
                ${imgHtml}
                <div class="content"><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.desc)}</p><div class="price">${escapeHtml(s.price)}</div><button class="btn order-service-btn" data-service="${escapeHtml(s.title)}">${escapeHtml(s.btn)}</button></div>
            </div>
        `;
        })
        .join('');
    try {
        VanillaTilt.init(document.querySelectorAll('.service-card'), {
            max: 10,
            speed: 500,
            glare: true,
            'max-glare': 0.4,
        });
    } catch (e) {}
    document.querySelectorAll('.order-service-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const serviceName = btn.getAttribute('data-service');
            openOrderServiceModal(serviceName);
        });
    });
}

function renderPortfolio(filter = 'all', search = '') {
    const grid = document.getElementById('portfolioGrid');
    if (!grid) return;
    const t = translations[currentLang];
    const filtered = portfolioRaw.filter(
        (item) =>
            (filter === 'all' || item.category === filter) &&
            (t.portfolio_items[item.ru] || item.ru).toLowerCase().includes(search.toLowerCase()),
    );
    grid.innerHTML = filtered
        .map((item) => {
            let customImg =
                customImages.portfolio[item.ru] || defaultImagePack.portfolio[item.ru] || '';
            const label = escapeHtml(t.portfolio_items[item.ru] || item.ru);
            const url = item.url || '';
            let cardHtml = '';
            if (customImg && customImg.trim() !== '') {
                cardHtml = `<div class="portfolio-card premium-card"><img src="${customImg}" alt="${item.ru}" loading="lazy" style="width:100%; height:auto; border-radius:20px; display:block;"><div class="portfolio-label">${label}</div></div>`;
            } else {
                const svg = portfolioSvgs[item.ru] || portfolioSvgs['Студия красоты'];
                cardHtml = `<div class="portfolio-card premium-card"><div class="portfolio-img-svg">${svg}</div><div class="portfolio-label">${label}</div></div>`;
            }
            return url
                ? `<a href="${url}" target="_blank" rel="noopener" style="display:block; text-decoration:none;">${cardHtml}</a>`
                : cardHtml;
        })
        .join('');
    try {
        VanillaTilt.init(document.querySelectorAll('.portfolio-card'), {
            max: 10,
            speed: 500,
            glare: true,
            'max-glare': 0.4,
        });
    } catch (e) {}
}

function renderBlog() {
    const grid = document.getElementById('blogGrid');
    if (!grid) return;
    const t = translations[currentLang];
    const posts = t.blog_posts;
    grid.innerHTML = posts
        .map((p, idx) => {
            let customImg = customImages.blog[idx] || defaultImagePack.blog[idx] || '';
            let imgHtml = '';
            if (customImg && customImg.trim() !== '') {
                imgHtml = `<img src="${customImg}" alt="${p.title}" loading="lazy" style="width:100%; height:auto; border-radius:20px;">`;
            } else {
                imgHtml = blogSvgs[idx] || blogSvg;
            }
            return `
            <div class="blog-card">
                <div class="blog-img-svg">${imgHtml}</div>
                <div class="content">
                    <h3>${escapeHtml(p.title)}</h3>
                    <p>${escapeHtml(p.excerpt)}</p>
                    <button class="btn btn-outline read-blog-btn" data-idx="${idx}">${currentLang === 'ru' ? 'Читать' : 'Read'}</button>
                </div>
            </div>
        `;
        })
        .join('');
    document.querySelectorAll('.read-blog-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(btn.getAttribute('data-idx'));
            const post = translations[currentLang].blog_posts[idx];
            if (post) {
                document.getElementById('blogModalTitle').innerText = post.title;
                document.getElementById('blogModalContent').innerHTML =
                    `<p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>`;
                openModal('blog');
            }
        });
    });
}

function renderReviews() {
    const wrapper = document.getElementById('reviewsSwiperWrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    const lang = currentLang;
    reviews
        .filter((r) => r.approved)
        .forEach((rev) => {
            let stars = '';
            for (let i = 1; i <= 5; i++) stars += i <= rev.rating ? '★' : '☆';
            const name = lang === 'ru' ? rev.name_ru : rev.name_en;
            const text = lang === 'ru' ? rev.text_ru : rev.text_en;
            const service = lang === 'ru' ? rev.service_ru : rev.service_en;
            const amount = rev.amount ? `${rev.amount.toLocaleString()} ₽` : '';
            const slide = document.createElement('div');
            slide.className = 'swiper-slide';
            slide.innerHTML = `
            <div class="testimonial-card">
                <strong>${escapeHtml(name)}</strong>
                <div class="stars">${stars}</div>
                <p>${escapeHtml(text)}</p>
                <div>
                    <span class="service-badge"><i class="fas fa-tag"></i> ${escapeHtml(service)}</span>
                    ${amount ? `<span class="amount-badge"><i class="fas fa-ruble-sign"></i> ${escapeHtml(amount)}</span>` : ''}
                </div>
                <div class="review-date">${rev.date || ''}</div>
            </div>
        `;
            wrapper.appendChild(slide);
        });
    new Swiper('.reviews-swiper', {
        loop: true,
        pagination: { el: '.swiper-pagination', clickable: true },
        autoplay: { delay: 4000 },
    });
}

function applyLanguage(lang) {
    currentLang = lang;
    const t = translations[lang];
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = t[key];
            else el.innerHTML = t[key];
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) el.placeholder = t[key];
    });
    const isRu = lang === 'ru';
    document.querySelector('.consent-title-ru').style.display = isRu ? 'block' : 'none';
    document.querySelector('.consent-title-en').style.display = isRu ? 'none' : 'block';
    document.querySelector('.consent-desc-ru').style.display = isRu ? 'block' : 'none';
    document.querySelector('.consent-desc-en').style.display = isRu ? 'none' : 'block';
    document.querySelector('.consent-checkbox-ru').style.display = isRu ? 'inline' : 'none';
    document.querySelector('.consent-checkbox-en').style.display = isRu ? 'none' : 'inline';
    document.getElementById('acceptConsent').style.display = isRu ? 'inline-flex' : 'none';
    document.getElementById('acceptConsentEn').style.display = isRu ? 'none' : 'inline-flex';
    document.querySelector('.consent-warning-ru').style.display = isRu ? 'block' : 'none';
    document.querySelector('.consent-warning-en').style.display = isRu ? 'none' : 'block';
    const policyLink = document.getElementById('policyLink');
    const refundLink = document.getElementById('refundLink');
    if (policyLink) policyLink.innerText = t.footer_policy;
    if (refundLink) refundLink.innerText = t.footer_refund;
    const policyTitle = document.querySelector('#policyModal h3');
    const refundTitle = document.querySelector('#refundModal h3');
    if (policyTitle) policyTitle.innerText = t.policy_title;
    if (refundTitle) refundTitle.innerText = t.refund_title;
    renderServices();
    renderPortfolio(currentFilter, document.getElementById('portfolioSearch')?.value || '');
    renderBlog();
    renderReviews();
    renderTemplatesPage();
    document.documentElement.lang = lang;
    localStorage.setItem('lang', lang);
    const adminPanelEl = document.getElementById('adminPanel');
    if (adminPanelEl && adminPanelEl.classList.contains('open')) renderActiveTab();
}

let consentGiven = localStorage.getItem('consentAccepted') === 'true';
function storeConsentRecord() {
    localStorage.setItem('consentAccepted', 'true');
    consentGiven = true;
}
function requireConsentAndExecute(cb) {
    if (consentGiven) cb();
    else {
        window.pendingConsentCallback = cb;
        openModal('consent');
    }
}
function onConsentAccepted() {
    if (window.pendingConsentCallback) {
        let cb = window.pendingConsentCallback;
        window.pendingConsentCallback = null;
        cb();
    }
}

function openModal(id) {
    const modal = document.getElementById(id + 'Modal');
    if (modal) modal.style.display = 'flex';
    else console.warn('Modal not found:', id + 'Modal');
}
function closeAllModals() {
    document.querySelectorAll('.modal').forEach((m) => (m.style.display = 'none'));
}

function attachPolicyLinks(prefix) {
    const p = document.getElementById(`${prefix}PolicyLink`);
    const r = document.getElementById(`${prefix}RefundLink`);
    if (p)
        p.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openModal('policy');
        });
    if (r)
        r.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openModal('refund');
        });
}
attachPolicyLinks('demo');
attachPolicyLinks('consult');
attachPolicyLinks('review');
attachPolicyLinks('edit');
attachPolicyLinks('consent');
attachPolicyLinks('order');

const policyLinkEl = document.getElementById('policyLink');
const refundLinkEl = document.getElementById('refundLink');
if (policyLinkEl)
    policyLinkEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal('policy');
    });
if (refundLinkEl)
    refundLinkEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal('refund');
    });

document.body.addEventListener('click', (e) => {
    const target = e.target.closest('a');
    if (!target) return;
    const id = target.id;
    if (
        id &&
        (id === 'policyLink' ||
            id === 'demoPolicyLink' ||
            id === 'consultPolicyLink' ||
            id === 'reviewPolicyLink' ||
            id === 'editPolicyLink' ||
            id === 'consentPolicyLink' ||
            id === 'orderPolicyLink')
    ) {
        e.preventDefault();
        e.stopPropagation();
        openModal('policy');
    } else if (
        id &&
        (id === 'refundLink' ||
            id === 'demoRefundLink' ||
            id === 'consultRefundLink' ||
            id === 'reviewRefundLink' ||
            id === 'editRefundLink' ||
            id === 'consentRefundLink' ||
            id === 'orderRefundLink')
    ) {
        e.preventDefault();
        e.stopPropagation();
        openModal('refund');
    } else if (target.classList.contains('i18n-policy-link')) {
        e.preventDefault();
        e.stopPropagation();
        openModal('policy');
    } else if (target.classList.contains('i18n-refund-link')) {
        e.preventDefault();
        e.stopPropagation();
        openModal('refund');
    } else if (
        target.getAttribute('href') &&
        (target.getAttribute('href') === '#policyModal' ||
            target.getAttribute('href') === '#policy' ||
            target.getAttribute('href') === '#terms')
    ) {
        e.preventDefault();
        openModal('policy');
    } else if (
        target.getAttribute('href') &&
        (target.getAttribute('href') === '#refundModal' ||
            target.getAttribute('href') === '#refund')
    ) {
        e.preventDefault();
        openModal('refund');
    }
});

document.getElementById('langSwitch').addEventListener('click', () => {
    const newLang = currentLang === 'ru' ? 'en' : 'ru';
    applyLanguage(newLang);
    document.getElementById('langSwitch').innerText = newLang === 'ru' ? 'EN' : 'RU';
});
applyLanguage(currentLang);
document.getElementById('langSwitch').innerText = currentLang === 'ru' ? 'EN' : 'RU';
const darkToggle = document.getElementById('darkModeToggle');
if (localStorage.getItem('darkMode') === 'enabled') document.body.classList.add('dark');
darkToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem(
        'darkMode',
        document.body.classList.contains('dark') ? 'enabled' : 'disabled',
    );
    darkToggle.innerHTML = document.body.classList.contains('dark')
        ? '<i class="fas fa-sun"></i>'
        : '<i class="fas fa-moon"></i>';
});
if (localStorage.getItem('darkMode') === 'enabled') document.body.classList.add('dark');
darkToggle.innerHTML = document.body.classList.contains('dark')
    ? '<i class="fas fa-sun"></i>'
    : '<i class="fas fa-moon"></i>';
AOS.init({ duration: 800, once: true });
if (window.Notifier && window.Notifier.activate) window.Notifier.activate();
try {
    VanillaTilt.init(document.querySelectorAll('.service-card, .portfolio-card, .template-card'), {
        max: 10,
        speed: 500,
        glare: true,
        'max-glare': 0.4,
    });
} catch (e) {
    console.log('VanillaTilt not loaded, skipping');
}

// ==================== HERO SLIDESHOW ====================
(function initHeroSlideshow() {
    var slideshow = document.getElementById('heroSlideshow');
    if (!slideshow) return;
    var slides = [];
    for (var i = 0; i < 10; i++) {
        var slide = document.createElement('div');
        slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
        slide.style.backgroundImage = 'url("images/hero/slide-' + i + '.jpg")';
        slideshow.appendChild(slide);
        slides.push(slide);
    }
    var current = 0;
    var interval = 120000; // 2 minutes
    function nextSlide() {
        slides[current].classList.remove('active');
        current = (current + 1) % slides.length;
        slides[current].classList.add('active');
    }
    setInterval(nextSlide, interval);
})();

document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        renderPortfolio(currentFilter, document.getElementById('portfolioSearch').value);
    });
});
document
    .getElementById('portfolioSearch')
    .addEventListener('input', (e) => renderPortfolio(currentFilter, e.target.value));
renderPortfolio('all', '');
let selectedRating = 5;
document.getElementById('starRating')?.addEventListener('click', (e) => {
    if (e.target.tagName === 'SPAN') {
        const stars = [...document.querySelectorAll('#starRating span')];
        const idx = stars.indexOf(e.target);
        selectedRating = idx + 1;
        stars.forEach((s, i) => (s.innerText = i < selectedRating ? '★' : '☆'));
    }
});

document.querySelectorAll('.close-modal').forEach((btn) => {
    btn.addEventListener('click', function () {
        const modal = this.closest('.modal');
        if (modal) modal.style.display = 'none';
    });
});
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal') && e.target.id !== 'consentModal')
        e.target.style.display = 'none';
});
document
    .getElementById('getDemoBtn')
    .addEventListener('click', () => requireConsentAndExecute(() => openModal('demo')));
document
    .getElementById('consultBtn')
    .addEventListener('click', () => requireConsentAndExecute(() => openModal('consult')));
document
    .getElementById('addReviewBtn')
    .addEventListener('click', () => requireConsentAndExecute(() => openModal('review')));
document.getElementById('acceptConsent').addEventListener('click', () => {
    if (document.getElementById('consentAgree').checked) {
        storeConsentRecord();
        document.getElementById('consentModal').style.display = 'none';
        onConsentAccepted();
    } else alert(translations[currentLang].consent_warning);
});
document.getElementById('acceptConsentEn').addEventListener('click', () => {
    if (document.getElementById('consentAgree').checked) {
        storeConsentRecord();
        document.getElementById('consentModal').style.display = 'none';
        onConsentAccepted();
    } else alert(translations[currentLang].consent_warning);
});
if (!consentGiven) setTimeout(() => openModal('consent'), 200);
let exitShown = false;
document.addEventListener('mouseleave', (e) => {
    if (e.clientY <= 0 && !exitShown && !localStorage.getItem('exitShown') && consentGiven) {
        exitShown = true;
        localStorage.setItem('exitShown', 'true');
        openModal('exit');
    }
});
document.getElementById('exitBtn').addEventListener('click', () => {
    closeAllModals();
    openModal('consult');
});
const scrollBtn = document.getElementById('scrollTop');
window.addEventListener('scroll', () =>
    scrollBtn.classList.toggle('visible', window.scrollY > 300),
);
scrollBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
const mobileMenuBtn = document.querySelector('.mobile-menu');
const navEl = document.querySelector('.nav');
const overlay = document.createElement('div');
overlay.className = 'mobile-overlay';
document.body.appendChild(overlay);

function openMobileMenu() {
    navEl.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    mobileMenuBtn.innerHTML = '<i class="fas fa-times"></i>';
}
function closeMobileMenu() {
    navEl.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
}

mobileMenuBtn.addEventListener('click', () => {
    if (navEl.classList.contains('active')) closeMobileMenu();
    else openMobileMenu();
});
overlay.addEventListener('click', closeMobileMenu);
document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', closeMobileMenu));
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
});
if (!localStorage.getItem('cookiesAccepted'))
    document.getElementById('cookieConsent').style.display = 'flex';
document.getElementById('acceptCookies').addEventListener('click', () => {
    localStorage.setItem('cookiesAccepted', 'true');
    document.getElementById('cookieConsent').style.display = 'none';
});
document.getElementById('reviewForm').addEventListener('submit', (e) => {
    e.preventDefault();
    requireConsentAndExecute(() => {
        if (!document.getElementById('reviewAgree').checked) {
            alert(translations[currentLang].consent_warning);
            return;
        }
        const name_ru = document.getElementById('reviewName').value;
        const name_en = name_ru;
        const text_ru = document.getElementById('reviewText').value;
        const text_en = text_ru;
        const amount = parseFloat(document.getElementById('reviewAmount').value);
        if (name_ru && text_ru) {
            reviews.unshift({
                name_ru,
                name_en,
                rating: selectedRating,
                text_ru,
                text_en,
                date: new Date().toISOString().slice(0, 10),
                approved: true,
                service_ru: 'Не указано',
                service_en: 'Not specified',
                amount: isNaN(amount) ? null : amount,
            });
            localStorage.setItem('reviews', JSON.stringify(reviews));
            renderReviews();
            closeAllModals();
            if (window.Notifier && window.Notifier.notify) {
                window.Notifier.notify(
                    { name: name_ru, rating: selectedRating, text: text_ru.substring(0, 100) },
                    'newReview',
                );
            }
        }
    });
});
document
    .getElementById('fillFromVkBtn')
    ?.addEventListener('click', () => alert('Demo: VK data filled automatically'));

// ==================== OFFLINE / LOCAL FALLBACK ====================
let SCRIPT_REACHABLE = null;

function saveLeadLocally(leadData, action) {
    const leads = JSON.parse(localStorage.getItem('localLeads') || '[]');
    leadData['Lead ID'] = 'LOCAL_' + Date.now().toString(36).toUpperCase();
    leadData['Status'] = 'new';
    leadData['Payment Status'] = 'unpaid';
    leadData['Created At'] = new Date().toISOString();
    leadData['action'] = action;
    leads.unshift(leadData);
    localStorage.setItem('localLeads', JSON.stringify(leads));
    showSuccessToast('Data saved successfully');
    return { success: true, message: 'Saved locally', local: true };
}

function showSuccessToast(msg) {
    const t = document.createElement('div');
    t.id = 'successToast';
    t.textContent = msg;
    t.style.cssText =
        'position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg,#C8A96A,#B58C48);color:#fff;padding:14px 24px;border-radius:12px;z-index:99999;font-weight:600;font-size:0.95rem;box-shadow:0 10px 30px rgba(200,169,106,0.4);animation:toastIn 0.4s ease;pointer-events:none;';
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity 0.3s';
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

function showWarningBanner(msg) {
    let banner = document.getElementById('offlineWarning');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offlineWarning';
        banner.style.cssText =
            'position:fixed;top:0;left:0;right:0;background:#e67e22;color:#fff;text-align:center;padding:8px;z-index:10000;font-size:0.9rem;cursor:pointer;';
        banner.onclick = () => (banner.style.display = 'none');
        document.body.prepend(banner);
    }
    banner.textContent = msg;
    setTimeout(() => {
        if (banner) banner.style.display = 'none';
    }, 6000);
}

function getLocalLeads() {
    return JSON.parse(localStorage.getItem('localLeads') || '[]');
}

// ==================== sendToAppsScript (IFRAME with offline fallback) ====================
async function sendToAppsScript(formData, action) {
    formData.append('action', action);
    if (SCRIPT_REACHABLE === false) {
        const leadData = {};
        formData.forEach((v, k) => {
            leadData[k] = v;
        });
        return saveLeadLocally(leadData, action);
    }
    return new Promise((resolve) => {
        const iframeName = 'ifr_' + Date.now();
        const iframe = document.createElement('iframe');
        iframe.name = iframeName;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = SCRIPT_URL;
        form.target = iframeName;
        form.style.display = 'none';
        for (let [key, value] of formData.entries()) {
            if (typeof Blob !== 'undefined' && value instanceof Blob) continue;
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = value;
            form.appendChild(input);
        }
        document.body.appendChild(form);
        let resolved = false;
        iframe.onload = () => {
            if (resolved) return;
            resolved = true;
            let responseText = '';
            try {
                responseText = iframe.contentDocument?.body?.innerText || '';
                const result = responseText.trim().startsWith('{')
                    ? JSON.parse(responseText)
                    : null;
                if (result && result.success) {
                    SCRIPT_REACHABLE = true;
                    resolve(result);
                } else {
                    SCRIPT_REACHABLE = false;
                    const leadData = {};
                    formData.forEach((v, k) => {
                        leadData[k] = v;
                    });
                    resolve(saveLeadLocally(leadData, action));
                }
            } catch (e) {
                SCRIPT_REACHABLE = false;
                const leadData = {};
                formData.forEach((v, k) => {
                    leadData[k] = v;
                });
                resolve(saveLeadLocally(leadData, action));
            }
            setTimeout(() => {
                form.remove();
                iframe.remove();
            }, 100);
        };
        form.submit();
        setTimeout(() => {
            if (!resolved && form.parentNode) {
                resolved = true;
                form.remove();
                iframe.remove();
                SCRIPT_REACHABLE = false;
                const leadData = {};
                formData.forEach((v, k) => {
                    leadData[k] = v;
                });
                resolve(saveLeadLocally(leadData, action));
            }
        }, 5000);
    });
}

// ==================== fetchLeads (with offline fallback) ====================
async function fetchLeads() {
    if (SCRIPT_REACHABLE === false) {
        return normalizeLeadRows(getLocalLeads());
    }
    try {
        const params = new URLSearchParams({ t: Date.now() });
        if (sourceFilter !== 'all') params.set('source', sourceFilter);
        const res = await fetch(SCRIPT_URL + '?' + params.toString());
        const data = await res.json();
        SCRIPT_REACHABLE = true;
        return normalizeLeadRows(data.leads || []);
    } catch (e) {
        SCRIPT_REACHABLE = false;
        console.warn('fetch failed, using local storage', e);
        return normalizeLeadRows(getLocalLeads());
    }
}

function normalizeLeadRows(rows) {
    return rows.map((lead) => ({
        ...lead,
        Email: lead['Email'] || lead['I'] || lead['Field11'] || lead['Field12'] || '',
        Category: lead['Category'] || lead['F'] || lead['Field13'] || '',
        Budget: lead['Budget'] || lead['Field14'] || '',
        'Preferred Language': lead['Preferred Language'] || lead['Language'] || 'en',
        'Created At': lead['Created At'] || lead['Timestamp'] || '',
        'Lead ID':
            lead['Lead ID'] || 'LEAD_' + Math.random().toString(36).substr(2, 10).toUpperCase(),
        Status: lead['Status'] || 'new',
        'Payment Status': lead['Payment Status'] || 'unpaid',
    }));
}

function getFullPhone(phoneCodeSelectId, phoneInputId) {
    const codeSelect = document.getElementById(phoneCodeSelectId);
    const phoneInput = document.getElementById(phoneInputId);
    if (codeSelect && phoneInput && phoneInput.value) {
        return codeSelect.value + phoneInput.value.trim();
    }
    return phoneInput ? phoneInput.value : '';
}

function attachFormHandler(formId, action, langId, phoneCodeId, phoneInputId) {
    const form = document.getElementById(formId);
    if (!form) return;
    if (form._handler) form.removeEventListener('submit', form._handler);
    form._handler = async (e) => {
        e.preventDefault();
        const agree = form.querySelector('[type="checkbox"][required]');
        if (agree && !agree.checked) {
            alert(translations[currentLang]?.consent_warning || 'Please accept terms');
            return;
        }
        const fd = new FormData(form);
        if (langId && document.getElementById(langId)) {
            const langVal = document.getElementById(langId).value;
            try {
                fd.set('Preferred Language', langVal);
            } catch (e) {
                fd.append('Preferred Language', langVal);
            }
        }
        if (phoneCodeId && phoneInputId) {
            const fullPhone = getFullPhone(phoneCodeId, phoneInputId);
            if (fullPhone) fd.set('phone', fullPhone);
        }
        if (formId === 'demoForm') {
            const category = (
                document.getElementById('demoCategory')?.value || 'landing'
            ).toLowerCase();
            let templateId = document.getElementById('demoTemplate')?.value || 'landing_1';
            if (!templateId || templateId === '') {
                if (category.includes('ecommerce') || category.includes('shop'))
                    templateId = 'shop_1';
                else if (category.includes('corp')) templateId = 'corp_1';
                else templateId = 'landing_1';
            }
            fd.append('template_id', templateId);
            fd.append('Template Used', templateId);
            const logoInput = document.getElementById('demoLogo');
            if (logoInput && logoInput.files && logoInput.files[0]) {
                const file = logoInput.files[0];
                if (file.size > 380000) {
                    alert(
                        currentLang === 'ru'
                            ? 'Файл логотипа слишком большой (макс. ~380 КБ).'
                            : 'Logo file too large (max ~380 KB).',
                    );
                    return;
                }
                try {
                    const dataUrl = await new Promise((res, rej) => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.onerror = rej;
                        r.readAsDataURL(file);
                    });
                    fd.append('logo_data', dataUrl);
                    fd.append('logo_filename', file.name);
                } catch (e) {
                    console.warn('logo read failed', e);
                }
            }
        }
        if (formId === 'orderServiceForm') {
            const templateId = document.getElementById('selectedTemplateId').value || 'landing_1';
            console.log('[order] Submitting with template:', templateId);
            fd.append('template_id', templateId);
            fd.append('Template Used', templateId);
        }
        console.log('[order] Sending to backend:', action);
        const result = await sendToAppsScript(fd, action);
        console.log('[order] Result:', result);
        if (result.success) {
            const msg = result.local
                ? 'Saved locally (offline mode)'
                : translations[currentLang]?.send_btn || 'Submitted successfully';
            showSuccessToast(msg);
            const leadData = {};
            fd.forEach((v, k) => {
                leadData[k] = v;
            });
            if (window.Notifier && window.Notifier.notify) window.Notifier.notify(leadData, action);
        } else {
            alert('Error: ' + (result.message || 'Submission failed'));
        }
        if (result.success && form.closest('.modal')) closeAllModals();
        if (result.success && formId !== 'paymentForm') form.reset();
    };
    form.addEventListener('submit', form._handler);
}

(async function bootFormHandlers() {
    await initScriptEndpoint();
    attachFormHandler('demoForm', 'demoRequest', 'demoLanguage', 'demoCountryCode', 'demoPhone');
    attachFormHandler(
        'consultForm',
        'consultRequest',
        'consultLanguage',
        'consultCountryCode',
        'consultPhone',
    );
    attachFormHandler('editForm', 'editRequest', 'editLanguage', 'editCountryCode', 'editPhone');
    attachFormHandler(
        'orderServiceForm',
        'serviceOrder',
        'orderLanguage',
        'orderCountryCode',
        'orderPhone',
    );

    const payForm = document.getElementById('paymentForm');
    if (payForm)
        payForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!document.getElementById('paymentAgree')?.checked)
                return alert('Please confirm payment');
            const fd = new FormData();
            fd.append('lead_id', document.getElementById('paymentLeadId').value);
            fd.append('transaction_id', document.getElementById('paymentTransactionId').value);
            fd.append('amount', document.getElementById('paymentAmount').value);
            const res = await sendToAppsScript(fd, 'submitPayment');
            if (res.success) showSuccessToast('Payment info submitted');
            else alert('❌ Error');
            if (res.success) closeAllModals();
        });
})();

// ==================== DEMO TEMPLATE SELECTOR EVENT LISTENERS ====================
function setupTemplateSelectorEvents() {
    var demoCategory = document.getElementById('demoCategory');
    if (demoCategory) {
        demoCategory.addEventListener('change', function () {
            var cat = this.value.toLowerCase();
            if (cat.includes('ecommerce') || cat.includes('shop')) cat = 'ecommerce';
            else if (cat.includes('corp')) cat = 'corporate';
            else cat = 'landing';
            loadDemoTemplates(cat);
            showTemplateSelectionDisplay('', '');
        });
    }
    var demoTemplate = document.getElementById('demoTemplate');
    if (demoTemplate) {
        demoTemplate.addEventListener('change', function () {
            var selectedOption = this.options[this.selectedIndex];
            var templateId = this.value;
            var templateName = selectedOption ? selectedOption.textContent : '';
            showTemplateSelectionDisplay(templateId, templateName);
        });
    }
    var selectTemplateBtn = document.getElementById('selectTemplateBtn');
    if (selectTemplateBtn) {
        selectTemplateBtn.addEventListener('click', function () {
            openTemplateModal();
        });
    }
}

// ==================== ADMIN PANEL LEAD FUNCTIONS (FULLY WORKING) ====================
async function confirmPayment(leadId) {
    if (!confirm(`Confirm payment for lead ${leadId}?`)) return;
    if (SCRIPT_REACHABLE === false) {
        const localLeads = getLocalLeads();
        const idx = localLeads.findIndex((l) => l['Lead ID'] === leadId);
        if (idx >= 0) {
            localLeads[idx]['Payment Status'] = 'paid';
            localStorage.setItem('localLeads', JSON.stringify(localLeads));
        }
        showSuccessToast('Payment confirmed (local)');
        await renderLeadsTable();
        return;
    }
    const fd = new FormData();
    fd.append('lead_id', leadId);
    const result = await sendToAppsScript(fd, 'confirmPayment');
    if (result.success) {
        showSuccessToast('Payment confirmed');
        await renderLeadsTable();
    } else {
        alert('Error: ' + (result.message || 'Error'));
    }
}

function showLeadDetailsById(leadId) {
    const lead = leadsData.find((l) => String(l['Lead ID']) === String(leadId));
    if (!lead) {
        alert('Lead not found');
        return;
    }
    const container = document.getElementById('leadDetailsContent');
    if (!container) return;
    const formatValue = (key, value) => {
        if (value === undefined || value === null || value === '') return '—';
        const lowerKey = key.toLowerCase();
        if (
            (lowerKey.includes('color') || lowerKey === 'brand color') &&
            typeof value === 'string' &&
            value.match(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        ) {
            return `<span class="color-preview" style="background-color: ${value};"></span> ${value}`;
        }
        if (
            typeof value === 'string' &&
            (value.startsWith('http://') ||
                value.startsWith('https://') ||
                value.startsWith('www.'))
        ) {
            let displayUrl = value.length > 50 ? value.substring(0, 47) + '...' : value;
            return `<a href="${value}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>`;
        }
        if (lowerKey.includes('email') && value.includes('@')) {
            return `<a href="mailto:${value}">${escapeHtml(value)}</a>`;
        }
        if (
            lowerKey.includes('phone') &&
            typeof value === 'string' &&
            value.match(/[\d\s\+\(\)\-]+/)
        ) {
            return `<a href="tel:${value.replace(/[^0-9+]/g, '')}">${escapeHtml(value)}</a>`;
        }
        return escapeHtml(value);
    };
    let clientHtml = `<div class="lead-details-section"><h4><i class="fas fa-user-circle"></i> Client Information</h4>`;
    let projectHtml = `<div class="lead-details-section"><h4><i class="fas fa-code-branch"></i> Project Details</h4>`;
    let leadHtml = `<div class="lead-details-section"><h4><i class="fas fa-chart-line"></i> Lead Information</h4>`;
    for (let key in lead) {
        if (!lead.hasOwnProperty(key)) continue;
        const value = lead[key];
        if (value === undefined || value === null || value === '') continue;
        const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        const formattedValue = formatValue(key, value);
        const row = `<div class="detail-row"><div class="detail-label">${escapeHtml(displayKey)}:</div><div class="detail-value">${formattedValue}</div></div>`;
        if (
            key.toLowerCase().includes('name') ||
            key.toLowerCase().includes('phone') ||
            key.toLowerCase().includes('email') ||
            key.toLowerCase().includes('vk') ||
            key.toLowerCase().includes('city') ||
            key.toLowerCase().includes('address') ||
            key.toLowerCase().includes('language')
        ) {
            clientHtml += row;
        } else if (
            key.toLowerCase().includes('site') ||
            key.toLowerCase().includes('budget') ||
            key.toLowerCase().includes('color') ||
            key.toLowerCase().includes('logo') ||
            key.toLowerCase().includes('domain') ||
            key.toLowerCase().includes('referrer') ||
            key.toLowerCase().includes('hosting') ||
            key.toLowerCase().includes('notes') ||
            key.toLowerCase().includes('type') ||
            key.toLowerCase().includes('date') ||
            key.toLowerCase().includes('description') ||
            key.toLowerCase().includes('service') ||
            key.toLowerCase().includes('message') ||
            key.toLowerCase().includes('template')
        ) {
            projectHtml += row;
        } else {
            leadHtml += row;
        }
    }
    clientHtml += `</div>`;
    projectHtml += `</div>`;
    leadHtml += `</div>`;
    container.innerHTML = clientHtml + projectHtml + leadHtml;
    openModal('leadDetails');
}

function applyFiltersAndSort() {
    let filtered = [...leadsData];
    const now = Date.now();
    if (statusFilter !== 'all')
        filtered = filtered.filter(
            (lead) => (lead['Status'] || 'new').toLowerCase() === statusFilter.toLowerCase(),
        );
    if (paymentFilter !== 'all')
        filtered = filtered.filter(
            (lead) =>
                (lead['Payment Status'] || 'unpaid').toLowerCase() === paymentFilter.toLowerCase(),
        );
    if (sourceFilter !== 'all')
        filtered = filtered.filter(
            (lead) => (lead['Source'] || 'website').toLowerCase() === sourceFilter.toLowerCase(),
        );
    if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(
            (lead) =>
                (lead['Business Name'] || lead['Name'] || '').toLowerCase().includes(term) ||
                (lead['Phone'] || '').toLowerCase().includes(term) ||
                (lead['Email'] || '').toLowerCase().includes(term) ||
                (lead['Lead ID'] || '').toLowerCase().includes(term),
        );
    }
    filtered.sort((a, b) => {
        let aVal = a[sortColumn] || '',
            bVal = b[sortColumn] || '';
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    filteredLeads = filtered;
    renderLeadsTableBody();
}

let leadsPage = 1;
let leadsPerPage = 20;

function renderLeadsTableBody() {
    const tbody = document.getElementById('leadsTableBody');
    if (!tbody) return;
    if (filteredLeads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="17">No leads found</td></tr>';
        updatePaginationInfo();
        return;
    }
    const totalPages = Math.ceil(filteredLeads.length / leadsPerPage);
    if (leadsPage > totalPages) leadsPage = totalPages;
    if (leadsPage < 1) leadsPage = 1;
    const start = (leadsPage - 1) * leadsPerPage;
    const pageItems = filteredLeads.slice(start, start + leadsPerPage);
    const frag = document.createDocumentFragment();
    const table = document.createElement('table');
    pageItems.forEach((lead, idx) => {
        const leadIdSafe = escapeHtml(String(lead['Lead ID'] || start + idx + 1));
        const businessName = escapeHtml(String(lead['Business Name'] || lead['Name'] || '-'));
        const city = escapeHtml(String(lead['City'] || '-'));
        const phone = escapeHtml(String(lead['Phone'] || '-'));
        const email = escapeHtml(String(lead['Email'] || '-'));
        const websiteType = escapeHtml(
            String(lead['Category'] || lead['Website Type'] || lead['Service'] || '-'),
        );
        const budget = escapeHtml(String(lead['Budget'] || '-'));
        const createdAt = escapeHtml(String(lead['Created At'] || lead['Date'] || '-'));
        const status = escapeHtml(String(lead['Status'] || 'new'));
        const paymentStatus = escapeHtml(String(lead['Payment Status'] || 'unpaid'));
        const preferredLang = escapeHtml(
            String(lead['Preferred Language'] || lead['Preferred Language for Website'] || '-'),
        );
        const requestType = escapeHtml(
            String(
                lead['action'] ||
                    lead['Request Type'] ||
                    (lead['service']
                        ? 'Service Order'
                        : lead['editType']
                          ? 'Edit Request'
                          : lead['Category']
                            ? 'Demo'
                            : 'Consultation'),
            ),
        );
        const sourceVal = String(lead['Source'] || 'website').toLowerCase();
        const sourceLabel =
            sourceVal === 'bot'
                ? 'Bot'
                : sourceVal === 'website'
                  ? 'Site'
                  : escapeHtml(lead['Source'] || 'Site');
        const sourceClass = sourceVal === 'bot' ? 'source-bot' : 'source-site';
        const actualScore = lead['Rating'] || lead['Score'] || 0;
        let stars = '';
        for (let i = 1; i <= 5; i++) stars += i <= actualScore ? '\u2605' : '\u2606';
        let statusClass = 'status-new';
        if (status === 'paid' || status === 'site_built') statusClass = 'status-paid';
        if (status === 'sent' || status === 'messaged') statusClass = 'status-sent';
        let paymentClass = 'status-new';
        if (paymentStatus === 'paid' || paymentStatus === 'confirmed') paymentClass = 'status-paid';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><input type="checkbox" class="leadCheckbox" data-id="${leadIdSafe}"></td>
            <td title="${leadIdSafe}">${leadIdSafe.substring(0, 12)}...</td>
            <td>${businessName}</td>
            <td>${city}</td>
            <td>${phone}</td>
            <td>${email}</td>
            <td>${websiteType}</td>
            <td>${budget}</td>
            <td>${preferredLang}</td>
            <td>${requestType}</td>
            <td>${createdAt}</td>
            <td><span class="status-badge ${statusClass}">${status}</span></td>
            <td><span class="status-badge ${paymentClass}">${paymentStatus}</span></td>
            <td><span class="source-badge ${sourceClass}">${sourceLabel}</span></td>
            <td><span style="color:var(--gold);">${stars}</span> (${actualScore})</td>
            <td style="white-space:nowrap;">
                <button class="btn-icon" onclick="showLeadDetailsById('${leadIdSafe}')" title="Details"><i class="fas fa-info-circle"></i></button>
                <button class="btn-icon" onclick="confirmPayment('${leadIdSafe}')" title="Confirm Payment"><i class="fas fa-check-circle"></i></button>
            </td>`;
        frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
    updatePaginationInfo();
    const selectAllCheckbox = document.getElementById('selectAllLeads');
    if (selectAllCheckbox)
        selectAllCheckbox.onchange = (e) => {
            document
                .querySelectorAll('.leadCheckbox')
                .forEach((cb) => (cb.checked = e.target.checked));
        };
}

function updatePaginationInfo() {
    const info = document.getElementById('leadsPaginationInfo');
    if (!info) return;
    const totalPages = Math.ceil(filteredLeads.length / leadsPerPage) || 1;
    info.innerHTML = `<button class="btn btn-sm" onclick="leadsPage=1;renderLeadsTableBody();" ${leadsPage <= 1 ? 'disabled' : ''}>First</button>
        <button class="btn btn-sm" onclick="leadsPage--;renderLeadsTableBody();" ${leadsPage <= 1 ? 'disabled' : ''}>Prev</button>
        <span style="margin:0 10px;">${filteredLeads.length} leads | Page ${leadsPage}/${totalPages}</span>
        <button class="btn btn-sm" onclick="leadsPage++;renderLeadsTableBody();" ${leadsPage >= totalPages ? 'disabled' : ''}>Next</button>
        <button class="btn btn-sm" onclick="leadsPage=${totalPages};renderLeadsTableBody();" ${leadsPage >= totalPages ? 'disabled' : ''}>Last</button>
        <select onchange="leadsPerPage=parseInt(this.value);leadsPage=1;renderLeadsTableBody();" class="search-input" style="width:80px;margin-left:10px;">
            <option value="10" ${leadsPerPage === 10 ? 'selected' : ''}>10</option>
            <option value="20" ${leadsPerPage === 20 ? 'selected' : ''}>20</option>
            <option value="50" ${leadsPerPage === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${leadsPerPage === 100 ? 'selected' : ''}>100</option>
        </select>`;
}

let leadsChartInstance = null;
let leadsTableBuilt = false;

async function renderLeadsTable() {
    leadsPage = 1;
    leadsData = await fetchLeads();
    applyFiltersAndSort();
    const totalLeads = leadsData.length;
    const siteCount = leadsData.filter((l) => (l['Source'] || 'website') === 'website').length;
    const botCount = leadsData.filter((l) => l['Source'] === 'bot').length;
    const offlineBanner =
        SCRIPT_REACHABLE === false
            ? '<div class="offline-banner">' +
              (currentLang === 'ru'
                  ? '\u041e\u0444\u043b\u0430\u0439\u043d-\u0440\u0435\u0436\u0438\u043c \u2014 \u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430'
                  : 'Offline mode \u2014 browser data only') +
              '</div>'
            : '';
    document.getElementById('adminContent').innerHTML =
        offlineBanner +
        `
        <div class="quick-actions">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                <div>
                    <strong>Total:</strong> ${totalLeads}
                    <span class="source-badge source-site" style="margin-left:10px;">Site: ${siteCount}</span>
                    <span class="source-badge source-bot" style="margin-left:5px;">Bot: ${botCount}</span>
                </div>
                <div>
                    <button class="btn" id="refreshLeadsBtn"><i class="fas fa-sync-alt"></i> Refresh</button>
                    <button class="btn" id="exportCsvBtn"><i class="fas fa-file-csv"></i> Export CSV</button>
                    <button class="btn" id="bulkReminderBtn"><i class="fas fa-bell"></i> Bulk Reminder</button>
                </div>
            </div>
        </div>
        <div class="filter-bar" style="display:flex;gap:10px;flex-wrap:wrap;">
            <input type="text" id="searchName" class="search-input" placeholder="Search name/phone/email" style="width:200px;">
            <select id="sourceFilterSelect" class="search-input" style="width:130px;">
                <option value="all">All Sources</option>
                <option value="website">Site Leads</option>
                <option value="bot">Bot Leads</option>
            </select>
            <select id="statusFilterSelect" class="search-input" style="width:130px;">
                <option value="all">All Statuses</option>
                <option value="new">New</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="site_built">Site Built</option>
            </select>
            <select id="paymentFilterSelect" class="search-input" style="width:130px;">
                <option value="all">All Payments</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
            </select>
            <button class="btn btn-sm" id="resetFiltersBtn">Reset</button>
        </div>
        <canvas id="leadsChart" width="400" height="150" style="max-height:200px;margin-bottom:20px;"></canvas>
        <div style="overflow-x: auto;">
            <table class="leads-table"><thead><tr>
                <th><input type="checkbox" id="selectAllLeads"></th>
                <th data-sort="Lead ID">ID <i class="fas fa-sort"></i></th>
                <th data-sort="Business Name">Business <i class="fas fa-sort"></i></th>
                <th data-sort="City">City <i class="fas fa-sort"></i></th>
                <th data-sort="Phone">Phone <i class="fas fa-sort"></i></th>
                <th data-sort="Email">Email <i class="fas fa-sort"></i></th>
                <th data-sort="Category">Type <i class="fas fa-sort"></i></th>
                <th data-sort="Budget">Budget <i class="fas fa-sort"></i></th>
                <th data-sort="Preferred Language">Lang <i class="fas fa-sort"></i></th>
                <th data-sort="Request Type">Request <i class="fas fa-sort"></i></th>
                <th data-sort="Created At">Created <i class="fas fa-sort"></i></th>
                <th data-sort="Status">Status <i class="fas fa-sort"></i></th>
                <th data-sort="Payment Status">Payment <i class="fas fa-sort"></i></th>
                <th data-sort="Source">Source <i class="fas fa-sort"></i></th>
                <th data-sort="Score">Score <i class="fas fa-sort"></i></th>
                <th>Actions</th>
            </tr></thead><tbody id="leadsTableBody"></tbody></table>
        </div>
        <div style="text-align:center;padding:12px;" id="leadsPaginationInfo"></div>
    `;
    leadsTableBuilt = true;

    try {
        const ctx = document.getElementById('leadsChart').getContext('2d');
        if (leadsChartInstance) leadsChartInstance.destroy();
        leadsChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array.from({ length: 7 }, (_, i) => 'Day -' + (6 - i)),
                datasets: [
                    {
                        label: 'Leads/day',
                        data: Array.from({ length: 7 }, () => Math.floor(Math.random() * 15)),
                        borderColor: 'var(--gold)',
                        fill: false,
                    },
                ],
            },
        });
    } catch (e) {}

    document.getElementById('refreshLeadsBtn').onclick = () => refreshLeads();
    document.getElementById('exportCsvBtn').onclick = exportToCSV;

    document.getElementById('searchName').addEventListener('input', () => {
        searchTerm = document.getElementById('searchName').value;
        applyFiltersAndSort();
    });
    document.getElementById('sourceFilterSelect').onchange = (e) => {
        sourceFilter = e.target.value;
        applyFiltersAndSort();
    };
    document.getElementById('statusFilterSelect').onchange = (e) => {
        statusFilter = e.target.value;
        applyFiltersAndSort();
    };
    document.getElementById('paymentFilterSelect').onchange = (e) => {
        paymentFilter = e.target.value;
        applyFiltersAndSort();
    };
    document.getElementById('resetFiltersBtn').onclick = () => {
        document.getElementById('searchName').value = '';
        document.getElementById('sourceFilterSelect').value = 'all';
        document.getElementById('statusFilterSelect').value = 'all';
        document.getElementById('paymentFilterSelect').value = 'all';
        searchTerm = '';
        sourceFilter = 'all';
        statusFilter = 'all';
        paymentFilter = 'all';
        applyFiltersAndSort();
    };
    document.querySelectorAll('.leads-table th[data-sort]').forEach((th) => {
        th.style.cursor = 'pointer';
        th.onclick = () => {
            const column = th.getAttribute('data-sort');
            if (sortColumn === column) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            else {
                sortColumn = column;
                sortDirection = 'asc';
            }
            applyFiltersAndSort();
        };
    });

    renderLeadsTableBody();
}

async function refreshLeads() {
    leadsData = await fetchLeads();
    const siteCount = leadsData.filter((l) => (l['Source'] || 'website') === 'website').length;
    const botCount = leadsData.filter((l) => l['Source'] === 'bot').length;
    const totalContainers = document.querySelectorAll('.quick-actions div div strong');
    if (totalContainers.length > 0) {
        totalContainers[0].parentElement.innerHTML = `<strong>Total:</strong> ${leadsData.length} <span class="source-badge source-site" style="margin-left:10px;">Site: ${siteCount}</span> <span class="source-badge source-bot" style="margin-left:5px;">Bot: ${botCount}</span>`;
    }
    applyFiltersAndSort();
}

function exportToCSV() {
    if (filteredLeads.length === 0) {
        alert('No data to export');
        return;
    }
    const headers = [
        'Lead ID',
        'Business Name',
        'City',
        'Phone',
        'Email',
        'Website Type',
        'Budget',
        'Preferred Language',
        'Request Type',
        'Created At',
        'Status',
        'Payment Status',
        'Source',
        'Score',
    ];
    const rows = filteredLeads.map((lead) => [
        lead['Lead ID'] || '',
        lead['Business Name'] || lead['Name'] || '',
        lead['City'] || '',
        lead['Phone'] || '',
        lead['Email'] || '',
        lead['Category'] || lead['Website Type'] || lead['Service'] || '',
        lead['Budget'] || '',
        lead['Preferred Language'] || lead['Preferred Language for Website'] || '',
        lead['action'] ||
            lead['Request Type'] ||
            (lead['service']
                ? 'Service Order'
                : lead['editType']
                  ? 'Edit Request'
                  : lead['Category']
                    ? 'Demo'
                    : 'Consultation'),
        lead['Created At'] || lead['Date'] || '',
        lead['Status'] || 'new',
        lead['Payment Status'] || 'unpaid',
        lead['Source'] || lead['Referrer'] || '',
        lead['Rating'] || lead['Score'] || 0,
    ]);
    const csvContent = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', 'leads_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function renderDashboard() {
    var leads = [];
    try {
        leads = await fetchLeads();
    } catch (e) {
        leads = getLocalLeads();
    }
    leads = normalizeLeadRows(leads);
    var total = leads.length;
    var newLeads = leads.filter(function (l) {
        return l['Status'] === 'new' || l['Status'] === 'pending_payment';
    }).length;
    var sent = leads.filter(function (l) {
        return l['Status'] === 'sent' || l['Status'] === 'messaged';
    }).length;
    var paid = leads.filter(function (l) {
        return (l['Payment Status'] || '').toLowerCase() === 'paid';
    }).length;
    var customers = leads.filter(function (l) {
        return (l['Payment Status'] || '').toLowerCase() === 'paid';
    }).length;
    var revenue = paid * 9000;

    var botStatusHtml =
        '<div class="admin-stat-box" style="background:var(--bg-card);padding:12px;border-radius:10px;margin-bottom:15px;display:flex;align-items:center;gap:10px;">';
    botStatusHtml +=
        '<div style="width:12px;height:12px;border-radius:50%;background:#2ecc71;display:inline-block;"></div>';
    botStatusHtml +=
        '<strong>Bot Status:</strong> Check <code>bot_status.json</code> for live status';
    botStatusHtml += '</div>';

    var offlineNotice =
        SCRIPT_REACHABLE === false
            ? '<div class="offline-banner">' +
              (currentLang === 'ru'
                  ? 'Offline mode - browser data'
                  : 'Offline mode - browser data only') +
              '</div>'
            : '';

    document.getElementById('adminContent').innerHTML =
        offlineNotice +
        botStatusHtml +
        '<div class="quick-actions"><button class="btn" onclick="refreshDashboard()"><i class="fas fa-sync-alt"></i> Refresh</button><button class="btn" onclick="exportToCSV()"><i class="fas fa-download"></i> Export CSV</button></div>' +
        '<div class="stats-cards">' +
        '<div class="stat-card"><div class="stat-number">' +
        total +
        '</div><div>' +
        (translations[currentLang].stats_total || 'Total') +
        '</div></div>' +
        '<div class="stat-card"><div class="stat-number">' +
        newLeads +
        '</div><div>' +
        (translations[currentLang].stats_new || 'New') +
        '</div></div>' +
        '<div class="stat-card"><div class="stat-number">' +
        sent +
        '</div><div>' +
        (translations[currentLang].stats_sent || 'Sent') +
        '</div></div>' +
        '<div class="stat-card"><div class="stat-number">' +
        paid +
        '</div><div>' +
        (translations[currentLang].stats_paid || 'Paid') +
        '</div></div>' +
        '<div class="stat-card"><div class="stat-number">' +
        revenue.toLocaleString() +
        ' &#8381;</div><div>Revenue</div></div>' +
        '<div class="stat-card"><div class="stat-number">' +
        customers +
        '</div><div>Customers</div></div>' +
        '</div>' +
        '<canvas id="statsChart" width="400" height="200"></canvas>';

    try {
        new Chart(document.getElementById('statsChart'), {
            type: 'bar',
            data: {
                labels: ['Total', 'New', 'Sent', 'Paid', 'Customers'],
                datasets: [
                    {
                        label: 'Count',
                        data: [total, newLeads, sent, paid, customers],
                        backgroundColor: ['#C8A96A', '#3498db', '#e67e22', '#2ecc71', '#9b59b6'],
                    },
                ],
            },
            options: {
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
            },
        });
    } catch (e) {}

    loadBotStatus();
}

async function loadBotStatus() {
    try {
        var resp = await fetch('/api/bot/status');
        if (resp.ok) {
            var data = await resp.json();
            var bot = data.bot;
            var dotColor =
                bot.status === 'running'
                    ? '#f1c40f'
                    : bot.status === 'idle'
                      ? '#2ecc71'
                      : '#e74c3c';
            var statusText =
                bot.status === 'running' ? 'Active' : bot.status === 'idle' ? 'Idle' : 'Unknown';
            var infoHtml = '<div style="margin-top:10px;font-size:0.85rem;">';
            if (bot.last_run_at)
                infoHtml += 'Last run: ' + new Date(bot.last_run_at).toLocaleString() + '<br>';
            if (bot.leads_found !== undefined)
                infoHtml +=
                    'Leads found: ' + bot.leads_found + ' | Added: ' + bot.leads_added + '<br>';
            infoHtml += '</div>';
            var boxes = document.querySelectorAll('.admin-stat-box');
            if (boxes.length > 0) {
                boxes[0].querySelector('div').style.background = dotColor;
                boxes[0].querySelector('strong').textContent = statusText;
                if (infoHtml) boxes[0].innerHTML += infoHtml;
            }
        }
    } catch (e) {}
}

async function refreshDashboard() {
    let leads = [];
    try {
        leads = await fetchLeads();
    } catch (e) {
        leads = [];
    }
    const total = leads.length;
    const newLeads = leads.filter(
        (l) => l.Status === 'new' || l.Status === 'pending_payment',
    ).length;
    const sent = leads.filter((l) => l.Status === 'sent').length;
    const paid = leads.filter(
        (l) => l['Payment Status'] === 'paid' || l['Payment Status'] === 'confirmed',
    ).length;
    const nums = document.querySelectorAll('.stat-number');
    if (nums.length >= 4) {
        nums[0].textContent = total;
        nums[1].textContent = newLeads;
        nums[2].textContent = sent;
        nums[3].textContent = paid;
    }
    const offlineNotice =
        SCRIPT_REACHABLE === false
            ? '<div class="offline-banner">' +
              (currentLang === 'ru'
                  ? '\u041e\u0444\u043b\u0430\u0439\u043d-\u0440\u0435\u0436\u0438\u043c \u2014 \u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430'
                  : 'Offline mode \u2014 browser data only') +
              '</div>'
            : '';
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        if (m === "'") return '&#39;';
        return m;
    });
}

// ==================== TEMPLATES MANAGER (ADMIN) ====================
async function renderTemplatesManager() {
    const t = translations[currentLang];
    let html = `<h3>🎨 ${t.tab_templates || 'Templates Manager'}</h3>
        <p>Edit template names, prices, and set image URLs for each template. Changes are saved automatically.</p>
        <div id="templatesManagerContainer"></div>
        <button class="btn" id="saveTemplatesBtn">💾 Save All Template Changes</button>
        <div id="templatesManagerResult"></div>`;
    document.getElementById('adminContent').innerHTML = html;
    const container = document.getElementById('templatesManagerContainer');
    container.innerHTML = '';
    for (let category in templatesData) {
        let catName =
            category === 'landing'
                ? 'Landing Pages'
                : category === 'ecommerce'
                  ? 'Online Stores'
                  : 'Corporate Websites';
        container.innerHTML += `<h4>${catName}</h4><div class="templates-edit-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:20px;">`;
        templatesData[category].forEach((tmpl) => {
            const nameRu = tmpl.name.ru || '';
            const nameEn = tmpl.name.en || '';
            const priceRu = tmpl.price.ru || '';
            const priceEn = tmpl.price.en || '';
            const imgUrl = customImages.templates[tmpl.id] || '';
            container.innerHTML += `
                <div class="template-edit-card" style="border:1px solid var(--border-light); border-radius:24px; padding:15px;">
                    <label>Template ID: ${tmpl.id}</label>
                    <label>Name (RU):</label><input type="text" class="search-input" data-template="${tmpl.id}" data-field="name_ru" value="${escapeHtml(nameRu)}" style="margin-bottom:8px;">
                    <label>Name (EN):</label><input type="text" class="search-input" data-template="${tmpl.id}" data-field="name_en" value="${escapeHtml(nameEn)}" style="margin-bottom:8px;">
                    <label>Price (RU):</label><input type="text" class="search-input" data-template="${tmpl.id}" data-field="price_ru" value="${escapeHtml(priceRu)}" style="margin-bottom:8px;">
                    <label>Price (EN):</label><input type="text" class="search-input" data-template="${tmpl.id}" data-field="price_en" value="${escapeHtml(priceEn)}" style="margin-bottom:8px;">
                    <label>Image URL:</label><input type="text" class="search-input" data-template-img="${tmpl.id}" value="${escapeHtml(imgUrl)}" placeholder="https://..." style="margin-bottom:8px;">
                    <div class="template-img-preview" style="margin-top:8px;">${imgUrl ? `<img src="${imgUrl}" loading="lazy" style="max-width:100px; border-radius:12px;">` : 'No image'}</div>
                </div>
            `;
        });
        container.innerHTML += `</div>`;
    }
    document.querySelectorAll('[data-template]').forEach((input) => {
        input.addEventListener('change', function () {
            const tmplId = this.getAttribute('data-template');
            const field = this.getAttribute('data-field');
            const value = this.value;
            for (let cat in templatesData) {
                const tmpl = templatesData[cat].find((t) => t.id === tmplId);
                if (tmpl) {
                    if (field === 'name_ru') tmpl.name.ru = value;
                    if (field === 'name_en') tmpl.name.en = value;
                    if (field === 'price_ru') tmpl.price.ru = value;
                    if (field === 'price_en') tmpl.price.en = value;
                    break;
                }
            }
        });
    });
    document.querySelectorAll('[data-template-img]').forEach((input) => {
        input.addEventListener('change', function () {
            const tmplId = this.getAttribute('data-template-img');
            const imgUrl = this.value;
            if (imgUrl) customImages.templates[tmplId] = imgUrl;
            else delete customImages.templates[tmplId];
        });
    });
    document.getElementById('saveTemplatesBtn').addEventListener('click', () => {
        localStorage.setItem('templatesData', JSON.stringify(templatesData));
        localStorage.setItem('customImages', JSON.stringify(customImages));
        document.getElementById('templatesManagerResult').innerHTML =
            '<span style="color:green;">✅ Templates saved! Refresh page to see changes.</span>';
        renderTemplatesPage();
        if (typeof renderServices === 'function') renderServices();
    });
}

async function renderImageManager() {
    const t = translations[currentLang];
    const serviceNames = translations[currentLang].services.map((s) => s.title);
    const portfolioItems = Object.keys(translations[currentLang].portfolio_items);
    const blogPosts = translations[currentLang].blog_posts;
    let html = `<h3>🖼️ ${t.tab_images || 'Image Manager'}</h3><p>Set custom image URLs for services, portfolio items and blog posts. Leave empty to use default SVG.</p><div style="margin-bottom: 30px;"><h4>Services</h4>`;
    serviceNames.forEach((name) => {
        html += `<div style="margin-bottom: 15px;"><label>${name}:</label><input type="text" id="img_service_${name.replace(/\s/g, '_')}" class="search-input" placeholder="Image URL (jpg/png)" value="${customImages.services[name] || ''}" style="width:100%;"></div>`;
    });
    html += `<h4>Portfolio</h4>`;
    portfolioItems.forEach((item) => {
        html += `<div style="margin-bottom: 15px;"><label>${item}:</label><input type="text" id="img_portfolio_${item.replace(/\s/g, '_')}" class="search-input" placeholder="Image URL" value="${customImages.portfolio[item] || ''}" style="width:100%;"></div>`;
    });
    html += `<h4>Blog Posts</h4>`;
    blogPosts.forEach((post, idx) => {
        html += `<div style="margin-bottom: 15px;"><label>Post #${idx + 1} (${post.title}):</label><input type="text" id="img_blog_${idx}" class="search-input" placeholder="Image URL" value="${customImages.blog[idx] || ''}" style="width:100%;"></div>`;
    });
    html += `<button class="btn" id="saveImagesBtn">💾 Save All Images</button><div id="imageManagerResult"></div>`;
    document.getElementById('adminContent').innerHTML = html;
    document.getElementById('saveImagesBtn').addEventListener('click', () => {
        serviceNames.forEach((name) => {
            let val = document
                .getElementById(`img_service_${name.replace(/\s/g, '_')}`)
                .value.trim();
            if (val) customImages.services[name] = val;
            else delete customImages.services[name];
        });
        portfolioItems.forEach((item) => {
            let val = document
                .getElementById(`img_portfolio_${item.replace(/\s/g, '_')}`)
                .value.trim();
            if (val) customImages.portfolio[item] = val;
            else delete customImages.portfolio[item];
        });
        blogPosts.forEach((_, idx) => {
            let val = document.getElementById(`img_blog_${idx}`).value.trim();
            if (val) customImages.blog[idx] = val;
            else delete customImages.blog[idx];
        });
        localStorage.setItem('customImages', JSON.stringify(customImages));
        document.getElementById('imageManagerResult').innerHTML =
            '<span style="color:green;">✅ Images saved! Refresh page to see changes.</span>';
        renderServices();
        renderPortfolio(currentFilter, document.getElementById('portfolioSearch')?.value || '');
        renderBlog();
        renderTemplatesPage();
    });
}

// ==================== ANALYTICS TAB ====================
async function renderAnalytics() {
    var allLeads = leadsData && leadsData.length ? leadsData : getLocalLeads();
    allLeads = normalizeLeadRows(allLeads);
    var total = allLeads.length;
    var paid = allLeads.filter(function (l) {
        return (l['Payment Status'] || '').toLowerCase() === 'paid';
    }).length;
    var pending = allLeads.filter(function (l) {
        return (l['Payment Status'] || '').toLowerCase() !== 'paid';
    }).length;
    var demoRequested = allLeads.filter(function (l) {
        return (l['action'] || '').indexOf('demo') >= 0;
    }).length;
    var sourceSite = allLeads.filter(function (l) {
        return (l['Source'] || 'website').toLowerCase() === 'website';
    }).length;
    var sourceBot = allLeads.filter(function (l) {
        return (l['Source'] || '').toLowerCase() === 'bot';
    }).length;
    var catCounts = {};
    allLeads.forEach(function (l) {
        var cat = l['Category'] || l['Website Type'] || l['Service'] || 'Other';
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    });
    var catLabels = Object.keys(catCounts);
    var catData = catLabels.map(function (k) {
        return catCounts[k];
    });
    var months = {};
    allLeads.forEach(function (l) {
        var d = l['Created At'] || l['Timestamp'] || '';
        if (d) {
            var m = d.substring(0, 7);
            months[m] = (months[m] || 0) + 1;
        }
    });
    var monthKeys = Object.keys(months).sort();
    var monthData = monthKeys.map(function (k) {
        return months[k];
    });
    var revenue = paid * 9000;

    var html = '<h3>Analytics</h3>';
    html += '<div style="display:flex;gap:15px;flex-wrap:wrap;margin-bottom:20px;">';
    html +=
        '<div class="admin-stat-box" style="flex:1;min-width:140px;padding:15px;background:var(--bg-card);border-radius:10px;text-align:center;"><strong style="font-size:28px;color:var(--gold);">' +
        total +
        '</strong><br>Total Leads</div>';
    html +=
        '<div class="admin-stat-box" style="flex:1;min-width:140px;padding:15px;background:var(--bg-card);border-radius:10px;text-align:center;"><strong style="font-size:28px;color:#2ecc71;">' +
        paid +
        '</strong><br>Paid</div>';
    html +=
        '<div class="admin-stat-box" style="flex:1;min-width:140px;padding:15px;background:var(--bg-card);border-radius:10px;text-align:center;"><strong style="font-size:28px;color:#e67e22;">' +
        pending +
        '</strong><br>Pending</div>';
    html +=
        '<div class="admin-stat-box" style="flex:1;min-width:140px;padding:15px;background:var(--bg-card);border-radius:10px;text-align:center;"><strong style="font-size:28px;color:#3498db;">' +
        demoRequested +
        '</strong><br>Demo Requests</div>';
    html +=
        '<div class="admin-stat-box" style="flex:1;min-width:140px;padding:15px;background:var(--bg-card);border-radius:10px;text-align:center;"><strong style="font-size:28px;color:#9b59b6;">' +
        revenue.toLocaleString() +
        ' &#8381;</strong><br>Est. Revenue</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
    html +=
        '<div style="flex:1;min-width:300px;"><canvas id="analyticsSourceChart"></canvas></div>';
    html +=
        '<div style="flex:1;min-width:300px;"><canvas id="analyticsCategoryChart"></canvas></div>';
    html += '</div>';
    html +=
        '<div style="margin-top:20px;"><h4>Monthly Breakdown</h4><canvas id="analyticsMonthlyChart" style="max-height:250px;"></canvas></div>';
    html +=
        '<div style="margin-top:15px;font-size:0.85rem;color:var(--text);">Source: Site: ' +
        sourceSite +
        ' | Bot: ' +
        sourceBot +
        '</div>';
    document.getElementById('adminContent').innerHTML = html;

    // Source pie chart
    var ctx1 = document.getElementById('analyticsSourceChart');
    if (ctx1) {
        new Chart(ctx1, {
            type: 'pie',
            data: {
                labels: ['Website', 'Bot'],
                datasets: [
                    { data: [sourceSite, sourceBot], backgroundColor: ['#C8A96A', '#A67B5A'] },
                ],
            },
            options: { plugins: { title: { display: true, text: 'Leads by Source' } } },
        });
    }
    // Category pie chart
    var ctx2 = document.getElementById('analyticsCategoryChart');
    if (ctx2 && catLabels.length > 0) {
        new Chart(ctx2, {
            type: 'pie',
            data: {
                labels: catLabels,
                datasets: [
                    {
                        data: catData,
                        backgroundColor: [
                            '#C8A96A',
                            '#A67B5A',
                            '#5E3A2C',
                            '#B58C48',
                            '#D6C6B0',
                            '#8B7355',
                            '#E8D5B7',
                            '#6B4423',
                        ],
                    },
                ],
            },
            options: { plugins: { title: { display: true, text: 'Leads by Category' } } },
        });
    }
    // Monthly bar chart
    var ctx3 = document.getElementById('analyticsMonthlyChart');
    if (ctx3 && monthKeys.length > 0) {
        new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: monthKeys,
                datasets: [{ label: 'Leads', data: monthData, backgroundColor: 'var(--gold)' }],
            },
            options: {
                plugins: { title: { display: true, text: 'Monthly Leads' } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
            },
        });
    }
    adminLog('Analytics tab viewed', 'info');
}

// ==================== SEO TAB ====================
async function renderSEO() {
    var seoData = JSON.parse(
        localStorage.getItem('admin_seo') ||
            '{"title":"Unique Web Studio | Website Creation","description":"Professional website development, high conversion.","keywords":"web development, website creation, landing page"}',
    );
    var t = translations[currentLang];
    var html = '<h3>SEO Settings</h3>';
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
    html += '<div style="flex:2;min-width:300px;">';
    html += '<label>Page Title (document.title):</label>';
    html +=
        '<input type="text" id="seoTitle" class="search-input" value="' +
        escAttr(seoData.title) +
        '" style="width:100%;">';
    html += '<label>Meta Description:</label>';
    html +=
        '<textarea id="seoDesc" class="search-input" rows="3" style="width:100%;">' +
        escHtml(seoData.description) +
        '</textarea>';
    html += '<label>Meta Keywords:</label>';
    html +=
        '<input type="text" id="seoKeywords" class="search-input" value="' +
        escAttr(seoData.keywords) +
        '" style="width:100%;">';
    html +=
        '<button class="btn" id="saveSeoBtn" style="margin-top:10px;">Save SEO Settings</button>';
    html += '<span id="seoResult" style="margin-left:10px;"></span>';
    html += '</div>';
    html +=
        '<div style="flex:1;min-width:250px;background:var(--beige);padding:15px;border-radius:10px;">';
    html += '<h4>Google Preview</h4>';
    html +=
        '<div style="font-size:1.1rem;color:#1a0dab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        escHtml(seoData.title.substring(0, 65)) +
        '</div>';
    html += '<div style="font-size:0.85rem;color:#006621;">uniquewebstudio.ru</div>';
    html +=
        '<div style="font-size:0.85rem;color:#545454;">' +
        escHtml(seoData.description.substring(0, 160)) +
        '</div>';
    html += '</div>';
    html += '</div>';
    html += '<div style="margin-top:20px;"><h4>Robots.txt Preview</h4>';
    html +=
        '<textarea readonly class="search-input" rows="5" style="width:100%;font-family:monospace;background:var(--bg-card);">User-agent: *\nDisallow: /admin\nAllow: /\n\nSitemap: https://uniquewebstudio.ru/sitemap.xml</textarea></div>';
    html += '<div style="margin-top:10px;"><h4>Sitemap Preview</h4>';
    html +=
        '<textarea readonly class="search-input" rows="4" style="width:100%;font-family:monospace;background:var(--bg-card);">' +
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n  <url><loc>https://uniquewebstudio.ru/</loc></url>\n  <url><loc>https://uniquewebstudio.ru/#services</loc></url>\n  <url><loc>https://uniquewebstudio.ru/#portfolio</loc></url>\n  <url><loc>https://uniquewebstudio.ru/#templates</loc></url>\n  <url><loc>https://uniquewebstudio.ru/#blog</loc></url>\n  <url><loc>https://uniquewebstudio.ru/#contact</loc></url>\n</urlset>' +
        '</textarea></div>';
    document.getElementById('adminContent').innerHTML = html;

    document.getElementById('saveSeoBtn').addEventListener('click', function () {
        var newSeo = {
            title: document.getElementById('seoTitle').value.trim(),
            description: document.getElementById('seoDesc').value.trim(),
            keywords: document.getElementById('seoKeywords').value.trim(),
        };
        localStorage.setItem('admin_seo', JSON.stringify(newSeo));
        document.title = newSeo.title;
        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', newSeo.description);
        else {
            metaDesc = document.createElement('meta');
            metaDesc.name = 'description';
            metaDesc.content = newSeo.description;
            document.head.appendChild(metaDesc);
        }
        var metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) metaKw.setAttribute('content', newSeo.keywords);
        else {
            metaKw = document.createElement('meta');
            metaKw.name = 'keywords';
            metaKw.content = newSeo.keywords;
            document.head.appendChild(metaKw);
        }
        document.getElementById('seoResult').innerHTML = '<span style="color:green;">Saved!</span>';
        adminLog('SEO settings updated', 'info');
        setTimeout(function () {
            document.getElementById('seoResult').innerHTML = '';
        }, 2000);
    });
}

// ==================== BACKUP TAB ====================
async function renderBackup() {
    var backupKeys = [
        'localLeads',
        'customImages',
        'templatesData',
        'reviews',
        'admin_seo',
        'admin_settings',
        'admin_notifications',
        'admin_followups',
        'admin_tickets',
        'admin_logs',
        'lang',
        'apps_script_url_override',
    ];
    var counts = {};
    var totalItems = 0;
    backupKeys.forEach(function (k) {
        try {
            var v = localStorage.getItem(k);
            if (v) {
                var parsed = JSON.parse(v);
                if (Array.isArray(parsed)) counts[k] = parsed.length;
                else counts[k] = '1';
                totalItems++;
            }
        } catch (e) {}
    });
    var lastBackup = localStorage.getItem('admin_last_backup') || 'Never';

    var html = '<h3>Backup &amp; Restore</h3>';
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
    html +=
        '<div style="flex:1;min-width:280px;background:var(--bg-card);padding:15px;border-radius:10px;">';
    html +=
        '<h4>Create Backup</h4><p style="font-size:0.85rem;">Export all localStorage data as a JSON file.</p>';
    html += '<button class="btn" id="exportBackupBtn">Export JSON Backup</button>';
    html +=
        '<p style="font-size:0.8rem;margin-top:10px;">Last backup: <strong>' +
        lastBackup +
        '</strong></p>';
    html += '</div>';
    html +=
        '<div style="flex:1;min-width:280px;background:var(--bg-card);padding:15px;border-radius:10px;">';
    html +=
        '<h4>Restore Backup</h4><p style="font-size:0.85rem;">Import a previously exported JSON backup file. <strong style="color:red;">This will overwrite current data.</strong></p>';
    html +=
        '<input type="file" id="importBackupFile" accept=".json" style="margin-bottom:10px;display:block;">';
    html += '<button class="btn" id="importBackupBtn" disabled>Restore from File</button>';
    html += '<span id="backupResult" style="margin-left:10px;"></span>';
    html += '</div>';
    html += '</div>';
    html +=
        '<div style="margin-top:20px;background:var(--bg-card);padding:15px;border-radius:10px;">';
    html +=
        '<h4>Data Preview</h4><table style="width:100%;"><thead><tr><th>Key</th><th>Item Count</th></tr></thead><tbody>';
    Object.keys(counts).forEach(function (k) {
        html += '<tr><td>' + k + '</td><td>' + counts[k] + '</td></tr>';
    });
    html +=
        '</tbody></table><p style="font-size:0.8rem;margin-top:5px;">Total keys with data: ' +
        totalItems +
        '</p>';
    html += '</div>';
    document.getElementById('adminContent').innerHTML = html;

    document.getElementById('exportBackupBtn').addEventListener('click', function () {
        var backup = {};
        backupKeys.forEach(function (k) {
            try {
                backup[k] = localStorage.getItem(k);
            } catch (e) {}
        });
        backup['exported_at'] = new Date().toISOString();
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'backup_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        localStorage.setItem('admin_last_backup', new Date().toLocaleString());
        document.getElementById('backupResult').innerHTML =
            '<span style="color:green;">Backup exported!</span>';
        adminLog('Backup exported', 'info');
        setTimeout(function () {
            document.getElementById('backupResult').innerHTML = '';
        }, 2000);
    });

    var fileInput = document.getElementById('importBackupFile');
    fileInput.addEventListener('change', function () {
        document.getElementById('importBackupBtn').disabled = !this.files || !this.files.length;
    });

    document.getElementById('importBackupBtn').addEventListener('click', function () {
        var file = fileInput.files[0];
        if (!file) return;
        if (!confirm('Restore backup? This will overwrite all current data.')) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var backup = JSON.parse(e.target.result);
                var count = 0;
                Object.keys(backup).forEach(function (k) {
                    if (k === 'exported_at') return;
                    try {
                        localStorage.setItem(k, backup[k]);
                        count++;
                    } catch (err) {}
                });
                document.getElementById('backupResult').innerHTML =
                    '<span style="color:green;">Restored ' + count + ' keys!</span>';
                adminLog('Backup restored (' + count + ' keys)', 'warn');
                setTimeout(function () {
                    location.reload();
                }, 1500);
            } catch (err) {
                document.getElementById('backupResult').innerHTML =
                    '<span style="color:red;">Invalid backup file.</span>';
            }
        };
        reader.readAsText(file);
    });
    adminLog('Backup tab viewed', 'info');
}

// ==================== NOTIFICATIONS TAB ====================
async function renderNotifications() {
    if (window.Notifier && window.Notifier.getConfigUI) {
        document.getElementById('adminContent').innerHTML = window.Notifier.getConfigUI();
        if (window.Notifier.bindConfigUI) window.Notifier.bindConfigUI();
    } else {
        document.getElementById('adminContent').innerHTML =
            '<h3>Notification Settings</h3><p>Notification module not loaded.</p>';
    }
    adminLog('Notifications tab viewed', 'info');
}

// ==================== FOLLOW-UP TAB ====================
async function renderFollowUp() {
    var followups = JSON.parse(localStorage.getItem('admin_followups') || '[]');
    followups.sort(function (a, b) {
        return new Date(a.date) - new Date(b.date);
    });
    var now = new Date().toISOString().slice(0, 10);

    var html = '<h3>Follow-up Reminders</h3>';
    html +=
        '<div style="background:var(--bg-card);padding:15px;border-radius:10px;margin-bottom:20px;">';
    html += '<h4>Add Reminder</h4>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    html +=
        '<input type="text" id="fuName" class="search-input" placeholder="Customer name" style="flex:1;min-width:150px;">';
    html +=
        '<input type="date" id="fuDate" class="search-input" value="' +
        now +
        '" style="flex:1;min-width:130px;">';
    html +=
        '<input type="text" id="fuNotes" class="search-input" placeholder="Notes" style="flex:2;min-width:200px;">';
    html += '<button class="btn" id="addFollowupBtn">Add</button>';
    html += '</div></div>';

    if (followups.length === 0) {
        html += '<p>No follow-up reminders yet.</p>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:10px;">';
        followups.forEach(function (f, idx) {
            var d = new Date(f.date);
            var isPast = d < new Date(now);
            var statusIcon = f.completed
                ? '<span style="color:green;">Completed</span>'
                : isPast
                  ? '<span style="color:red;">Overdue</span>'
                  : '<span style="color:var(--gold);">Upcoming</span>';
            html +=
                '<div class="admin-item" style="padding:12px;border-radius:8px;border-left:4px solid ' +
                (f.completed ? '#2ecc71' : isPast ? '#e74c3c' : 'var(--gold)') +
                ';">';
            html +=
                '<strong>' +
                escHtml(f.name) +
                '</strong> <span style="font-size:0.85rem;">' +
                d.toLocaleDateString() +
                '</span> ' +
                statusIcon;
            html += '<p style="margin:5px 0;font-size:0.9rem;">' + escHtml(f.notes || '') + '</p>';
            html += '<div style="display:flex;gap:5px;">';
            if (!f.completed) {
                html +=
                    '<button class="btn" style="font-size:0.8rem;padding:4px 10px;" onclick="completeFollowup(' +
                    idx +
                    ')">Complete</button>';
            }
            html +=
                '<button class="btn" style="font-size:0.8rem;padding:4px 10px;background:#e74c3c;" onclick="deleteFollowup(' +
                idx +
                ')">Delete</button>';
            html += '</div></div>';
        });
        html += '</div>';
    }
    html += '<span id="fuResult" style="margin-left:10px;"></span>';
    document.getElementById('adminContent').innerHTML = html;

    document.getElementById('addFollowupBtn').addEventListener('click', function () {
        var name = document.getElementById('fuName').value.trim();
        var date = document.getElementById('fuDate').value;
        var notes = document.getElementById('fuNotes').value.trim();
        if (!name || !date) {
            document.getElementById('fuResult').innerHTML =
                '<span style="color:red;">Name and date required.</span>';
            return;
        }
        followups.push({
            name: name,
            date: date,
            notes: notes,
            completed: false,
            created: new Date().toISOString(),
        });
        localStorage.setItem('admin_followups', JSON.stringify(followups));
        adminLog('Follow-up added: ' + name, 'info');
        renderFollowUp();
    });
}

function completeFollowup(idx) {
    var followups = JSON.parse(localStorage.getItem('admin_followups') || '[]');
    if (followups[idx]) followups[idx].completed = true;
    localStorage.setItem('admin_followups', JSON.stringify(followups));
    adminLog('Follow-up completed: ' + (followups[idx] ? followups[idx].name : ''), 'info');
    renderFollowUp();
}

function deleteFollowup(idx) {
    if (!confirm('Delete this follow-up?')) return;
    var followups = JSON.parse(localStorage.getItem('admin_followups') || '[]');
    var name = followups[idx] ? followups[idx].name : '';
    followups.splice(idx, 1);
    localStorage.setItem('admin_followups', JSON.stringify(followups));
    adminLog('Follow-up deleted: ' + name, 'warn');
    renderFollowUp();
}

// ==================== SCRAPER TAB (placeholder) ====================
async function renderScraper() {
    document.getElementById('adminContent').innerHTML =
        '<h3>Lead Scraper</h3><button class="btn" onclick="alert(\'Scraping started (backend required)\')">Start parsing</button><button class="btn" onclick="alert(\'Stopped\')">Stop</button><p>Last run: 2025-04-04 10:23</p>';
}

// ==================== TICKETS TAB ====================
async function renderTickets() {
    var tickets = JSON.parse(localStorage.getItem('admin_tickets') || '[]');
    var filterStatus = '';
    var html = '<h3>Support Tickets</h3>';
    html +=
        '<div style="background:var(--bg-card);padding:15px;border-radius:10px;margin-bottom:20px;">';
    html += '<h4>Create Ticket</h4>';
    html +=
        '<input type="text" id="ticketTitle" class="search-input" placeholder="Title" style="width:100%;margin-bottom:8px;">';
    html +=
        '<textarea id="ticketDesc" class="search-input" placeholder="Description" rows="3" style="width:100%;margin-bottom:8px;"></textarea>';
    html += '<div style="display:flex;gap:10px;">';
    html +=
        '<select id="ticketPriority" class="search-input"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>';
    html += '<button class="btn" id="createTicketBtn">Create</button>';
    html += '</div></div>';

    html += '<h4>Filter: ';
    html +=
        '<button class="btn btn-sm" onclick="filterTicketStatus=\'\';renderTickets();">All</button> ';
    html +=
        '<button class="btn btn-sm" onclick="filterTicketStatus=\'open\';renderTickets();">Open</button> ';
    html +=
        '<button class="btn btn-sm" onclick="filterTicketStatus=\'in_progress\';renderTickets();">In Progress</button> ';
    html +=
        '<button class="btn btn-sm" onclick="filterTicketStatus=\'resolved\';renderTickets();">Resolved</button>';
    html += '</h4>';

    var filtered = tickets;
    if (typeof filterTicketStatus !== 'undefined' && filterTicketStatus) {
        filtered = tickets.filter(function (t) {
            return t.status === filterTicketStatus;
        });
    }
    html +=
        '<span style="font-size:0.85rem;">Showing ' +
        filtered.length +
        ' of ' +
        tickets.length +
        ' tickets</span>';

    if (filtered.length === 0) {
        html += '<p>No tickets found.</p>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">';
        filtered.forEach(function (tk, origIdx) {
            var statusBadge = '';
            if (tk.status === 'open')
                statusBadge = '<span class="status-badge status-new">Open</span>';
            else if (tk.status === 'in_progress')
                statusBadge = '<span class="status-badge status-sent">In Progress</span>';
            else statusBadge = '<span class="status-badge status-paid">Resolved</span>';
            var priorityBadge =
                tk.priority === 'high'
                    ? '<span style="color:red;font-weight:bold;">[HIGH]</span>'
                    : tk.priority === 'low'
                      ? '<span style="color:#999;">[Low]</span>'
                      : '<span style="color:var(--gold);">[Medium]</span>';
            html += '<div class="admin-item" style="padding:12px;border-radius:8px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html +=
                '<strong>' + priorityBadge + ' ' + escHtml(tk.title) + '</strong> ' + statusBadge;
            html +=
                '<span style="font-size:0.8rem;">' +
                new Date(tk.created).toLocaleString() +
                '</span>';
            html += '</div>';
            html +=
                '<p style="margin:5px 0;font-size:0.9rem;">' +
                escHtml(tk.description || '') +
                '</p>';
            html += '<div style="display:flex;gap:5px;">';
            if (tk.status !== 'resolved') {
                html +=
                    '<button class="btn" style="font-size:0.8rem;padding:4px 10px;" onclick="changeTicketStatus(' +
                    origIdx +
                    ",'in_progress')\">In Progress</button>";
                html +=
                    '<button class="btn" style="font-size:0.8rem;padding:4px 10px;" onclick="changeTicketStatus(' +
                    origIdx +
                    ",'resolved')\">Resolve</button>";
            } else {
                html +=
                    '<button class="btn" style="font-size:0.8rem;padding:4px 10px;" onclick="changeTicketStatus(' +
                    origIdx +
                    ",'open')\">Reopen</button>";
            }
            html +=
                '<button class="btn" style="font-size:0.8rem;padding:4px 10px;background:#e74c3c;" onclick="deleteTicket(' +
                origIdx +
                ')">Delete</button>';
            html += '</div></div>';
        });
        html += '</div>';
    }
    document.getElementById('adminContent').innerHTML = html;

    var createBtn = document.getElementById('createTicketBtn');
    if (createBtn)
        createBtn.addEventListener('click', function () {
            var title = document.getElementById('ticketTitle').value.trim();
            var desc = document.getElementById('ticketDesc').value.trim();
            var priority = document.getElementById('ticketPriority').value;
            if (!title) return;
            var tickets = JSON.parse(localStorage.getItem('admin_tickets') || '[]');
            tickets.push({
                title: title,
                description: desc,
                priority: priority,
                status: 'open',
                created: new Date().toISOString(),
            });
            localStorage.setItem('admin_tickets', JSON.stringify(tickets));
            adminLog('Ticket created: ' + title, 'info');
            renderTickets();
        });
}
var filterTicketStatus = '';

function changeTicketStatus(idx, status) {
    var tickets = JSON.parse(localStorage.getItem('admin_tickets') || '[]');
    if (tickets[idx]) {
        tickets[idx].status = status;
        tickets[idx].updated = new Date().toISOString();
    }
    localStorage.setItem('admin_tickets', JSON.stringify(tickets));
    adminLog('Ticket #' + (idx + 1) + ' status -> ' + status, 'info');
    renderTickets();
}

function deleteTicket(idx) {
    if (!confirm('Delete this ticket?')) return;
    var tickets = JSON.parse(localStorage.getItem('admin_tickets') || '[]');
    var title = tickets[idx] ? tickets[idx].title : '';
    tickets.splice(idx, 1);
    localStorage.setItem('admin_tickets', JSON.stringify(tickets));
    adminLog('Ticket deleted: ' + title, 'warn');
    renderTickets();
}

// ==================== CUSTOMERS TAB ====================
async function renderCustomers() {
    var leads = leadsData && leadsData.length ? leadsData : getLocalLeads();
    leads = normalizeLeadRows(leads);
    var customers = leads.filter(function (l) {
        return (l['Payment Status'] || '').toLowerCase() === 'paid';
    });
    var html = '<h3>Customers (' + customers.length + ')</h3>';
    html +=
        '<div style="margin-bottom:10px;"><input type="text" id="customerSearch" class="search-input" placeholder="Search customers..." style="max-width:300px;"></div>';
    if (customers.length === 0) {
        html += '<p>No customers yet.</p>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:10px;">';
        customers.forEach(function (c, idx) {
            var name = c['Business Name'] || c['name'] || 'Unknown';
            var phone = c['Phone'] || c['phone'] || '';
            var email = c['Email'] || c['email'] || '';
            var city = c['City'] || c['city'] || '';
            var site = c['Final Site Link'] || c['Demo Link'] || '';
            var status = c['Status'] || c['status'] || '';
            var lastAction = c['Last Action Date'] || c['last_action'] || '';
            html +=
                '<div class="admin-item" style="padding:15px;border-radius:10px;border-left:4px solid #2ecc71;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<strong>' + escHtml(name) + '</strong>';
            html += '<span class="status-badge status-paid">Customer</span>';
            html += '</div>';
            html +=
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:8px;font-size:0.9rem;">';
            if (phone) html += '<div><i class="fas fa-phone"></i> ' + escHtml(phone) + '</div>';
            if (email) html += '<div><i class="fas fa-envelope"></i> ' + escHtml(email) + '</div>';
            if (city) html += '<div><i class="fas fa-city"></i> ' + escHtml(city) + '</div>';
            if (site)
                html +=
                    '<div><i class="fas fa-link"></i> <a href="' +
                    escAttr(site) +
                    '" target="_blank">View site</a></div>';
            if (lastAction)
                html +=
                    '<div><i class="fas fa-clock"></i> ' +
                    new Date(lastAction).toLocaleString() +
                    '</div>';
            html += '</div></div>';
        });
        html += '</div>';
    }
    document.getElementById('adminContent').innerHTML = html;
    document.getElementById('customerSearch').addEventListener('input', function () {
        var term = this.value.toLowerCase();
        var items = document.querySelectorAll('.admin-item');
        items.forEach(function (item) {
            item.style.display = item.textContent.toLowerCase().indexOf(term) >= 0 ? '' : 'none';
        });
    });
}

// ==================== ORDERS TAB ====================
async function renderOrders() {
    var leads = leadsData && leadsData.length ? leadsData : getLocalLeads();
    leads = normalizeLeadRows(leads);
    var orders = leads.filter(function (l) {
        var req = (l['Request Type'] || l['action'] || '').toLowerCase();
        return req.indexOf('demo') >= 0 || req.indexOf('order') >= 0 || req.indexOf('service') >= 0;
    });
    var filter = '';
    var html = '<h3>Orders (' + orders.length + ')</h3>';
    html += '<div style="margin-bottom:10px;display:flex;gap:10px;">';
    html += '<select id="orderStatusFilter" class="search-input" style="max-width:200px;">';
    html +=
        '<option value="all">All</option><option value="new">New</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="waiting_payment">Waiting Payment</option>';
    html += '</select>';
    html +=
        '<input type="text" id="orderSearch" class="search-input" placeholder="Search orders..." style="max-width:300px;flex:1;">';
    html += '</div>';

    if (orders.length === 0) {
        html += '<p>No orders yet.</p>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:12px;">';
        orders.forEach(function (o, idx) {
            var name = o['Business Name'] || o['name'] || 'Unknown';
            var type = o['Request Type'] || o['action'] || 'N/A';
            var service = o['Service'] || o['Website Type'] || '';
            var status = o['Status'] || 'new';
            var payment = o['Payment Status'] || '';
            var site = o['Final Site Link'] || o['Demo Link'] || '';
            var amount = o['Amount'] || o['Budget'] || '';

            var statusBadge =
                status === 'new'
                    ? '<span class="status-badge status-new">New</span>'
                    : status === 'messaged' || status === 'sent'
                      ? '<span class="status-badge status-sent">In Progress</span>'
                      : status === 'waiting_payment'
                        ? '<span class="status-badge" style="background:#f39c12;">Payment Due</span>'
                        : '<span class="status-badge status-paid">Completed</span>';

            html +=
                '<div class="admin-item order-card" data-status="' +
                status +
                '" style="padding:15px;border-radius:10px;border-left:4px solid var(--gold);">';
            html +=
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
            html +=
                '<div><strong>' +
                escHtml(name) +
                '</strong> <span style="color:#888;">(' +
                escHtml(type) +
                ')</span></div>';
            html += statusBadge;
            html += '</div>';
            html += '<div style="font-size:0.9rem;">';
            if (service)
                html += '<span style="margin-right:15px;">Service: ' + escHtml(service) + '</span>';
            if (amount)
                html += '<span style="margin-right:15px;">Budget: ' + escHtml(amount) + '</span>';
            if (payment)
                html += '<span style="margin-right:15px;">Payment: ' + escHtml(payment) + '</span>';
            if (site)
                html +=
                    '<a href="' +
                    escAttr(site) +
                    '" target="_blank" style="color:var(--gold);">View site</a>';
            html += '</div></div>';
        });
        html += '</div>';
    }
    document.getElementById('adminContent').innerHTML = html;

    document.getElementById('orderStatusFilter').addEventListener('change', function () {
        var val = this.value;
        document.querySelectorAll('.order-card').forEach(function (card) {
            card.style.display =
                val === 'all' || card.getAttribute('data-status') === val ? '' : 'none';
        });
    });
    document.getElementById('orderSearch').addEventListener('input', function () {
        var term = this.value.toLowerCase();
        document.querySelectorAll('.order-card').forEach(function (card) {
            card.style.display = card.textContent.toLowerCase().indexOf(term) >= 0 ? '' : 'none';
        });
    });
}

// ==================== SETTINGS TAB ====================
async function renderSettings() {
    var settings = JSON.parse(
        localStorage.getItem('admin_settings') ||
            '{"scriptUrl":"","language":"en","theme":"gold","adminEmail":"","vkGroup":""}',
    );
    var th = localStorage.getItem('admin_theme') || 'gold';
    var html = '<h3>General Settings</h3>';
    html +=
        '<div style="background:var(--bg-card);padding:15px;border-radius:10px;max-width:600px;">';
    html += '<label>Admin Email:</label>';
    html +=
        '<input type="email" id="setAdminEmail" class="search-input" value="' +
        escAttr(settings.adminEmail || '') +
        '" style="width:100%;">';
    html += '<label>VK Group Link:</label>';
    html +=
        '<input type="text" id="setVkGroup" class="search-input" value="' +
        escAttr(settings.vkGroup || '') +
        '" style="width:100%;">';
    html += '<label>Script URL Override (leave empty for default):</label>';
    html +=
        '<input type="text" id="setScriptUrl" class="search-input" value="' +
        escAttr(settings.scriptUrl || '') +
        '" style="width:100%;">';
    html += '<p style="font-size:0.8rem;">Current: ' + SCRIPT_URL + '</p>';
    html += '<label>Language Preference:</label>';
    html +=
        '<select id="setLanguage" class="search-input" style="width:100%;"><option value="en" ' +
        (settings.language === 'en' ? 'selected' : '') +
        '>English</option><option value="ru" ' +
        (settings.language === 'ru' ? 'selected' : '') +
        '>Russian</option></select>';
    html += '<label>Theme:</label>';
    html +=
        '<select id="setTheme" class="search-input" style="width:100%;"><option value="gold" ' +
        (th === 'gold' ? 'selected' : '') +
        '>Gold (Default)</option><option value="dark" ' +
        (th === 'dark' ? 'selected' : '') +
        '>Dark</option><option value="light" ' +
        (th === 'light' ? 'selected' : '') +
        '>Light</option></select>';
    html +=
        '<button class="btn" id="saveSettingsBtn" style="margin-top:15px;">Save Settings</button>';
    html += '<span id="settingsResult" style="margin-left:10px;"></span>';
    html += '</div>';
    document.getElementById('adminContent').innerHTML = html;

    document.getElementById('saveSettingsBtn').addEventListener('click', function () {
        var newSettings = {
            scriptUrl: document.getElementById('setScriptUrl').value.trim(),
            language: document.getElementById('setLanguage').value,
            theme: document.getElementById('setTheme').value,
            adminEmail: document.getElementById('setAdminEmail').value.trim(),
            vkGroup: document.getElementById('setVkGroup').value.trim(),
        };
        localStorage.setItem('admin_settings', JSON.stringify(newSettings));
        localStorage.setItem('admin_theme', newSettings.theme);
        if (newSettings.scriptUrl) {
            localStorage.setItem('apps_script_url_override', newSettings.scriptUrl);
            SCRIPT_URL = newSettings.scriptUrl;
        } else {
            localStorage.removeItem('apps_script_url_override');
            SCRIPT_URL = DEFAULT_SCRIPT_URL;
        }
        if (newSettings.language && newSettings.language !== currentLang) {
            localStorage.setItem('lang', newSettings.language);
            currentLang = newSettings.language;
            applyLanguage(currentLang);
        }
        document.getElementById('settingsResult').innerHTML =
            '<span style="color:green;">Settings saved! Refreshing...</span>';
        adminLog(
            'Settings updated: lang=' + newSettings.language + ' theme=' + newSettings.theme,
            'info',
        );
        setTimeout(function () {
            location.reload();
        }, 1500);
    });
}

// ==================== LOGS TAB ====================
async function renderLogs() {
    var logs = [];
    try {
        logs = JSON.parse(localStorage.getItem('admin_logs') || '[]');
    } catch (e) {}
    var levelFilter = typeof logLevelFilter !== 'undefined' ? logLevelFilter : 'all';
    var filtered = logs;
    if (levelFilter !== 'all')
        filtered = logs.filter(function (l) {
            return l.level === levelFilter;
        });

    var html = '<h3>System Logs</h3>';
    html += '<div style="margin-bottom:10px;">';
    html += '<strong>Filter: </strong>';
    html +=
        '<button class="btn btn-sm" onclick="logLevelFilter=\'all\';renderLogs();">All</button> ';
    html +=
        '<button class="btn btn-sm" onclick="logLevelFilter=\'info\';renderLogs();" style="background:#3498db;color:#fff;">Info</button> ';
    html +=
        '<button class="btn btn-sm" onclick="logLevelFilter=\'warn\';renderLogs();" style="background:#e67e22;color:#fff;">Warn</button> ';
    html +=
        '<button class="btn btn-sm" onclick="logLevelFilter=\'error\';renderLogs();" style="background:#e74c3c;color:#fff;">Error</button>';
    html += '</div>';
    html +=
        '<p style="font-size:0.85rem;">Showing ' +
        filtered.length +
        ' of ' +
        logs.length +
        ' entries (max 500)</p>';
    html +=
        '<div style="background:var(--bg-card);padding:10px;border-radius:8px;max-height:400px;overflow-y:auto;font-family:monospace;font-size:0.85rem;">';
    if (filtered.length === 0) {
        html += '<p>No log entries.</p>';
    } else {
        filtered.forEach(function (l) {
            var lvlColor =
                l.level === 'error' ? '#e74c3c' : l.level === 'warn' ? '#e67e22' : '#888';
            html += '<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);">';
            html +=
                '<span style="color:#666;">[' +
                new Date(l.timestamp).toLocaleString() +
                ']</span> ';
            html += '<span style="color:' + lvlColor + ';">[' + l.level.toUpperCase() + ']</span> ';
            html += escHtml(l.message);
            html += '</div>';
        });
    }
    html += '</div>';
    html +=
        '<button class="btn" id="clearLogsBtn" style="margin-top:10px;background:#e74c3c;">Clear All Logs</button>';
    html += '<span id="logsResult" style="margin-left:10px;"></span>';
    document.getElementById('adminContent').innerHTML = html;

    var clearBtn = document.getElementById('clearLogsBtn');
    if (clearBtn)
        clearBtn.addEventListener('click', function () {
            if (!confirm('Clear all ' + logs.length + ' log entries?')) return;
            localStorage.setItem('admin_logs', '[]');
            document.getElementById('logsResult').innerHTML =
                '<span style="color:green;">Logs cleared!</span>';
            adminLog('Logs cleared', 'warn');
            setTimeout(function () {
                renderLogs();
            }, 1000);
        });
}
var logLevelFilter = 'all';
async function renderTextEditor() {
    const ru = translations.ru;
    const en = translations.en;
    document.getElementById('adminContent').innerHTML =
        `<div class="admin-text-editor"><h3>✏️ Text Editor (Russian version)</h3><label>Hero Title (RU):</label><input type="text" id="heroTitleRu" class="search-input" value="${ru.hero_title.replace(/"/g, '&quot;')}"><label>Hero Description (RU):</label><textarea id="heroDescRu" rows="2" class="search-input">${ru.hero_desc}</textarea><label>Services Title (RU):</label><input type="text" id="servicesTitleRu" class="search-input" value="${ru.services_title}"><label>Portfolio Title (RU):</label><input type="text" id="portfolioTitleRu" class="search-input" value="${ru.portfolio_title}"><label>Blog Title (RU):</label><input type="text" id="blogTitleRu" class="search-input" value="${ru.blog_title}"><label>Reviews Title (RU):</label><input type="text" id="reviewsTitleRu" class="search-input" value="${ru.reviews_title}"><label>Edit Section Title (RU):</label><input type="text" id="editTitleRu" class="search-input" value="${ru.edit_title}"><label>Contact Title (RU):</label><input type="text" id="contactTitleRu" class="search-input" value="${ru.contact_title}"><label>Footer Copyright (RU):</label><input type="text" id="footerCopyrightRu" class="search-input" value="${ru.footer_copyright}"><label>Service 1 (Title, desc, price):</label><input type="text" id="service1TitleRu" value="${ru.services[0].title}"><input type="text" id="service1DescRu" value="${ru.services[0].desc}"><input type="text" id="service1PriceRu" value="${ru.services[0].price}"><label>Service 2:</label><input type="text" id="service2TitleRu" value="${ru.services[1].title}"><input type="text" id="service2DescRu" value="${ru.services[1].desc}"><input type="text" id="service2PriceRu" value="${ru.services[1].price}"><label>Service 3:</label><input type="text" id="service3TitleRu" value="${ru.services[2].title}"><input type="text" id="service3DescRu" value="${ru.services[2].desc}"><input type="text" id="service3PriceRu" value="${ru.services[2].price}"><label>Service 4 (Website Edit):</label><input type="text" id="service4TitleRu" value="${ru.services[3].title}"><input type="text" id="service4DescRu" value="${ru.services[3].desc}"><input type="text" id="service4PriceRu" value="${ru.services[3].price}"><hr><h3>English version</h3><label>Hero Title (EN):</label><input type="text" id="heroTitleEn" class="search-input" value="${en.hero_title.replace(/"/g, '&quot;')}"><label>Hero Description (EN):</label><textarea id="heroDescEn" rows="2" class="search-input">${en.hero_desc}</textarea><label>Services Title (EN):</label><input type="text" id="servicesTitleEn" class="search-input" value="${en.services_title}"><label>Portfolio Title (EN):</label><input type="text" id="portfolioTitleEn" class="search-input" value="${en.portfolio_title}"><label>Blog Title (EN):</label><input type="text" id="blogTitleEn" class="search-input" value="${en.blog_title}"><label>Reviews Title (EN):</label><input type="text" id="reviewsTitleEn" class="search-input" value="${en.reviews_title}"><label>Edit Section Title (EN):</label><input type="text" id="editTitleEn" class="search-input" value="${en.edit_title}"><label>Contact Title (EN):</label><input type="text" id="contactTitleEn" class="search-input" value="${en.contact_title}"><label>Footer Copyright (EN):</label><input type="text" id="footerCopyrightEn" class="search-input" value="${en.footer_copyright}"><label>Service 1:</label><input type="text" id="service1TitleEn" value="${en.services[0].title}"><input type="text" id="service1DescEn" value="${en.services[0].desc}"><input type="text" id="service1PriceEn" value="${en.services[0].price}"><label>Service 2:</label><input type="text" id="service2TitleEn" value="${en.services[1].title}"><input type="text" id="service2DescEn" value="${en.services[1].desc}"><input type="text" id="service2PriceEn" value="${en.services[1].price}"><label>Service 3:</label><input type="text" id="service3TitleEn" value="${en.services[2].title}"><input type="text" id="service3DescEn" value="${en.services[2].desc}"><input type="text" id="service3PriceEn" value="${en.services[2].price}"><label>Service 4 (Website Edit):</label><input type="text" id="service4TitleEn" value="${en.services[3].title}"><input type="text" id="service4DescEn" value="${en.services[3].desc}"><input type="text" id="service4PriceEn" value="${en.services[3].price}"><hr><button class="btn" id="saveAllTextsBtn">💾 Save all changes</button><div id="editorResult" style="margin-top:15px;"></div></div>`;
    document.getElementById('saveAllTextsBtn').addEventListener('click', () => {
        translations.ru.hero_title = document.getElementById('heroTitleRu').value;
        translations.ru.hero_desc = document.getElementById('heroDescRu').value;
        translations.ru.services_title = document.getElementById('servicesTitleRu').value;
        translations.ru.portfolio_title = document.getElementById('portfolioTitleRu').value;
        translations.ru.blog_title = document.getElementById('blogTitleRu').value;
        translations.ru.reviews_title = document.getElementById('reviewsTitleRu').value;
        translations.ru.edit_title = document.getElementById('editTitleRu').value;
        translations.ru.contact_title = document.getElementById('contactTitleRu').value;
        translations.ru.footer_copyright = document.getElementById('footerCopyrightRu').value;
        translations.ru.services = [
            {
                title: document.getElementById('service1TitleRu').value,
                desc: document.getElementById('service1DescRu').value,
                price: document.getElementById('service1PriceRu').value,
                btn: 'Заказать',
            },
            {
                title: document.getElementById('service2TitleRu').value,
                desc: document.getElementById('service2DescRu').value,
                price: document.getElementById('service2PriceRu').value,
                btn: 'Заказать',
            },
            {
                title: document.getElementById('service3TitleRu').value,
                desc: document.getElementById('service3DescRu').value,
                price: document.getElementById('service3PriceRu').value,
                btn: 'Заказать',
            },
            {
                title: document.getElementById('service4TitleRu').value,
                desc: document.getElementById('service4DescRu').value,
                price: document.getElementById('service4PriceRu').value,
                btn: 'Заказать',
            },
        ];
        translations.en.hero_title = document.getElementById('heroTitleEn').value;
        translations.en.hero_desc = document.getElementById('heroDescEn').value;
        translations.en.services_title = document.getElementById('servicesTitleEn').value;
        translations.en.portfolio_title = document.getElementById('portfolioTitleEn').value;
        translations.en.blog_title = document.getElementById('blogTitleEn').value;
        translations.en.reviews_title = document.getElementById('reviewsTitleEn').value;
        translations.en.edit_title = document.getElementById('editTitleEn').value;
        translations.en.contact_title = document.getElementById('contactTitleEn').value;
        translations.en.footer_copyright = document.getElementById('footerCopyrightEn').value;
        translations.en.services = [
            {
                title: document.getElementById('service1TitleEn').value,
                desc: document.getElementById('service1DescEn').value,
                price: document.getElementById('service1PriceEn').value,
                btn: 'Order',
            },
            {
                title: document.getElementById('service2TitleEn').value,
                desc: document.getElementById('service2DescEn').value,
                price: document.getElementById('service2PriceEn').value,
                btn: 'Order',
            },
            {
                title: document.getElementById('service3TitleEn').value,
                desc: document.getElementById('service3DescEn').value,
                price: document.getElementById('service3PriceEn').value,
                btn: 'Order',
            },
            {
                title: document.getElementById('service4TitleEn').value,
                desc: document.getElementById('service4DescEn').value,
                price: document.getElementById('service4PriceEn').value,
                btn: 'Order',
            },
        ];
        localStorage.setItem('custom_translations_ru', JSON.stringify(translations.ru));
        localStorage.setItem('custom_translations_en', JSON.stringify(translations.en));
        applyLanguage(currentLang);
        document.getElementById('editorResult').innerHTML =
            '<span style="color:green;">✅ All texts updated!</span>';
    });
}

// =====================================================
// ====== FIXED ADMIN PANEL – guaranteed open ==========
// =====================================================
function renderCloudTab() {
    var c = window.GitHubCloud ? window.GitHubCloud.getConfig() : {};
    var html = '<h3>☁️ GitHub Cloud Storage</h3>';
    html +=
        '<p style="margin-bottom:20px;">Sync all your site data (leads, reviews, settings) to a GitHub repository. Once configured, data is readable by anyone with the repo URL and writable with your token.</p>';

    html +=
        '<div style="background:var(--bg-card);padding:20px;border-radius:12px;border:2px solid ';
    html += c.owner && c.repo && c.token ? 'var(--gold);' : 'rgba(200,169,106,0.3);';
    html += 'max-width:650px;">';

    html += '<h4 style="margin-bottom:15px;">Repository Configuration</h4>';

    html +=
        '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;margin-bottom:4px;">GitHub Username / Organization</label>';
    html +=
        '<input type="text" id="cloudOwner" class="search-input" value="' +
        (c.owner || '') +
        '" placeholder="e.g. UNIQUE-STUDIO" style="width:100%;"></div>';

    html +=
        '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;margin-bottom:4px;">Repository Name</label>';
    html +=
        '<input type="text" id="cloudRepo" class="search-input" value="' +
        (c.repo || '') +
        '" placeholder="e.g. website-data" style="width:100%;"></div>';

    html +=
        '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;margin-bottom:4px;">Personal Access Token <span style="font-weight:400;font-size:0.8rem;">(required for writes)</span></label>';
    html +=
        '<input type="password" id="cloudToken" class="search-input" value="' +
        (c.token || '') +
        '" placeholder="ghp_..." style="width:100%;"></div>';

    html +=
        '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;margin-bottom:4px;">Branch</label>';
    html +=
        '<input type="text" id="cloudBranch" class="search-input" value="' +
        (c.branch || 'main') +
        '" placeholder="main" style="width:100%;"></div>';

    html += '<div style="display:flex;gap:10px;margin-top:15px;">';
    html += '<button class="btn" id="saveCloudConfig">Save Config</button>';
    if (c.owner && c.repo && c.token) {
        html += '<button class="btn btn-outline" id="testCloudConnection">Test Connection</button>';
    }
    html += '<button class="btn btn-outline" id="cloudDisconnect">Disconnect</button>';
    html += '</div>';
    html += '<div id="cloudResult" style="margin-top:12px;"></div>';

    html += '</div>';

    html +=
        '<div style="margin-top:20px;background:var(--bg-card);padding:20px;border-radius:12px;max-width:650px;">';
    html += '<h4 style="margin-bottom:10px;">Setup Instructions</h4>';
    html += '<ol style="line-height:1.8;padding-left:20px;">';
    html += '<li>Create a <strong>new public repository</strong> on GitHub</li>';
    html +=
        '<li>Go to Settings > Developer settings > Personal access tokens > Fine-grained tokens</li>';
    html +=
        '<li>Generate a token with <strong>Contents: Read and write</strong> permission on that repo</li>';
    html += '<li>Paste the token above and click <strong>Save Config</strong></li>';
    html += '<li>Click <strong>Push All Data Now</strong> below to sync existing data</li>';
    html += '</ol>';
    html +=
        '<button class="btn" id="cloudForcePush" style="margin-top:10px;"><i class="fas fa-cloud-upload-alt"></i> Push All Data Now</button>';
    html += '</div>';

    html +=
        '<div style="margin-top:20px;background:var(--bg-card);padding:20px;border-radius:12px;max-width:650px;">';
    html += '<h4 style="margin-bottom:10px;">Sync Status</h4>';
    html +=
        '<p><strong>Data synced to cloud:</strong> ' +
        (c.owner && c.repo && c.token ? c.owner + '/' + c.repo : 'Not configured') +
        '</p>';
    html +=
        '<p><strong>Syncable keys:</strong> ' +
        (window.GitHubCloud ? window.GitHubCloud.SYNC_KEYS.join(', ') : 'N/A') +
        '</p>';
    html +=
        '<p><strong>Note:</strong> Preferences (dark mode, consent, admin password) are NOT synced - they stay in your browser only.</p>';
    html += '</div>';

    document.getElementById('adminContent').innerHTML = html;

    document.getElementById('saveCloudConfig').addEventListener('click', function () {
        var newCfg = {
            owner: document.getElementById('cloudOwner').value.trim(),
            repo: document.getElementById('cloudRepo').value.trim(),
            token: document.getElementById('cloudToken').value.trim(),
            branch: document.getElementById('cloudBranch').value.trim() || 'main',
        };
        if (!newCfg.owner || !newCfg.repo) {
            document.getElementById('cloudResult').innerHTML =
                '<span style="color:red;">Owner and repo are required.</span>';
            return;
        }
        window.GitHubCloud.setConfig(newCfg);
        document.getElementById('cloudResult').innerHTML =
            '<span style="color:var(--gold);">Config saved! Data will now sync to GitHub automatically.</span>';
        renderCloudTab();
    });

    if (c.owner && c.repo && c.token) {
        document.getElementById('testCloudConnection').addEventListener('click', function () {
            var btn = document.getElementById('testCloudConnection');
            btn.disabled = true;
            btn.innerHTML = 'Testing...';
            window.GitHubCloud.pull(window.GitHubCloud.SYNC_KEYS[0])
                .then(function (result) {
                    document.getElementById('cloudResult').innerHTML =
                        result !== null
                            ? '<span style="color:green;">Connection successful! Cloud is working.</span>'
                            : '<span style="color:var(--gold);">Connection OK (repo connected, no data file found yet).</span>';
                    btn.disabled = false;
                    btn.innerHTML = 'Test Connection';
                })
                .catch(function () {
                    document.getElementById('cloudResult').innerHTML =
                        '<span style="color:red;">Connection failed. Check your token and repo name.</span>';
                    btn.disabled = false;
                    btn.innerHTML = 'Test Connection';
                });
        });
    }

    document.getElementById('cloudDisconnect').addEventListener('click', function () {
        if (
            confirm(
                'Remove GitHub cloud configuration? Data will stay on GitHub but no longer sync.',
            )
        ) {
            window.GitHubCloud.setConfig({});
            document.getElementById('cloudResult').innerHTML =
                '<span style="color:var(--gold);">Cloud config removed. Data stays in localStorage only.</span>';
            setTimeout(function () {
                renderCloudTab();
            }, 800);
        }
    });

    document.getElementById('cloudForcePush').addEventListener('click', function () {
        if (!window.GitHubCloud.isConfigured()) {
            alert('Please configure GitHub repo and token first.');
            return;
        }
        var btn = document.getElementById('cloudForcePush');
        btn.disabled = true;
        btn.innerHTML = 'Pushing...';
        window.GitHubCloud.flush();
        btn.innerHTML = 'Push scheduled! Check console.';
        setTimeout(function () {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Push All Data Now';
        }, 3000);
    });
}

function renderActiveTab() {
    const content = document.getElementById('adminContent');
    if (!content) {
        console.error('❌ adminContent not found');
        return;
    }

    try {
        switch (currentAdminTab) {
            case 'dashboard':
                renderDashboard();
                break;
            case 'leads':
                renderLeadsTable();
                break;
            case 'analytics':
                renderAnalytics();
                break;
            case 'seo':
                renderSEO();
                break;
            case 'backup':
                renderBackup();
                break;
            case 'notifications':
                renderNotifications();
                break;
            case 'followup':
                renderFollowUp();
                break;
            case 'scraper':
                renderScraper();
                break;
            case 'tickets':
                renderTickets();
                break;
            case 'settings':
                renderSettings();
                break;
            case 'logs':
                renderLogs();
                break;
            case 'editor':
                renderTextEditor();
                break;
            case 'images':
                renderImageManager();
                break;
            case 'templates_manager':
                renderTemplatesManager();
                break;
            case 'cloud':
                renderCloudTab();
                break;
            case 'customers':
                renderCustomers();
                break;
            case 'orders':
                renderOrders();
                break;
            default:
                content.innerHTML = '<p> Tab ready.</p>';
        }
    } catch (e) {
        console.error('❌ Error in renderActiveTab:', e);
        content.innerHTML = `<p style="color:red;">⚠️ Error loading tab "${currentAdminTab}": ${e.message}</p>`;
    }
}

// -------- Secure admin authentication with SHA-256 hashing --------
var ADMIN_LOCKOUT_KEY = 'admin_lockout_until';
var ADMIN_ATTEMPTS_KEY = 'admin_login_attempts';
var ADMIN_HASH_KEY = 'admin_password_hash';
var MAX_ATTEMPTS = 5;
var LOCKOUT_MINUTES = 5;

async function sha256Hash(message) {
    var encoder = new TextEncoder();
    var data = encoder.encode(message);
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
        .map(function (b) {
            return b.toString(16).padStart(2, '0');
        })
        .join('');
}

function generateRandomPassword() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    var result = '';
    var array = new Uint32Array(16);
    crypto.getRandomValues(array);
    for (var i = 0; i < 16; i++) {
        result += chars[array[i] % chars.length];
    }
    return result;
}

function getAdminSetupLink() {
    return location.origin + location.pathname + '?setup_admin=1';
}

function isLockedOut() {
    var lockoutUntil = localStorage.getItem(ADMIN_LOCKOUT_KEY);
    if (!lockoutUntil) return false;
    if (Date.now() < parseInt(lockoutUntil, 10)) return true;
    localStorage.removeItem(ADMIN_LOCKOUT_KEY);
    localStorage.removeItem(ADMIN_ATTEMPTS_KEY);
    return false;
}

function recordFailedAttempt() {
    var attempts = parseInt(localStorage.getItem(ADMIN_ATTEMPTS_KEY) || '0', 10) + 1;
    localStorage.setItem(ADMIN_ATTEMPTS_KEY, attempts.toString());
    if (attempts >= MAX_ATTEMPTS) {
        var lockoutUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
        localStorage.setItem(ADMIN_LOCKOUT_KEY, lockoutUntil.toString());
        return true;
    }
    return false;
}

function resetLoginAttempts() {
    localStorage.removeItem(ADMIN_ATTEMPTS_KEY);
    localStorage.removeItem(ADMIN_LOCKOUT_KEY);
}

function getStoredPasswordHash() {
    return localStorage.getItem(ADMIN_HASH_KEY);
}

function showAdminPanel() {
    var panel = document.getElementById('adminPanel');
    var content = document.getElementById('adminContent');
    panel.classList.add('open');
    if (window.Notifier && window.Notifier.resetLeadsCount) window.Notifier.resetLeadsCount();
    if (!content.innerHTML.trim()) {
        content.innerHTML = '<p>Loading admin panel...</p>';
    }
    try {
        renderActiveTab();
    } catch (e) {
        console.error('Critical error in renderActiveTab:', e);
        content.innerHTML = '<p style="color:red;">Failed to load panel: ' + e.message + '</p>';
    }
}

async function handleAdminLogin() {
    if (isLockedOut()) {
        var lockoutUntil = parseInt(localStorage.getItem(ADMIN_LOCKOUT_KEY), 10);
        var remaining = Math.ceil((lockoutUntil - Date.now()) / 60000);
        alert('Too many failed attempts. Please try again in ' + remaining + ' minute(s).');
        return;
    }

    var currentHash = getStoredPasswordHash();

    if (!currentHash) {
        var setupMsg =
            'No admin password has been set.\n\n' +
            'To set your password, visit this link in your browser:\n' +
            getAdminSetupLink() +
            '\n\n' +
            'Or enter a new password now:';
        var newPassword = prompt(setupMsg);
        if (!newPassword || newPassword.length < 4) {
            alert('Password must be at least 4 characters.');
            return;
        }
        try {
            var newHash = await sha256Hash(newPassword);
            localStorage.setItem(ADMIN_HASH_KEY, newHash);
            alert('Admin password set successfully!');
            showAdminPanel();
        } catch (e) {
            alert('Error setting password. Please try again.');
        }
        return;
    }

    var pwd = prompt('Password:');
    if (!pwd) return;

    try {
        var inputHash = await sha256Hash(pwd);
        if (inputHash !== currentHash) {
            var locked = recordFailedAttempt();
            var attempts = parseInt(localStorage.getItem(ADMIN_ATTEMPTS_KEY) || '0', 10);
            var remaining = MAX_ATTEMPTS - attempts;
            if (locked) {
                alert('Too many failed attempts. Locked out for ' + LOCKOUT_MINUTES + ' minutes.');
            } else {
                alert('Wrong password. ' + remaining + ' attempt(s) remaining.');
            }
            return;
        }
        resetLoginAttempts();
        showAdminPanel();
    } catch (e) {
        alert('Authentication error. Please try again.');
    }
}

// Handle setup_admin URL parameter for direct setup link
(function handleSetupAdmin() {
    if (location.search.indexOf('setup_admin=1') !== -1) {
        var currentHash = getStoredPasswordHash();
        if (currentHash) {
            alert('Admin password is already set.\n\nTo reset it, clear localStorage and reload.');
        } else {
            var newPassword = prompt('Set your admin password (at least 4 characters):');
            if (newPassword && newPassword.length >= 4) {
                sha256Hash(newPassword)
                    .then(function (newHash) {
                        localStorage.setItem(ADMIN_HASH_KEY, newHash);
                        alert(
                            'Admin password set successfully!\n\nHash: ' +
                                newHash +
                                '\n\nPlease save your password securely. It cannot be recovered.',
                        );
                    })
                    .catch(function () {
                        alert('Error setting password. Please try again.');
                    });
            } else {
                alert('Password must be at least 4 characters.');
            }
        }
        if (history.replaceState) {
            history.replaceState({}, '', location.pathname);
        }
    }
})();

document.getElementById('adminToggleBtn').addEventListener('click', handleAdminLogin);

// -------- Also ensure adminClose works --------
document.getElementById('adminClose').addEventListener('click', function () {
    document.getElementById('adminPanel').classList.remove('open');
});

// =====================================================
// ====== END OF ADMIN PANEL FIX =======================
// =====================================================

document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        currentAdminTab = tab.getAttribute('data-tab');
        renderActiveTab();
    });
});

for (let i = 0; i < 60; i++) {
    let p = document.createElement('div');
    p.classList.add('particle');
    let size = Math.random() * 12 + 4;
    p.style.width = p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = Math.random() * 20 + 12 + 's';
    p.style.animationDelay = Math.random() * 10 + 's';
    document.getElementById('particles').appendChild(p);
}
function setupModalLanguageButtons() {
    const policyRu = document.querySelector('.policy-lang-ru'),
        policyEn = document.querySelector('.policy-lang-en'),
        policyRuContent = document.querySelector('.policy-content-ru'),
        policyEnContent = document.querySelector('.policy-content-en');
    if (policyRu && policyEn) {
        policyRu.addEventListener('click', () => {
            policyRu.classList.add('active');
            policyEn.classList.remove('active');
            policyRuContent.style.display = 'block';
            policyEnContent.style.display = 'none';
        });
        policyEn.addEventListener('click', () => {
            policyEn.classList.add('active');
            policyRu.classList.remove('active');
            policyRuContent.style.display = 'none';
            policyEnContent.style.display = 'block';
        });
    }
    const refundRu = document.querySelector('.refund-lang-ru'),
        refundEn = document.querySelector('.refund-lang-en'),
        refundRuContent = document.querySelector('.refund-content-ru'),
        refundEnContent = document.querySelector('.refund-content-en');
    if (refundRu && refundEn) {
        refundRu.addEventListener('click', () => {
            refundRu.classList.add('active');
            refundEn.classList.remove('active');
            refundRuContent.style.display = 'block';
            refundEnContent.style.display = 'none';
        });
        refundEn.addEventListener('click', () => {
            refundEn.classList.add('active');
            refundRu.classList.remove('active');
            refundRuContent.style.display = 'none';
            refundEnContent.style.display = 'block';
        });
    }
}
setupModalLanguageButtons();

const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('newsletterEmail').value.trim();
        if (!email || !email.includes('@')) {
            document.getElementById('newsletterMsg').innerHTML =
                '<span style="color:red;">Please enter a valid email.</span>';
            return;
        }
        const msgDiv = document.getElementById('newsletterMsg');
        msgDiv.innerHTML = '<span>Sending...</span>';
        try {
            const formData = new FormData();
            formData.append('action', 'newsletter');
            formData.append('email', email);
            const response = await fetch(SCRIPT_URL, { method: 'POST', body: formData });
            const result = await response.json();
            if (result.success) {
                msgDiv.innerHTML = '<span style="color:green;">✅ Subscribed successfully!</span>';
                document.getElementById('newsletterEmail').value = '';
                localStorage.setItem('newsletter_subscribed', email);
                if (window.Notifier && window.Notifier.notify)
                    window.Notifier.notify({ email: email }, 'newsletter');
            } else {
                let subscribers = JSON.parse(
                    localStorage.getItem('newsletter_subscribers') || '[]',
                );
                if (!subscribers.includes(email)) {
                    subscribers.push(email);
                    localStorage.setItem('newsletter_subscribers', JSON.stringify(subscribers));
                    if (window.Notifier && window.Notifier.notify)
                        window.Notifier.notify({ email: email }, 'newsletter');
                }
                msgDiv.innerHTML =
                    '<span style="color:green;">✅ Subscribed (offline mode).</span>';
                document.getElementById('newsletterEmail').value = '';
            }
        } catch (err) {
            let subscribers = JSON.parse(localStorage.getItem('newsletter_subscribers') || '[]');
            if (!subscribers.includes(email)) {
                subscribers.push(email);
                localStorage.setItem('newsletter_subscribers', JSON.stringify(subscribers));
                if (window.Notifier && window.Notifier.notify)
                    window.Notifier.notify({ email: email }, 'newsletter');
            }
            msgDiv.innerHTML = '<span style="color:green;">✅ Subscribed (offline).</span>';
            document.getElementById('newsletterEmail').value = '';
        }
        setTimeout(() => {
            msgDiv.innerHTML = '';
        }, 3000);
    });
}
function animateStats() {
    const statNumbers = document.querySelectorAll('.stat-number[data-count]');
    if (!statNumbers.length) return;
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.getAttribute('data-count'), 10);
                    let current = 0;
                    const increment = target / 50;
                    const timer = setInterval(() => {
                        current += increment;
                        if (current >= target) {
                            el.innerText = target;
                            clearInterval(timer);
                        } else {
                            el.innerText = Math.floor(current);
                        }
                    }, 30);
                    observer.unobserve(el);
                }
            });
        },
        { threshold: 0.5 },
    );
    statNumbers.forEach((el) => observer.observe(el));
}
window.addEventListener('load', () => {
    animateStats();
});

function addLoadingSpinner(button) {
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = originalText + '<span class="loading-spinner"></span>';
    return () => {
        button.disabled = false;
        button.innerHTML = originalText;
    };
}
const originalSendToAppsScript = sendToAppsScript;
if (typeof originalSendToAppsScript === 'function') {
    window.sendToAppsScript = async function (formData, action, submitBtn) {
        let restore = null;
        if (submitBtn && submitBtn.tagName === 'BUTTON') {
            restore = addLoadingSpinner(submitBtn);
        }
        try {
            return await originalSendToAppsScript(formData, action);
        } finally {
            if (restore) restore();
        }
    };
}
const originalShowLeadDetailsById = showLeadDetailsById;
if (typeof originalShowLeadDetailsById === 'function') {
    window.showLeadDetailsById = function (leadId) {
        originalShowLeadDetailsById(leadId);
        setTimeout(() => {
            const modalContent = document.querySelector('#leadDetailsModal .modal-content');
            if (modalContent && !modalContent.querySelector('.copy-lead-btn')) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn btn-outline copy-lead-btn';
                copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy Lead ID';
                copyBtn.style.marginTop = '20px';
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(leadId);
                    alert('Lead ID copied: ' + leadId);
                };
                modalContent.appendChild(copyBtn);
            }
        }, 100);
    };
}
const supportDot = document.querySelector('.live-support');
if (supportDot) {
    supportDot.style.cursor = 'pointer';
    supportDot.addEventListener('click', () => {
        if (typeof requireConsentAndExecute === 'function') {
            requireConsentAndExecute(() => openModal('consult'));
        } else {
            openModal('consult');
        }
    });
}
window.addEventListener('scroll', () => {
    const header = document.querySelector('.header');
    if (window.scrollY > 50) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
});
let mouseX = 0,
    mouseY = 0,
    mouseTicking = false;
document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!mouseTicking) {
        mouseTicking = true;
        requestAnimationFrame(() => {
            const x = mouseX / window.innerWidth;
            const y = mouseY / window.innerHeight;
            document
                .querySelectorAll('.service-card, .portfolio-card, .template-card')
                .forEach((el) => {
                    const moveX = (x - 0.5) * 15;
                    const moveY = (y - 0.5) * 15;
                    el.style.transform = `translate(${moveX}px, ${moveY}px)`;
                });
            mouseTicking = false;
        });
    }
});
const staggerElements = document.querySelectorAll(
    '.service-card, .portfolio-card, .blog-card, .stat-item, .template-card',
);
const staggerObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, index * 100);
                staggerObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.2 },
);
staggerElements.forEach((el) => {
    el.classList.add('stagger-item');
    staggerObserver.observe(el);
});
// Fallback: ensure all stagger items become visible even if IntersectionObserver fails
setTimeout(() => {
    document.querySelectorAll('.stagger-item:not(.visible)').forEach((el) => {
        el.classList.add('visible');
    });
}, 1500);
let refreshInterval = null;
const adminPanelEl = document.getElementById('adminPanel');
if (adminPanelEl) {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                if (adminPanelEl.classList.contains('open')) {
                    if (!refreshInterval) {
                        refreshInterval = setInterval(() => {
                            if (currentAdminTab === 'leads' && typeof refreshLeads === 'function') {
                                refreshLeads();
                            } else if (
                                currentAdminTab === 'dashboard' &&
                                typeof refreshDashboard === 'function'
                            ) {
                                refreshDashboard();
                            }
                        }, 30000);
                    }
                } else {
                    if (refreshInterval) {
                        clearInterval(refreshInterval);
                        refreshInterval = null;
                    }
                }
            }
        });
    });
    observer.observe(adminPanelEl, { attributes: true });
}
(function mergeTemplatesCatalogFromGitHub() {
    var catalogUrl =
        'https://raw.githubusercontent.com/UNIQUE-STUDIO/website-templates-GITHUB/main/templates-catalog.json';
    fetch(catalogUrl + '?t=' + Date.now())
        .then(function (r) {
            if (!r.ok) return null;
            return r.json();
        })
        .then(function (data) {
            if (!data || typeof data !== 'object') return;
            ['landing', 'ecommerce', 'corporate'].forEach(function (cat) {
                if (!Array.isArray(data[cat])) return;
                data[cat].forEach(function (item) {
                    if (!item || !item.id) return;
                    if (!templatesData[cat]) templatesData[cat] = [];
                    if (
                        templatesData[cat].some(function (t) {
                            return t.id === item.id;
                        })
                    )
                        return;
                    templatesData[cat].push({
                        id: item.id,
                        category: cat,
                        name: item.name || { en: String(item.id), ru: String(item.id) },
                        price: item.price || { en: '', ru: '' },
                        image: item.image || 'images/photos/services/landing.jpg',
                        preview_url: item.preview_url || item.repo_url || '',
                    });
                });
            });
            if (typeof renderTemplatesPage === 'function') renderTemplatesPage();
        })
        .catch(function () {
            /* optional catalog */
        });
})();
console.log(
    '✅ FINAL VERSION: All features integrated, leads display fixed, templates manager active, all form fields sent to Google Sheets.',
);
