import json, sys, urllib.request, urllib.parse, os, re
UA = {"User-Agent": "plant-reference-fetch/1.0 (research script)"}
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
queries = {
 "boxwood_ball": "boxwood topiary",
 "boxwood_ball2": "Buxus ball garden",
 "boxwood_hedge": "Buxus hedge clipped",
 "zelkova_dangsan": "Zelkova serrata Korea village",
 "zelkova_big": "Zelkova serrata dangsan namu",
 "zelkova_crown": "Zelkova serrata tree",
 "mulch_bed": "mulch garden bed",
 "planter_korea": "flower planter Seoul street",
}
import os
out = json.load(open("sources.json",encoding="utf-8")) if os.path.exists("sources.json") else {}
for key, q in queries.items():
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search", "gsrsearch": q + " filetype:bitmap",
        "gsrnamespace": 6, "gsrlimit": 6, "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 1000})
    try:
        js = json.loads(get(api))
    except Exception as e:
        print(key, "ERR", e); continue
    pages = sorted(js.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    n = 0
    for p in pages:
        ii = p["imageinfo"][0]
        md = ii.get("extmetadata", {})
        lic = md.get("LicenseShortName", {}).get("value", "")
        if not re.search(r"CC|Public|PD", lic, re.I):
            continue
        art = re.sub("<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip()
        fn = f"{key}_{n+1}.jpg"
        try:
            open(fn, "wb").write(get(ii["thumburl"]))
        except Exception as e:
            print("dl fail", e); continue
        out[fn] = {"title": p["title"], "page": ii["descriptionurl"], "license": lic, "author": art}
        n += 1
        if n >= 3: break
    print(key, n)
json.dump(out, open("sources.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
