# tests/test_db.py
import sqlite3

import db


def test_init_db_creates_tables(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    db.init_db()
    conn = sqlite3.connect(str(tmp_path / "t.db"))
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"players", "scores"} <= tables
    conn.close()


def test_player_username_unique(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    db.init_db()
    conn = db.get_conn()
    conn.execute(
        "INSERT INTO players (username, email, created_at) VALUES ('saul', NULL, 0)")
    conn.commit()
    try:
        conn.execute(
            "INSERT INTO players (username, email, created_at) VALUES ('saul', NULL, 0)")
        conn.commit()
        raised = False
    except sqlite3.IntegrityError:
        raised = True
    finally:
        conn.close()
    assert raised
