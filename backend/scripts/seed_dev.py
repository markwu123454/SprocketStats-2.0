"""Fill the dev database with made-up team data for trying the app out.

Run from the repository root:

    uv run --project backend --env-file backend/.env python backend/scripts/seed_dev.py
    uv run --project backend --env-file backend/.env python backend/scripts/seed_dev.py --remove

What it adds, all around fake members whose ids start with ``seed-`` (emails at
example.com, so they can never sign in with Google; use the dev sign-in):

* about 30 members: a captain, mentors, a lead and members per subteam, alumni
  and visitors, including two pending approval, two banned, one who hasn't
  finished onboarding, two with kiosk access, and a few tags
* six weeks of past meetings plus two upcoming weeks, with check-ins (so the
  attendance leaderboard has numbers) and some absences
* about 40 tasks in every status, with contributors and notes
* three in-app notifications with responses, and two push messages with
  delivery logs
* check-ins on the rosters of two events

The banned members are deliberately on tasks, rosters, notifications and the
attendance records, so banning and unbanning can be seen working everywhere.

Re-running replaces everything it added before (same data each time: the random
generator is seeded). ``--remove`` only deletes it. Real accounts are never
touched. Refuses to run unless ``ENV=development``.
"""

import argparse
import asyncio
import os
import random
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.connection import DB_NAME, close_pool, db_connection  # noqa: E402

PREFIX = "seed-"
TZ = ZoneInfo("America/Los_Angeles")
rng = random.Random(3473)

SUBTEAMS = ["cad", "manufacturing", "programming", "scouting", "publicity", "operations", "outreach"]
GRADES = ["freshman", "sophomore", "junior", "senior"]

FIRST = ["Aarav", "Maya", "Ethan", "Sofia", "Lucas", "Chloe", "Noah", "Ava", "Leo", "Isla", "Kai", "Zoe",
         "Mateo", "Emma", "Ryan", "Nora", "Arjun", "Lily", "Owen", "Mia", "Daniel", "Hana", "Jonah", "Elena",
         "Felix", "Grace", "Omar", "Ruby", "Theo", "Ana", "Sam", "Iris"]
LAST = ["Patel", "Nguyen", "Garcia", "Kim", "Chen", "Rivera", "Okafor", "Singh", "Lopez", "Tanaka", "Haddad",
        "Kowalski", "Fischer", "Moreno", "Sato", "Ibrahim", "Brooks", "Park", "Silva", "Novak"]

AREAS = {
    "cad": ["Drivetrain", "Intake", "Elevator", "Bumpers"],
    "manufacturing": ["CNC", "Lathe", "Assembly", "Shop"],
    "programming": ["Autonomous", "Vision", "Swerve", "Dashboard"],
    "scouting": ["App", "Strategy", "Pit scouting"],
    "publicity": ["Social media", "Video", "Website"],
    "operations": ["Travel", "Budget", "Inventory"],
    "outreach": ["FLL", "Demos", "Sponsors"],
    "general": ["General", "Competition prep"],
}
TASK_TITLES = {
    "cad": ["Model the intake rollers", "Revise elevator carriage", "Add bumper mounts to the frame",
            "Export drawings for the gearbox plates", "Check clearances on the arm pivot"],
    "manufacturing": ["Cut the drivetrain side plates", "Turn new axle spacers", "Restock rivets and bolts",
                      "Tap the elevator tube ends", "Clean and oil the CNC"],
    "programming": ["Tune swerve module PID", "Write a two-piece auto", "Fix the vision pipeline latency",
                    "Add a driver dashboard for shooter speed", "Log battery voltage per match"],
    "scouting": ["Update the scouting form for this season", "Train new scouts", "Build the pick list sheet",
                 "Test offline sync in the app"],
    "publicity": ["Post build-week recap", "Edit the robot reveal video", "Update the sponsor page",
                  "Photograph the new robot"],
    "operations": ["Book hotel rooms for regionals", "Collect travel forms", "Order spare batteries",
                   "Reconcile the parts budget"],
    "outreach": ["Plan the FLL mentoring night", "Schedule the library demo", "Write sponsor thank-you notes",
                 "Prepare the STEM fair booth"],
    "general": ["Clean the shop before the open house", "Pack the pit cart", "Label every toolbox",
                "Make a safety glasses checklist"],
}
NOTES = ["Started on this, should be done by Friday.", "Blocked on parts, waiting for the order.",
         "Can someone check my numbers?", "Looks good, just fix the tolerance on the second plate.",
         "Pushed a first version.", "I can help with this after school tomorrow.",
         "Needs a review before we cut anything.", "Done, moving it to review."]
