export interface Product {
  id: string;
  name: string;
  cents: number;
}

export interface Order {
  id: string;
  items: string[];
  totalCents: number;
}
