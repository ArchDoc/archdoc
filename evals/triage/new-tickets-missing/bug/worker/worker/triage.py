import psycopg


def triage(title: str) -> None:
    priority = "high" if "outage" in title.lower() else "normal"
    with psycopg.connect("postgresql://postgres/tickets") as conn:
        cur = conn.execute(
            "update tickets set priority = %s where title = %s", (priority, title)
        )
        print(f"priority {priority} for {title!r}: {cur.rowcount} rows updated")
