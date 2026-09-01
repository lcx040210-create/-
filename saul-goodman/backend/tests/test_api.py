# tests/test_api.py
import db
from main import app
from fastapi.testclient import TestClient


def _fresh_client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    db.init_db()
    return TestClient(app)


def test_create_player_returns_id(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    r = c.post("/api/players", json={"username": "saul", "email": "x@y.z"})
    assert r.status_code == 200
    assert r.json()["player_id"] >= 1


def test_create_player_rejects_duplicate_username(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    c.post("/api/players", json={"username": "saul"})
    r = c.post("/api/players", json={"username": "saul"})
    assert r.status_code == 409


def test_submit_score_and_leaderboard(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    a = c.post("/api/players", json={"username": "alice"}).json()["player_id"]
    b = c.post("/api/players", json={"username": "bob"}).json()["player_id"]
    c.post("/api/scores", json={"player_id": a, "win_index": 80, "score": 4000})
    c.post("/api/scores", json={"player_id": b, "win_index": 55, "score": 2000})
    lb = c.get("/api/leaderboard").json()["players"]
    assert [p["username"] for p in lb] == ["alice", "bob"]
    assert lb[0]["win_index"] == 80


def test_submit_score_returns_rank(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    a = c.post("/api/players", json={"username": "alice"}).json()["player_id"]
    b = c.post("/api/players", json={"username": "bob"}).json()["player_id"]
    c.post("/api/scores", json={"player_id": a, "win_index": 80, "score": 4000})
    r = c.post("/api/scores", json={"player_id": b, "win_index": 55, "score": 2000})
    assert r.json() == {"rank": 2, "total_players": 2}


def test_leaderboard_uses_best_score_per_player(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    a = c.post("/api/players", json={"username": "alice"}).json()["player_id"]
    c.post("/api/scores", json={"player_id": a, "win_index": 40, "score": 1000})
    c.post("/api/scores", json={"player_id": a, "win_index": 90, "score": 5000})
    lb = c.get("/api/leaderboard").json()["players"]
    assert len(lb) == 1 and lb[0]["win_index"] == 90
