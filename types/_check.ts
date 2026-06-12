import type { Database } from "./database";
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
const _p: ProfileRow = { 
  id: "x", role: "client", full_name: "x", email: "x",
  phone: null, trainer_id: null, created_at: "x", updated_at: "x"
};
console.log(_p.id);
