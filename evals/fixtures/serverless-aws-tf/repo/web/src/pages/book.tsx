import { useState } from "react";
import { createBooking } from "../api";

export function BookPage() {
  const [slot, setSlot] = useState("");
  const [partySize, setPartySize] = useState(2);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void createBooking({ restaurant: "harbor", slot, partySize });
      }}
    >
      <input value={slot} onChange={(e) => setSlot(e.target.value)} />
      <input
        type="number"
        value={partySize}
        onChange={(e) => setPartySize(Number(e.target.value))}
      />
      <button type="submit">Book</button>
    </form>
  );
}