ABSENCE_REASONS = ["Doctor's appointment", "Family event", "Exam the next day", "Sick", "Club conflict",
                   "Out of town", ""]


def member(uid, first, last, role, *, grade=None, year=None, approved=True, banned=False,
           onboarded=True, kiosk=None, first_team=None):
    return {
        "id": PREFIX + uid, "first": first, "last": last, "role": role, "grade": grade, "year": year,
        "approved": approved, "banned": banned, "onboarded": onboarded, "kiosk": kiosk, "first_team": first_team,
    }


def build_members() -> list[dict]:
    names = iter(rng.sample([(f, l) for f in FIRST for l in LAST], 40))
    people = [
        member("captain", "Priya", "Raman", "captain", grade="senior", year="year_4"),
        member("mentor-1", "David", "Okonkwo", "mentor"),
        member("mentor-2", "Laura", "Bennett", "mentor"),
    ]
    for team in SUBTEAMS:
        f, l = next(names)
        # Two leads are still waiting for approval.
        people.append(member(f"{team}-lead", f, l, f"{team}_lead", grade=rng.choice(GRADES[2:]),
                             year=rng.choice(["year_2", "year_3"]), approved=team not in ("publicity", "outreach")))
        for i in range(rng.choice([2, 3])):
            f, l = next(names)
            people.append(member(f"{team}-{i + 1}", f, l, f"{team}_member", grade=rng.choice(GRADES),
                                 year=rng.choice(["year_1", "year_1", "year_2", "year_3"])))
    for i in range(2):
        f, l = next(names)
        people.append(member(f"alum-{i + 1}", f, l, "alumni"))
    f, l = next(names)
    people.append(member("visitor-1", f, l, "visitor", first_team=("FTC", 16072)))
    f, l = next(names)
    people.append(member("visitor-2", f, l, "visitor"))
    f, l = next(names)
    people.append(member("new-signup", f, l, None, onboarded=False, approved=False))

    by_id = {p["id"]: p for p in people}
    # Banned: a programming member and the scouting lead, both busy elsewhere in the data.
    by_id[PREFIX + "programming-1"]["banned"] = True
    by_id[PREFIX + "scouting-lead"]["banned"] = True
    # Kiosk access granted from the Members page: one open-ended, one for the afternoon.
    by_id[PREFIX + "operations-1"]["kiosk"] = "no_end"
    by_id[PREFIX + "manufacturing-1"]["kiosk"] = "2h"
    return people


def is_student(p) -> bool:
    return p["role"] is not None and p["role"] not in ("mentor", "alumni", "visitor")


def subteam(p) -> str | None:
    role = p["role"] or ""
    return role.rsplit("_", 1)[0] if role.endswith(("_lead", "_member")) else None


async def remove(conn) -> None:
    """Delete every row the seed added (in foreign-key order), leaving real accounts alone."""
    seed = PREFIX + "%"
    await conn.execute("DELETE FROM notification_responses WHERE user_id LIKE $1", seed)
    await conn.execute("DELETE FROM notifications WHERE created_by LIKE $1", seed)
    await conn.execute("DELETE FROM push_messages WHERE created_by LIKE $1", seed)
    await conn.execute("DELETE FROM push_delivery_logs WHERE user_id LIKE $1", seed)
    await conn.execute("DELETE FROM tasks WHERE created_by LIKE $1", seed)
    await conn.execute("DELETE FROM attendance WHERE user_id LIKE $1", seed)
    await conn.execute("DELETE FROM meeting_hours WHERE created_by LIKE $1", seed)
    await conn.execute("DELETE FROM event_roster WHERE user_id LIKE $1", seed)
    await conn.execute("DELETE FROM users WHERE id LIKE $1", seed)


