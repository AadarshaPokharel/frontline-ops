"""Game balance and map definitions. The client and the game server download these from /api/config,
and match submissions are validated against them."""

# Maps are rectangles stamped onto a grid of 2 m tiles: "#" wall (3.2 m), "C" tall cover (2.3 m),
# "c" low cover you can crouch behind and shoot over (1.05 m), "." floor (used to carve doorways).
# The grid always gets a solid outer border. Texture repeats are in metres.
MAPS = [
    {
        "slug": "warehouse",
        "name": "Warehouse",
        "desc": "Close quarters between tall shelving, crates and a central office.",
        "w": 40,
        "h": 26,
        "theme": {
            "floor": "concrete", "floorRepeat": 6, "floorTint": "#d9d6cf",
            "wall": "iron", "wallTint": "#aeb6bd",
            "cover": ["crate"], "decor": ["jerrycan"],
            "background": "#15181c", "skyTop": "#4a5d75", "skyHorizon": "#9aa7b3", "fog": "#7f8a94",
            "sun": "#ffe9cc", "sunIntensity": 2.4,
            "hemiSky": "#c4d0dc", "hemiGround": "#3b3730", "hemiIntensity": 1.1,
            "mini": {"floor": "#3b3e37", "wall": "#6c7466", "cover": "#7d5c33"},
        },
        "rects": [
            [9, 3, 10, 2, "C"], [21, 3, 10, 2, "C"], [9, 21, 10, 2, "C"], [21, 21, 10, 2, "C"],
            [15, 9, 10, 8], [16, 10, 8, 6, "."], [19, 9, 2, 1, "."], [19, 16, 2, 1, "."],
            [15, 12, 1, 2, "."], [24, 12, 1, 2, "."], [19, 12, 2, 2, "c"],
            [5, 7, 2, 2, "c"], [5, 17, 2, 2, "c"], [33, 7, 2, 2, "c"], [33, 17, 2, 2, "c"],
            [10, 8, 1, 3], [29, 8, 1, 3], [10, 15, 1, 3], [29, 15, 1, 3], [12, 12, 2, 2, "C"], [26, 12, 2, 2, "C"],
        ],
    },
    {
        "slug": "desert",
        "name": "Desert Compound",
        "desc": "Four sandstone buildings around a watchtower. Mid-range lanes.",
        "w": 44,
        "h": 28,
        "theme": {
            "floor": "sand", "floorRepeat": 8, "floorTint": "#f2dcb5",
            "wall": "sandstone", "wallTint": "#e8d2ae",
            "cover": ["crate", "barrel"], "decor": ["jerrycan"],
            "background": "#4a3a26", "skyTop": "#5b8fc7", "skyHorizon": "#e9d3ae", "fog": "#d9c39c",
            "sun": "#fff0d2", "sunIntensity": 3.0,
            "hemiSky": "#ffe2b8", "hemiGround": "#7a5a36", "hemiIntensity": 1.0,
            "mini": {"floor": "#b39a68", "wall": "#9d7f56", "cover": "#5e4a2f"},
        },
        "rects": [
            [7, 3, 10, 7], [8, 4, 8, 5, "."], [11, 9, 2, 1, "."], [16, 6, 1, 2, "."], [7, 5, 1, 2, "."], [9, 5, 2, 1, "c"],
            [27, 3, 10, 7], [28, 4, 8, 5, "."], [31, 9, 2, 1, "."], [27, 6, 1, 2, "."], [36, 5, 1, 2, "."], [33, 7, 2, 1, "c"],
            [7, 18, 10, 7], [8, 19, 8, 5, "."], [11, 18, 2, 1, "."], [16, 20, 1, 2, "."], [7, 21, 1, 2, "."], [9, 22, 2, 1, "c"],
            [27, 18, 10, 7], [28, 19, 8, 5, "."], [31, 18, 2, 1, "."], [27, 20, 1, 2, "."], [36, 21, 1, 2, "."], [33, 20, 2, 1, "c"],
            [19, 11, 6, 6], [20, 12, 4, 4, "."], [21, 11, 2, 1, "."], [21, 16, 2, 1, "."], [19, 13, 1, 2, "."], [24, 13, 1, 2, "."],
            [19, 6, 2, 2, "c"], [23, 6, 2, 2, "c"], [19, 20, 2, 2, "c"], [23, 20, 2, 2, "c"],
            [3, 12, 2, 4, "C"], [39, 12, 2, 4, "C"], [12, 13, 2, 2, "c"], [30, 13, 2, 2, "c"],
        ],
    },
    {
        "slug": "ruins",
        "name": "Urban Ruins",
        "desc": "Bombed-out city blocks and a plaza. Flank through broken walls.",
        "w": 42,
        "h": 30,
        "theme": {
            "floor": "asphalt", "floorRepeat": 6, "floorTint": "#c9c9c9",
            "wall": "brick", "wallTint": "#d8c4bc",
            "cover": ["barrel", "crate"], "decor": ["jerrycan"],
            "background": "#101317", "skyTop": "#2c3550", "skyHorizon": "#8c7f86", "fog": "#5d5a62",
            "sun": "#d6ddff", "sunIntensity": 1.8,
            "hemiSky": "#8a9bb8", "hemiGround": "#2a2622", "hemiIntensity": 1.2,
            "mini": {"floor": "#30353a", "wall": "#737b86", "cover": "#475536"},
        },
        "rects": [
            [8, 3, 6, 5], [9, 4, 4, 3, "."], [11, 7, 2, 1, "."], [13, 4, 1, 2, "."],
            [18, 2, 6, 4],
            [28, 3, 6, 5], [29, 4, 4, 3, "."], [29, 7, 2, 1, "."], [28, 5, 1, 2, "."],
            [8, 22, 6, 5], [9, 23, 4, 3, "."], [11, 22, 2, 1, "."], [13, 24, 1, 2, "."],
            [18, 24, 6, 4],
            [28, 22, 6, 5], [29, 23, 4, 3, "."], [30, 22, 2, 1, "."], [28, 23, 1, 2, "."],
            [15, 11, 2, 8], [15, 14, 2, 2, "."], [25, 11, 2, 8], [25, 14, 2, 2, "."],
            [19, 13, 4, 4, "c"], [4, 12, 2, 6, "C"], [36, 12, 2, 6, "C"],
            [10, 13, 2, 2, "c"], [30, 15, 2, 2, "c"], [20, 8, 2, 1, "c"], [20, 21, 2, 1, "c"], [8, 10, 1, 3], [33, 17, 1, 3],
        ],
    },
]

