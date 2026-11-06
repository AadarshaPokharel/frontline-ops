from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("config", views.config, name="config"),
    path("players", views.create_player, name="create-player"),
    path("players/<uuid:player_id>", views.player_detail, name="player-detail"),
    path("matches", views.submit_match, name="submit-match"),
    path("leaderboard", views.leaderboard, name="leaderboard"),
    path("internal/results", views.internal_results, name="internal-results"),
]
