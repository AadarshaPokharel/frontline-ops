import uuid

from django.db import models


class Player(models.Model):
    """An anonymous player profile. The browser keeps the id; there is no login."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    callsign = models.CharField(max_length=12)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.callsign


class Match(models.Model):
    class Result(models.TextChoices):
        WIN = "win", "Win"
        LOSS = "loss", "Loss"
        DRAW = "draw", "Draw"

    class Mode(models.TextChoices):
        PRACTICE = "practice", "Practice vs bots"   # reported by the browser, plausibility-checked
        ONLINE = "online", "Online"                 # reported by the game server, which ran the match

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="matches")
    mode = models.CharField(max_length=8, choices=Mode.choices, default=Mode.PRACTICE)
    map_slug = models.CharField(max_length=32)
    weapon = models.CharField(max_length=16)
    difficulty = models.PositiveSmallIntegerField()
    result = models.CharField(max_length=4, choices=Result.choices)
    kills = models.PositiveIntegerField()
    deaths = models.PositiveIntegerField()
    score = models.PositiveIntegerField()
    best_streak = models.PositiveIntegerField()
    team_score = models.PositiveSmallIntegerField()
    enemy_score = models.PositiveSmallIntegerField()
    duration = models.PositiveIntegerField(help_text="Match length in seconds.")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["map_slug", "created_at"]),
            models.Index(fields=["player", "created_at"]),
        ]

    def __str__(self):
        return f"{self.player} {self.result} on {self.map_slug} ({self.kills}/{self.deaths})"
