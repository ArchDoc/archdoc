export interface Doc {
  headings: string[];
  links: string[];
}

export function toDoc(html: string): Doc {
  return {
    headings: [...html.matchAll(/<h\d>(.*?)<\/h\d>/g)].map((m) => m[1] ?? ""),
    links: [...html.matchAll(/href="(.*?)"/g)].map((m) => m[1] ?? ""),
  };
}
