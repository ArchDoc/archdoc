import psycopg


def triage(title: str) -> None:
    priority = "high" if "outage" in title.lower() else "normal"
    with psycopg.connect("postgresql://postgres/tickets") as conn:
        conn.execute("update tickets set priority = %s where title = %s", (priority, title))
