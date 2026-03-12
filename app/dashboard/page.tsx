import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: currencies, error } = await supabase
    .from("currencies")
    .select("*");

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Dashboard</h1>
      <h2>Currencies</h2>
      {error ? (
        <p style={{ color: "red" }}>Error loading currencies: {error.message}</p>
      ) : (
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            maxWidth: "600px",
          }}
        >
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: "8px", textAlign: "left" }}>Code</th>
              <th style={{ border: "1px solid #ccc", padding: "8px", textAlign: "left" }}>Name</th>
              <th style={{ border: "1px solid #ccc", padding: "8px", textAlign: "left" }}>Symbol</th>
            </tr>
          </thead>
          <tbody>
            {currencies?.map((currency) => (
              <tr key={currency.code}>
                <td style={{ border: "1px solid #ccc", padding: "8px" }}>{currency.code}</td>
                <td style={{ border: "1px solid #ccc", padding: "8px" }}>{currency.name}</td>
                <td style={{ border: "1px solid #ccc", padding: "8px" }}>{currency.symbol}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
