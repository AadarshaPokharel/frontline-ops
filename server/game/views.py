import hmac
import json
import re
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.db.models import Count, Max, Q, Sum
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.cache import cache_control
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from . import gamedata
from .models import Match, Player

CALLSIGN_RE = re.compile(r"^[A-Za-z0-9 _.-]{1,12}$")
MATCH_COOLDOWN = timedelta(seconds=15)
NEW_PLAYERS_PER_MINUTE = 10
MAX_SCORE_PER_KILL = 400  # a kill is worth 100, +50 for a headshot, plus at most 250 multi-kill bonus
PERIODS = {"all": None, "week": timedelta(days=7), "day": timedelta(days=1)}
MODES = {"all", Match.Mode.PRACTICE, Match.Mode.ONLINE}


def error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def read_json(request):
    if len(request.body) > 4096:
        raise ValueError("Request body is too large.")
    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Body must be JSON.") from exc
    if not isinstance(data, dict):
        raise ValueError("Body must be a JSON object.")
    return data


def clean_callsign(value):
    callsign = str(value or "").strip()
    if not CALLSIGN_RE.match(callsign):
        raise ValueError("Callsign must be 1-12 letters, digits, spaces, '.', '_' or '-'.")
    return callsign


def int_field(data, key, lo, hi):
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError(f"'{key}' must be a whole number from {lo} to {hi}.")
    return value


def client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if settings.TRUST_X_FORWARDED_FOR and forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def throttled(request, bucket, limit, window=60):
    """Small fixed-window limiter keyed by client IP (per worker process)."""
    key = f"throttle:{bucket}:{client_ip(request)}"
    cache.add(key, 0, window)
    try:
        return cache.incr(key) > limit
    except ValueError:  # the key expired between add() and incr()
        cache.set(key, 1, window)
        return False


def match_payload(match):
    return {
        "map": match.map_slug, "mode": match.mode, "weapon": match.weapon, "result": match.result,
        "kills": match.kills, "deaths": match.deaths, "score": match.score,
        "teamScore": match.team_score, "enemyScore": match.enemy_score,
        "playedAt": match.created_at.isoformat(),
    }


def player_totals(player):
    totals = player.matches.aggregate(
        matches=Count("id"),
        wins=Count("id", filter=Q(result=Match.Result.WIN)),
        kills=Sum("kills"),
        deaths=Sum("deaths"),
        score=Sum("score"),
        best_streak=Max("best_streak"),
    )
    return {key: value or 0 for key, value in totals.items()}


def player_rank(total_score):
    if not total_score:
        return None
    ahead = Match.objects.values("player").annotate(total=Sum("score")).filter(total__gt=total_score).count()
    return ahead + 1


def player_payload(player, with_stats=False):
    data = {"id": str(player.id), "callsign": player.callsign}
    if with_stats:
        totals = player_totals(player)
        data.update(totals=totals, rank=player_rank(totals["score"]),
                    recent=[match_payload(m) for m in player.matches.all()[:5]])
    return data


def clean_match(data):
    try:
        player_id = uuid.UUID(str(data.get("player")))
    except ValueError as exc:
        raise ValueError("'player' must be a player id.") from exc
    if data.get("map") not in gamedata.MAP_SLUGS:
        raise ValueError("Unknown map.")
    if data.get("weapon") not in gamedata.PRIMARIES:
        raise ValueError("Unknown weapon.")
    # Several kills can land in the same frame (an airstrike), so a team can finish a little past the limit.
    top_score = max(gamedata.MATCH["scoreLimits"]) + 10
    fields = {
        "player_id": player_id,
        "map_slug": data["map"],
        "weapon": data["weapon"],
        "difficulty": int_field(data, "difficulty", 0, len(gamedata.DIFFICULTIES) - 1),
        "kills": int_field(data, "kills", 0, top_score),
        "deaths": int_field(data, "deaths", 0, 500),
        "score": int_field(data, "score", 0, top_score * MAX_SCORE_PER_KILL),
        "best_streak": int_field(data, "bestStreak", 0, top_score),
        "team_score": int_field(data, "teamScore", 0, top_score),
        "enemy_score": int_field(data, "enemyScore", 0, top_score),
        "duration": int_field(data, "duration", 1, gamedata.MATCH["timeLimit"] + 60),
    }
    if fields["best_streak"] > fields["kills"]:
        raise ValueError("Best streak cannot be higher than kills.")
    if fields["kills"] > fields["team_score"]:
        raise ValueError("Kills cannot be higher than the team score.")
    if fields["score"] > fields["kills"] * MAX_SCORE_PER_KILL:
        raise ValueError("Score is too high for the number of kills.")
    team, enemy = fields["team_score"], fields["enemy_score"]
    fields["result"] = Match.Result.WIN if team > enemy else Match.Result.LOSS if team < enemy else Match.Result.DRAW
    return fields


