"""
Dev seed: inject a fake comp_events row + events list entry + set prefetch.
Run: uv run --project backend --env-file backend/.env python backend/temp_seed.py
"""
import asyncio, json, os
import asyncpg
import dotenv

dotenv.load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
EVENT_KEY    = "2025casj"   # Real TBA key; 3473 may not have attended, so matches/rankings may be empty

COMP_EVENT = {
    "event_key":   EVENT_KEY,
    "event_name":  "2025 Silicon Valley Regional",
    "links": json.dumps({
        "tba":        f"https://www.thebluealliance.com/event/{EVENT_KEY}",
        "statbotics": f"https://www.statbotics.io/event/{EVENT_KEY}",
        "nexus":      f"https://frc.nexus/en/event/{EVENT_KEY}",
        "youtube":    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
"twitch":    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }),
    # Today's itinerary — items before ~10 AM will be past, items after will be upcoming
    "itinerary": json.dumps([
        {"dt": "2026-08-13T07:00:00", "label": "Depart School",            "detail": "Meet in the parking lot at 7 AM"},
        {"dt": "2026-08-13T08:30:00", "label": "Arrive at Venue",          "detail": "SAP Center, San Jose"},
        {"dt": "2026-08-13T09:00:00", "label": "Pit Setup",                "detail": None},
        {"dt": "2026-08-13T09:30:00", "label": "Practice Matches",         "detail": None},
        {"dt": "2026-08-13T10:30:00", "label": "Opening Ceremonies",       "detail": None},
        {"dt": "2026-08-13T11:00:00", "label": "Qualification Matches",    "detail": "Day 1 quals begin"},
        {"dt": "2026-08-13T12:30:00", "label": "Lunch",                    "detail": "30 min, stay near pit"},
        {"dt": "2026-08-13T13:15:00", "label": "Qualification Matches",    "detail": "Quals continue"},
        {"dt": "2026-08-13T17:00:00", "label": "Break",                    "detail": "15 min"},
        {"dt": "2026-08-13T17:15:00", "label": "Qualification Matches",    "detail": "Final quals of the day"},
        {"dt": "2026-08-13T20:00:00", "label": "Day 1 End",                "detail": "Secure robot in pit"},
        {"dt": "2026-08-14T07:30:00", "label": "Arrive at Venue",          "detail": "Day 2"},
        {"dt": "2026-08-14T08:30:00", "label": "Qualification Matches",    "detail": "Day 2 quals begin"},
        {"dt": "2026-08-14T12:00:00", "label": "Lunch",                    "detail": None},
        {"dt": "2026-08-14T13:00:00", "label": "Alliance Selection",       "detail": None},
        {"dt": "2026-08-14T14:00:00", "label": "Playoff Matches",          "detail": None},
        {"dt": "2026-08-14T18:30:00", "label": "Awards Ceremony",          "detail": None},
        {"dt": "2026-08-14T19:30:00", "label": "Depart for Home",          "detail": None},
    ]),
    "packing_list": json.dumps([
        {
            "category": "Robot",
            "items": ["Robot", "Bumpers (red + blue)", "Battery x4", "Battery charger", "Radio", "Driver station laptop"],
        },
        {
            "category": "Tools",
            "items": ["Impact driver", "Socket set", "Allen key set", "Zip ties", "Electrical tape", "Wire crimpers"],
        },
        {
            "category": "Pit",
            "items": ["Pit banner", "Extension cord", "Power strip", "Spare motors x2", "Spare gearboxes"],
        },
        {
            "category": "Personal",
            "items": ["Team shirt", "ID / permission slip", "Lunch / snacks", "Water bottle", "Comfortable shoes"],
        },
    ]),
    "instructions": json.dumps([
        {
            "heading": "Pit Conduct",
            "body": "Keep the pit area clean and organized at all times. Only designated students may handle the robot during matches. Mentors handle all battery swaps.",
        },
        {
            "heading": "Drive Team",
            "body": "Report to the queuing station 2 matches before your match number. Bring the drive station laptop, radio, and a fully charged battery.",
        },
        {
            "heading": "Scouting",
            "body": "All students not in the pit or drive team are expected to be scouting. See lead mentor for assignments before quals start.",
        },
    ]),
    "roster": json.dumps([
        {"user_id": None, "display_name": "Coach Smith",   "role": "mentor",     "phone": "555-0101"},
        {"user_id": None, "display_name": "Coach Johnson", "role": "mentor",     "phone": "555-0102"},
        {"user_id": None, "display_name": "Alex Chen",     "role": "captain",    "phone": "555-0201"},
        {"user_id": None, "display_name": "Jordan Lee",    "role": "lead",       "phone": "555-0202"},
        {"user_id": None, "display_name": "Sam Park",      "role": "drive_team", "phone": None},
        {"user_id": None, "display_name": "Riley Kim",     "role": "drive_team", "phone": None},
        {"user_id": None, "display_name": "Morgan Davis",  "role": "drive_team", "phone": None},
        {"user_id": None, "display_name": "Casey Wilson",  "role": "pit_crew",   "phone": None},
        {"user_id": None, "display_name": "Taylor Brown",  "role": "pit_crew",   "phone": None},
        {"user_id": None, "display_name": "Drew Martinez", "role": "pit_crew",   "phone": None},
        {"user_id": None, "display_name": "Jamie Garcia",  "role": "attending",  "phone": None},
        {"user_id": None, "display_name": "Quinn Adams",   "role": "attending",  "phone": None},
    ]),
}

