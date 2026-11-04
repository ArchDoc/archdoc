import { useState } from "react";
import { complete } from "./complete";

/** A query input that completes function names and runs the query on Enter. */
export function QueryEditor({ onRun }: { onRun: (q: string) => void }) {
  const [q, setQ] = useState("");
  const hints = complete(q);
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun(q)}
      />
      {hints.length > 0 && (
        <ul>
          {hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
