import { QueryEditor } from "@pulse/query-editor";
import { useState } from "react";
import { type QueryResult, runQuery } from "../api";

export function QueryPage() {
  const [result, setResult] = useState<QueryResult>();
  const [error, setError] = useState<string>();
  return (
    <main>
      <h1>Query</h1>
      <QueryEditor
        onRun={(q) =>
          runQuery(q)
            .then(setResult)
            .catch((e: Error) => setError(e.message))
        }
      />
      {error && <p className="error">{error}</p>}
      {result && <output>{result.value}</output>}
    </main>
  );
}