EVENTS_ROW = {
    "name":         "Silicon Valley Regional",
    "start_time":   "2026-03-20",
    "end_time":     "2026-03-21",
    "location":     "San Jose, CA",
    "event_type":   "regional",
    "url":          f"/events/{EVENT_KEY}",
    "tba_key":      EVENT_KEY,
    "display_order": 1,
}


async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Upsert comp_event
        await conn.execute("""
            INSERT INTO comp_events (event_key, event_name, links, itinerary, packing_list, instructions, roster)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (event_key) DO UPDATE SET
                event_name   = EXCLUDED.event_name,
                links        = EXCLUDED.links,
                itinerary    = EXCLUDED.itinerary,
                packing_list = EXCLUDED.packing_list,
                instructions = EXCLUDED.instructions,
                roster       = EXCLUDED.roster
        """,
            COMP_EVENT["event_key"], COMP_EVENT["event_name"],
            COMP_EVENT["links"], COMP_EVENT["itinerary"],
            COMP_EVENT["packing_list"], COMP_EVENT["instructions"],
            COMP_EVENT["roster"],
        )
        print(f"✓ comp_events upserted: {EVENT_KEY}")

        # Upsert events list row
        existing = await conn.fetchrow("SELECT id FROM events WHERE tba_key = $1", EVENT_KEY)
        if existing:
            await conn.execute("""
                UPDATE events SET name=$1, start_time=$2, end_time=$3, location=$4,
                    event_type=$5, url=$6, display_order=$7
                WHERE tba_key=$8
            """, EVENTS_ROW["name"], EVENTS_ROW["start_time"], EVENTS_ROW["end_time"],
                EVENTS_ROW["location"], EVENTS_ROW["event_type"], EVENTS_ROW["url"],
                EVENTS_ROW["display_order"], EVENT_KEY)
        else:
            await conn.execute("""
                INSERT INTO events (name, start_time, end_time, location, event_type, url, tba_key, display_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, EVENTS_ROW["name"], EVENTS_ROW["start_time"], EVENTS_ROW["end_time"],
                EVENTS_ROW["location"], EVENTS_ROW["event_type"], EVENTS_ROW["url"],
                EVENT_KEY, EVENTS_ROW["display_order"])
        print(f"✓ events list row upserted: {EVENT_KEY}")

        # Set prefetch
        await conn.execute("UPDATE app_config SET prefetch_event_id = $1", EVENT_KEY)
        print(f"✓ app_config.prefetch_event_id = {EVENT_KEY}")

        print("\nDone. Visit /events to see the event list, /events/2025casj for the event hub.")
    finally:
        await conn.close()


asyncio.run(main())
