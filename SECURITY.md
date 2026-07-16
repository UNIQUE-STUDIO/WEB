# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**DO NOT CREATE A PUBLIC ISSUE** for security vulnerabilities.

Instead, please report them privately:

- Email: **uniqe.studio@yandex.ru**
- Subject: `SECURITY: [brief description]`

We will respond within 48 hours.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected versions/files
- Potential impact
- Suggested fix (if any)

### Responsible Disclosure

- Allow up to 30 days for a fix before public disclosure
- We will credit you in the release notes (unless you prefer to remain anonymous)

## Security Practices

- All dependencies are scanned weekly via Dependabot
- Automated secret scanning runs on every push (Gitleaks)
- No hardcoded credentials in source code
- HTTPS enforced via GitHub Pages
- Content Security Policy headers recommended for production use