async def insert_members(conn, people) -> None:
    captain = PREFIX + "captain"
    now = datetime.now(TZ)
    for p in people:
        name = f'{p["first"]} {p["last"]}'
        kiosk_until = now + timedelta(hours=2) if p["kiosk"] == "2h" else None
        program, number = p["first_team"] or (None, None)
        await conn.execute(
            """
            INSERT INTO users (id, email, name, given_name, display_name, role, onboarding_complete,
                               grade, team_year, banned_at, kiosk_access_until, kiosk_access_no_end,
                               first_program, first_team_number, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            """,
            p["id"], f'{p["id"]}@example.com', name if p["onboarded"] else None,
            p["first"] if p["onboarded"] else None, p["first"] if p["onboarded"] else None,
            p["role"], p["onboarded"], p["grade"], p["year"],
            now - timedelta(days=rng.randint(1, 9)) if p["banned"] else None,
            kiosk_until, p["kiosk"] == "no_end", program, number,
            now - timedelta(days=rng.randint(30, 200)),
        )
    # Approvals point at the captain, so they go in once every row exists.
    for p in people:
        if p["approved"] and p["onboarded"]:
            await conn.execute("UPDATE users SET approved_by = $2 WHERE id = $1",
                               p["id"], p["id"] if p["id"] == captain else captain)
    tags = {"captain": ["drive_team"], "programming-lead": ["drive_team"], "cad-1": ["drive_team"],
            "operations-lead": ["safety_captain"], "mentor-1": ["first_aid"], "programming-1": ["drive_team"]}
    for uid, ts in tags.items():
        for tag in ts:
            await conn.execute("INSERT INTO user_tags (user_id, tag, assigned_by) VALUES ($1, $2, $3)",
                               PREFIX + uid, tag, captain)


def meeting_slots(today: date):
    """Mon/Wed/Fri afternoons and Saturday mornings, six weeks back and two forward."""
    start = today - timedelta(weeks=6)
    for offset in range((today + timedelta(weeks=2) - start).days):
        day = start + timedelta(days=offset)
        if day.weekday() in (0, 2, 4):
            yield day, time(15, 30), time(18, 0), "Build", 1.0
        elif day.weekday() == 5:
            yield day, time(9, 0), time(13, 0), "Saturday build", 1.5


async def insert_meetings(conn, people) -> None:
    captain = PREFIX + "captain"
    now = datetime.now(TZ)
    attendees = [p for p in people if p["onboarded"] and (is_student(p) or p["role"] == "mentor")]
    # How reliably each person shows up.
    reliability = {p["id"]: rng.uniform(0.45, 0.95) for p in attendees}
    agendas = ["Finish the intake prototype\nDrive practice at 5", "Safety talk\nSubteam work time",
               "Design review for the elevator", "Scouting training in room 204", ""]
    for day, t0, t1, purpose, mult in meeting_slots(now.date()):
        start, end = datetime.combine(day, t0, TZ), datetime.combine(day, t1, TZ)
        meeting_id = await conn.fetchval(
            """
            INSERT INTO meeting_hours (created_by, start_time, end_time, meeting_purpose, hours_multiplier, agenda)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
            """,
            captain, start, end, purpose, mult, rng.choice(agendas),
        )
        if end < now:
            for p in attendees:
                if rng.random() > reliability[p["id"]]:
                    if rng.random() < 0.3:
                        await conn.execute(
                            "INSERT INTO meeting_absences (meeting_id, user_id, reason) VALUES ($1, $2, $3)",
                            meeting_id, p["id"], rng.choice(ABSENCE_REASONS))
                    continue
                checkin = start + timedelta(minutes=rng.randint(-10, 30))
                checkout = end + timedelta(minutes=rng.randint(-40, 20))
                await conn.execute(
                    """
                    INSERT INTO attendance (user_id, checkin_time, checkout_time, source, checkout_method)
                    VALUES ($1, $2, $3, 'kiosk', $4)
                    """,
                    p["id"], checkin, checkout, "self" if rng.random() < 0.2 else "kiosk",
                )
        elif start > now and rng.random() < 0.5:
            for p in rng.sample(attendees, rng.randint(1, 4)):
                await conn.execute(
                    "INSERT INTO meeting_absences (meeting_id, user_id, reason) VALUES ($1, $2, $3)",
                    meeting_id, p["id"], rng.choice(ABSENCE_REASONS))


