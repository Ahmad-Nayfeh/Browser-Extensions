#!/usr/bin/env python3
"""
Convert Adblock-Plus-style filter lists (EasyList, EasyPrivacy, ...) into
Chrome Manifest V3 assets:

  * declarativeNetRequest static rulesets (JSON)  -> network blocking
  * generic.css                                    -> element hiding on every site
  * specific.json  {domain: [selectors]}           -> element hiding per site
  * generichide.json [domains]                     -> sites where generic.css must not run

Usage:
  python3 tools/build_filters.py adblock   # builds extensions/01-ad-blocker/filters
  python3 tools/build_filters.py cookies   # builds extensions/09-cookie-dismiss/filters

Lists are downloaded into tools/cache/ (ignored by git). Pass --offline to
reuse the cached copies.
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache")

LISTS = {
    "easylist": "https://easylist.to/easylist/easylist.txt",
    "easyprivacy": "https://easylist.to/easylist/easyprivacy.txt",
    "peterlowe": "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&mimetype=plaintext",
    "cookies": "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
}

TARGETS = {
    "adblock": {
        "out": "extensions/01-ad-blocker/filters",
        "network": ["easylist", "easyprivacy", "peterlowe"],
        "cosmetic": ["easylist"],
    },
    "cookies": {
        "out": "extensions/09-cookie-dismiss/filters",
        "network": [],          # blocking consent scripts breaks too many sites
        "cosmetic": ["cookies"],
    },
}

# ABP option -> DNR resource type
TYPE_MAP = {
    "script": "script",
    "image": "image",
    "stylesheet": "stylesheet",
    "object": "object",
    "xmlhttprequest": "xmlhttprequest",
    "subdocument": "sub_frame",
    "ping": "ping",
    "media": "media",
    "font": "font",
    "websocket": "websocket",
    "other": "other",
}
# options we understand but that don't change the DNR condition
IGNORED_OPTIONS = {"all"}
HOST_RE = re.compile(r"^[a-z0-9.-]+$")
ALLOW_ID_BASE = 900000


def fetch(name, offline):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + ".txt")
    if not offline or not os.path.exists(path):
        print(f"  downloading {name} ...")
        req = urllib.request.Request(LISTS[name], headers={"User-Agent": "filter-builder"})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def to_ascii_domain(d):
    d = d.strip().lower()
    if not d:
        return None
    try:
        d.encode("ascii")
        return d
    except UnicodeEncodeError:
        try:
            return d.encode("idna").decode("ascii")
        except Exception:
            return None


# --------------------------------------------------------------------------
# Network filters
# --------------------------------------------------------------------------
def parse_network(line):
    """Return (is_exception, condition_dict, action_override) or None if unsupported."""
    exception = line.startswith("@@")
    if exception:
        line = line[2:]

    pattern, options = line, ""
    if "$" in line:
        idx = line.rfind("$")
        # a '$' inside a regex or path is rare; treat last '$' as option separator
        pattern, options = line[:idx], line[idx + 1:]

    if pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 1:
        return None  # regex filters: skipped (DNR allows only ~1000, RE2 only)

    cond = {}
    types, not_types = [], []
    document = False
    for opt in filter(None, options.split(",")):
        neg = opt.startswith("~")
        name = opt[1:] if neg else opt
        value = None
        if "=" in name:
            name, value = name.split("=", 1)
        if name in TYPE_MAP:
            (not_types if neg else types).append(TYPE_MAP[name])
        elif name == "third-party" or name == "3p":
            cond["domainType"] = "firstParty" if neg else "thirdParty"
        elif name == "first-party" or name == "1p":
            cond["domainType"] = "thirdParty" if neg else "firstParty"
        elif name == "domain" and value:
            inc, exc = [], []
            for d in value.split("|"):
                n = d.startswith("~")
                d = to_ascii_domain(d[1:] if n else d)
                if not d or d.endswith(".*") or "*" in d:
                    continue  # entity wildcards not supported by DNR
                (exc if n else inc).append(d)
            if inc:
                cond["initiatorDomains"] = inc
            elif not exc:
                return None  # every domain was unsupported
            if exc:
                cond["excludedInitiatorDomains"] = exc
        elif name == "match-case":
            cond["isUrlFilterCaseSensitive"] = True
        elif name == "document" or name == "doc":
            document = True
        elif name in IGNORED_OPTIONS:
            pass
        else:
            return None  # popup, csp, rewrite, redirect, removeparam, generichide, ...

    if document:
        types = ["main_frame", "sub_frame"]
    if types:
        cond["resourceTypes"] = sorted(set(types))
    elif not_types:
        cond["excludedResourceTypes"] = sorted(set(not_types))

    pattern = pattern.strip()
    if not pattern or pattern in ("*", "|", "||"):
        return None
    try:
        pattern.encode("ascii")
    except UnicodeEncodeError:
        return None
    # DNR: '||' only allowed at the very start, '|' only at start/end
    body = pattern[2:] if pattern.startswith("||") else pattern.lstrip("|")
    if "|" in body.rstrip("|"):
        return None
    if pattern.startswith("||*"):
        pattern = pattern[2:]

    # plain "||host^" -> can be grouped into requestDomains
    m = re.fullmatch(r"\|\|([a-z0-9.-]+)\^?", pattern)
    if m and HOST_RE.match(m.group(1)) and "." in m.group(1):
        cond["_host"] = m.group(1)
    else:
        cond["urlFilter"] = pattern

    return exception, cond, document


def build_ruleset(lines, start_id):
    rules = []
    groups = {}  # signature -> list of hosts
    generichide = set()
    stats = {"network": 0, "skipped": 0}

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("!") or line.startswith("["):
            continue
        if "##" in line or "#@#" in line or "#?#" in line or "#$#" in line or "#%#" in line:
            continue
        # $generichide / $elemhide exceptions affect cosmetic filtering only
        if line.startswith("@@") and re.search(r"\$(.*,)?(generichide|elemhide|ghide|ehide)(,|$)", line):
            m = re.match(r"@@\|\|([a-z0-9.-]+)\^", line)
            if m:
                generichide.add(m.group(1))
            continue
        parsed = parse_network(line)
        if not parsed:
            stats["skipped"] += 1
            continue
        exception, cond, document = parsed
        stats["network"] += 1

        if exception:
            action = {"type": "allowAllRequests" if document else "allow"}
            priority = 2
            if document:
                cond["resourceTypes"] = ["main_frame", "sub_frame"]
        else:
            action = {"type": "block"}
            priority = 1

        host = cond.pop("_host", None)
        if host:
            sig = json.dumps([action, priority, cond], sort_keys=True)
            groups.setdefault(sig, []).append(host)
        else:
            rules.append({"priority": priority, "action": action, "condition": cond})

    for sig, hosts in groups.items():
        action, priority, cond = json.loads(sig)
        hosts = sorted(set(hosts))
        for i in range(0, len(hosts), 1000):
            c = dict(cond)
            c["requestDomains"] = hosts[i:i + 1000]
            rules.append({"priority": priority, "action": action, "condition": c})

    # block/redirect rules get ids from start_id, exceptions from ALLOW_ID_BASE,
    # so the popup can count only real blocks (getMatchedRules has no action field)
    blocks = [r for r in rules if r["action"]["type"] == "block"]
    allows = [r for r in rules if r["action"]["type"] != "block"]
    for i, r in enumerate(blocks):
        r["id"] = start_id + i
    for i, r in enumerate(allows):
        r["id"] = ALLOW_ID_BASE + start_id + i
    return blocks + allows, generichide, stats


# --------------------------------------------------------------------------
# Cosmetic filters
# --------------------------------------------------------------------------
def rightmost_compound(sel):
    """Return the last compound selector (after the last combinator) outside () and []."""
    depth = 0
    last = 0
    i = 0
    while i < len(sel):
        ch = sel[i]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif depth == 0 and ch in " >+~":
            last = i + 1
        i += 1
    return sel[last:]


def is_cheap_generic(sel):
    """
    True when the browser can index the selector by id/class (rule hashing).
    Selectors whose right-most part is only a tag or an attribute are tested
    against every element of every page -> skipped to keep CPU usage low.
    """
    if any(x in sel for x in (":has(", ":-abp-", ":xpath", ":has-text", ":upward", ":style", "{")):
        return False
    comp = rightmost_compound(sel).strip()
    stripped = re.sub(r"\[[^\]]*\]", "", comp)   # remove attribute parts
    stripped = re.sub(r"\([^)]*\)", "", stripped)
    return "#" in stripped or "." in stripped


def build_cosmetic(lines):
    generic = set()
    specific = {}
    exceptions_generic = set()
    exceptions_specific = {}

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("!"):
            continue
        for sep in ("#@#", "##"):
            if sep in line:
                domains, sel = line.split(sep, 1)
                break
        else:
            continue
        if sel.startswith("+js(") or not sel:
            continue
        domains = [d for d in domains.split(",") if d]
        pos = [to_ascii_domain(d) for d in domains if not d.startswith("~")]
        pos = [d for d in pos if d]
        if sep == "#@#":
            if pos:
                for d in pos:
                    exceptions_specific.setdefault(d, set()).add(sel)
                exceptions_generic.add(sel)
            continue
        if not domains:
            generic.add(sel)
        elif pos:
            for d in pos:
                specific.setdefault(d, set()).add(sel)
        # negated-only domain lists ("~a.com##.x") are rare -> skipped

    # generic selectors with any exception would hide content on sites that
    # explicitly asked not to -> drop them (we cannot "un-hide" per site cheaply)
    generic -= exceptions_generic
    cheap = sorted(s for s in generic if is_cheap_generic(s))

    out_specific = {}
    for d, sels in specific.items():
        sels = sels - exceptions_specific.get(d, set())
        if sels:
            out_specific[d] = sorted(sels)
    return cheap, out_specific, len(generic)


def write_css(path, selectors):
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* generated by tools/build_filters.py - do not edit */\n")
        for s in selectors:
            f.write(s + "{display:none!important}\n")


def main():
    offline = "--offline" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    targets = args or list(TARGETS)
    for t in targets:
        cfg = TARGETS[t]
        out = os.path.join(ROOT, cfg["out"])
        os.makedirs(out, exist_ok=True)
        print(f"[{t}] -> {cfg['out']}")
        generichide = set()
        rulesets = []
        next_id = 1
        for name in cfg["network"]:
            rules, gh, stats = build_ruleset(fetch(name, offline), next_id)
            next_id += sum(1 for r in rules if r["action"]["type"] == "block")
            generichide |= gh
            with open(os.path.join(out, f"{name}.json"), "w") as f:
                json.dump(rules, f, separators=(",", ":"))
            rulesets.append(name)
            print(f"  {name}: {stats['network']} filters -> {len(rules)} rules "
                  f"({stats['skipped']} unsupported skipped)")
        cos_lines = []
        for name in cfg["cosmetic"]:
            cos_lines += fetch(name, offline)
            if not cfg["network"]:
                _, gh, _ = build_ruleset(fetch(name, offline), 1)
                generichide |= gh
        generic, specific, total_generic = build_cosmetic(cos_lines)
        write_css(os.path.join(out, "generic.css"), generic)
        with open(os.path.join(out, "specific.json"), "w") as f:
            json.dump(specific, f, separators=(",", ":"), sort_keys=True)
        with open(os.path.join(out, "generichide.json"), "w") as f:
            json.dump(sorted(generichide), f)
        print(f"  cosmetic: {len(generic)}/{total_generic} generic selectors kept, "
              f"{len(specific)} sites with specific rules, {len(generichide)} generichide sites")
        print(f"  rulesets: {rulesets}  (total rules: {next_id - 1})")


if __name__ == "__main__":
    main()
