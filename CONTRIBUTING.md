# Contributing to Unique Web Studio

We love contributions! Here's how to get started.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/UNIQUE-STUDIO/WEB.git
cd WEB

# Start a local server
python3 -m http.server 8000

# Validate HTML
html-validate index.html

# Minify CSS after changes
cleancss -o css/styles.min.css css/styles.css
```

## Development Workflow

1. **Fork** the repository
2. **Create a branch**: `git checkout -b feat/my-feature`
3. **Make changes** and test locally
4. **Validate**: HTML + CSS + responsive
5. **Commit** with clear message: `feat: description`
6. **Push** and open a Pull Request

## Commit Convention

| Prefix | Use For |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `style:` | CSS/UI changes |
| `refactor:` | Code restructuring |
| `perf:` | Performance |
| `chore:` | Maintenance |
| `ci:` | CI/workflows |

## Code Quality Checklist

- [ ] HTML validates (`html-validate index.html`)
- [ ] CSS is minified after changes
- [ ] Responsive on all screen sizes
- [ ] No hardcoded API keys or tokens
- [ ] VK integration intact
- [ ] All links functional
- [ ] New templates match existing naming convention

## Adding Templates

1. Place template folder in `templates-preview/`
2. Add SVG thumbnail in `images/templates/`
3. Add entry in `templates.json` with all required fields
4. Test preview loads correctly

## Questions?

- Open a [Discussion](https://github.com/UNIQUE-STUDIO/WEB/discussions)
- Email: uniqe.studio@yandex.ru
- VK: https://vk.com/unique__business