async def insert_tasks(conn, people) -> int:
    active = [p for p in people if p["onboarded"] and is_student(p)]
    leads = {subteam(p): p for p in people if (p["role"] or "").endswith("_lead")}
    captain = PREFIX + "captain"
    banned = [p["id"] for p in people if p["banned"]]
    today = date.today()
    count = 0
    statuses = ["todo"] * 3 + ["doing"] * 3 + ["review"] * 2 + ["done"] * 3
    for bucket, titles in TASK_TITLES.items():
        for title in titles:
            team = [p for p in active if subteam(p) == bucket] or active
            status = rng.choice(statuses)
            creator = (leads.get(bucket) or {"id": captain})["id"]
            assignee = None if status == "todo" and rng.random() < 0.6 else rng.choice(team)["id"]
            finished = assignee if status in ("review", "done") else None
            reviewer = rng.choice([creator, captain]) if status == "done" else None
            if reviewer == finished:
                reviewer = captain if finished != captain else PREFIX + "mentor-1"
            task_id = await conn.fetchval(
                """
                INSERT INTO tasks (title, area, bucket, priority, status, assignee_id, due_date, created_by,
                                   finished_by, reviewed_by, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
                """,
                title, rng.choice(AREAS[bucket]), bucket,
                rng.choices(["low", "med", "high", "critical"], [3, 5, 3, 1])[0], status, assignee,
                today + timedelta(days=rng.randint(-10, 21)) if rng.random() < 0.7 else None, creator,
                finished, reviewer, datetime.now(TZ) - timedelta(days=rng.randint(1, 40)),
            )
            count += 1
            people_on_it = {assignee} if assignee else set()
            if assignee:
                for helper in rng.sample(team, min(len(team), rng.randint(0, 2))):
                    if helper["id"] != assignee:
                        await conn.execute("INSERT INTO task_contributors (task_id, user_id) VALUES ($1, $2)",
                                           task_id, helper["id"])
                        people_on_it.add(helper["id"])
            authors = list(people_on_it | {creator})
            for _ in range(rng.randint(0, 3)):
                await conn.execute(
                    "INSERT INTO task_notes (task_id, author_id, body, created_at) VALUES ($1, $2, $3, $4)",
                    task_id, rng.choice(authors), rng.choice(NOTES),
                    datetime.now(TZ) - timedelta(hours=rng.randint(1, 300)))
    # Make sure the banned members are on the board: one claimed task each, a
    # finished one, a contribution and a note, so hiding them is visible.
    b1, b2 = banned
    rows = await conn.fetch("SELECT id FROM tasks WHERE created_by LIKE $1 ORDER BY title", PREFIX + "%")
    claimed, finished, helped = rows[0]["id"], rows[1]["id"], rows[2]["id"]
    await conn.execute("UPDATE tasks SET assignee_id = $2, status = 'doing', finished_by = NULL, reviewed_by = NULL "
                       "WHERE id = $1", claimed, b1)
    await conn.execute("UPDATE tasks SET assignee_id = $2, status = 'done', finished_by = $2, reviewed_by = $3 "
                       "WHERE id = $1", finished, b2, captain)
    await conn.execute("UPDATE tasks SET assignee_id = COALESCE(assignee_id, $2) WHERE id = $1", helped, captain)
    await conn.execute(
        "INSERT INTO task_contributors (task_id, user_id) SELECT $1, $2 FROM tasks "
        "WHERE id = $1 AND assignee_id IS DISTINCT FROM $2 ON CONFLICT DO NOTHING", helped, b1)
    await conn.execute("INSERT INTO task_notes (task_id, author_id, body) VALUES ($1, $2, $3)",
                       helped, b1, "I'll take the wiring part of this.")
    return count


