from django.contrib import admin
from django.urls import include, path

from game import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("game.urls")),
    path("", views.index, name="index"),
]
