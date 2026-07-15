// Unique Web Studio - ESLint Flat Config (v10+)
const globals = require('globals');

module.exports = [
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                ...globals.browser,
                Swiper: 'readonly',
                AOS: 'readonly',
                VanillaTilt: 'readonly',
                Chart: 'readonly',
                GitHubCloud: 'readonly',
                Notifier: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-undef': 'warn',
            'no-console': 'off',
            'no-constant-condition': 'warn',
            'no-empty': 'warn',
            'no-prototype-builtins': 'off',
            'no-dupe-keys': 'error',
            'no-redeclare': 'warn',
        },
    },
    {
        ignores: ['sw.js', 'manifest.json', 'js/github-storage.js'],
    },
];