# dmg is per bullet (per pellet for shotguns); falloff = [full damage until m, minimum from m, minimum multiplier];
# spreads are cone half-angles in radians; recoil is the view kick per shot; adsZoom multiplies the field of view.
WEAPONS = {
    "ar": {"name": "M4A1", "cls": "Assault Rifle", "mag": 30, "reserve": 150, "rpm": 750, "dmg": 28, "head": 1.5,
           "pellets": 1, "falloff": [30, 60, 0.7], "hipSpread": 0.045, "adsSpread": 0.004, "recoil": 0.012,
           "reload": 2.0, "auto": True, "adsZoom": 0.8, "sound": "ar"},
    "smg": {"name": "MP5", "cls": "SMG", "mag": 32, "reserve": 192, "rpm": 900, "dmg": 22, "head": 1.4,
            "pellets": 1, "falloff": [12, 30, 0.65], "hipSpread": 0.035, "adsSpread": 0.008, "recoil": 0.009,
            "reload": 1.8, "auto": True, "adsZoom": 0.85, "move": 1.08, "sound": "smg"},
    "shotgun": {"name": "Model 1887", "cls": "Shotgun", "mag": 7, "reserve": 42, "rpm": 80, "dmg": 18, "head": 1.2,
                "pellets": 9, "falloff": [6, 18, 0.3], "hipSpread": 0.085, "adsSpread": 0.07, "recoil": 0.05,
                "reload": 2.6, "auto": False, "adsZoom": 0.85, "move": 1.03, "sound": "shotgun"},
    "sniper": {"name": "Intervention", "cls": "Sniper Rifle", "mag": 5, "reserve": 30, "rpm": 45, "dmg": 110, "head": 2.0,
               "pellets": 1, "falloff": [100, 200, 1], "hipSpread": 0.09, "adsSpread": 0.0005, "recoil": 0.06,
               "reload": 3.0, "auto": False, "adsZoom": 0.6, "move": 0.9, "sound": "sniper"},
    "lmg": {"name": "RPD", "cls": "Light Machine Gun", "mag": 100, "reserve": 200, "rpm": 650, "dmg": 26, "head": 1.5,
            "pellets": 1, "falloff": [35, 70, 0.75], "hipSpread": 0.06, "adsSpread": 0.008, "recoil": 0.012,
            "reload": 4.5, "auto": True, "adsZoom": 0.78, "move": 0.85, "sound": "lmg"},
    "pistol": {"name": "M1911", "cls": "Pistol", "mag": 8, "reserve": 64, "rpm": 400, "dmg": 34, "head": 1.5,
               "pellets": 1, "falloff": [12, 30, 0.65], "hipSpread": 0.03, "adsSpread": 0.006, "recoil": 0.025,
               "reload": 1.5, "auto": False, "adsZoom": 0.85, "move": 1.1, "sound": "pistol"},
}
PRIMARIES = ["ar", "smg", "shotgun", "sniper", "lmg"]
SIDEARM = "pistol"

