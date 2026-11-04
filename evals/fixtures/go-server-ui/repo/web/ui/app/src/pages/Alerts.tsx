import { useEffect, useState } from "react";
import { type Alert, firingAlerts } from "../api";

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => {
    firingAlerts().then(setAlerts);
  }, []);
  return (
    <main>
      <h1>Alerts</h1>
      <ul>
        {alerts.map((a) => (
          <li key={a.name}>
            {a.name}: {a.expr} = {a.value} since {a.since}
          </li>
        ))}
      </ul>
    </main>
  );
}
