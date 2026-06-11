import os, re
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SCALE = 2
URL = "http://localhost:3010"
ACCENT = (45, 224, 200)
AMBER = (251, 191, 36)
WHITE = (240, 245, 248)
GRAY = (158, 170, 180)

def font(path, size):
    return ImageFont.truetype(path, size)
FB = r"C:\Windows\Fonts\segoeuib.ttf"   # bold
FR = r"C:\Windows\Fonts\segoeui.ttf"    # regular
F_TITLE = font(FB, 46)
F_SUB = font(FR, 30)
F_NUM = font(FB, 44)
F_TAG = font(FB, 24)

# Frames: (id, nav, number, title, subtitle, primary_targets[], secondary_targets[])
# nav: ("settings",) or ("step", N)
FRAMES = [
    ("01_settings", ("settings",), "1", "Set up your AI provider",
     "Pick a provider, paste your API key, and choose a model. Mistral has a free tier.",
     ['input[placeholder*="key" i]', 'input[type="password"]'], []),
    ("02_mode", ("step", 0), "2", "Choose mode & output track",
     "SFW or NSFW sets the compliance rules; the track decides what package you build.",
     ['text=SAFE FOR WORK', 'text=MODE A'], ['text=FULL STORY PACKAGE']),
    ("03_concept", ("step", 1), "3", "Drop in your concept",
     "Paste your premise, set a token budget, then let the AI refine it with you.",
     ['text=HELP ME REFINE', 'text=Help me Refine'], ['text=TOKEN SUMMARY']),
    ("04_sync", ("step", 2), "4", "Set the world with UI controls — then Sync",
     "Choose Setting, Tone, Art & Palette in the panel, then hit Sync to brief the AI.",
     ['button:has-text("Sync")'], []),
    ("05_grounding", ("step", 5), "5", "Ground your world",
     "Define the rules your story runs on — design your own or let the AI propose them.",
     ['text=Design your own', 'text=DESIGN YOUR OWN', 'text=Build your own', 'text=Design Your Own'], []),
    ("06_plotcard", ("step", 7), "6", "Generate & recolor the story card",
     "Draft the HTML plot card, then tune its palette live with Chromatic Tuning.",
     ['text=CHROMATIC_TUNING', 'text=REGENERATE CARD'], []),
    ("07_characters", ("step", 8), "7", "Build your cast",
     "Each character gets a sheet + HTML card. Watch the per-card token meter and Tighten if over cap.",
     ['text=CONSTRUCT NEW PERSONA', 'text=INIT_PERSONA_SYNC'], ['text=GOTHIC']),
    ("08_deliverables", ("step", 10), "8", "Co-work the deployable deliverables",
     "Prompt Plot, Guidelines, Reminders & First Message — generate each with one button.",
     ['text=TRIGGER_COHESION', 'text=FORMULATE THE PROMPT PLOT'], []),
    ("09_compact", ("step", 11), "9", "Trim tokens with Compact mode",
     "Compact Guidelines keep the rulebook lean so the whole package fits the budget.",
     ['text=COMPACT MODE'], ['text=TOKEN SUMMARY']),
    ("10_export", ("step", 15), "10", "Check integrity, then export to ISK0",
     "When the package reads VERIFIED, hit Export_Core and paste the result into ISK0.",
     ['text=Export_Core', 'text=EXPORT_CORE'], ['text=MASTER_INTEGRITY_VERIFIED']),
]

def bbox(page, selectors):
    for sel in selectors:
        try:
            if sel.startswith("text="):
                loc = page.get_by_text(sel[5:], exact=False).first
            else:
                loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=1200)
            b = loc.bounding_box()
            if b and b["width"] > 2 and b["height"] > 2:
                return b
        except Exception:
            pass
    return None

def ring(draw, b, color, pad=8, w=5):
    x, y = b["x"]*SCALE, b["y"]*SCALE
    ww, hh = b["width"]*SCALE, b["height"]*SCALE
    draw.rounded_rectangle([x-pad, y-pad, x+ww+pad, y+hh+pad], radius=14, outline=color, width=w)