async def insert_notifications(conn, people) -> None:
    captain = PREFIX + "captain"
    onboarded = [p for p in people if p["onboarded"]]
    students = [p for p in onboarded if is_student(p)]
    student_roles = sorted({p["role"] for p in students})
    notices = [
        ("Permission slips for the regional", "Has a parent signed your travel permission slip?",
         student_roles, ["Yes, signed", "Not yet"], "single", students),
        ("Team shirt size", "Pick your shirt size for this season's order.",
         [], ["S", "M", "L", "XL"], "single", onboarded),
        ("Read the updated shop safety rules", "Please read the new safety rules before your next shop day.",
         [], [], "single", onboarded),
    ]
    for title, body, roles, options, mode, audience in notices:
        nid = await conn.fetchval(
            """
            INSERT INTO notifications (title, body, target_roles, response_options, response_mode, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
            """,
            title, body, roles, options, mode, captain, datetime.now(TZ) - timedelta(days=rng.randint(1, 14)))
        responders = [p for p in audience if rng.random() < 0.65 or p["banned"]]
        for p in responders:
            await conn.execute(
                "INSERT INTO notification_responses (notification_id, user_id, response, responded_at) "
                "VALUES ($1, $2, $3, $4)",
                nid, p["id"], [rng.choice(options)] if options else [],
                datetime.now(TZ) - timedelta(hours=rng.randint(1, 200)))

    pushes = [("Meeting moved to the cafeteria", "Today's meeting is in the cafeteria; the shop is being cleaned."),
              ("Robot reveal tonight", "Livestream starts at 7 on the team channel.")]
    for title, body in pushes:
        targets = [p for p in onboarded if rng.random() < 0.8 or p["banned"]]
        pid = await conn.fetchval(
            "INSERT INTO push_messages (title, body, sent_count, created_by, created_at) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            title, body, len(targets), captain, datetime.now(TZ) - timedelta(days=rng.randint(1, 10)))
        for p in targets:
            await conn.execute(
                "INSERT INTO push_delivery_logs (push_message_id, user_id, endpoint, status) VALUES ($1, $2, $3, $4)",
                pid, p["id"], f"https://push.example.com/{p['id']}",
                rng.choices(["delivered", "failed", "sent"], [8, 1, 1])[0])


async def insert_rosters(conn, people) -> list[str]:
    events = await conn.fetch(
        "SELECT hub_key, start_time, end_time FROM events WHERE end_time IS NOT NULL AND checkin_enabled "
        "ORDER BY start_time LIMIT 2")
    going = [p for p in people if p["onboarded"] and (is_student(p) or p["role"] == "mentor")]
    for ev in events:
        first, last = date.fromisoformat(ev["start_time"][:10]), date.fromisoformat(ev["end_time"][:10])
        days = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]
        for p in [p for p in going if rng.random() < 0.6 or p["banned"]]:
            role = "mentor" if p["role"] == "mentor" else rng.choices(["attending", "drive_team", "pit_crew"], [6, 1, 2])[0]
            await conn.execute(
                "INSERT INTO event_roster (event_key, user_id, display_name, role, phone, days) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                ev["hub_key"], p["id"], f'{p["first"]} {p["last"]}', role,
                f"(626) 555-{rng.randint(1000, 9999)}" if rng.random() < 0.5 else None,
                rng.sample(days, rng.randint(1, len(days))) if len(days) > 1 else days)
    return [ev["hub_key"] for ev in events]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--remove", action="store_true", help="only delete what the seed added")
    args = parser.parse_args()
    if os.environ.get("ENV") != "development":
        sys.exit("Refusing to run: ENV is not 'development'. This script is for the dev database only.")

    try:
        async with db_connection(DB_NAME) as conn:
            async with conn.transaction():
                await remove(conn)
                if args.remove:
                    print("Removed the seeded data.")
                    return
                people = build_members()
                await insert_members(conn, people)
                await insert_meetings(conn, people)
                tasks = await insert_tasks(conn, people)
                await insert_notifications(conn, people)
                events = await insert_rosters(conn, people)
            summary = await conn.fetchrow(
                """
                SELECT (SELECT count(*) FROM users WHERE id LIKE $1) AS members,
                       (SELECT count(*) FROM meeting_hours WHERE created_by LIKE $1) AS meetings,
                       (SELECT count(*) FROM attendance WHERE user_id LIKE $1) AS checkins,
                       (SELECT count(*) FROM meeting_absences WHERE user_id LIKE $1) AS absences
                """, PREFIX + "%")
        print(f"Seeded {summary['members']} members, {summary['meetings']} meetings, {summary['checkins']} check-ins, "
              f"{summary['absences']} absences, {tasks} tasks, 3 notifications, 2 pushes, rosters on {', '.join(events)}.")
        print("Banned: seed-programming-1, seed-scouting-lead. Remove it all with --remove.")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
