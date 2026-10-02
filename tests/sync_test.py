"""Offline regression tests for the read-only ConfTool import/reconciliation."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import fetch_conftool as sync  # noqa: E402


def talk(ident, paper_id, title, speaker, room="SR 113", status=None):
    item = {
        "id": ident, "conftool_paper_id": paper_id, "type": "talk",
        "day": "2026-10-01", "start": "09:00", "end": "09:30",
        "room": room, "panel_id": "panel-1", "title": title,
        "speakers": [speaker], "abstract": None,
    }
    if status:
        item["status"] = status
    return item


def program(sessions):
    return {"sessions": sessions, "panels": [
        {"id": "panel-1", "title": "Langes Panel", "day": "2026-10-01",
         "block_start": "09:00", "room": "SR 113"}], "events": [], "blocks": []}


class SyncTests(unittest.TestCase):
    def test_cancelled_slot_does_not_pull_later_talks_forward(self):
        def timed(ident, paper_id, start, end, room="SR 113"):
            item = talk(ident, paper_id, f"Beitrag {paper_id}", f"Person {paper_id}", room=room)
            item.update(start=start, end=end)
            return item

        old = program([
            timed("missing", "100", "10:00", "10:30"),
            timed("next", "101", "10:30", "11:00"),
            timed("later", "102", "11:00", "11:30"),
            timed("elsewhere", "103", "10:30", "11:00", room="SR 206"),
        ])
        fresh = program([
            timed("next-new", "101", "10:00", "10:30"),
            timed("later-new", "102", "10:30", "11:00"),
            timed("elsewhere-new", "103", "10:00", "10:30", room="SR 206"),
        ])
        merged = sync.reconcile_programs(old, copy.deepcopy(fresh), [])
        by_id = {s["id"]: s for s in merged["sessions"]}
        self.assertEqual((by_id["missing"]["start"], by_id["missing"]["status"]),
                         ("10:00", "cancelled"))
        self.assertEqual((by_id["next"]["start"], by_id["next"]["end"]),
                         ("10:30", "11:00"))
        self.assertEqual((by_id["later"]["start"], by_id["later"]["end"]),
                         ("11:00", "11:30"))
        self.assertEqual(by_id["elsewhere"]["start"], "10:00")
        self.assertEqual(sync.diff_programs(old, merged)["counts"],
                         {"new": 0, "changed": 1, "removed": 1})

        repeated = sync.reconcile_programs(merged, copy.deepcopy(fresh), [])
        self.assertEqual(sync.diff_programs(merged, repeated)["counts"],
                         {"new": 0, "changed": 0, "removed": 0})

    def test_app_first_author_keeps_affiliation_and_does_not_repeat_as_change(self):
        item = talk("paper-342", "342", "Gemeinsamer Vortrag", "Tatjana Kurbangulova")
        item["speakers"] = ["Tatjana Kurbangulova", "Olia Blacher", "Chingiz Poletaev"]
        item["affiliations"] = ["Innsbruck", "Jena", "Konstanz"]
        source = program([item])
        sync.apply_app_author_order(source)
        corrected = source["sessions"][0]
        self.assertEqual(corrected["speakers"],
                         ["Chingiz Poletaev", "Tatjana Kurbangulova", "Olia Blacher"])
        self.assertEqual(corrected["affiliations"], ["Konstanz", "Innsbruck", "Jena"])
        repeated = copy.deepcopy(source)
        sync.apply_app_author_order(repeated)
        self.assertEqual(sync.diff_programs(source, repeated)["counts"],
                         {"new": 0, "changed": 0, "removed": 0})

    def test_change_history_preserves_real_updates_without_duplicates(self):
        def batch(stamp, title=None):
            new = [{"id": title, "title": title}] if title else []
            return {"counts": {"new": len(new), "changed": 0, "removed": 0},
                    "new": new, "changed": [], "removed": [], "generated_at": stamp}

        first = batch("2026-09-28T12:00:00+02:00", "Erster Titel")
        second = batch("2026-09-29T10:00:00+02:00", "Zweiter Titel")
        third = batch("2026-09-29T11:00:00+02:00", "Dritter Titel")
        migrated = sync.with_change_history(first, second)
        self.assertEqual(migrated["history"], [first])
        self.assertEqual(migrated["new"], second["new"])

        no_change = sync.with_change_history(migrated, batch("2026-09-29T10:30:00+02:00"))
        self.assertEqual(no_change["history"], [first, second])
        resumed = sync.with_change_history(no_change, third)
        self.assertEqual(resumed["history"], [first, second])
        self.assertEqual(resumed["new"], third["new"])

        duplicate = {**second, "history": [first, second]}
        self.assertEqual(sync.with_change_history(duplicate, third)["history"], [first, second])

    def test_obfuscated_footer_id_is_not_a_program_change(self):
        old = program([])
        old["events"] = [{"id": "event-1", "people": "Kontakt ctmail5de5c4bc"}]
        fresh = copy.deepcopy(old)
        fresh["events"][0]["people"] = "Kontakt ctmail7a359e2c"
        self.assertEqual(sync.canonical(old), sync.canonical(fresh))
        fresh["events"][0]["people"] = "Neuer Kontakt ctmail7a359e2c"
        self.assertNotEqual(sync.canonical(old), sync.canonical(fresh))

    def test_name_title_room_cancellation_and_reinstatement(self):
        old = program([
            talk("stable-a", "101", "Alter Titel", "Alice", status=None),
            talk("stable-b", "102", "Beitrag B", "Bob"),
            talk("stable-c", "103", "Beitrag C", "Carol"),
        ])
        fresh = program([
            talk("moving-a", "101", "Neuer Titel", "Alicia", room="SR 206"),
            talk("moving-b", "102", "Beitrag B", "Bobby"),
        ])
        merged = sync.reconcile_programs(old, copy.deepcopy(fresh), [])
        by_id = {s["id"]: s for s in merged["sessions"]}
        self.assertEqual(by_id["stable-a"]["room"], "SR 206")
        self.assertEqual(by_id["stable-a"]["title"], "Neuer Titel")
        self.assertEqual(by_id["stable-a"]["speakers"], ["Alicia"])
        self.assertEqual(by_id["stable-b"]["speakers"], ["Bobby"])
        self.assertEqual(by_id["stable-c"]["status"], "cancelled")
        diff = sync.diff_programs(old, merged)
        self.assertEqual(diff["counts"], {"new": 0, "changed": 2, "removed": 1})

        restored = copy.deepcopy(fresh)
        restored["sessions"].append(talk("new-c", "103", "Beitrag C", "Carol"))
        revived = sync.reconcile_programs(merged, restored, [])
        self.assertNotIn("status", next(s for s in revived["sessions"] if s["id"] == "stable-c"))
        self.assertEqual(sync.diff_programs(merged, revived)["counts"]["new"], 1)

    def test_legacy_title_match_keeps_favorites_id(self):
        old = program([talk("old-slot-id", None, "Unveraenderter Titel", "Alice")])
        fresh = program([talk("new-slot-id", "901", "Unveraenderter Titel", "Alice", room="SR 206")])
        merged = sync.reconcile_programs(old, fresh, [])
        self.assertEqual(merged["sessions"][0]["id"], "old-slot-id")
        self.assertEqual(merged["sessions"][0]["conftool_paper_id"], "901")

    def test_speakerless_panel_copy_is_not_preserved(self):
        ghost = talk("ghost", None, "Langes Panel", "")
        ghost["speakers"] = []
        old = program([ghost])
        merged = sync.reconcile_programs(old, program([]), [])
        self.assertEqual(merged["sessions"], [])

    def test_mass_disappearance_stops_publication(self):
        old = program([talk(f"old-{n}", str(n), f"Beitrag {n}", f"Name {n}") for n in range(9)])
        with self.assertRaisesRegex(ValueError, "9 Beitraege"):
            sync.reconcile_programs(old, program([]), [])


if __name__ == "__main__":
    unittest.main()
