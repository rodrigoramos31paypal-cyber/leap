import type { Database } from "@/types/database";
type X = Database["public"]["Tables"]["profiles"]["Row"];
const x: X = null as any;
console.log(x.id);
