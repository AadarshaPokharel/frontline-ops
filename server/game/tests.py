import json
from datetime import timedelta

from django.test import Client, TestCase, override_settings
from django.utils import timezone

from . import gamedata
from .models import Match, Player


def post(client, url, body, **extra):
    return client.post(url, json.dumps(body), content_type="application/json", **extra)


def match_body(who, **overrides):
    body = {
        "player": str(who.id), "map": "warehouse", "weapon": "ar", "difficulty": 1,
        "kills": 12, "deaths": 5, "score": 1450, "bestStreak": 6,
        "teamScore": 30, "enemyScore": 22, "duration": 300,
    }
    body.update(overrides)
    return body


class ConfigTests(TestCase):
    def test_config_lists_maps_and_weapons(self):
        res = self.client.get("/api/config")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual([m["slug"] for m in data["maps"]], ["warehouse", "desert", "ruins"])
        self.assertTrue(set(data["primaries"]) <= set(data["weapons"]))
        self.assertIn("max-age=300", res["Cache-Control"])

    def test_every_map_fits_its_grid(self):
        for m in gamedata.MAPS:
            for x, y, w, h, *_ in m["rects"]:
                self.assertTrue(0 < x and 0 < y and x + w < m["w"] and y + h < m["h"], (m["slug"], x, y))

    def test_index_sets_csrf_cookie(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("csrftoken", res.cookies)


class PlayerTests(TestCase):
    def test_create_and_rename(self):
        res = post(self.client, "/api/players", {"callsign": "Ghost"})
        self.assertEqual(res.status_code, 201)
        pid = res.json()["id"]
        res = self.client.patch(f"/api/players/{pid}", json.dumps({"callsign": "Soap-2"}), content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Player.objects.get(pk=pid).callsign, "Soap-2")

    def test_rejects_bad_callsign(self):
        for bad in ["", "x" * 13, "<script>"]:
            self.assertEqual(post(self.client, "/api/players", {"callsign": bad}).status_code, 400)

    def test_unknown_player_is_404(self):
        self.assertEqual(self.client.get("/api/players/00000000-0000-0000-0000-000000000000").status_code, 404)

    def test_csrf_is_enforced(self):
        strict = Client(enforce_csrf_checks=True)
        self.assertEqual(post(strict, "/api/players", {"callsign": "Ghost"}).status_code, 403)
        strict.get("/")
        token = strict.cookies["csrftoken"].value
        self.assertEqual(post(strict, "/api/players", {"callsign": "Ghost"}, HTTP_X_CSRFTOKEN=token).status_code, 201)


class MatchTests(TestCase):
    def setUp(self):
        self.player = Player.objects.create(callsign="Ghost")

    def test_submit_records_result_from_scores(self):
        res = post(self.client, "/api/matches", match_body(self.player))
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual(data["match"]["result"], "win")
        self.assertEqual(data["totals"]["kills"], 12)
        self.assertEqual(data["rank"], 1)

    def test_rejects_impossible_stats(self):
        cases = [
            {"map": "moon"}, {"weapon": "railgun"}, {"kills": -1}, {"kills": "12"},
            {"bestStreak": 13}, {"kills": 31, "teamScore": 30}, {"score": 999999},
            {"duration": 10_000}, {"player": "not-a-uuid"},
        ]
        for override in cases:
            res = post(self.client, "/api/matches", match_body(self.player, **override))
            self.assertEqual(res.status_code, 400, override)
        self.assertEqual(Match.objects.count(), 0)

    def test_cooldown_between_submissions(self):
        self.assertEqual(post(self.client, "/api/matches", match_body(self.player)).status_code, 201)
        self.assertEqual(post(self.client, "/api/matches", match_body(self.player)).status_code, 429)
        Match.objects.update(created_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(post(self.client, "/api/matches", match_body(self.player)).status_code, 201)


@override_settings(GAME_SERVER_KEY="test-key")
class GameServerResultsTests(TestCase):
    def setUp(self):
        self.player = Player.objects.create(callsign="Ghost")

    def test_requires_the_shared_key(self):
        body = {"matches": [match_body(self.player)]}
        self.assertEqual(post(self.client, "/api/internal/results", body).status_code, 403)
        self.assertEqual(post(self.client, "/api/internal/results", body, HTTP_X_GAME_SERVER_KEY="wrong").status_code, 403)
        self.assertEqual(Match.objects.count(), 0)

    def test_records_online_matches_without_cooldown(self):
        body = {"matches": [match_body(self.player), match_body(self.player, kills=3, score=300, bestStreak=2)]}
        res = post(self.client, "/api/internal/results", body, HTTP_X_GAME_SERVER_KEY="test-key")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["saved"], 2)
        self.assertEqual(Match.objects.filter(mode="online").count(), 2)

    def test_skips_invalid_reports(self):
        body = {"matches": [match_body(self.player, map="moon"), {"player": "00000000-0000-0000-0000-000000000000", **match_body(self.player)}]}
        body["matches"][1]["player"] = "00000000-0000-0000-0000-000000000000"
        res = post(self.client, "/api/internal/results", body, HTTP_X_GAME_SERVER_KEY="test-key")
        self.assertEqual(res.json(), {"saved": 0, "rejected": ["Unknown map.", "Unknown player."]})

    def test_leaderboard_filters_by_mode(self):
        post(self.client, "/api/internal/results", {"matches": [match_body(self.player)]}, HTTP_X_GAME_SERVER_KEY="test-key")
        post(self.client, "/api/matches", match_body(self.player, kills=1, score=100, bestStreak=1))
        online = self.client.get("/api/leaderboard", {"mode": "online"}).json()["rows"]
        practice = self.client.get("/api/leaderboard", {"mode": "practice"}).json()["rows"]
        self.assertEqual((online[0]["score"], practice[0]["score"]), (1450, 100))


@override_settings(GAME_SERVER_KEY="")
class GameServerDisabledTests(TestCase):
    def test_endpoint_is_off_without_a_key(self):
        self.assertEqual(post(self.client, "/api/internal/results", {"matches": []}, HTTP_X_GAME_SERVER_KEY="").status_code, 403)


class LeaderboardTests(TestCase):
    def setUp(self):
        self.a = Player.objects.create(callsign="Alpha")
        self.b = Player.objects.create(callsign="Bravo")
        common = dict(weapon="ar", difficulty=1, deaths=3, best_streak=3, team_score=30, enemy_score=10, duration=200, result="win")
        Match.objects.create(player=self.a, map_slug="warehouse", kills=10, score=1000, **common)
        Match.objects.create(player=self.b, map_slug="desert", kills=20, score=2500, **common)
        old = Match.objects.create(player=self.a, map_slug="desert", kills=20, score=2400, **common)
        Match.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=30))

    def test_orders_by_total_score_and_hides_ids(self):
        rows = self.client.get("/api/leaderboard").json()["rows"]
        self.assertEqual([(r["callsign"], r["score"]) for r in rows], [("Alpha", 3400), ("Bravo", 2500)])
        self.assertNotIn(str(self.a.id), json.dumps(rows))

    def test_filters_by_map_and_period(self):
        rows = self.client.get("/api/leaderboard", {"map": "desert", "period": "week"}).json()["rows"]
        self.assertEqual([r["callsign"] for r in rows], ["Bravo"])

    def test_flags_callers_row(self):
        rows = self.client.get("/api/leaderboard", HTTP_X_PLAYER=str(self.b.id)).json()["rows"]
        self.assertEqual([r["me"] for r in rows], [False, True])

    def test_rejects_unknown_filters(self):
        self.assertEqual(self.client.get("/api/leaderboard", {"map": "moon"}).status_code, 400)
        self.assertEqual(self.client.get("/api/leaderboard", {"period": "year"}).status_code, 400)
