import { useEffect, useState } from "react";
import { booking, myBookings } from "../api";

export function MyBookingsPage() {
  const [list, setList] = useState<{ bookingId: string; slot: string; status: string }[]>([]);
  const [open, setOpen] = useState<unknown>();
  useEffect(() => {
    void myBookings().then(setList);
  }, []);
  return (
    <ul>
      {list.map((b) => (
        <li key={b.bookingId}>
          <button type="button" onClick={() => void booking(b.bookingId).then(setOpen)}>
            {b.slot} ({b.status})
          </button>
        </li>
      ))}
      {open ? <pre>{JSON.stringify(open)}</pre> : null}
    </ul>
  );
}
