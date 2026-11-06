from django.contrib import admin

from .models import Match, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("callsign", "created_at", "last_seen")
    search_fields = ("callsign",)


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ("player", "map_slug", "weapon", "result", "kills", "deaths", "score", "created_at")
    list_filter = ("map_slug", "result", "weapon", "difficulty")
    list_select_related = ("player",)
