import { useEffect, useState } from "react";
import { runQuery } from "../api";

const TARGETS = ["api", "web", "db"];

export function StatusPage() {
  const [up, setUp] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const t of TARGETS)
      runQuery(`up(${t})`).then((r) => setUp((u) => ({ ...u, [t]: r.value })));
  }, []);
  return (
    <main>
      <h1>Status</h1>
      <table>
        <tbody>
          {TARGETS.map((t) => (
            <tr key={t}>
              <td>{t}</td>
              <td>{Math.round((up[t] ?? 0) * 100)}% up</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
