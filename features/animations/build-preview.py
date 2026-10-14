"""Build the animation preview as one offline HTML document."""
from pathlib import Path
import base64

ROOT = Path(__file__).resolve().parent
PREVIEW = ROOT / "preview"


def build():
    page = (PREVIEW / "panel.html").read_text(encoding="utf-8-sig")
    for asset in ("pang.svg", "pang-glyph.svg"):
        logo = base64.b64encode((PREVIEW / "assets" / asset).read_bytes()).decode("ascii")
        page = page.replace(f'"assets/{asset}"', f'"data:image/svg+xml;base64,{logo}"')
    for name in ("styles.css", "numeric-motion.css", "motion-engine.css", "priority-motion.css", "plugin-ui.css", "surface.css"):
        css = (PREVIEW / name).read_text(encoding="utf-8-sig")
        page = page.replace(f'<link rel="stylesheet" href="{name}">', f"<style>\n{css}\n</style>")
    for name in ("catalog.js", "native-support.js", "numeric-motion.js", "impact-dust.js", "brand-card.js", "priority-motion.js", "motion-engine.js", "app.js", "native-plan.js", "plugin-ui.js", "surface.js"):
        source = (PREVIEW / name).read_text(encoding="utf-8-sig").replace("</script", "<\\/script")
        page = page.replace(f'<script src="{name}"></script>', f"<script>\n{source}\n</script>")
    page=page.replace("</head>","<style>"+(ROOT.parents[1]/"shared/ui/toolbox-theme.css").read_text(encoding="utf-8")+"</style></head>")
    page=page.replace("</head>","<script>"+(ROOT.parents[1]/"shared/ui/toast.js").read_text(encoding="utf-8")+"</script></head>")
    (PREVIEW / "index.html").write_text(page, encoding="utf-8")
    print(f"Built {PREVIEW / 'index.html'} ({len(page.encode('utf-8')):,} bytes)")


if __name__ == "__main__":
    build()
