import { useEffect, useState } from "react";
import { query } from "../api";

export function TargetsPage() {
  const [latency, setLatency] = useState<number>();
  useEffect(() => {
    query("latency(api)[5m]").then(setLatency);
  }, []);
  return <p>API latency: {latency?.toFixed(3)}s</p>;
}