@ensure_csrf_cookie
def index(request):
    return render(request, "index.html")


@require_GET
def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"ok": True})


@require_GET
@cache_control(public=True, max_age=300)
def config(request):
    return JsonResponse(gamedata.CLIENT_CONFIG)


@require_POST
def create_player(request):
    if throttled(request, "players", NEW_PLAYERS_PER_MINUTE):
        return error("Too many new players from this address. Try again in a minute.", 429)
    try:
        callsign = clean_callsign(read_json(request).get("callsign"))
    except ValueError as exc:
        return error(str(exc))
    player = Player.objects.create(callsign=callsign)
    return JsonResponse(player_payload(player, with_stats=True), status=201)


@require_http_methods(["GET", "PATCH"])
def player_detail(request, player_id):
    player = Player.objects.filter(pk=player_id).first()
    if player is None:
        return error("Unknown player.", 404)
    if request.method == "PATCH":
        try:
            player.callsign = clean_callsign(read_json(request).get("callsign"))
        except ValueError as exc:
            return error(str(exc))
        player.save(update_fields=["callsign", "last_seen"])
    return JsonResponse(player_payload(player, with_stats=True))


@require_POST
def submit_match(request):
    try:
        fields = clean_match(read_json(request))
    except ValueError as exc:
        return error(str(exc))
    player = Player.objects.filter(pk=fields.pop("player_id")).first()
    if player is None:
        return error("Unknown player.", 404)
    last = player.matches.filter(mode=Match.Mode.PRACTICE).only("created_at").first()
    if last and timezone.now() - last.created_at < MATCH_COOLDOWN:
        return error("Matches are being submitted too quickly.", 429)
    match = Match.objects.create(player=player, **fields)
    player.save(update_fields=["last_seen"])
    payload = player_payload(player, with_stats=True)
    payload["match"] = match_payload(match)
    return JsonResponse(payload, status=201)


@csrf_exempt   # server-to-server: authenticated by the shared key instead of a browser session
@require_POST
def internal_results(request):
    """The game server reports online matches it ran; these are not limited by the browser cooldown."""
    key = request.headers.get("X-Game-Server-Key", "")
    if not settings.GAME_SERVER_KEY or not hmac.compare_digest(key, settings.GAME_SERVER_KEY):
        return error("Forbidden.", 403)
    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return error("Body must be JSON.")
    reports = body.get("matches") if isinstance(body, dict) else None
    if not isinstance(reports, list) or len(reports) > 20:
        return error("'matches' must be a list of up to 20 results.")
    saved, rejected = 0, []
    with transaction.atomic():
        for report in reports:
            try:
                fields = clean_match(report if isinstance(report, dict) else {})
            except ValueError as exc:
                rejected.append(str(exc))
                continue
            player = Player.objects.filter(pk=fields.pop("player_id")).first()
            if player is None:
                rejected.append("Unknown player.")
                continue
            Match.objects.create(player=player, mode=Match.Mode.ONLINE, **fields)
            player.save(update_fields=["last_seen"])
            saved += 1
    return JsonResponse({"saved": saved, "rejected": rejected}, status=201 if saved else 200)


@require_GET
def leaderboard(request):
    map_slug = request.GET.get("map", "all")
    period = request.GET.get("period", "all")
    mode = request.GET.get("mode", "all")
    if map_slug != "all" and map_slug not in gamedata.MAP_SLUGS:
        return error("Unknown map.")
    if period not in PERIODS:
        return error("Unknown period.")
    if mode not in MODES:
        return error("Unknown mode.")
    matches = Match.objects.all()
    if map_slug != "all":
        matches = matches.filter(map_slug=map_slug)
    if mode != "all":
        matches = matches.filter(mode=mode)
    if PERIODS[period]:
        matches = matches.filter(created_at__gte=timezone.now() - PERIODS[period])
    rows = (
        matches.values("player_id", "player__callsign")
        .annotate(
            score=Sum("score"), kills=Sum("kills"), deaths=Sum("deaths"), matches=Count("id"),
            wins=Count("id", filter=Q(result=Match.Result.WIN)), best_streak=Max("best_streak"),
        )
        .order_by("-score", "-kills", "player__callsign")[:25]
    )
    # Player ids work like passwords here, so they are never sent; the caller's own row is flagged instead.
    me = request.headers.get("X-Player", "")
    return JsonResponse({
        "map": map_slug,
        "period": period,
        "mode": mode,
        "rows": [
            {
                "rank": i + 1, "callsign": row["player__callsign"], "score": row["score"],
                "kills": row["kills"], "deaths": row["deaths"], "matches": row["matches"],
                "wins": row["wins"], "bestStreak": row["best_streak"], "me": str(row["player_id"]) == me,
            }
            for i, row in enumerate(rows)
        ],
    })