# Sights you can mount. zoom multiplies the field of view when aiming (None = the weapon's own adsZoom);
# scope = shows a scope view instead of the gun while fully aimed.
OPTICS = {
    "iron": {"name": "Iron Sights", "desc": "No optic. Fast and clear.", "zoom": None, "reticle": "iron", "scope": False},
    "reddot": {"name": "Red Dot", "desc": "Simple red dot, slight zoom.", "zoom": 0.75, "reticle": "dot", "scope": False},
    "holo": {"name": "Holographic", "desc": "Ring-and-dot reticle for close range.", "zoom": 0.72, "reticle": "holo", "scope": False},
    "acog": {"name": "ACOG 4x", "desc": "4x scope for picking targets at range.", "zoom": 0.38, "reticle": "chevron", "scope": True},
    "sniper": {"name": "Sniper Scope 8x", "desc": "High-power scope for long shots.", "zoom": 0.2, "reticle": "sniper", "scope": True},
}
WEAPON_OPTICS = {
    "ar": ["iron", "reddot", "holo", "acog"],
    "smg": ["iron", "reddot", "holo", "acog"],
    "shotgun": ["iron", "reddot", "holo"],
    "sniper": ["sniper", "acog", "iron"],
    "lmg": ["iron", "reddot", "holo", "acog"],
    "pistol": ["iron", "reddot"],
}
for _weapon_id, _optics in WEAPON_OPTICS.items():
    WEAPONS[_weapon_id]["optics"] = _optics   # the first one is the default

# Bot skill: reaction time (s), aim error (rad), turn speed (rad/s), whether they go for the head.
DIFFICULTIES = [
    {"name": "Recruit", "react": 0.7, "aim": 0.06, "turn": 3.0, "headshots": False},
    {"name": "Regular", "react": 0.45, "aim": 0.035, "turn": 5.0, "headshots": False},
    {"name": "Veteran", "react": 0.25, "aim": 0.015, "turn": 8.0, "headshots": True},
]

STREAKS = [
    {"kills": 3, "id": "uav", "name": "UAV"},
    {"kills": 5, "id": "care", "name": "Care Package"},
    {"kills": 7, "id": "air", "name": "Airstrike"},
]

MATCH = {"timeLimit": 480, "teamSize": 5, "scoreLimits": [15, 30, 50], "defaultScoreLimit": 30}

MAP_SLUGS = {m["slug"] for m in MAPS}

CLIENT_CONFIG = {
    "version": 3,
    "maps": MAPS,
    "weapons": WEAPONS,
    "optics": OPTICS,
    "primaries": PRIMARIES,
    "sidearm": SIDEARM,
    "difficulties": DIFFICULTIES,
    "streaks": STREAKS,
    "match": MATCH,
}
