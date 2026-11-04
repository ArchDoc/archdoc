const API = import.meta.env.VITE_API_URL;

export interface NewBooking {
  restaurant: string;
  slot: string;
  partySize: number;
}

export async function createBooking(b: NewBooking) {
  const res = await fetch(`${API}/bookings`, { method: "POST", body: JSON.stringify(b) });
  return res.json();
}

export async function myBookings() {
  return (await fetch(`${API}/bookings`)).json();
}

export async function booking(id: string) {
  return (await fetch(`${API}/bookings/${id}`)).json();
}