def arrow(draw, b, color):
    # short arrow pointing UP into the target's bottom edge from below
    import math
    cx = (b["x"] + b["width"]/2)*SCALE
    by = (b["y"] + b["height"])*SCALE
    end = (cx, by + 14)
    start = (cx, by + 150)
    draw.line([start, end], fill=color, width=7)
    # arrowhead
    ah = 26
    draw.polygon([(end[0], end[1]), (end[0]-ah*0.6, end[1]+ah), (end[0]+ah*0.6, end[1]+ah)], fill=color)

def caption(draw, W, H, num, title, sub):
    bandH = 196
    top = H - bandH
    draw.rectangle([0, top, W, H], fill=(9, 11, 15, 238))
    draw.rectangle([0, top, W, top+6], fill=ACCENT)
    # number chip
    cx0, cy0 = 50, top+50
    draw.rounded_rectangle([cx0, cy0, cx0+96, cy0+96], radius=16, fill=ACCENT)
    tb = draw.textbbox((0,0), num, font=F_NUM)
    draw.text((cx0+48-(tb[2]-tb[0])/2, cy0+48-(tb[3]-tb[1])/2 - tb[1]), num, font=F_NUM, fill=(9,11,15))
    # title + subtitle
    tx = cx0 + 96 + 40
    draw.text((tx, top+44), title, font=F_TITLE, fill=WHITE)
    draw.text((tx, top+108), sub, font=F_SUB, fill=GRAY)
    # brand tag bottom-right
    tag = "AETHER_CORE · USCS WORKSHOP"
    tgb = draw.textbbox((0,0), tag, font=F_TAG)
    draw.text((W-(tgb[2]-tgb[0])-50, H-44), tag, font=F_TAG, fill=(90,100,110))

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1480, "height": 920}, device_scale_factor=SCALE)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1500)
        # load example
        page.click("button:has(svg.lucide-circle-question-mark)")
        page.wait_for_timeout(600)
        page.get_by_text("Load example project", exact=False).first.click()
        page.wait_for_timeout(1800)
        page.keyboard.press("Escape")
        page.evaluate("()=>{const k='aether_core_state_v1';const s=JSON.parse(localStorage.getItem(k));s.aiProvider='mistral';s.modelSettings=s.modelSettings||{};s.modelSettings.model='mistral-medium-latest';localStorage.setItem(k,JSON.stringify(s));}")

        for fid, nav, num, title, sub, prim, sec in FRAMES:
            if nav[0] == "settings":
                page.reload(wait_until="networkidle"); page.wait_for_timeout(1100)
                page.click("button:has(svg.lucide-settings)"); page.wait_for_timeout(700)
            else:
                page.evaluate("(n)=>{const k='aether_core_state_v1';const s=JSON.parse(localStorage.getItem(k));s.step=n;localStorage.setItem(k,JSON.stringify(s));}", nav[1])
                page.reload(wait_until="networkidle"); page.wait_for_timeout(1100)
            tmp = os.path.join(OUT, "_tmp.png")
            page.screenshot(path=tmp)
            pb = bbox(page, prim)
            sbs = [bbox(page, [s]) for s in sec]
            img = Image.open(tmp).convert("RGB")
            draw = ImageDraw.Draw(img, "RGBA")
            W, H = img.size
            for sb in sbs:
                if sb: ring(draw, sb, AMBER, pad=10, w=4)
            if pb:
                ring(draw, pb, AMBER, pad=10, w=6)
                arrow(draw, pb, AMBER)
            caption(draw, W, H, num, title, sub)
            img.save(os.path.join(OUT, fid + ".png"))
            print(fid, "ok" if pb else "NO-TARGET")
        os.path.exists(tmp) and os.remove(tmp)
        browser.close()

if __name__ == "__main__":
    main()
